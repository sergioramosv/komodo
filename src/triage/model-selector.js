import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { eventBus, EVENT_TYPES } from '../events/event-bus.js';

/**
 * Default model mappings: CLI → Role → Complexity Level → model name.
 *
 * These are sensible defaults that balance cost/quality.
 * Can be overridden via .env (MODEL_MAP_<CLI>_<ROLE>=trivial,standard,complex).
 */
const DEFAULT_MODEL_MAP = {
  claude: {
    PLANNER:  { trivial: 'sonnet', standard: 'sonnet', complex: 'opus' },
    CODER:    { trivial: 'sonnet', standard: 'sonnet', complex: 'opus' },
    REVIEWER: { trivial: 'haiku', standard: 'sonnet', complex: 'sonnet' },
  },
  codex: {
    PLANNER:  { trivial: 'codex-mini', standard: 'o4-mini', complex: 'o3' },
    CODER:    { trivial: 'codex-mini', standard: 'o4-mini', complex: 'o3' },
    REVIEWER: { trivial: 'codex-mini', standard: 'o4-mini', complex: 'o3' },
  },
  gemini: {
    PLANNER:  { trivial: 'gemini-2.0-flash', standard: 'gemini-2.5-pro', complex: 'gemini-2.5-pro' },
    CODER:    { trivial: 'gemini-2.0-flash', standard: 'gemini-2.5-pro', complex: 'gemini-2.5-pro' },
    REVIEWER: { trivial: 'gemini-2.0-flash', standard: 'gemini-2.5-pro', complex: 'gemini-2.5-pro' },
  },
};

/**
 * Parses a comma-separated model map string into a complexity→model object.
 *
 * @param {string} mapStr - Format: "trivialModel,standardModel,complexModel"
 * @returns {{ trivial: string, standard: string, complex: string } | null}
 */
function parseModelMapString(mapStr) {
  if (!mapStr || typeof mapStr !== 'string') return null;

  const parts = mapStr.split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length !== 3) return null;

  return { trivial: parts[0], standard: parts[1], complex: parts[2] };
}

/**
 * Gets the model map for a given CLI + role, checking .env overrides first.
 *
 * Lookup order:
 *  1. .env MODEL_MAP_<CLI>_<ROLE> (e.g. MODEL_MAP_CLAUDE_CODER=haiku,sonnet,opus)
 *  2. Default map for CLI + role
 *  3. null (no mapping found)
 *
 * @param {string} cliType - CLI name (claude, codex, gemini)
 * @param {string} agentRole - Role name (PLANNER, CODER, REVIEWER)
 * @returns {{ trivial: string, standard: string, complex: string } | null}
 */
function getModelMap(cliType, agentRole) {
  const envKey = `modelMap_${cliType}_${agentRole}`;
  const envValue = config[envKey];

  if (envValue) {
    const parsed = parseModelMapString(envValue);
    if (parsed) return parsed;
  }

  const cliMap = DEFAULT_MODEL_MAP[cliType];
  if (!cliMap) return null;

  return cliMap[agentRole] || null;
}

/**
 * Selects the optimal model for a given CLI, agent role, and complexity level.
 *
 * Priority order:
 *  1. Task-level override (taskOverride) — highest priority
 *  2. Global role force override (.env FORCE_MODEL_<ROLE>)
 *  3. Model map lookup (CLI + role + complexity)
 *  4. null (let the CLI use its own default)
 *
 * @param {string} cliType - CLI to use (claude, codex, gemini)
 * @param {string} agentRole - Agent role (PLANNER, CODER, REVIEWER)
 * @param {string} complexityLevel - Complexity level (trivial, standard, complex)
 * @param {string} [taskOverride] - Per-task model override (highest priority)
 * @returns {string | null} Model name or null for CLI default
 */
export function selectModel(cliType, agentRole, complexityLevel, taskOverride) {
  const role = agentRole.toUpperCase();
  const cli = cliType.toLowerCase();
  const level = complexityLevel.toLowerCase();

  let selectedModel = null;
  let source = 'default';

  // Priority 1: Task-level override
  if (taskOverride) {
    selectedModel = taskOverride;
    source = 'task-override';
  }

  // Priority 2: Global role force override (FORCE_MODEL_CODER=opus)
  if (!selectedModel) {
    const forceKey = `forceModel_${role}`;
    const forceValue = config[forceKey];
    if (forceValue) {
      selectedModel = forceValue;
      source = 'force-override';
    }
  }

  // Priority 3: Model map (CLI + role + complexity)
  if (!selectedModel) {
    const modelMap = getModelMap(cli, role);
    if (modelMap && modelMap[level]) {
      selectedModel = modelMap[level];
      source = 'complexity-map';
    }
  }

  // Log the selection
  if (selectedModel) {
    logger.info(
      `Model selected: ${selectedModel} (${source}) [cli=${cli}, role=${role}, complexity=${level}]`,
      'TRIAGE',
    );
  }

  // Emit event for dashboard visibility
  eventBus.emitEvent(EVENT_TYPES.MODEL_SELECTED, {
    metadata: {
      cliType: cli,
      agentRole: role,
      complexityLevel: level,
      model: selectedModel,
      source,
    },
  });

  return selectedModel;
}
