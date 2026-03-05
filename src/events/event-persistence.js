import { getDb } from '../../skills/planning-task-mcp/src/firebase.js';
import { eventBus, EVENT_TYPES } from './event-bus.js';
import { config } from '../config.js';

/**
 * High-frequency event types that should never be persisted.
 */
const EXCLUDED_TYPES = new Set([
  EVENT_TYPES.AGENT_OUTPUT,
]);

/**
 * Determines whether an event type should be persisted.
 *
 * @param {string} eventType
 * @returns {boolean}
 */
export function shouldPersist(eventType) {
  if (EXCLUDED_TYPES.has(eventType)) return false;

  const persistTypes = config.eventPersistTypes;
  if (persistTypes === '*') return true;

  const allowed = persistTypes.split(',').map(s => s.trim()).filter(Boolean);
  return allowed.includes(eventType);
}

/**
 * Formats a Date as YYYY-MM-DD for the Firebase path.
 *
 * @param {Date} date
 * @returns {string}
 */
function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

/**
 * Persists a single event payload to Firebase RTDB.
 *
 * @param {string} projectId
 * @param {Object} payload - Event payload from EventBus
 * @returns {Promise<string|null>} The generated event ID, or null if skipped
 */
export async function persistEvent(projectId, payload) {
  if (!shouldPersist(payload.type)) return null;

  const date = formatDate(new Date(payload.timestamp));
  const path = `events/${projectId}/${date}`;

  const record = {
    type: payload.type,
    timestamp: payload.timestamp,
    metadata: payload.metadata || {},
    agentName: payload.agentName || null,
    taskId: (payload.metadata && payload.metadata.taskId) || null,
  };

  const ref = getDb().ref(path).push();
  await ref.set(record);
  return ref.key;
}

/**
 * Starts listening to all EventBus events and persists them to Firebase.
 *
 * @param {string} projectId
 * @returns {() => void} Unsubscribe function
 */
export function startEventPersistence(projectId) {
  const unsubscribe = eventBus.onAny((payload) => {
    persistEvent(projectId, payload).catch((err) => {
      console.warn('EventPersistence: failed to persist event', err.message);
    });
  });

  return unsubscribe;
}

/**
 * Queries historical events from Firebase by date range and optional type filter.
 *
 * @param {string} projectId
 * @param {string} startDate - Start date inclusive (YYYY-MM-DD)
 * @param {string} endDate - End date inclusive (YYYY-MM-DD)
 * @param {string} [typeFilter] - Optional event type to filter by
 * @returns {Promise<Object[]>} Array of event records
 */
export async function queryEvents(projectId, startDate, endDate, typeFilter) {
  const db = getDb();
  const start = new Date(startDate);
  const end = new Date(endDate);
  const results = [];

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const date = formatDate(d);
    const path = `events/${projectId}/${date}`;
    const snapshot = await db.ref(path).once('value');
    const data = snapshot.val();
    if (!data) continue;

    for (const [id, event] of Object.entries(data)) {
      if (typeFilter && event.type !== typeFilter) continue;
      results.push({ id, ...event });
    }
  }

  return results;
}

/**
 * Removes events older than the configured retention period.
 *
 * @param {string} projectId
 * @param {number} [retentionDays] - Override retention days (default: config value)
 * @returns {Promise<number>} Number of date nodes removed
 */
export async function cleanupOldEvents(projectId, retentionDays) {
  const days = retentionDays ?? config.eventRetentionDays;
  const db = getDb();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const eventsRef = db.ref(`events/${projectId}`);
  const snapshot = await eventsRef.once('value');
  const data = snapshot.val();
  if (!data) return 0;

  let removed = 0;
  const updates = {};

  for (const dateKey of Object.keys(data)) {
    if (dateKey < formatDate(cutoff)) {
      updates[dateKey] = null;
      removed++;
    }
  }

  if (removed > 0) {
    await eventsRef.update(updates);
  }

  return removed;
}
