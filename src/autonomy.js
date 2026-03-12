import { config } from './config.js';

export const AutonomyMode = {
  SUPERVISED: 'supervised',
  SEMI_AUTONOMOUS: 'semi-autonomous',
  AUTONOMOUS: 'autonomous',
  GUARDIAN: 'guardian',
};

/**
 * Returns the currently configured autonomy mode.
 * @returns {string} One of 'supervised', 'semi-autonomous', 'autonomous', 'guardian'.
 */
export function getAutonomyMode() {
  const mode = config.autonomyLevel?.toLowerCase();
  if (Object.values(AutonomyMode).includes(mode)) {
    return mode;
  }
  return AutonomyMode.SEMI_AUTONOMOUS; // Default to semi-autonomous if invalid config
}

/**
 * Determines if the system should pause based on the autonomy mode and current context.
 *
 * @param {string} currentStep - The current step or event in the agent's workflow.
 *   Examples: 'agent_start', 'code_change', 'pr_created', 'review_cycle_end', 'low_review_score', 'large_diff'
 * @param {number} reviewDiffLines - The number of lines changed in the current review.
 * @returns {boolean} True if the system should pause for human approval, false otherwise.
 */
export function shouldPause(currentStep, reviewDiffLines = 0) {
  const autonomyMode = getAutonomyMode();

  switch (autonomyMode) {
    case AutonomyMode.SUPERVISED:
      // Always pause, for every significant step (e.g., after each agent's turn, before any action)
      return true;

    case AutonomyMode.SEMI_AUTONOMOUS:
      // Pause only at critical points like PR creation and low review scores
      return ['pr_created', 'low_review_score'].includes(currentStep);

    case AutonomyMode.AUTONOMOUS:
      // Never pause for human approval, run fully automatically
      return false;

    case AutonomyMode.GUARDIAN:
      // Pause for low review scores or if the code change is too large
      const isLargeDiff = reviewDiffLines > config.guardianMaxDiffLines;
      return ['low_review_score'].includes(currentStep) || isLargeDiff;

    default:
      // Fallback to semi-autonomous behavior for unknown modes
      return ['pr_created', 'low_review_score'].includes(currentStep);
  }
}

/**
 * Returns the approval timeout in minutes based on the configuration.
 * @returns {number} Timeout in minutes.
 */
export function getApprovalTimeoutMinutes() {
  return config.approvalTimeoutMinutes;
}
