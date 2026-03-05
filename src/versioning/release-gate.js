import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { eventBus, EVENT_TYPES } from '../events/event-bus.js';
import { getAll } from '../../skills/planning-task-mcp/src/firebase.js';

const AGENT = 'RELEASE-GATE';

const BLOCKING_SEVERITIES = ['critical', 'high'];
const BLOCKING_STATUSES = ['open', 'in-progress'];

/**
 * Checks whether there are open critical/high bugs blocking a release.
 *
 * @param {string} projectId
 * @returns {Promise<{ ready: boolean, blockingBugs: object[] }>}
 */
export async function checkReleaseGate(projectId) {
  const allBugs = await getAll('bugs');

  const blockingBugs = allBugs.filter(
    b =>
      b.projectId === projectId &&
      BLOCKING_SEVERITIES.includes(b.severity) &&
      BLOCKING_STATUSES.includes(b.status),
  );

  const ready = blockingBugs.length === 0;

  if (ready) {
    logger.info('Release gate: no blocking bugs found', AGENT);
  } else {
    logger.warn(
      `Release gate: ${blockingBugs.length} blocking bug(s) found`,
      AGENT,
    );
    for (const bug of blockingBugs) {
      logger.warn(
        `  - [${bug.severity}] ${bug.title} (${bug.status})`,
        AGENT,
      );
    }
  }

  return { ready, blockingBugs };
}

/**
 * Evaluates the release gate and emits appropriate events.
 *
 * If RELEASE_IGNORE_BUGS=true, blocking bugs are logged but do not prevent release.
 *
 * @param {string} projectId
 * @returns {Promise<{ allowed: boolean, blockingBugs: object[], overridden: boolean }>}
 */
export async function evaluateReleaseGate(projectId) {
  const { ready, blockingBugs } = await checkReleaseGate(projectId);

  if (ready) {
    eventBus.emitEvent(EVENT_TYPES.RELEASE_GATE_PASSED, {
      metadata: { projectId },
    });
    return { allowed: true, blockingBugs: [], overridden: false };
  }

  // There are blocking bugs
  const overridden = config.releaseIgnoreBugs === true;

  if (overridden) {
    logger.warn(
      `Release gate: RELEASE_IGNORE_BUGS=true — overriding ${blockingBugs.length} blocking bug(s)`,
      AGENT,
    );
  }

  eventBus.emitEvent(EVENT_TYPES.RELEASE_GATE_BLOCKED, {
    metadata: {
      projectId,
      blockingBugs: blockingBugs.map(b => ({
        id: b.id,
        title: b.title,
        severity: b.severity,
        status: b.status,
      })),
      overridden,
    },
  });

  return {
    allowed: overridden,
    blockingBugs,
    overridden,
  };
}
