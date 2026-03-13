import { eventBus, EVENT_TYPES } from '../events/event-bus.js';
import { logger } from '../utils/logger.js';
import { getDb } from '../../skills/planning-task-mcp/src/firebase.js';

const AGENT_TAG = 'ANOMALY-DETECTOR';

/** Rolling window sizes for each rule. */
const TOKEN_BASELINE_WINDOW = 10;
const REVIEW_WINDOW = 5;
const MODEL_WINDOW = 10;

/** In-memory state — reset on each startAnomalyDetector() call. */
let _isRunning = false;
let _unsubscribePerf = null;
let _unsubscribeTokens = null;

/** taskId → totalTokensUsed (latest value from TASK_TOKEN_METRICS_UPDATED) */
const _taskTokenCache = new Map();

/** Rolling list of { taskId, totalTokensUsed } for baseline computation. */
const _recentTokens = [];

/** Rolling list of review scores (numbers). */
const _recentScores = [];

/** model → [{ approved }] — rolling window per model. */
const _modelResults = new Map();

/** Recent alerts for the API (in-memory, capped). */
const _recentAlerts = [];
const MAX_ALERTS_IN_MEMORY = 100;

/** Cooldown tracking: alertKey → timestamp of last alert emitted. */
const _alertCooldowns = new Map();
const ALERT_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour between repeated alerts of the same type

/**
 * Checks if a task used 2x the expected (average) tokens.
 *
 * @param {string} taskId
 * @param {number} totalTokensUsed
 * @param {number[]} baselineTokens - Array of recent token counts (NOT including current task)
 * @returns {Object|null} Alert object or null
 */
export function checkTokenSpike(taskId, totalTokensUsed, baselineTokens) {
  if (baselineTokens.length < 3) return null;

  const avg = baselineTokens.reduce((s, v) => s + v, 0) / baselineTokens.length;
  if (avg <= 0) return null;

  const ratio = totalTokensUsed / avg;
  if (ratio < 2) return null;

  return {
    rule: 'token-spike',
    data: {
      taskId,
      totalTokensUsed,
      expectedAvg: Math.round(avg),
      ratio: parseFloat(ratio.toFixed(2)),
    },
    suggestion: 'La tarea usó el doble de tokens esperados. Considera dividirla en subtareas o revisar el prompt.',
  };
}

/**
 * Checks if the last REVIEW_WINDOW review scores are all below 7.
 *
 * @param {number[]} recentScores - Last N scores (already includes the current one)
 * @returns {Object|null} Alert object or null
 */
export function checkReviewRegression(recentScores) {
  if (recentScores.length < REVIEW_WINDOW) return null;

  const window = recentScores.slice(-REVIEW_WINDOW);
  const allLow = window.every(s => s < 7);
  if (!allLow) return null;

  const avg = window.reduce((s, v) => s + v, 0) / window.length;

  return {
    rule: 'review-regression',
    data: {
      recentScores: [...window],
      avgScore: parseFloat(avg.toFixed(1)),
    },
    suggestion: `Los últimos ${REVIEW_WINDOW} reviews puntuaron por debajo de 7. Revisar la calidad del código generado o ajustar el criterio del reviewer.`,
  };
}

/**
 * Checks if a model has a fail rate > 40% in the last MODEL_WINDOW tasks.
 *
 * @param {string} model
 * @param {Array<{ approved: boolean }>} results - Last N results for this model
 * @returns {Object|null} Alert object or null
 */
export function checkModelDegradation(model, results) {
  if (results.length < MODEL_WINDOW) return null;

  const window = results.slice(-MODEL_WINDOW);
  const failCount = window.filter(r => !r.approved).length;
  const failRate = failCount / window.length;
  if (failRate <= 0.4) return null;

  return {
    rule: 'model-degradation',
    data: {
      model,
      failCount,
      taskCount: window.length,
      failRatePercent: Math.round(failRate * 100),
    },
    suggestion: `El modelo "${model}" tiene un fail rate del ${Math.round(failRate * 100)}% en las últimas ${MODEL_WINDOW} tareas. Considera cambiar de modelo o revisar su configuración.`,
  };
}

/**
 * Returns true if enough time has passed since the last alert of this key.
 * Sets the cooldown timestamp if off-cooldown.
 *
 * @param {string} alertKey - Unique key for the alert type (e.g. 'review-regression')
 * @returns {boolean}
 */
function _isAlertOffCooldown(alertKey) {
  const now = Date.now();
  const last = _alertCooldowns.get(alertKey);
  if (last != null && now - last < ALERT_COOLDOWN_MS) return false;
  _alertCooldowns.set(alertKey, now);
  return true;
}

/**
 * Persists an alert to Firebase and emits ANOMALY_ALERT on the EventBus.
 *
 * @param {string} projectId
 * @param {Object} alert - { rule, data, suggestion }
 */
