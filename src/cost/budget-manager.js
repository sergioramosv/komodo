import { config } from '../config.js';
import { eventBus, EVENT_TYPES } from '../events/event-bus.js';
import { komodoState, EXECUTION_STATES } from '../state/komodo-state.js';
import { logger } from '../utils/logger.js';

const AGENT = 'BUDGET';

/**
 * Manages cost tracking with daily/weekly budgets, warnings, and auto-pause.
 *
 * - Tracks estimated cost per agent invocation
 * - Emits warning at configurable threshold (default 80%)
 * - Auto-pauses daemon when budget is exceeded
 * - Resets counters at day/week boundaries
 * - Persists daily cost history to Firebase
 */
class BudgetManager {
  constructor() {
    /** @type {number} */
    this._dailySpent = 0;
    /** @type {number} */
    this._weeklySpent = 0;
    /** @type {string} Current day key YYYY-MM-DD */
    this._currentDay = '';
    /** @type {number} ISO week number */
    this._currentWeek = 0;
    /** @type {number} Current year */
    this._currentYear = 0;
    /** @type {boolean} */
    this._warningEmittedDaily = false;
    /** @type {boolean} */
    this._warningEmittedWeekly = false;
    /** @type {boolean} */
    this._exceededEmitted = false;
    /** @type {NodeJS.Timeout|null} */
    this._resetTimer = null;
    /** @type {((projectId: string, date: string, cost: number) => Promise<void>)|null} */
    this._persistFn = null;
    /** @type {string|null} */
    this._projectId = null;
    /** @type {(() => void)|null} */
    this._costListener = null;
  }

  /**
   * Starts the budget manager — initializes counters and schedules resets.
   *
   * @param {Object} [options]
   * @param {string} [options.projectId] - Project ID for Firebase persistence
   * @param {(projectId: string, date: string, cost: number) => Promise<void>} [options.persistFn] - Function to persist daily cost
   */
  start(options = {}) {
    this._projectId = options.projectId || null;
    this._persistFn = options.persistFn || null;

    const now = new Date();
    this._currentDay = _formatDate(now);
    this._currentWeek = _getISOWeek(now);
    this._currentYear = now.getFullYear();
    this._dailySpent = 0;
    this._weeklySpent = 0;
    this._warningEmittedDaily = false;
    this._warningEmittedWeekly = false;
    this._exceededEmitted = false;

    this._syncState();

    // Check for period resets every 60 seconds
    this._resetTimer = setInterval(() => this._checkReset(), 60_000);

    // Listen to COST_UPDATED events from agents and record them automatically
    const handler = (payload) => {
      const cost = payload.metadata?.cost;
      if (typeof cost === 'number' && cost > 0) {
        this.recordCost(cost, {
          agentName: payload.agentName,
          taskId: payload.metadata?.taskId,
        });
      }
    };
    eventBus.on(EVENT_TYPES.COST_UPDATED, handler);
    this._costListener = () => eventBus.off(EVENT_TYPES.COST_UPDATED, handler);

    logger.info(
      `Budget tracking started — daily: $${config.dailyBudgetUsd || 'unlimited'}, weekly: $${config.weeklyBudgetUsd || 'unlimited'}`,
      AGENT,
    );
  }

  /**
   * Stops the budget manager and clears timers.
   */
  stop() {
    if (this._resetTimer) {
      clearInterval(this._resetTimer);
      this._resetTimer = null;
    }
    if (this._costListener) {
      this._costListener();
      this._costListener = null;
    }
    logger.info('Budget tracking stopped', AGENT);
  }

