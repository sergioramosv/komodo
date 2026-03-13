/**
 * Ordered model tiers per CLI (lightest → most powerful).
 * Shared between smart-model-router and cross-project-intelligence.
 */
export const MODEL_TIERS = {
  claude: ['haiku', 'sonnet', 'opus'],
  codex: ['codex-mini', 'o4-mini', 'o3'],
  gemini: ['gemini-2.5-flash', 'gemini-2.5-pro'],
};
