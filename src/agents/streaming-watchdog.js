import { eventBus, EVENT_TYPES } from '../events/event-bus.js';
import { logger } from '../utils/logger.js';

/**
 * Estimates token count from a string.
 * Rough approximation: ~4 chars per token.
 */
function estimateTokens(text) {
  return Math.ceil((text || '').length / 4);
}

/**
 * StreamingWatchdog monitors a Claude JSON-line output stream in real time
 * and signals early termination when anomalies are detected.
 *
 * Anomaly detectors:
 * 1. Wrong language — agent responds in a language other than expected
 * 2. Tool loop — same tool called 5+ consecutive times
 * 3. No access — agent says it cannot access required resources
 * 4. Wandering — 5K+ tokens of text output without any code block
 * 5. Watchdog alert — 8K+ tokens without a tool call (alert only)
 * 6. Watchdog kill — 20+ consecutive tool calls without text output
 * 7. Reviewer early approval — APPROVED found within first 3K chars of output
 */
export class StreamingWatchdog {
  /**
   * @param {string} agentName - PLANNER, CODER, REVIEWER, etc.
   * @param {Object} [options]
   * @param {string} [options.expectedLanguage] - 'english' | 'spanish' | null (no check)
   * @param {boolean} [options.reviewerMode] - Enable early-approval detection
   */
  constructor(agentName, options = {}) {
    this.agentName = agentName;
    this.expectedLanguage = options.expectedLanguage || null;
    this.reviewerMode = options.reviewerMode === true;

    // State tracking
    this._totalChars = 0;
    this._totalTokensEstimate = 0;
    this._charsAtLastToolCall = 0;
    this._tokensSinceLastCodeBlock = 0;
    this._consecutiveToolCalls = 0;
    this._lastToolName = null;
    this._consecutiveSameToolCount = 0;
    this._consecutiveToolCallsWithoutText = 0;

    // Termination signal
    this._terminated = false;
    this._terminationReason = null;

    // Kill callback — set by base-agent after spawn
    this._killFn = null;
  }

  /**
   * Register a callback that kills the subprocess immediately.
   * @param {Function} fn - () => void
   */
  onKill(fn) {
    this._killFn = fn;
  }

  /** True if the watchdog has triggered early termination. */
  get terminated() {
    return this._terminated;
  }

  /** Reason string if terminated, null otherwise. */
  get terminationReason() {
    return this._terminationReason;
  }

  /**
   * Estimated tokens saved — chars buffered but not yet processed by the agent.
   * Very rough estimate based on average chars per token.
   */
  get tokensSavedEstimate() {
    if (!this._terminated) return 0;
    // Assume the agent would have continued for ~2x what it already consumed
    return Math.round(this._totalTokensEstimate * 0.2);
  }

