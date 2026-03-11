import 'dotenv/config';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { execFileSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = resolve(__dirname, '..');

/**
 * Loads dashboard config from komodo.config.json (written by the dashboard UI).
 * Returns agent CLI/model overrides if present.
 */
function loadDashboardConfig() {
  const configPath = resolve(ROOT_DIR, 'komodo.config.json');
  try {
    if (!existsSync(configPath)) return null;
    return JSON.parse(readFileSync(configPath, 'utf-8'));
  } catch {
    return null;
  }
}

const _dashboardConfig = loadDashboardConfig();

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
  // Dashboard overrides (komodo.config.json) > .env > defaults
  cliPlanner: _dashboardConfig?.agents?.planner?.cli || process.env.CLI_PLANNER || 'claude',
  cliArchitect: _dashboardConfig?.agents?.architect?.cli || process.env.CLI_ARCHITECT || 'claude',
  cliCoder: _dashboardConfig?.agents?.coder?.cli || process.env.CLI_CODER || 'claude',
  cliReviewer: _dashboardConfig?.agents?.reviewer?.cli || process.env.CLI_REVIEWER || 'claude',

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
  apiServer: process.env.API_SERVER === 'true', // default: false
  apiPort: parseInt(process.env.API_PORT || '3002', 10),
  komodoApiKey: process.env.KOMODO_API_KEY || '',
  maxReviewCycles: _dashboardConfig?.maxReviewCycles || parseInt(process.env.MAX_REVIEW_CYCLES || '5', 10),
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
  modelMap_claude_ARCHITECT: process.env.MODEL_MAP_CLAUDE_ARCHITECT || '',
  modelMap_claude_CODER: process.env.MODEL_MAP_CLAUDE_CODER || '',
  modelMap_claude_REVIEWER: process.env.MODEL_MAP_CLAUDE_REVIEWER || '',
  modelMap_claude_QA: process.env.MODEL_MAP_CLAUDE_QA || '',
  modelMap_codex_PLANNER: process.env.MODEL_MAP_CODEX_PLANNER || '',
  modelMap_codex_ARCHITECT: process.env.MODEL_MAP_CODEX_ARCHITECT || '',
  modelMap_codex_CODER: process.env.MODEL_MAP_CODEX_CODER || '',
  modelMap_codex_REVIEWER: process.env.MODEL_MAP_CODEX_REVIEWER || '',
  modelMap_codex_QA: process.env.MODEL_MAP_CODEX_QA || '',
  modelMap_gemini_PLANNER: process.env.MODEL_MAP_GEMINI_PLANNER || '',
  modelMap_gemini_ARCHITECT: process.env.MODEL_MAP_GEMINI_ARCHITECT || '',
  modelMap_gemini_CODER: process.env.MODEL_MAP_GEMINI_CODER || '',
  modelMap_gemini_REVIEWER: process.env.MODEL_MAP_GEMINI_REVIEWER || '',
  modelMap_gemini_QA: process.env.MODEL_MAP_GEMINI_QA || '',

  // Force model override per role (overrides complexity-based selection)
  // Dashboard model selection takes priority over .env FORCE_MODEL_*
  forceModel_PLANNER: _dashboardConfig?.agents?.planner?.model || process.env.FORCE_MODEL_PLANNER || '',
  forceModel_ARCHITECT: _dashboardConfig?.agents?.architect?.model || process.env.FORCE_MODEL_ARCHITECT || '',
  forceModel_CODER: _dashboardConfig?.agents?.coder?.model || process.env.FORCE_MODEL_CODER || '',
  forceModel_REVIEWER: _dashboardConfig?.agents?.reviewer?.model || process.env.FORCE_MODEL_REVIEWER || '',
  forceModel_QA: process.env.FORCE_MODEL_QA || '',

  // Rate limit fallback
  rateLimitFallback: process.env.RATE_LIMIT_FALLBACK !== 'false', // default: true
  fallbackCliOrder: (process.env.FALLBACK_CLI_ORDER || 'claude,codex,gemini')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean),
  rateLimitCooldownMinutes: parseInt(process.env.RATE_LIMIT_COOLDOWN_MINUTES || '15', 10),
  rateLimitTokenWindowMs: parseInt(process.env.RATE_LIMIT_TOKEN_WINDOW_MS || '300000', 10), // default: 5 minutes
  rateLimitTokenBudget: parseInt(process.env.RATE_LIMIT_TOKEN_BUDGET || '400000', 10), // default: 400K tokens (Claude Pro)

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

  // Model Performance Tracker (record per-model metrics in Firebase)
  modelPerformanceTracking: process.env.MODEL_PERFORMANCE_TRACKING !== 'false', // default: true

  // Smart Model Routing with Learning (epsilon-greedy selection based on Firebase metrics)
  smartModelRouting: process.env.SMART_MODEL_ROUTING !== 'false', // default: true
  smartModelRoutingThreshold: parseFloat(process.env.SMART_MODEL_ROUTING_THRESHOLD || '6.0'),
  smartModelRoutingMinTasks: parseInt(process.env.SMART_MODEL_ROUTING_MIN_TASKS || '5', 10),

  // Tech Debt Tracker (auto-create tasks from minor review issues)
  techDebtTracking: process.env.TECH_DEBT_TRACKING !== 'false', // default: true

  // Dependency Checker (periodic npm audit / outdated)
  depCheckEnabled: process.env.DEP_CHECK_ENABLED === 'true',
  depCheckIntervalHours: parseInt(process.env.DEP_CHECK_INTERVAL_HOURS || '24', 10),

  // Codebase Knowledge Index (semantic map injected into Coder prompt)
  codebaseIndexEnabled: process.env.CODEBASE_INDEX_ENABLED !== 'false', // default: true
  codebaseContextMaxTokens: parseInt(process.env.CODEBASE_CONTEXT_MAX_TOKENS || '2000', 10),
  cacheIndexTtlMs: parseInt(process.env.CACHE_INDEX_TTL_MS || '300000', 10), // default: 5 minutes

  // Style Guide Detector (auto-detected conventions injected into Coder prompt)
  styleDetectorEnabled: process.env.STYLE_DETECTOR_ENABLED !== 'false', // default: true

  // Smart Task Ordering: context affinity boost (0-1, default: 0.2 = 20% boost)
  contextAffinityBoost: parseFloat(process.env.CONTEXT_AFFINITY_BOOST || '0.2'),

  // Pre-PR Test Execution
  prePrTests: process.env.PRE_PR_TESTS !== 'false', // default: true
  prePrTestCmd: process.env.PRE_PR_TEST_CMD || 'auto',

  // CI Monitor (watch GitHub Actions after merge)
  ciMonitor: process.env.CI_MONITOR === 'true', // default: false
  ciMonitorTimeoutMinutes: parseInt(process.env.CI_MONITOR_TIMEOUT_MINUTES || '15', 10),
  autoRevert: process.env.AUTO_REVERT === 'true', // default: false, requires opt-in

  // QA Agent (generate and execute tests between Coder and Reviewer)
  qaAgent: process.env.QA_AGENT === 'true', // default: false
  cliQA: process.env.CLI_QA || 'claude',
  qaTestTypes: (process.env.QA_TEST_TYPES || 'unit,edge-cases')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean),

  // Coverage Delta Check (compare PR coverage vs baseline)
  coverageCheck: process.env.COVERAGE_CHECK !== 'false', // default: true
  coverageCmd: process.env.COVERAGE_CMD || 'auto',
  minCoverageDelta: parseFloat(process.env.MIN_COVERAGE_DELTA || '-2'),

  // Parallel Execution (run multiple independent tasks simultaneously)
  maxParallel: parseInt(process.env.MAX_PARALLEL || '1', 10), // default: 1 = sequential

  // Smart Batching (group trivial tasks into a single PR)
  smartBatching: process.env.SMART_BATCHING === 'true', // default: false
  batchMaxTasks: parseInt(process.env.BATCH_MAX_TASKS || '5', 10),

  // Incremental Review (only re-review fix commits in fix cycles)
  incrementalReview: process.env.INCREMENTAL_REVIEW !== 'false', // default: true

  // Semantic Versioning (auto-bump version after merge)
  autoVersion: process.env.AUTO_VERSION === 'true', // default: false
  versionFile: process.env.VERSION_FILE || 'package.json',

  // Auto Changelog (generate CHANGELOG.md entries after version bump)
  autoChangelog: process.env.AUTO_CHANGELOG
    ? process.env.AUTO_CHANGELOG === 'true'
    : process.env.AUTO_VERSION === 'true', // default: true if AUTO_VERSION=true

  // Auto Release (create GitHub Release when sprint completes)
  autoRelease: process.env.AUTO_RELEASE === 'true', // default: false
  releaseOnSprintComplete: process.env.RELEASE_ON_SPRINT_COMPLETE !== 'false', // default: true
  releaseIgnoreBugs: process.env.RELEASE_IGNORE_BUGS === 'true', // default: false — override release gate

  // Multi-project support
  projects: (process.env.PROJECTS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean),
  multiProjectStrategy: process.env.MULTI_PROJECT_STRATEGY || 'round-robin',

  // Budget Manager
  dailyBudgetUsd: parseFloat(process.env.DAILY_BUDGET_USD || '10'),
  weeklyBudgetUsd: parseFloat(process.env.WEEKLY_BUDGET_USD || '50'),
  budgetWarningThreshold: parseFloat(process.env.BUDGET_WARNING_THRESHOLD || '0.8'),
  estimatedCostPerInvocation: parseFloat(process.env.ESTIMATED_COST_PER_INVOCATION || '0.05'),

  // Event Persistence (persist EventBus events to Firebase for analytics)
  eventRetentionDays: parseInt(process.env.EVENT_RETENTION_DAYS || '30', 10),
  eventPersistTypes: process.env.EVENT_PERSIST_TYPES || '*', // '*' = all, or comma-separated list

  // Webhook Outgoing (send events to external URLs)
  webhookUrl: process.env.WEBHOOK_URL || '',
  webhookUrls: (process.env.WEBHOOK_URLS || '')
    .split(',')
    .map(u => u.trim())
    .filter(Boolean),
  webhookEvents: process.env.WEBHOOK_EVENTS || '*', // '*' = all, or comma-separated list
  webhookHeaders: (process.env.WEBHOOK_HEADERS || '')
    .split(',')
    .map(h => h.trim())
    .filter(Boolean),
  webhookMaxRetries: parseInt(process.env.WEBHOOK_MAX_RETRIES || '3', 10),

  // SonarQube / SonarCloud
  enableSonar: process.env.ENABLE_SONAR === 'true',
  sonarToken: process.env.SONAR_TOKEN || '',
  sonarHostUrl: process.env.SONAR_HOST_URL || '',
  sonarProjectKey: process.env.SONAR_PROJECT_KEY || '',
  sonarOrganization: process.env.SONAR_ORGANIZATION || '',

  // Multi-project support (comma-separated IDs or '*' for all user projects)
  projects: process.env.PROJECTS || '',

  // Circuit Breaker
  circuitBreakerEnabled: process.env.CIRCUIT_BREAKER_ENABLED !== 'false', // default: true
  cbFirebaseThreshold: parseInt(process.env.CB_FIREBASE_THRESHOLD || '5', 10),
  cbGithubThreshold: parseInt(process.env.CB_GITHUB_THRESHOLD || '3', 10),
  cbCliThreshold: parseInt(process.env.CB_CLI_THRESHOLD || '4', 10),
  cbCooldownSeconds: parseInt(process.env.CB_COOLDOWN_SECONDS || '60', 10),
  cbHalfOpenMaxAttempts: parseInt(process.env.CB_HALF_OPEN_MAX_ATTEMPTS || '2', 10),

  // Error Budget
  errorBudgetWindowMinutes: parseInt(process.env.ERROR_BUDGET_WINDOW_MINUTES || '30', 10),
  errorBudgetMaxFailureRate: parseFloat(process.env.ERROR_BUDGET_MAX_FAILURE_RATE || '0.3'),

  // Dead Letter Queue
  deadLetterMaxRetries: parseInt(process.env.DEAD_LETTER_MAX_RETRIES || '3', 10),

  // Plugins
  pluginsDir: resolve(ROOT_DIR, process.env.PLUGINS_DIR || './plugins'),
  enabledPlugins: (process.env.ENABLED_PLUGINS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean),

  // Paths
  rootDir: ROOT_DIR,
  memoryDir: resolve(ROOT_DIR, 'memory'),
  knowledgeDir: resolve(ROOT_DIR, 'knowledge'),
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
