import { getDb } from '../../skills/planning-task-mcp/src/firebase.js';

/**
 * Persists/updates daily cost to Firebase RTDB.
 *
 * @param {string} projectId
 * @param {string} date - YYYY-MM-DD
 * @param {number} totalCost - Accumulated cost for that day
 * @returns {Promise<void>}
 */
export async function persistDailyCost(projectId, date, totalCost) {
  const path = `budgets/${projectId}/daily/${date}`;
  await getDb().ref(path).set({
    date,
    totalCost,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Queries daily cost history from Firebase for a date range.
 *
 * @param {string} projectId
 * @param {string} startDate - YYYY-MM-DD inclusive
 * @param {string} endDate - YYYY-MM-DD inclusive
 * @returns {Promise<Array<{ date: string, totalCost: number }>>}
 */
export async function queryDailyCosts(projectId, startDate, endDate) {
  const ref = getDb().ref(`budgets/${projectId}/daily`);
  const snapshot = await ref
    .orderByKey()
    .startAt(startDate)
    .endAt(endDate)
    .once('value');

  const data = snapshot.val();
  if (!data) return [];

  return Object.values(data).sort((a, b) => a.date.localeCompare(b.date));
}