  /**
   * Feed a parsed Claude JSON-line message to the watchdog.
   * Call this for every JSON line emitted by the agent.
   *
   * @param {Object} msg - Parsed JSON line from Claude --output-format json
   * @param {string} rawAccumulatedOutput - The full stdout accumulated so far
   */
  feed(msg, rawAccumulatedOutput) {
    if (this._terminated) return;

    this._totalChars = (rawAccumulatedOutput || '').length;
    this._totalTokensEstimate = estimateTokens(rawAccumulatedOutput);

    // ── Reviewer early-approval detector ──────────────────────────────────
    if (this.reviewerMode && this._totalChars <= 3000) {
      const upper = (rawAccumulatedOutput || '').toUpperCase();
      if (upper.includes('APPROVED') || upper.includes('"APPROVE"') || upper.includes('"verdict":"APPROVED"')) {
        this._kill('reviewer_early_approved', `Reviewer emitted APPROVED within first 3K chars (${this._totalChars} chars processed)`);
        eventBus.emitEvent(EVENT_TYPES.REVIEWER_EARLY_APPROVED, {
          agentName: this.agentName,
          metadata: {
            charsAtDetection: this._totalChars,
            tokensEstimate: this._totalTokensEstimate,
            tokensSaved: this.tokensSavedEstimate,
          },
        });
        return;
      }
    }

    if (msg.type !== 'assistant' || !msg.message?.content) return;

    const content = msg.message.content;
    const toolUses = content.filter(c => c.type === 'tool_use');
    const textBlocks = content.filter(c => c.type === 'text' && c.text);

    // ── Tool loop detector ─────────────────────────────────────────────────
    for (const tu of toolUses) {
      if (tu.name === this._lastToolName) {
        this._consecutiveSameToolCount++;
        if (this._consecutiveSameToolCount >= 5) {
          this._kill('tool_loop', `Same tool "${tu.name}" called ${this._consecutiveSameToolCount} consecutive times`);
          return;
        }
      } else {
        this._lastToolName = tu.name;
        this._consecutiveSameToolCount = 1;
      }
    }

    // ── Consecutive tool calls without text (kill at 20+) ─────────────────
    if (toolUses.length > 0 && textBlocks.length === 0) {
      this._consecutiveToolCallsWithoutText += toolUses.length;
      this._charsAtLastToolCall = this._totalChars;

      if (this._consecutiveToolCallsWithoutText >= 20) {
        this._kill('excessive_tool_calls', `${this._consecutiveToolCallsWithoutText} consecutive tool calls without text output`);
        return;
      }
    } else if (textBlocks.length > 0) {
      this._consecutiveToolCallsWithoutText = 0;
    }

    // ── Watchdog alert: 8K+ tokens without a tool call ────────────────────
    const tokensSinceLastTool = estimateTokens(
      (rawAccumulatedOutput || '').slice(this._charsAtLastToolCall)
    );
    if (toolUses.length === 0 && tokensSinceLastTool >= 8000) {
      // Alert only — do not kill
      logger.warn(
        `[watchdog] ${tokensSinceLastTool} tokens since last tool call (alert threshold: 8K)`,
        this.agentName
      );
      eventBus.emitEvent(EVENT_TYPES.WATCHDOG_ALERT, {
        agentName: this.agentName,
        metadata: {
          tokensSinceLastToolCall: tokensSinceLastTool,
          totalTokens: this._totalTokensEstimate,
          threshold: 8000,
        },
      });
      // Reset to avoid spamming alerts
      this._charsAtLastToolCall = this._totalChars;
    }

    // ── No-access detector ────────────────────────────────────────────────
    for (const tb of textBlocks) {
      const text = (tb.text || '').toLowerCase();
      const noAccessPhrases = [
        "i don't have access",
        "i cannot access",
        "i do not have access",
        "unable to access",
        "no access to",
        "cannot read the",
        "cannot connect to",
      ];
      if (noAccessPhrases.some(p => text.includes(p))) {
        this._kill('no_access', `Agent reported no access to required resources`);
        return;
      }
    }

    // ── Wandering detector: 5K+ tokens without code block ─────────────────
    const textInThisTurn = textBlocks.map(tb => tb.text || '').join('');
    const hasCodeBlock = textInThisTurn.includes('```');

    if (hasCodeBlock) {
      this._tokensSinceLastCodeBlock = 0;
    } else {
      this._tokensSinceLastCodeBlock += estimateTokens(textInThisTurn);
      if (this._tokensSinceLastCodeBlock >= 5000) {
        this._kill('wandering', `${this._tokensSinceLastCodeBlock} tokens of text output without any code block`);
        return;
      }
    }

    // ── Wrong language detector ───────────────────────────────────────────
    if (this.expectedLanguage && textInThisTurn.length > 200) {
      const isWrongLanguage = detectWrongLanguage(textInThisTurn, this.expectedLanguage);
      if (isWrongLanguage) {
        this._kill('wrong_language', `Agent is responding in wrong language (expected: ${this.expectedLanguage})`);
        return;
      }
    }
  }

  /**
   * Trigger early termination.
   * @param {string} reason - Machine-readable reason code
   * @param {string} description - Human-readable description
   */
  _kill(reason, description) {
    if (this._terminated) return;
    this._terminated = true;
    this._terminationReason = reason;

    const tokensSaved = this.tokensSavedEstimate;

    logger.warn(
      `[early-termination] reason=${reason} | tokens_so_far=~${this._totalTokensEstimate} | tokens_saved_est=~${tokensSaved} | ${description}`,
      this.agentName
    );

    eventBus.emitEvent(EVENT_TYPES.EARLY_TERMINATION, {
      agentName: this.agentName,
      metadata: {
        reason,
        description,
        tokensAtTermination: this._totalTokensEstimate,
        tokensSavedEstimate: tokensSaved,
        charsAtTermination: this._totalChars,
      },
    });

    eventBus.emitEvent(EVENT_TYPES.ANOMALY_DETECTED, {
      agentName: this.agentName,
      metadata: { reason, description },
    });

    if (this._killFn) {
      try {
        this._killFn();
      } catch (err) {
        logger.warn(`[early-termination] kill callback error: ${err.message}`, this.agentName);
      }
    }
  }
}

/**
 * Heuristic check for wrong language in text output.
 * Returns true if the text appears to be in the wrong language.
 *
 * @param {string} text
 * @param {string} expectedLanguage - 'english' | 'spanish'
 * @returns {boolean}
 */
function detectWrongLanguage(text, expectedLanguage) {
  const sample = text.slice(0, 500).toLowerCase();

  if (expectedLanguage === 'english') {
    // Detect Spanish: common Spanish words that don't appear in English
    const spanishMarkers = ['también', 'además', 'según', 'después', 'están', 'esto es', 'vamos a', 'necesito', 'tengo que', 'para que'];
    const spanishCount = spanishMarkers.filter(m => sample.includes(m)).length;
    return spanishCount >= 2;
  }

  if (expectedLanguage === 'spanish') {
    // Detect English: common English phrases that indicate wrong language
    const englishMarkers = ['i will', 'i need to', 'let me', "i'll", 'we need', 'the code', 'this is', 'first,', 'next,', 'finally,'];
    const englishCount = englishMarkers.filter(m => sample.includes(m)).length;
    return englishCount >= 3;
  }

  return false;
}
