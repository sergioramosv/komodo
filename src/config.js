import 'dotenv/config';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { execFileSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = resolve(__dirname, '..');

/**
 * Detecta si un CLI está instalado en el sistema.
 * On Windows, npm installs CLIs as .cmd/.ps1 wrappers that require shell to resolve.
 * We use `where` (Windows) or `which` (Unix) to check if the command is in PATH.
 * @param {string} command
 * @returns {boolean}
 */
export function cliExists(command) {
  try {
    const checkCmd = process.platform === 'win32' ? 'where' : 'which';
    execFileSync(checkCmd, [command], { stdio: 'pipe', encoding: 'utf-8' });
    return true;
  } catch {
    return false;
  }
}

export const config = {
  // CLIs de agentes IA (terminales, NO APIs)
  // Cada agente usa un CLI real: claude, codex, gemini, etc.
  cliPlanner: process.env.CLI_PLANNER || 'claude',
  cliCoder: process.env.CLI_CODER || 'claude',
  cliReviewer: process.env.CLI_REVIEWER || 'claude',

  // Firebase (para planning-task-mcp)
  googleCredentials: process.env.GOOGLE_APPLICATION_CREDENTIALS || '',
  firebaseDatabaseUrl: process.env.FIREBASE_DATABASE_URL || '',

  // Usuario por defecto
  defaultUserId: process.env.DEFAULT_USER_ID || '',
  defaultUserName: process.env.DEFAULT_USER_NAME || '',

  // GitHub
  githubToken: process.env.GITHUB_TOKEN || '',

  // Komodo
  wsPort: parseInt(process.env.WS_PORT || '3001', 10),
  maxReviewCycles: parseInt(process.env.MAX_REVIEW_CYCLES || '5', 10),
  autoMerge: process.env.AUTO_MERGE !== 'false', // default: true
  defaultProjectId: process.env.DEFAULT_PROJECT_ID || '',

  // Browser MCP (Chrome DevTools)
  enableBrowserMcp: process.env.ENABLE_BROWSER_MCP === 'true',
  chromeDebuggerPort: parseInt(process.env.CHROME_DEBUGGER_PORT || '9222', 10),

  // Telegram Bot
  enableTelegram: process.env.ENABLE_TELEGRAM === 'true',
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
  telegramChatId: process.env.TELEGRAM_CHAT_ID || '',
  telegramAllowedUsers: (process.env.TELEGRAM_ALLOWED_USERS || '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean),
  telegramVerbosity: process.env.TELEGRAM_VERBOSITY || 'verbose', // 'verbose' | 'minimal'
  telegramClaudeTimeout: parseInt(process.env.TELEGRAM_CLAUDE_TIMEOUT || '120000', 10),

  // Triage / Complexity classification
  complexityTrivialMax: parseInt(process.env.COMPLEXITY_TRIVIAL_MAX || '3', 10),
  complexityStandardMax: parseInt(process.env.COMPLEXITY_STANDARD_MAX || '6', 10),

  // Task decomposition
  taskDecomposition: process.env.TASK_DECOMPOSITION !== 'false', // default: true
  decompositionThresholdDevpoints: parseInt(process.env.DECOMPOSITION_THRESHOLD_DEVPOINTS || '8', 10),

  // Model selection: per-CLI per-role mappings (format: "trivialModel,standardModel,complexModel")
  modelMap_claude_PLANNER: process.env.MODEL_MAP_CLAUDE_PLANNER || '',
  modelMap_claude_CODER: process.env.MODEL_MAP_CLAUDE_CODER || '',
  modelMap_claude_REVIEWER: process.env.MODEL_MAP_CLAUDE_REVIEWER || '',
  modelMap_codex_PLANNER: process.env.MODEL_MAP_CODEX_PLANNER || '',
  modelMap_codex_CODER: process.env.MODEL_MAP_CODEX_CODER || '',
  modelMap_codex_REVIEWER: process.env.MODEL_MAP_CODEX_REVIEWER || '',
  modelMap_gemini_PLANNER: process.env.MODEL_MAP_GEMINI_PLANNER || '',
  modelMap_gemini_CODER: process.env.MODEL_MAP_GEMINI_CODER || '',
  modelMap_gemini_REVIEWER: process.env.MODEL_MAP_GEMINI_REVIEWER || '',

  // Force model override per role (overrides complexity-based selection)
  forceModel_PLANNER: process.env.FORCE_MODEL_PLANNER || '',
  forceModel_CODER: process.env.FORCE_MODEL_CODER || '',
  forceModel_REVIEWER: process.env.FORCE_MODEL_REVIEWER || '',

  // Rate limit fallback
  rateLimitFallback: process.env.RATE_LIMIT_FALLBACK !== 'false', // default: true
  fallbackCliOrder: (process.env.FALLBACK_CLI_ORDER || 'claude,codex,gemini')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean),
  rateLimitCooldownMinutes: parseInt(process.env.RATE_LIMIT_COOLDOWN_MINUTES || '15', 10),

  // Heartbeat monitor (ping rate-limited CLIs to detect recovery)
  heartbeatEnabled: process.env.HEARTBEAT_ENABLED !== 'false', // default: true
  heartbeatIntervalMinutes: parseInt(process.env.HEARTBEAT_INTERVAL_MINUTES || '5', 10),

  // Daemon / watch mode
  daemonPollInterval: parseInt(process.env.DAEMON_POLL_INTERVAL || '60', 10),
  daemonMaxTasksPerSession: parseInt(process.env.DAEMON_MAX_TASKS_PER_SESSION || '0', 10),

  // Watchdog: kill agents that produce no output for too long
  agentTimeoutMinutes: parseInt(process.env.AGENT_TIMEOUT_MINUTES || '15', 10),

  // Scheduler: execution windows (format: "02:00-06:00,14:00-18:00")
  // Empty or unset = 24/7 execution
  schedule: process.env.SCHEDULE || '',
  scheduleTimezone: process.env.SCHEDULE_TIMEZONE || '',

  // GitHub Issue Sync
  enableGithubIssueSync: process.env.GITHUB_ISSUE_SYNC === 'true',
  githubIssuePollMinutes: parseInt(process.env.GITHUB_ISSUE_POLL_MINUTES || '5', 10),
  githubIssueLabel: process.env.GITHUB_ISSUE_LABEL || 'komodo',
  githubIssueRepo: process.env.GITHUB_ISSUE_REPO || '',

  // PR Comment Bug Reports (@komodo bug: ...)
  enablePrCommentBugs: process.env.PR_COMMENT_BUGS === 'true',
  prCommentBugsPollMinutes: parseInt(process.env.PR_COMMENT_BUGS_POLL_MINUTES || '3', 10),
  prCommentBugsRepo: process.env.PR_COMMENT_BUGS_REPO || process.env.GITHUB_ISSUE_REPO || '',

  // Auto-improve (codebase analysis when backlog is empty)
  autoImprove: process.env.AUTO_IMPROVE === 'true',
  autoImproveMaxProposals: parseInt(process.env.AUTO_IMPROVE_MAX_PROPOSALS || '5', 10),
  autoImproveCategories: process.env.AUTO_IMPROVE_CATEGORIES || '',

  // Estimation Tracker (compare estimated vs actual devPoints)
  estimationTracking: process.env.ESTIMATION_TRACKING !== 'false', // default: true

  // Tech Debt Tracker (auto-create tasks from minor review issues)
  techDebtTracking: process.env.TECH_DEBT_TRACKING !== 'false', // default: true

  // Dependency Checker (periodic npm audit / outdated)
  depCheckEnabled: process.env.DEP_CHECK_ENABLED === 'true',
  depCheckIntervalHours: parseInt(process.env.DEP_CHECK_INTERVAL_HOURS || '24', 10),

  // Codebase Knowledge Index (semantic map injected into Coder prompt)
  codebaseIndexEnabled: process.env.CODEBASE_INDEX_ENABLED !== 'false', // default: true
  codebaseContextMaxTokens: parseInt(process.env.CODEBASE_CONTEXT_MAX_TOKENS || '2000', 10),

  // Style Guide Detector (auto-detected conventions injected into Coder prompt)
  styleDetectorEnabled: process.env.STYLE_DETECTOR_ENABLED !== 'false', // default: true

  // Smart Task Ordering: context affinity boost (0-1, default: 0.2 = 20% boost)
  contextAffinityBoost: parseFloat(process.env.CONTEXT_AFFINITY_BOOST || '0.2'),

  // SonarQube / SonarCloud
  enableSonar: process.env.ENABLE_SONAR === 'true',
  sonarToken: process.env.SONAR_TOKEN || '',
  sonarHostUrl: process.env.SONAR_HOST_URL || '',
  sonarProjectKey: process.env.SONAR_PROJECT_KEY || '',

  // Paths
  rootDir: ROOT_DIR,
  memoryDir: resolve(ROOT_DIR, 'memory'),
  skillsDir: resolve(ROOT_DIR, 'skills'),
  planningMcpDir: resolve(ROOT_DIR, 'skills', 'planning-task-mcp'),
  githubMcpDir: resolve(ROOT_DIR, 'skills', 'github-mcp'),
  memoryMcpDir: resolve(ROOT_DIR, 'skills', 'memory-mcp'),
};

/**
 * Valida que las dependencias obligatorias estén configuradas.
 * @returns {string[]} Array de mensajes de error (vacío si todo OK)
 */
export function validateConfig() {
  const errors = [];

  // Verificar que al menos un CLI de IA está instalado
  const clis = [config.cliPlanner, config.cliCoder, config.cliReviewer];
  const uniqueClis = [...new Set(clis)];

  for (const cli of uniqueClis) {
    if (!cliExists(cli)) {
      errors.push(`CLI "${cli}" no encontrado. Instálalo o cambia la config en .env`);
    }
  }

  // Verificar gh CLI
  if (!cliExists('gh')) {
    errors.push('GitHub CLI (gh) no instalado. Instalar: https://cli.github.com/');
  }

  // Firebase
  if (!config.googleCredentials) {
    errors.push('GOOGLE_APPLICATION_CREDENTIALS no configurada');
  }

  if (!config.firebaseDatabaseUrl) {
    errors.push('FIREBASE_DATABASE_URL no configurada');
  }

  if (!config.defaultUserId) {
    errors.push('DEFAULT_USER_ID no configurado');
  }

  return errors;
}