async function _emitAlert(projectId, alert) {
  const alertPayload = {
    ...alert,
    projectId,
    detectedAt: new Date().toISOString(),
  };

  // Add to in-memory list (capped)
  _recentAlerts.unshift(alertPayload);
  if (_recentAlerts.length > MAX_ALERTS_IN_MEMORY) {
    _recentAlerts.pop();
  }

  // Persist to Firebase
  try {
    const db = getDb();
    const ref = db.ref(`observability/alerts/${projectId}`).push();
    await ref.set(alertPayload);
  } catch (err) {
    logger.warn(`Failed to persist anomaly alert: ${err.message}`, AGENT_TAG);
  }

  // Emit to EventBus (triggers Telegram notifier, webhook, dashboard)
  eventBus.emitEvent(EVENT_TYPES.ANOMALY_ALERT, {
    metadata: alertPayload,
  });

  logger.warn(
    `[${alert.rule}] ${alert.suggestion} | data: ${JSON.stringify(alert.data)}`,
    AGENT_TAG,
  );
}

/**
 * Handles a MODEL_PERFORMANCE_RECORDED event and runs the 3 anomaly rules.
 *
 * @param {Object} payload - EventBus payload
 */
async function _onModelPerformanceRecorded(payload) {
  const { taskId, projectId, reviewScore, approved, coderModel, plannerModel, reviewerModel } = payload.metadata || {};

  if (!taskId || !projectId) return;

  // --- Rule 1: Token spike ---
  const totalTokensUsed = _taskTokenCache.get(taskId);
  if (totalTokensUsed != null) {
    // Baseline: all recent tasks excluding the current one
    const baseline = _recentTokens.map(t => t.totalTokensUsed);
    const alert = checkTokenSpike(taskId, totalTokensUsed, baseline);
    if (alert) {
      await _emitAlert(projectId, alert);
    }
    // Add current task to rolling baseline AFTER the check
    _recentTokens.push({ taskId, totalTokensUsed });
    if (_recentTokens.length > TOKEN_BASELINE_WINDOW) {
      _recentTokens.shift();
    }
  }

  // --- Rule 2: Review regression ---
  if (reviewScore != null && Number.isFinite(reviewScore)) {
    _recentScores.push(reviewScore);
    if (_recentScores.length > REVIEW_WINDOW * 2) {
      _recentScores.shift();
    }
    const alert = checkReviewRegression(_recentScores);
    if (alert && _isAlertOffCooldown('review-regression')) {
      await _emitAlert(projectId, alert);
    }
  }

  // --- Rule 3: Model degradation ---
  // Deduplicate models: if multiple roles share the same model, record the result only once.
  const uniqueModels = [...new Set(
    [coderModel, plannerModel, reviewerModel].filter(Boolean),
  )];

  for (const model of uniqueModels) {
    if (!_modelResults.has(model)) {
      _modelResults.set(model, []);
    }
    const results = _modelResults.get(model);
    results.push({ approved: !!approved });
    if (results.length > MODEL_WINDOW * 2) {
      results.shift();
    }
    const alert = checkModelDegradation(model, results);
    if (alert && _isAlertOffCooldown(`model-degradation:${model}`)) {
      await _emitAlert(projectId, alert);
    }
  }
}

/**
 * Starts the anomaly detector — subscribes to EventBus events.
 * Safe to call multiple times (no-op if already running).
 */
export function startAnomalyDetector() {
  if (_isRunning) return;
  _isRunning = true;

  // Track token usage per task
  const onTokenMetrics = (payload) => {
    const { taskId, totalTokensUsed } = payload.metadata || {};
    if (taskId && totalTokensUsed != null) {
      _taskTokenCache.set(taskId, totalTokensUsed);
    }
  };
  eventBus.on(EVENT_TYPES.TASK_TOKEN_METRICS_UPDATED, onTokenMetrics);
  _unsubscribeTokens = () => eventBus.off(EVENT_TYPES.TASK_TOKEN_METRICS_UPDATED, onTokenMetrics);

  // Run anomaly checks on each completed task
  const onPerf = (payload) => {
    _onModelPerformanceRecorded(payload).catch(err => {
      logger.warn(`Anomaly check failed: ${err.message}`, AGENT_TAG);
    });
  };
  eventBus.on(EVENT_TYPES.MODEL_PERFORMANCE_RECORDED, onPerf);
  _unsubscribePerf = () => eventBus.off(EVENT_TYPES.MODEL_PERFORMANCE_RECORDED, onPerf);

  logger.info('Anomaly detector started', AGENT_TAG);
}

/**
 * Stops the anomaly detector and clears in-memory state.
 */
export function stopAnomalyDetector() {
  if (!_isRunning) return;
  _isRunning = false;

  if (_unsubscribeTokens) {
    _unsubscribeTokens();
    _unsubscribeTokens = null;
  }
  if (_unsubscribePerf) {
    _unsubscribePerf();
    _unsubscribePerf = null;
  }

  _taskTokenCache.clear();
  _recentTokens.length = 0;
  _recentScores.length = 0;
  _modelResults.clear();
  _recentAlerts.length = 0;
  _alertCooldowns.clear();

  logger.info('Anomaly detector stopped', AGENT_TAG);
}

/**
 * Returns recent anomaly alerts (in-memory, latest first).
 *
 * @param {Object} [options]
 * @param {string} [options.projectId] - Filter by projectId
 * @param {number} [options.limit] - Max number of alerts to return (default: 20)
 * @returns {Object[]}
 */
export function getRecentAlerts({ projectId, limit = 20 } = {}) {
  let alerts = _recentAlerts;
  if (projectId) {
    alerts = alerts.filter(a => a.projectId === projectId);
  }
  return alerts.slice(0, limit);
}
