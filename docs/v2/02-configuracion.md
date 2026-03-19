# PARTE 2: CONFIGURACION Y ENTORNO

---

## 4. VARIABLES DE ENTORNO (.env)

```bash
# ============================================
# KOMODO ORCHESTRATOR V2.0 - CONFIGURACION
# ============================================

# --- CLIs de Agentes ---
CLI_PLANNER=claude
CLI_CODER=claude
CLI_REVIEWER=claude
CLI_ARCHITECT=claude
CLI_QA=claude
CLI_SECURITY=claude
CLI_TESTER=claude

# --- Firebase ---
GOOGLE_APPLICATION_CREDENTIALS=./skills/planning-task-mcp/serviceAccountKey.json
FIREBASE_DATABASE_URL=https://tu-proyecto-default-rtdb.europe-west1.firebasedatabase.app

# --- Usuario ---
DEFAULT_USER_ID=tu-firebase-uid
DEFAULT_USER_NAME=TuNombre
DEFAULT_PROJECT_ID=-OmFjaFM9glBQnBTT7QQ

# --- GitHub ---
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
GITHUB_ISSUE_SYNC=false
GITHUB_ISSUE_LABEL=komodo
GITHUB_ISSUE_POLL_INTERVAL=300000

# --- Servidores ---
WS_PORT=3001
API_PORT=3002
API_KEY=komodo-secret-key

# --- Review ---
MAX_REVIEW_CYCLES=3
AUTO_MERGE=true
INCREMENTAL_REVIEW=true
REVIEW_ESCALATION_THRESHOLD=5

# --- Presupuesto ---
DAILY_BUDGET_USD=10
WEEKLY_BUDGET_USD=50
BUDGET_WARNING_THRESHOLD=0.8

# --- Rate Limit ---
RATE_LIMIT_FALLBACK=true
FALLBACK_CLI_ORDER=claude,codex,gemini
RATE_LIMIT_COOLDOWN_MINUTES=15
RATE_LIMIT_TOKEN_BUDGET=300000
RATE_LIMIT_TOKEN_WINDOW=300
CHECKPOINT_AUTO_RESUME=false

# --- Modelo por complejidad (trivial,standard,complex) ---
MODEL_MAP_CLAUDE_PLANNER=haiku,sonnet,sonnet
MODEL_MAP_CLAUDE_CODER=sonnet,sonnet,opus
MODEL_MAP_CLAUDE_REVIEWER=haiku,sonnet,sonnet
MODEL_MAP_CLAUDE_ARCHITECT=sonnet,sonnet,opus
MODEL_MAP_CLAUDE_QA=haiku,sonnet,sonnet
MODEL_MAP_CLAUDE_SECURITY=sonnet,sonnet,opus
MODEL_MAP_CLAUDE_TESTER=haiku,sonnet,sonnet
MODEL_MAP_CODEX_CODER=codex-mini,o4-mini,o3
MODEL_MAP_GEMINI_CODER=gemini-2.0-flash,gemini-2.5-pro,gemini-2.5-pro

# --- Autonomia ---
AUTONOMY_LEVEL=semi-autonomous
APPROVAL_TIMEOUT_MINUTES=30

# --- Task Decomposition ---
TASK_DECOMPOSITION=true
TASK_DECOMPOSITION_THRESHOLD=8

# --- Testing ---
PRE_PR_TESTS=true
ENABLE_QA_AGENT=true
ENABLE_TESTER_AGENT=true
ENABLE_SECURITY_AGENT=true

# --- CI Monitor ---
CI_MONITOR=false
AUTO_REVERT=false
CI_TIMEOUT_MS=900000

# --- Canary ---
CANARY_ENABLED=false
CANARY_BRANCH=staging
CANARY_STABILITY_MINUTES=10

# --- SonarQube ---
ENABLE_SONAR=false
SONAR_TOKEN=squ_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
SONAR_HOST_URL=http://localhost:9000
SONAR_PROJECT_KEY=komodo

# --- Browser MCP ---
ENABLE_BROWSER_MCP=false

# --- Daemon ---
DAEMON_POLL_INTERVAL=60000
SCHEDULE=
SCHEDULE_TIMEZONE=Europe/Madrid

# --- Versionado ---
AUTO_VERSION=false
AUTO_CHANGELOG=false
AUTO_RELEASE=false
RELEASE_ON_SPRINT_COMPLETE=false

# --- Inteligencia ---
CODEBASE_INDEX_ENABLED=true
CODEBASE_LEARNING=true
STYLE_DETECTOR_ENABLED=true
CROSS_PROJECT_INTELLIGENCE=false

# --- Multi-proyecto ---
MULTI_PROJECT_STRATEGY=round-robin

# --- Plugins ---
PLUGINS_DIR=./plugins
ENABLED_PLUGINS=

# --- Coverage ---
MIN_COVERAGE_DELTA=-2
```