  /**
   * Records cost for an agent invocation and checks budget limits.
   *
   * @param {number} [cost] - Estimated cost in USD (default: config.estimatedCostPerInvocation)
   * @param {Object} [metadata] - Additional metadata for the event
   * @param {string} [metadata.agentName] - Which agent incurred the cost
   * @param {string} [metadata.taskId] - Associated task ID
   * @returns {{ allowed: boolean, dailySpent: number, weeklySpent: number, warning: boolean, exceeded: boolean }}
   */
  recordCost(cost, metadata = {}) {
    const amount = cost ?? config.estimatedCostPerInvocation;
    this._checkReset();

    this._dailySpent += amount;
    this._weeklySpent += amount;

    this._syncState();

    const dailyBudget = config.dailyBudgetUsd;
    const weeklyBudget = config.weeklyBudgetUsd;
    const threshold = config.budgetWarningThreshold;

    let warning = false;
    let exceeded = false;

    // Check daily budget
    if (dailyBudget > 0) {
      if (this._dailySpent >= dailyBudget) {
        exceeded = true;
      } else if (this._dailySpent >= dailyBudget * threshold && !this._warningEmittedDaily) {
        warning = true;
        this._warningEmittedDaily = true;
      }
    }

    // Check weekly budget
    if (weeklyBudget > 0) {
      if (this._weeklySpent >= weeklyBudget) {
        exceeded = true;
      } else if (this._weeklySpent >= weeklyBudget * threshold && !this._warningEmittedWeekly) {
        warning = true;
        this._warningEmittedWeekly = true;
      }
    }

    // Emit cost updated event
    eventBus.emitEvent(EVENT_TYPES.BUDGET_UPDATED, {
      metadata: {
        ...metadata,
        cost: amount,
        dailySpent: this._dailySpent,
        weeklySpent: this._weeklySpent,
        dailyBudget,
        weeklyBudget,
      },
    });

    // Emit warning
    if (warning) {
      const pctDaily = dailyBudget > 0 ? ((this._dailySpent / dailyBudget) * 100).toFixed(0) : null;
      const pctWeekly = weeklyBudget > 0 ? ((this._weeklySpent / weeklyBudget) * 100).toFixed(0) : null;

      logger.warn(
        `Budget warning — daily: $${this._dailySpent.toFixed(2)}/${dailyBudget || '∞'} (${pctDaily || '-'}%), weekly: $${this._weeklySpent.toFixed(2)}/${weeklyBudget || '∞'} (${pctWeekly || '-'}%)`,
        AGENT,
      );

      eventBus.emitEvent(EVENT_TYPES.BUDGET_WARNING, {
        metadata: {
          dailySpent: this._dailySpent,
          weeklySpent: this._weeklySpent,
          dailyBudget,
          weeklyBudget,
          percentDaily: pctDaily ? Number(pctDaily) : null,
          percentWeekly: pctWeekly ? Number(pctWeekly) : null,
        },
      });
    }

    // Exceed: auto-pause daemon
    if (exceeded && !this._exceededEmitted) {
      this._exceededEmitted = true;
      komodoState.budget.paused = true;
      this._syncState();

      logger.error(
        `Budget exceeded — daily: $${this._dailySpent.toFixed(2)}/${dailyBudget || '∞'}, weekly: $${this._weeklySpent.toFixed(2)}/${weeklyBudget || '∞'}. Auto-pausing daemon.`,
        AGENT,
      );

      komodoState.setExecutionState(EXECUTION_STATES.BUDGET_PAUSED);

      eventBus.emitEvent(EVENT_TYPES.BUDGET_EXCEEDED, {
        metadata: {
          dailySpent: this._dailySpent,
          weeklySpent: this._weeklySpent,
          dailyBudget,
          weeklyBudget,
        },
      });
    }

    // Persist daily cost to Firebase (fire-and-forget)
    if (this._persistFn && this._projectId) {
      this._persistFn(this._projectId, this._currentDay, this._dailySpent).catch(err => {
        logger.warn(`Failed to persist daily cost: ${err.message}`, AGENT);
      });
    }

    return {
      allowed: !exceeded,
      dailySpent: this._dailySpent,
      weeklySpent: this._weeklySpent,
      warning,
      exceeded,
    };
  }

  /**
   * Returns current budget status without recording any cost.
   *
   * @returns {{ dailySpent: number, weeklySpent: number, dailyBudget: number, weeklyBudget: number, dailyPercent: number, weeklyPercent: number, exceeded: boolean }}
   */
  getStatus() {
    const dailyBudget = config.dailyBudgetUsd;
    const weeklyBudget = config.weeklyBudgetUsd;

    return {
      dailySpent: this._dailySpent,
      weeklySpent: this._weeklySpent,
      dailyBudget,
      weeklyBudget,
      dailyPercent: dailyBudget > 0 ? (this._dailySpent / dailyBudget) * 100 : 0,
      weeklyPercent: weeklyBudget > 0 ? (this._weeklySpent / weeklyBudget) * 100 : 0,
      exceeded: this._exceededEmitted,
    };
  }

  /**
   * Checks if day/week has changed and resets counters.
   */
  _checkReset() {
    const now = new Date();
    const today = _formatDate(now);
    const thisWeek = _getISOWeek(now);
    const thisYear = now.getFullYear();

    let resetOccurred = false;

    // Daily reset
    if (today !== this._currentDay) {
      this._currentDay = today;
      this._dailySpent = 0;
      this._warningEmittedDaily = false;
      resetOccurred = true;
      logger.info(`Daily budget counter reset (${today})`, AGENT);
    }

    // Weekly reset
    if (thisWeek !== this._currentWeek || thisYear !== this._currentYear) {
      this._currentWeek = thisWeek;
      this._currentYear = thisYear;
      this._weeklySpent = 0;
      this._warningEmittedWeekly = false;
      resetOccurred = true;
      logger.info(`Weekly budget counter reset (week ${thisWeek})`, AGENT);
    }

    if (resetOccurred) {
      this._exceededEmitted = false;
      komodoState.budget.paused = false;
      this._syncState();

      // If daemon was paused due to budget, resume it
      if (komodoState.executionState === EXECUTION_STATES.BUDGET_PAUSED) {
        komodoState.setExecutionState(EXECUTION_STATES.DAEMON_RUNNING);
      }

      eventBus.emitEvent(EVENT_TYPES.BUDGET_RESET, {
        metadata: {
          day: this._currentDay,
          week: this._currentWeek,
          dailyBudget: config.dailyBudgetUsd,
          weeklyBudget: config.weeklyBudgetUsd,
        },
      });
    }
  }

  /**
   * Syncs internal state to komodoState for dashboard consumption.
   */
  _syncState() {
    komodoState.budget.dailySpent = this._dailySpent;
    komodoState.budget.weeklySpent = this._weeklySpent;
    komodoState.budget.dailyBudget = config.dailyBudgetUsd;
    komodoState.budget.weeklyBudget = config.weeklyBudgetUsd;
  }
}

/**
 * Formats a Date as YYYY-MM-DD.
 * @param {Date} date
 * @returns {string}
 */
function _formatDate(date) {
  return date.toISOString().slice(0, 10);
}

/**
 * Returns ISO week number for a given date.
 * @param {Date} date
 * @returns {number}
 */
function _getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86_400_000 + 1) / 7);
}

/** Singleton instance. */
export const budgetManager = new BudgetManager();