## 5. CONFIG RUNTIME (komodo.config.json)

Escrito por el dashboard, sobreescribe valores de .env:

```json
{
  "activeProjectId": "",
  "agents": {
    "planner": { "cli": "claude", "model": "sonnet", "maxTurns": 30 },
    "coder": { "cli": "claude", "model": "opus", "maxTurns": 30 },
    "reviewer": { "cli": "claude", "model": "sonnet", "maxTurns": 30 }
  },
  "maxReviewCycles": 5,
  "budgetLimit": 0,
  "continuousMode": false,
  "availableClis": ["claude", "gemini"]
}
```

## 6. CONFIG LOADER (src/config.js)

El config loader tiene esta logica:
1. Lee `.env` via dotenv
2. Lee `komodo.config.json` (si existe) - dashboard config sobreescribe .env para agents
3. Parsea MODEL_MAP_* y FORCE_MODEL_* env vars a objetos
4. Exporta singleton `config` con 80+ propiedades
5. Exporta `validateConfig()` - verifica CLIs en PATH y Firebase configurado
6. Exporta `cliExists(command)` - verifica si CLI esta instalado (usa `which` o `where`)

**Propiedades clave del config:**

```javascript
export const config = {
  // Agent CLIs (string: 'claude'|'codex'|'gemini')
  cliPlanner, cliCoder, cliReviewer, cliArchitect, cliQA, cliSecurity, cliTester,

  // Firebase
  googleCredentials, firebaseDatabaseUrl, defaultUserId, defaultUserName, defaultProjectId,

  // GitHub
  githubToken, githubIssueSync, githubIssueLabel, githubIssuePollInterval,

  // Servers
  wsPort, apiPort, apiKey,

  // Review
  maxReviewCycles, autoMerge, incrementalReview, reviewEscalationThreshold,

  // Budget
  dailyBudgetUsd, weeklyBudgetUsd, budgetWarningThreshold,

  // Rate limit
  rateLimitFallback, fallbackCliOrder, rateLimitCooldownMinutes,
  rateLimitTokenBudget, rateLimitTokenWindow, checkpointAutoResume,

  // Model maps: { claude: { planner: ['haiku','sonnet','sonnet'], coder: [...] } }
  modelMaps,
  // Force models: { planner: 'sonnet', coder: 'opus' } (optional overrides)
  forceModels,

  // Autonomy
  autonomyLevel, approvalTimeoutMinutes,

  // Task decomposition
  taskDecomposition, taskDecompositionThreshold,

  // Testing
  prePrTests, enableQAAgent, enableTesterAgent, enableSecurityAgent,

  // CI
  ciMonitor, autoRevert, ciTimeoutMs,

  // Canary
  canaryEnabled, canaryBranch, canaryStabilityMinutes,

  // SonarQube
  enableSonar, sonarToken, sonarHostUrl, sonarProjectKey,

  // Browser
  enableBrowserMcp,

  // Daemon
  daemonPollInterval, schedule, scheduleTimezone,

  // Versioning
  autoVersion, autoChangelog, autoRelease, releaseOnSprintComplete,

  // Intelligence
  codebaseIndexEnabled, codebaseLearning, styleDetectorEnabled, crossProjectIntelligence,

  // Multi-project
  projects, multiProjectStrategy,

  // Plugins
  pluginsDir, enabledPlugins,

  // Coverage
  minCoverageDelta,

  // Webhooks
  webhookUrls, webhookHeaders,

  // Fixed thresholds
  complexityThresholds: { trivial: 3, standard: 6 },
  // devPoints <= 3 = trivial, <= 6 = standard, > 6 = complex

  // Derived paths
  rootDir, memoryDir, knowledgeDir, skillsDir,
};
```

## 7. VALIDACION DE CONFIG

```javascript
export function validateConfig() {
  const issues = [];

  // Check required CLIs
  const usedClis = new Set([
    config.cliPlanner, config.cliCoder, config.cliReviewer
  ]);
  for (const cli of usedClis) {
    if (!cliExists(cli)) {
      issues.push(`CLI '${cli}' not found in PATH`);
    }
  }

  // Check Firebase
  if (!config.googleCredentials || !config.firebaseDatabaseUrl) {
    issues.push('Firebase not configured (GOOGLE_APPLICATION_CREDENTIALS + FIREBASE_DATABASE_URL)');
  }

  // Check GitHub
  if (!cliExists('gh')) {
    issues.push('GitHub CLI (gh) not found');
  }

  return { valid: issues.length === 0, issues };
}

export function cliExists(command) {
  try {
    execSync(`${process.platform === 'win32' ? 'where' : 'which'} ${command}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
```
