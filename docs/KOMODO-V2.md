# PARTE 1: VISION, ARQUITECTURA Y ESTRUCTURA

---

## 1. VISION Y CONCEPTO

### 1.1 Que es Komodo

Komodo es un **orquestador de agentes IA para desarrollo de software**. Coordina multiples agentes de IA (Claude Code, Codex CLI, Gemini CLI) como subprocesos reales de terminal — no APIs — permitiendo que cada agente trabaje como un desarrollador autonomo con acceso a herramientas reales (git, GitHub CLI, terminal).

### 1.2 Problema que resuelve

El desarrollo de software tiene un ciclo repetitivo: seleccionar tarea → planificar → implementar → hacer PR → revisar codigo → corregir → mergear. Komodo automatiza TODO este ciclo usando agentes IA especializados que se comunican entre si.

### 1.3 Flujo fundamental

```
PLANNER → ARCHITECT → CODER → QA/TESTER/SECURITY → REVIEWER → MERGE
    ↑                                                    |
    |              (si REQUEST_CHANGES)                   |
    |         CODER ← fix ← REVIEWER (loop max N)        |
    |                                                    ↓
    └──────────── siguiente tarea ◄──── tarea completada
```

### 1.4 Principios de diseno

1. **Subprocess-based**: Cada agente es un proceso CLI real (claude, codex, gemini) con stdin/stdout
2. **JSON-over-stdin**: Todos los prompts van por stdin, nunca como argumentos CLI (evita problemas de shell escaping)
3. **MCP como capa de capacidad**: Cada agente tiene acceso a MCPs como herramientas (GitHub, Firebase, Memory)
4. **EventBus**: Arquitectura de eventos para comunicacion entre componentes
5. **Checkpoint-based resilience**: Estado guardado para recuperacion de fallos
6. **Multi-CLI**: Soporte para Claude, Codex y Gemini con fallback automatico

### 1.5 Agentes del sistema

| Agente | Rol | Descripcion |
|--------|-----|-------------|
| PLANNER | Seleccion | Analiza backlog, selecciona tarea de mayor prioridad |
| ARCHITECT | Planificacion | Analiza codebase, genera plan de implementacion |
| CODER | Implementacion | Crea branch, escribe codigo, abre PR |
| QA | Testing | Genera y ejecuta tests de aceptacion |
| TESTER | Testing quirurgico | Genera tests usando Knowledge Graph |
| SECURITY | Seguridad | Escanea vulnerabilidades OWASP |
| REVIEWER | Revision | Revisa PR con 8 criterios estrictos |

### 1.6 Lo que NO incluye V2.0

- **Office 3D** (Three.js / React Three Fiber) - Eliminado
- **Pixel Office** (Canvas 2D pixel art) - Eliminado
- **Telegram Bot** (node-telegram-bot-api) - Eliminado

El dashboard mantiene toda su funcionalidad de monitoreo, analytics y control pero sin las visualizaciones 3D/pixel.

---

## 2. ARQUITECTURA GENERAL

### 2.1 Stack tecnologico

| Componente | Tecnologia |
|-----------|------------|
| Runtime | Node.js 18+ con ES Modules |
| CLI Framework | Commander.js |
| AI CLIs | Claude Code, Codex CLI, Gemini CLI |
| MCP Protocol | @modelcontextprotocol/sdk |
| Base de datos | Firebase Realtime Database |
| Dashboard | Next.js 15 + React 19 + TypeScript |
| Estilos | Tailwind CSS 4 |
| Charts | Recharts |
| WebSocket | ws (servidor), nativo (cliente) |
| Tests | Vitest |
| Validacion | Zod |
| Logging | chalk (colores terminal) |

### 2.2 Diagrama de componentes

```
┌─────────────────────────────────────────────────────────┐
│                    CLI (Commander.js)                     │
│  komodo run | resume | watch | multi | setup | doctor    │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│                   ORCHESTRATOR                           │
│  - Task loop (run N tasks)                               │
│  - State management (KomodoState)                        │
│  - Server lifecycle (WS, API)                            │
│  - Plugin loading                                        │
│  - Checkpoint detection                                  │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│                   TASK RUNNER                             │
│  Plan → Architect → Code → QA/Test/Security → Review     │
│  - Model selection per complexity                        │
│  - Task decomposition                                    │
│  - Pre-PR tests                                          │
│  - SonarQube analysis                                    │
│  - Tech debt creation                                    │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│                   REVIEW LOOP                            │
│  Reviewer ↔ Coder (max N cycles)                         │
│  - Incremental review (diff-only)                        │
│  - Model escalation                                      │
│  - SonarQube re-analysis                                 │
│  - Pattern recording                                     │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│                   BASE AGENT                             │
│  - CLI adapters (Claude, Codex, Gemini)                  │
│  - Stdin pipe protocol                                   │
│  - MCP server injection                                  │
│  - Rate limit detection                                  │
│  - Streaming watchdog                                    │
│  - Timeout management (idle vs total)                    │
└──────────────────────┬──────────────────────────────────┘
                       │
           ┌───────────┼───────────┐
           ▼           ▼           ▼
       [claude]    [codex]     [gemini]
      subprocess  subprocess  subprocess
```

### 2.3 Flujo de datos

```
Firebase RTDB ◄──── planning-task-mcp ────► Planner/Coder/Reviewer
                                            (lee tareas, sprints, bugs)

GitHub ◄──────── github-mcp ──────────────► Coder/Reviewer
                                            (branches, PRs, merges)

Patterns.json ◄── memory-mcp ────────────► Reviewer
                                            (patrones de error, estadisticas)

KomodoState ◄──── EventBus ──────────────► WebSocket Server
                                            ► Dashboard (tiempo real)
                                            ► API Server (HTTP endpoints)
```

---

## 3. ESTRUCTURA DE DIRECTORIOS COMPLETA

```
komodo/
├── .claude/
│   ├── commands/
│   │   └── komodo.md                    # Slash command /komodo
│   └── settings.local.json              # MCP server registration
│
├── .env                                  # Variables de entorno (secretos)
├── .env.example                          # Template de configuracion
├── .gitignore
├── .komodo/
│   └── checkpoints/                     # Recovery points para tareas pausadas
│
├── src/                                  # Codigo fuente principal
│   ├── index.js                         # CLI entry point (Commander)
│   ├── orchestrator.js                  # Motor de orquestacion principal
│   ├── config.js                        # Cargador de configuracion
│   ├── setup.js                         # Wizard de configuracion interactivo
│   │
│   ├── agents/                          # Implementaciones de agentes
│   │   ├── base-agent.js               # Clase base - spawn CLI + stdin
│   │   ├── planner.js                  # Seleccion de tarea
│   │   ├── architect.js                # Planificacion de implementacion
│   │   ├── coder.js                    # Implementacion de codigo
│   │   ├── reviewer.js                 # Revision de codigo
│   │   ├── qa.js                       # Generacion de tests QA
│   │   ├── tester.js                   # Tests quirurgicos
│   │   ├── security-agent.js           # Analisis de seguridad
│   │   ├── fallback-manager.js         # Gestion de fallback CLI
│   │   ├── rate-limit-detector.js      # Deteccion de rate limits
│   │   ├── streaming-watchdog.js       # Deteccion de anomalias en stream
│   │   └── multi-part-filter.js        # Filtro de tareas multi-parte
│   │
│   ├── cycle/                           # Flujo de ejecucion
│   │   ├── task-runner.js              # Pipeline completo de tarea
│   │   ├── review-loop.js             # Ciclo Coder ↔ Reviewer
│   │   ├── incremental-review.js      # Review incremental (diff-only)
│   │   └── pipeline-scheduler.js      # Paralelizacion de agentes
│   │
│   ├── prompts/                         # System prompts de agentes
│   │   ├── planner-system.js
│   │   ├── architect-system.js
│   │   ├── coder-system.js
│   │   ├── reviewer-system.js
│   │   ├── qa-system.js
│   │   ├── tester-system.js
│   │   └── security-system.js
│   │
│   ├── state/                           # Gestion de estado global
│   │   ├── komodo-state.js             # Singleton de estado
│   │   └── checkpoint-manager.js       # Persistencia de checkpoints
│   │
│   ├── events/                          # Sistema de eventos
│   │   ├── event-bus.js                # EventBus pub/sub global
│   │   └── event-persistence.js        # Persistencia en Firebase
│   │
│   ├── server/                          # Servidores
│   │   ├── ws-server.js                # WebSocket para dashboard
│   │   └── api-server.js              # API REST HTTP
│   │
│   ├── triage/                          # Clasificacion y seleccion
│   │   ├── complexity-classifier.js
│   │   ├── model-selector.js
│   │   ├── smart-model-router.js
│   │   └── task-decomposer.js
│   │
│   ├── intelligence/                    # Inteligencia del codebase
│   │   ├── codebase-indexer.js
│   │   ├── codebase-learner.js
│   │   ├── style-detector.js
│   │   ├── review-feedback.js
│   │   └── cross-project-intelligence.js
│   │
│   ├── knowledge/
│   │   └── knowledge-graph.js
│   ├── memory/
│   │   └── memory-manager.js
│   ├── autonomy/
│   │   ├── autonomy-engine.js
│   │   ├── guardian-gates.js
│   │   ├── approval-gate.js
│   │   └── approval-channels.js
│   ├── resilience/
│   │   ├── resilience-manager.js
│   │   ├── circuit-breaker.js
│   │   ├── error-budget.js
│   │   └── dead-letter-queue.js
│   ├── self-healing/
│   │   ├── healing-engine.js
│   │   ├── flaky-test-registry.js
│   │   └── strategies/
│   │       ├── rate-limit.js
│   │       ├── github-api-error.js
│   │       ├── merge-conflict.js
│   │       ├── test-failure.js
│   │       ├── agent-timeout.js
│   │       └── firebase-down.js
│   ├── cost/
│   │   └── budget-manager.js
│   ├── estimation/
│   │   ├── token-estimator.js
│   │   └── rate-limit-tracker.js
│   ├── daemon/
│   │   └── daemon.js
│   ├── scheduler/
│   │   └── scheduler.js
│   ├── heartbeat/
│   │   └── heartbeat-monitor.js
│   ├── ci-monitor/
│   │   └── ci-monitor.js
│   ├── canary/
│   │   ├── canary-merge.js
│   │   └── conflict-detector.js
│   ├── sonar/
│   │   └── analyzer.js
│   ├── testing/
│   │   └── pre-pr-tests.js
│   ├── coverage/
│   │   └── coverage-analyzer.js
│   ├── versioning/
│   │   ├── version-bumper.js
│   │   ├── changelog-generator.js
│   │   ├── release-manager.js
│   │   └── release-gate.js
│   ├── tech-debt/
│   │   └── tech-debt-tracker.js
│   ├── auto-improve/
│   │   ├── auto-improve.js
│   │   ├── codebase-analyzer.js
│   │   └── dependency-checker.js
│   ├── multi-project/
│   │   ├── multi-project-runner.js
│   │   └── project-loader.js
│   ├── integrations/
│   │   ├── github-issue-sync.js
│   │   ├── pr-comment-bugs.js
│   │   └── webhook-outgoing.js
│   ├── plugins/
│   │   ├── plugin-loader.js
│   │   └── plugin-interface.js
│   ├── observability/
│   │   ├── anomaly-detector.js
│   │   ├── task-timeline.js
│   │   └── explain-decision.js
│   ├── metrics/
│   │   └── metrics-recorder.js
│   ├── security/
│   │   └── security-policies.js
│   ├── smart-ordering/
│   │   └── context-affinity.js
│   ├── review/
│   │   └── review-depth-selector.js
│   ├── doctor/
│   │   └── doctor.js
│   ├── shutdown/
│   │   └── shutdown-manager.js
│   ├── watchdog/
│   │   └── agent-watchdog.js
│   └── utils/
│       ├── logger.js
│       ├── parser.js
│       └── response-validator.js
│
├── skills/                              # MCP Servers (4)
│   ├── komodo-mcp/
│   ├── github-mcp/
│   ├── memory-mcp/
│   └── planning-task-mcp/
│
├── dashboard/                           # Next.js Web UI
│   ├── app/
│   ├── components/
│   ├── hooks/
│   ├── context/
│   └── lib/
│
├── plugins/
├── memory/
├── knowledge/
├── package.json
├── komodo.config.json
├── vitest.config.js
└── sonar-project.properties
```
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
# PARTE 3: CLI Y ORQUESTADOR

---

## 8. CLI - PUNTO DE ENTRADA (src/index.js)

Commander.js maneja todos los comandos. El CLI es el unico punto de entrada para usuarios.

### Comandos disponibles:

| Comando | Descripcion | Opciones |
|---------|-------------|----------|
| `komodo run` | Ejecutar N tareas | `-p <id>`, `-t <n>`, `-c` (continuo), `--cwd`, `--dry-run` |
| `komodo resume` | Reanudar desde checkpoint | `--cwd` |
| `komodo watch` | Modo daemon (24/7) | `-p <id>`, `--cwd`, `--max-tasks` |
| `komodo multi` | Orquestacion multi-proyecto | `--strategy`, `--cwd` |
| `komodo setup` | Wizard de configuracion | (interactivo) |
| `komodo doctor` | Diagnosticos | (silencioso pre-run) |
| `komodo dashboard` | Lanzar WS + Next.js | - |

### Flujo de `komodo run`:
1. Resolver projectId (de `-p`, o PROJECTS env, o DEFAULT_PROJECT_ID)
2. Ejecutar `doctor({ silent: true })` - auto-diagnostico
3. Verificar checkpoints pendientes con `checkForPendingCheckpoints()`
4. Llamar `run(projectId, { tasks, cwd, dryRun })`

### Graceful shutdown:
```javascript
process.on('SIGINT', async () => {
  const { shutdownManager } = await import('./shutdown/shutdown-manager.js');
  await shutdownManager.shutdown();
  process.exit(0);
});
```

### resolveProjectIdFromEnv():
```javascript
export function resolveProjectIdFromEnv() {
  if (config.projects.length > 0) return config.projects[0];
  if (config.defaultProjectId) return config.defaultProjectId;
  logger.error('No project ID configured');
  process.exit(1);
}
```

---

## 9. ORQUESTADOR PRINCIPAL (src/orchestrator.js)

### 9.1 Exports

```javascript
export { run, resume, checkForPendingCheckpoints };
// Re-exports para acceso externo:
export { eventBus, komodoState, checkpointManager };
```

### 9.2 run(projectId, options)

Esta es la funcion principal. Ejecuta N tareas del backlog secuencialmente.

**Parametros:**
- `projectId` (string) - ID del proyecto en Firebase
- `options.tasks` (number) - Tareas a ejecutar (0 = infinito)
- `options.cwd` (string) - Directorio del repo target
- `options.dryRun` (boolean) - Simular sin ejecutar
- `options.skipServers` (boolean) - No iniciar WS/API (usado por MCP)
- `options.skipHeartbeat` (boolean) - No iniciar heartbeat (usado por MCP)

**Flujo:**
1. Si dryRun: loop de `runTaskDryRun()` y salir
2. Setear estado: `komodoState.setExecutionState('running')`
3. Cargar plugins: `loadPlugins()` (trigger codebase learning)
4. Iniciar servidores: WS (port 3001), API (port 3002) - si no skipServers
5. Iniciar monitores: HeartbeatMonitor, BudgetManager, ResilienceManager
6. Registrar shutdown hooks
7. **Loop principal:**
   - Verificar pause/stop request
   - Verificar budget exceeded
   - Ejecutar `runTask(projectId, cwd)`
   - Si null → backlog vacio, break
   - Si rateLimited → checkpoint guardado, break
   - Si success → incrementar contador
   - Si error → log y continuar (graceful degradation)
8. Finally: cleanup via `shutdownManager.shutdown()`

### 9.3 resume(options)

Reanuda desde un checkpoint de rate limit.

**Flujo:**
1. Listar checkpoints pendientes
2. Cargar el mas reciente
3. Validar (no expirado >24h, datos validos)
4. Ejecutar `resumeTask(checkpoint, cwd)`
5. Borrar checkpoint al completar
6. Cleanup

### 9.4 checkForPendingCheckpoints(options)

Detecta y opcionalmente auto-reanuda checkpoints pendientes.

**Flujo:**
1. Listar checkpoints
2. Si no hay, return
3. Validar el mas reciente
4. Si `CHECKPOINT_AUTO_RESUME=true` → auto-resume
5. Si no → log "Run komodo resume"

---

## 10. SETUP WIZARD (src/setup.js)

Wizard interactivo de 12 pasos usando readline:

1. **Prerequisites**: Verificar Node, git, gh, CLIs de IA
2. **Select CLIs**: Planner, Coder, Reviewer CLI selection
3. **Firebase**: Credenciales y database URL
4. **User Identity**: UID y nombre
5. **GitHub**: Token + Issue Sync
6. **Basic Preferences**: Project ID, auto-merge, max review cycles
7. **Budget**: Daily/weekly USD limits
8. **Rate Limit**: Fallback + complexity thresholds
9. **Servers**: WS + API ports
10. **Browser MCP**: Chrome DevTools toggle
11. **Advanced**: SonarQube + Plugins
12. **Generate .env**: Escribe archivo completo

Post-setup:
- `npm install` en root y cada skill
- `claude mcp add komodo-mcp` - registro global
- Actualizar `.claude/settings.local.json` con permisos
# PARTE 4: AGENTE BASE E INFRAESTRUCTURA DE AGENTES

---

## 11. BASE AGENT (src/agents/base-agent.js)

Este es el archivo mas critico del sistema. Maneja la comunicacion con todos los CLIs de IA.

### 11.1 CLI Adapters

Cada CLI tiene su propio adapter con 3 funciones: `buildArgs`, `buildStdin`, `parseOutput`.

**Claude Code Adapter:**
- Args: `--output-format json`, `--mcp-config <path>`, `--model <model>`, `--max-turns <n>`, `--disallowed-tool <tool>` (uno por cada)
- Stdin: `{systemPrompt}\n\n---\n\n{userPrompt}`
- Parse: JSON lines, buscar `type: "result"`, extraer `result`, `cost_usd`, `num_turns`

**Codex CLI Adapter:**
- Args: `exec`, `--json`, `--full-auto`, `-m <model>`, `--mcp-config <path>`
- Stdin: mismo formato
- Parse: JSON lines con `type: "message"` o campo `response`

**Gemini CLI Adapter:**
- Args: `--output-format json`, `--yolo`, `-m <model>`
- Stdin: mismo formato
- Parse: JSON lines con campo `result` o `response`

### 11.2 buildMcpServers(serverNames)

Construye definiciones de MCP servers para inyectar en el CLI:

```javascript
// Servers disponibles:
// 'planning-task-mcp' → node + skillsDir path + Firebase env vars
// 'github-mcp' → node + skillsDir path + GITHUB_TOKEN
// 'memory-mcp' → node + skillsDir path + KOMODO_ROOT
// 'chrome-devtools' → npx @anthropic-ai/chrome-devtools-mcp@latest (si enabled)
```

Genera JSON temporal en os.tmpdir() que se pasa como `--mcp-config`.

### 11.3 spawnCli(command, args, options)

Spawn de subproceso con gestion de timeouts:

**Parametros:**
- `command` (string) - CLI ejecutable
- `args` (string[]) - Argumentos
- `options.stdinData` (string) - Datos a enviar por stdin
- `options.idleTimeout` (number) - Ms sin output → kill (default 180000)
- `options.totalTimeout` (number|null) - Ms totales → kill (null = solo idle)
- `options.signal` (AbortSignal) - Cancelacion externa
- `options.onStdoutLine` (function) - Callback por linea stdout
- `options.onStderrLine` (function) - Callback por linea stderr

**Comportamiento:**
- `shell: true` para Windows .cmd file resolution
- Idle timeout: se resetea con cada chunk de output (bueno para Planner/Reviewer)
- Total timeout: limite duro que no se resetea (bueno para Coder en Windows por buffering de stdout)
- Si ambos configurados, total timeout toma precedencia
- AbortSignal: permite cancelacion desde pipeline-scheduler
- Cleanup: timers limpiados en close/error

### 11.4 runAgent(options) - Funcion principal

**Parametros:**
```javascript
{
  name,              // 'PLANNER', 'CODER', 'REVIEWER', etc.
  cli,               // 'claude', 'codex', 'gemini'
  systemPrompt,      // String completo
  userPrompt,        // String completo
  mcpServerNames,    // ['planning-task-mcp', 'github-mcp', ...]
  model,             // 'sonnet', 'opus', 'haiku', etc.
  maxTurns,          // Max conversation turns (default 30)
  idleTimeout,       // Ms idle timeout (default 180000)
  totalTimeout,      // Ms total timeout (null = use idle)
  disallowedTools,   // ['Write', 'Edit', ...] tools bloqueados
  signal,            // AbortSignal para cancelacion
}
```

**Flujo:**
1. **Resolve CLI**: `fallbackManager.resolveEffectiveCli(cli, name)` - si rate-limited, usa fallback
2. **Get adapter**: Seleccionar adapter segun CLI efectivo
3. **Build MCP config**: Generar archivo JSON temporal con servers MCP
4. **Build args**: Construir argumentos via adapter
5. **Build stdin**: Construir payload stdin via adapter
6. **Create watchdog**: `new StreamingWatchdog(name, { reviewerMode })` para deteccion de anomalias
7. **Spawn process**: `spawnCli()` con callbacks:
   - `onStdoutLine`: Feed watchdog, emit agent:output event, write debug file
   - `onStderrLine`: Check rate limit, write debug file
8. **Parse output**: Extraer JSON via adapter
9. **Check rate limit**: Detectar en resultado y stderr
10. **Return**: `{ success, result, cost, turns, duration, earlyTerminated, rateLimited, error }`
11. **Cleanup**: Borrar archivo MCP config temporal

**Return value:**
```javascript
{
  success: boolean,        // true si completo sin errores
  result: string | null,   // Texto/JSON del agente
  cost: number,            // Costo en USD
  turns: number,           // Turnos de conversacion
  duration: number,        // Ms totales
  earlyTerminated: boolean,// Watchdog termino temprano
  terminationReason: string | null, // Razon de terminacion
  rateLimited: boolean,    // Rate limit detectado
  error: string | null,    // Mensaje de error
}
```

### 11.5 Debug files

Cada invocacion escribe archivos de debug en rootDir:
- `_debug_PLANNER_stdout.txt`
- `_debug_PLANNER_stderr.txt`
- `_debug_CODER_stdout.txt`
- etc.

Utiles para diagnostico cuando el parsing JSON falla.

---

## 12. FALLBACK MANAGER (src/agents/fallback-manager.js)

### 12.1 Proposito

Cuando un CLI esta rate-limited, el fallback manager redirige al siguiente CLI disponible.

### 12.2 Clase FallbackManager (singleton)

```javascript
class FallbackManager {
  #rateLimitedMap = new Map(); // cli → timestamp

  isEnabled() { return config.rateLimitFallback; }

  markRateLimited(cli) {
    this.#rateLimitedMap.set(cli, Date.now());
  }

  isRateLimited(cli) {
    const timestamp = this.#rateLimitedMap.get(cli);
    if (!timestamp) return false;
    // TTL-based cleanup
    const cooldownMs = config.rateLimitCooldownMinutes * 60 * 1000;
    if (Date.now() - timestamp > cooldownMs) {
      this.#rateLimitedMap.delete(cli);
      return false;
    }
    return true;
  }

  getAvailableFallbackCli(failedCli) {
    for (const cli of config.fallbackCliOrder) {
      if (cli === failedCli) continue;
      if (this.isRateLimited(cli)) continue;
      if (!cliExists(cli)) continue;
      return cli;
    }
    return null; // All CLIs rate-limited
  }

  resolveEffectiveCli(originalCli, agentRole) {
    if (!this.isEnabled()) return { cli: originalCli, isFallback: false };
    if (!this.isRateLimited(originalCli)) return { cli: originalCli, isFallback: false };

    const fallback = this.getAvailableFallbackCli(originalCli);
    if (fallback) {
      eventBus.emitEvent('AGENT_FALLBACK', { agent: agentRole, from: originalCli, to: fallback });
      return { cli: fallback, isFallback: true };
    }

    // All rate-limited, use original anyway
    return { cli: originalCli, isFallback: false };
  }

  markRecovered(cli) { this.#rateLimitedMap.delete(cli); }
  clear() { this.#rateLimitedMap.clear(); }
  getRateLimitedClis() { /* auto-clean expired, return array */ }
}

export const fallbackManager = new FallbackManager();
```

---

## 13. RATE LIMIT DETECTOR (src/agents/rate-limit-detector.js)

### 13.1 Patrones por CLI

**Claude:**
```javascript
const CLAUDE_PATTERNS = [
  /rate.?limit/i,
  /too many requests/i,
  /429/,
  /usage.?limit/i,
  /quota.?exceeded/i,
  /overloaded/i,
  /at capacity/i,
  /hit your.*limit/i,
  /resets?\s+\d{1,2}[ap]m/i,
];
```

**Codex:**
```javascript
const CODEX_PATTERNS = [
  /rate_limit_exceeded/i,
  /tokens?.?per.?min/i,
  /requests?.?per.?min/i,
  ...CLAUDE_PATTERNS, // shared patterns
];
```

**Gemini:**
```javascript
const GEMINI_PATTERNS = [
  /resource_exhausted/i,
  /RESOURCE_EXHAUSTED/,
  ...CLAUDE_PATTERNS,
];
```

### 13.2 detectRateLimit(text, cli)

```javascript
export function detectRateLimit(text, cli) {
  const patterns = CLI_PATTERNS[cli] || CLAUDE_PATTERNS;
  for (const pattern of patterns) {
    if (pattern.test(text)) {
      return { detected: true, matchedPattern: pattern.source };
    }
  }
  return { detected: false, matchedPattern: null };
}
```

### 13.3 parseRetryAfter(text)

Extrae duracion de retry-after de 7 formatos diferentes:

```javascript
export function parseRetryAfter(text) {
  // "retry after 2m30s" → compound
  // "retry after 22s" → seconds
  // "Retry-After: 120" → HTTP header
  // "try again in 45 seconds"
  // "wait 60s before"
  // "retry in 5 minutes"
  // "resets 8pm" → calculate seconds until next occurrence
  // Returns: seconds (number) or null
}
```

### 13.4 checkAndEmitRateLimit(text, cli, agentName)

Punto de integracion principal - llamado desde base-agent:

```javascript
export function checkAndEmitRateLimit(text, cli, agentName) {
  const { detected, matchedPattern } = detectRateLimit(text, cli);
  if (!detected) return false;

  const retryAfterSeconds = parseRetryAfter(text);
  fallbackManager.markRateLimited(cli);

  eventBus.emitEvent('RATE_LIMIT_DETECTED', {
    cli, agentName, matchedPattern, retryAfterSeconds
  });

  checkAllClisRateLimited();
  return true;
}
```

### 13.5 checkAllClisRateLimited()

```javascript
export function checkAllClisRateLimited() {
  const usedClis = new Set([config.cliPlanner, config.cliCoder, config.cliReviewer]);
  const allLimited = [...usedClis].every(cli => fallbackManager.isRateLimited(cli));
  if (allLimited) {
    eventBus.emitEvent('ALL_CLIS_RATE_LIMITED', {});
    logger.warn('All CLIs rate-limited. Komodo on standby.');
  }
}
```

---

## 14. STREAMING WATCHDOG (src/agents/streaming-watchdog.js)

### 14.1 Proposito

Monitorea el stream de output de agentes en tiempo real para detectar 7 tipos de anomalias y terminar tempranamente.

### 14.2 Clase StreamingWatchdog

```javascript
export class StreamingWatchdog {
  constructor(agentName, options = {}) {
    this.agentName = agentName;
    this.reviewerMode = options.reviewerMode || false;
    this._terminated = false;
    this._terminationReason = null;
    this._killCallback = null;

    // Counters
    this.totalTokensEstimate = 0;
    this.lastToolName = null;
    this.consecutiveSameToolCount = 0;
    this.consecutiveToolsWithoutText = 0;
    this.tokensSinceLastCodeBlock = 0;
    this.tokensSinceLastToolCall = 0;
  }
```

### 14.3 Detectores de anomalias

**1. Reviewer Early Approval (solo reviewerMode):**
- En los primeros 3K chars, buscar patron `"verdict":"APPROVED"` o `"verdict": "APPROVED"`
- Si encontrado: kill, emit REVIEWER_EARLY_APPROVED
- Ahorra ~20% tokens en reviews rapidas

**2. Tool Loop (5+ misma tool consecutiva):**
- Track `lastToolName` y `consecutiveSameToolCount`
- Si mismo tool 5+ veces → kill (loop infinito)

**3. Excessive Tool Calls (20+ sin texto):**
- Track `consecutiveToolsWithoutText`
- Si 20+ tool calls sin texto entre ellas → kill

**4. Watchdog Alert (8K+ tokens sin tool call):**
- Track `tokensSinceLastToolCall`
- Si > 8K tokens sin herramienta → alerta (NO kill)
- Reset counter para evitar spam

**5. No Access Detector:**
- Buscar frases: "cannot access", "don't have access", "i don't have access"
- Si encontrado → kill

**6. Wandering Detector (5K+ tokens sin code block):**
- Track `tokensSinceLastCodeBlock`
- Si > 5K tokens de texto sin bloque de codigo → kill (divagando)

**7. Wrong Language Detector:**
- Marcadores espanol: "tambien", "ademas", "segun", etc.
- Marcadores ingles: "i will", "let me", "we need", etc.
- Si 2+ marcadores del idioma incorrecto → kill

### 14.4 feed(msg, rawAccumulatedOutput)

```javascript
feed(msg, rawAccumulatedOutput) {
  if (this._terminated) return;

  // Estimate tokens (~4 chars per token)
  const text = JSON.stringify(msg);
  const tokens = Math.ceil(text.length / 4);
  this.totalTokensEstimate += tokens;

  // 1. Reviewer early approval check
  if (this.reviewerMode && this.totalTokensEstimate < 750) { // ~3K chars
    if (/"verdict"\s*:\s*"APPROVED"/i.test(text)) {
      this._kill('REVIEWER_EARLY_APPROVED', 'Reviewer approved in first 3K chars');
      return;
    }
  }

  // 2-7. Other detectors...
  // (check each anomaly type and kill if threshold exceeded)
}
```

### 14.5 _kill(reason, description)

```javascript
_kill(reason, description) {
  this._terminated = true;
  this._terminationReason = reason;
  this.tokensSavedEstimate = Math.ceil(this.totalTokensEstimate * 0.2);

  logger.warn(`[WATCHDOG:${this.agentName}] ${reason}: ${description}`);

  eventBus.emitEvent('EARLY_TERMINATION', {
    agentName: this.agentName, reason, description
  });
  eventBus.emitEvent('ANOMALY_DETECTED', {
    agentName: this.agentName, type: reason
  });

  // Execute kill callback (terminates subprocess)
  this._killCallback?.();
}
```

---

## 15. MULTI-PART FILTER (src/agents/multi-part-filter.js)

Detecta tareas multi-parte como "(2/4)" y bloquea partes posteriores si anteriores no estan completadas.

```javascript
export function getUnresolvedPreviousParts(task, allTasks) {
  // Patterns: "(2/4)", "(Part 2 of 4)", "[2/4]", "(2 of 4)"
  const patterns = [
    /\((\d+)\/(\d+)\)/,
    /\(Part\s+(\d+)\s+of\s+(\d+)\)/i,
    /\[(\d+)\/(\d+)\]/,
    /\((\d+)\s+of\s+(\d+)\)/i,
  ];

  for (const pattern of patterns) {
    const match = task.title.match(pattern);
    if (!match) continue;

    const currentPart = parseInt(match[1]);
    const totalParts = parseInt(match[2]);
    if (currentPart <= 1) return []; // Part 1 never blocked

    const baseTitle = task.title.replace(pattern, '').trim();
    const unresolved = [];

    for (let i = 1; i < currentPart; i++) {
      const prevTask = allTasks.find(t => {
        const prevMatch = t.title.match(pattern);
        if (!prevMatch) return false;
        const prevBase = t.title.replace(pattern, '').trim();
        return prevBase === baseTitle && parseInt(prevMatch[1]) === i;
      });

      if (!prevTask || prevTask.status !== 'done') {
        unresolved.push(prevTask?.id || `part-${i}-of-${baseTitle}`);
      }
    }

    return unresolved;
  }

  return [];
}
```
# PARTE 5: AGENTES ESPECIFICOS (Planner, Architect, Coder, Reviewer)

---

## 16. AGENTE PLANNER (src/agents/planner.js)

### 16.1 Proposito
Selecciona la siguiente tarea del backlog usando ranking inteligente basado en sprint order, eficiencia y afinidad de contexto.

### 16.2 fetchProjectTasks(projectId)
Obtiene todas las tareas del proyecto desde Firebase via helper directo.

### 16.3 filterBlockedTasks(todoTasks, allTasks)

**Logica:**
1. Construir mapa de tareas para lookup rapido
2. Para cada tarea to-do:
   - Verificar dependencias explicitas (`blockedBy[]`) - si blocker no esta "done", bloquear
   - Verificar dependencias implicitas multi-parte via `getUnresolvedPreviousParts()`
3. Return: `{ eligible: [], blocked: [{ task, unresolvedBlockers }] }`

### 16.4 pickNextTask(projectId, options)

**Parametros:**
- `projectId` - ID del proyecto
- `options.cwd` - Directorio de trabajo
- `options.lastCompletedTaskContext` - Contexto de la ultima tarea completada (para afinidad)

**Flujo completo:**

1. **Fetch tasks** - Obtener todas las tareas del proyecto
2. **Check in-progress** - Si hay tareas in-progress, retornar la primera (completar trabajo iniciado)
3. **Filter to-do** - Obtener solo tareas con status "to-do"
4. **Filter blocked** - Separar eligible vs blocked por dependencias
5. **Fetch sprint order** - Ordenar sprints por startDate ASC
6. **Enrich tasks** - Para cada tarea eligible:
   - Clasificar complejidad (trivial/standard/complex)
   - Estimar tokens necesarios
   - Calcular eficiencia: `bizPoints / estimatedTokens`
   - Asignar indice de sprint
7. **Apply context affinity** - Boost a tareas relacionadas con archivos recientemente modificados
8. **Sort** - Sprint order ASC, eficiencia DESC dentro del mismo sprint
9. **Run Planner agent** - Enviar lista ordenada al agente para seleccion final
10. **Validate** - Verificar que respuesta tenga taskId, title, branchName

**Return value:**
```javascript
{
  taskId: string,
  title: string,
  branchName: string,        // "feature/task-{6chars}-{slug}"
  repoUrl: string,
  userStory: { who, what, why },
  acceptanceCriteria: string[],
  devPoints: number,
  bizPoints: number,
  sprintId: string,
  cost: number,
  duration: number,
}
```

---

## 17. AGENTE ARCHITECT (src/agents/architect.js)

### 17.1 Proposito
Analiza el codebase y genera un plan de implementacion estructurado antes de que el Coder empiece.

### 17.2 analyzeTask(taskSpec, cwd, options)

**Input:** taskSpec (taskId, title, userStory, acceptanceCriteria, branchName, repoUrl)

**Prompt instruye al agente a:**
1. Leer archivos relevantes del proyecto
2. Identificar archivos a crear y modificar
3. Determinar orden de implementacion
4. Detectar riesgos y dependencias
5. Devolver JSON estructurado

**Config del agente:**
- MCPs: ninguno (solo acceso read-only al filesystem)
- maxTurns: 20
- idleTimeout: 300000 (5 min)
- Model: seleccion por complejidad

**Return value:**
```javascript
{
  success: boolean,
  plan: {
    filesToCreate: string[],
    filesToModify: string[],
    dependencies: string[],
    dataModelChanges: string,
    apiChanges: string,
    implementationOrder: string[],
    risks: string[],
    estimatedComplexity: string,  // "trivial"|"low"|"medium"|"high"|"critical"
  },
  cost: number,
  duration: number,
}
```

---

## 18. AGENTE CODER (src/agents/coder.js)

### 18.1 Proposito
Implementa codigo, crea branches, abre PRs. Tiene dos modos: implementacion inicial y correccion de issues.

### 18.2 implementTask(taskSpec, cwd, options)

**Inyeccion de contexto (static prefix para caching):**
1. **Architect Plan** - Si disponible, skip exploration del codebase
2. **Codebase Index** - Si no hay plan y indexing enabled, inyectar resumen
3. **Style Guide** - Reglas de estilo detectadas automaticamente
4. **Review Feedback** - Top patrones de reviews anteriores
5. **Coding Guidelines** - Directrices especificas del proyecto (desde dashboard)
6. **Module Lessons** - Lecciones del Knowledge Graph
7. **Learning Context** - Patrones de aprendizaje incremental

**Config del agente:**
- MCPs: `github-mcp`, `planning-task-mcp`
- maxTurns: 50
- totalTimeout: 900000 (15 min - total, no idle, para Windows)
- Model: seleccion por complejidad

**Instrucciones al agente:**
1. Crear branch desde main
2. Implementar TODOS los criterios de aceptacion
3. Commits descriptivos (feat:/fix:/refactor:)
4. Abrir PR o reutilizar existente
5. NO hacer merge

**Return value:**
```javascript
{
  success: boolean,
  pr: {
    prNumber: number,
    prUrl: string,
    branchName: string,
    filesChanged: string[],
    summary: string,
  },
  cost: number,
  duration: number,
}
```

### 18.3 fixReviewIssues(taskSpec, prNumber, reviewFeedback, cwd, options)

**Logica clave:**
- Extraer archivos mencionados en issues (diff-only context)
- Inyectar review feedback patterns
- Instrucciones: leer SOLO archivos mencionados, arreglar CADA issue, push misma branch

**Config del agente:**
- MCPs: `github-mcp`
- maxTurns: 40
- totalTimeout: 900000 (15 min)

**Return value:**
```javascript
{
  success: boolean,
  fix: {
    fixed: boolean,
    issuesResolved: string[],
    issuesNotResolved: string[],
    filesChanged: string[],
    summary: string,
  },
  cost: number,
  duration: number,
}
```

### 18.4 Helpers

```javascript
// Extraer owner/repo de URL GitHub
function extractOwnerRepo(repoUrl) {
  const match = repoUrl?.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
  return match ? `${match[1]}/${match[2]}` : null;
}

// Extraer paths de archivos mencionados en issues de review
function extractFilesFromIssues(issues) {
  const files = new Set();
  for (const issue of issues) {
    if (issue.file) files.add(issue.file);
    const desc = issue.description || (typeof issue === 'string' ? issue : '');
    const matches = desc.match(/[\w/.-]+\.(js|ts|tsx|jsx|py|go|rs|java|css|html|json|md|yaml|yml)/g);
    if (matches) matches.forEach(f => files.add(f));
  }
  return [...files];
}
```

---

## 19. AGENTE REVIEWER (src/agents/reviewer.js)

### 19.1 Proposito
Revisa PRs con 8 criterios estrictos. Genera veredicto APPROVED o REQUEST_CHANGES.

### 19.2 reviewPR(options)

**Parametros completos:**
```javascript
{
  prNumber, repo, taskSpec, cwd,
  sonarReport,         // Analisis SonarQube
  coverageReport,      // Delta de cobertura
  qaReport,            // Resultados QA
  securityReport,      // Findings de seguridad
  model,               // Override de modelo
  codingGuidelines,    // Directrices del proyecto
  reviewCycle,         // Numero de ciclo (1, 2, 3...)
  previousReview,      // Review anterior (para incremental)
  lastReviewSHA,       // SHA del ultimo review (para diff incremental)
  pluginIssues,        // Issues de plugins before-review
  knowledgeContext,     // Contexto del Knowledge Graph
  filesChanged,        // Archivos modificados
}
```

**Flujo completo:**

1. **Select review depth** via `selectReviewDepth()`:
   - `quick`: solo correctness + security critical (devPoints <= 3, < 5 files)
   - `standard`: correctness, error handling, edge cases, naming, structure
   - `deep`: 8 criterios completos (devPoints >= 8 o security flags)
   - `forensic`: analisis linea por linea (cambios criticos)

2. **Capture HEAD SHA** para incremental review futuro

3. **Build prompt sections:**
   - Acceptance criteria list
   - Browser validation (si ENABLE_BROWSER_MCP)
   - SonarQube analysis (si disponible)
   - Coverage delta (si disponible)
   - QA test results (si disponible)
   - Security findings (si disponible)
   - Coding guidelines
   - Plugin issues (obligatorio resolver)
   - Incremental context (ciclo > 1: solo diff desde lastReviewSHA)
   - Knowledge Graph context (solo ciclo 1)

4. **Incremental review** (ciclo > 1):
   - Solo diff desde lastReviewSHA
   - Estimar tokens ahorrados
   - Log metricas de reduccion

5. **Run agent** con disallowedTools: ['Write', 'Edit', 'NotebookEdit'] (read-only)

6. **Early termination** detection:
   - Si watchdog detecta APPROVED en primeros 3K chars → score 10

7. **Normalize verdict** via `normalizeVerdict()`

**Config del agente:**
- MCPs: `github-mcp`, `memory-mcp`
- maxTurns: depends on depth (quick=10, standard=20, deep=30, forensic=40)
- totalTimeout: 600000 (10 min)
- disallowedTools: Write, Edit, NotebookEdit

### 19.3 normalizeVerdict(rawVerdict, score, issues, sonarReport, coverageReport)

Reglas de consenso:

```javascript
export function normalizeVerdict(rawVerdict, score, issues, sonarReport, coverageReport) {
  // 1. Quality Gate FAILED → force REQUEST_CHANGES
  if (sonarReport?.qualityGate === 'ERROR') return 'REQUEST_CHANGES';

  // 2. Coverage below threshold → force REQUEST_CHANGES
  if (coverageReport?.belowThreshold) return 'REQUEST_CHANGES';

  // 3. Check issues severity
  const hasCritical = issues?.some(i => i.severity === 'critical');
  const hasMajor = issues?.some(i => i.severity === 'major');

  // 4. Score < 8 OR critical/major → REQUEST_CHANGES
  if (score < 8 || hasCritical || hasMajor) return 'REQUEST_CHANGES';

  // 5. Normalize variant names
  const normalized = rawVerdict?.toUpperCase?.()?.trim?.();
  if (normalized?.includes('APPROVE')) return 'APPROVED';
  if (normalized?.includes('REQUEST') || normalized?.includes('CHANGE')) return 'REQUEST_CHANGES';

  // 6. Default based on score
  return score >= 8 ? 'APPROVED' : 'REQUEST_CHANGES';
}
```

### 19.4 Return value

```javascript
{
  success: boolean,
  review: {
    verdict: 'APPROVED' | 'REQUEST_CHANGES',
    score: number,       // 0-10
    issues: [{
      severity: 'critical' | 'major' | 'minor',
      description: string,
      file: string,
      line: number,
      suggestion: string,
    }],
    positives: string[],
    summary: string,
  },
  cost: number,
  duration: number,
  reviewSHA: string,        // HEAD SHA at review time
  reviewDepth: string,      // quick|standard|deep|forensic
  earlyTerminated: boolean,
  tokensSavedEstimate: number,
  incremental: boolean,
  incrementalMetrics: { tokensSaved, reductionPercent },
}
```

### 19.5 8 Criterios de review

1. **Correctness** - Funcionalidad correcta, criterios cumplidos
2. **Error Handling** - Try/catch, validaciones, edge cases
3. **Edge Cases** - Null, empty, boundary values
4. **Naming** - Variables, funciones, archivos descriptivos
5. **Structure** - Organizacion, modularidad, DRY
6. **Tests** - Cobertura adecuada, tests significativos
7. **Security** - OWASP compliance, no secrets hardcoded
8. **Patterns** - Patrones del proyecto, consistencia

### 19.6 Seccion SonarQube

Si sonarReport disponible, inyecta:
- Quality gate status
- Metricas (bugs, vulnerabilities, code smells, coverage)
- Issues BLOCKER y CRITICAL como tabla
- Instrucciones: mencionar findings, no duplicar esfuerzo

### 19.7 Seccion QA

Si qaReport disponible:
- Tests generados/pasados/fallidos
- Archivos creados
- Tests que fallan el codigo del Coder (failsCoderCode: true)
- Instrucciones: factor test failures into verdict

### 19.8 Seccion Security

Si securityReport disponible:
- Verdict (PASS/WARN/BLOCK)
- Counts por severidad
- Summary y tabla de findings (CRITICAL/HIGH/MEDIUM)
- Instrucciones: focus en logica, no duplicar analisis

---

## 20. AGENTE QA (src/agents/qa.js)

### 20.1 runQAAgent(options)

**Parametros:** taskSpec, filesChanged[], branchName, repo, prNumber, cwd, model

**Flujo:**
1. Prompt con: tarea, criterios, archivos modificados, tipos de test
2. Instrucciones: detectar framework, generar tests por criteria + edge cases, ejecutar, push si pasan
3. Distinguir bugs del Coder (failsCoderCode: true) vs tests mal escritos
4. Config: maxTurns 30, totalTimeout 600s
5. Emit QA_TESTS_GENERATED event

**Return:**
```javascript
{
  success: boolean,
  qa: {
    testsGenerated: number,
    testsPassed: number,
    testsFailed: number,
    filesCreated: string[],
    filesChanged: string[],
    pushed: boolean,
    failedTests: [{ name, error, failsCoderCode }],
    summary: string,
  },
  cost: number,
  duration: number,
}
```

---

## 21. AGENTE TESTER (src/agents/tester.js)

### 21.1 runTesterAgent(options)

Similar a QA pero usa Knowledge Graph para tests "quirurgicos":
- Inyecta contexto del Architect plan y decisiones del Coder
- Tests basados en riesgos identificados
- Coverage percentage tracked

**Diferencia con QA:** Tester tiene contexto completo del Knowledge Graph (plan + decisiones), QA solo tiene archivos modificados.

**Return:**
```javascript
{
  success: boolean,
  tester: {
    testsGenerated: number,
    testsPassed: number,
    testsFailed: number,
    coverage: number,        // percentage
    filesCreated: string[],
    filesChanged: string[],
    pushed: boolean,
    failedTests: [],
    summary: string,
  },
  cost: number,
  duration: number,
}
```

---

## 22. AGENTE SECURITY (src/agents/security-agent.js)

### 22.1 runSecurityAgent(options)

**Flujo unico:** Ejecuta herramientas EXTERNAS antes del LLM:
1. `npm audit` - vulnerabilidades de dependencias
2. `gitleaks` - secretos hardcoded (si instalado)
3. `semgrep` - patrones de seguridad (si instalado)
4. Inyectar findings como contexto
5. LLM analiza cada archivo contra OWASP Top 10

**Verdict computation (independiente del LLM):**
```javascript
// Re-derive verdict from findings (prevent hallucination)
const criticalCount = findings.filter(f => f.severity === 'CRITICAL').length;
const highCount = findings.filter(f => f.severity === 'HIGH').length;
const mediumCount = findings.filter(f => f.severity === 'MEDIUM').length;

let computedVerdict;
if (criticalCount > 0 || highCount > 0) computedVerdict = 'BLOCK';
else if (mediumCount > 0) computedVerdict = 'WARN';
else computedVerdict = 'PASS';

// Use computed verdict (not LLM's, prevent bypass)
```

**Return:**
```javascript
{
  success: boolean,
  security: {
    verdict: 'PASS' | 'WARN' | 'BLOCK',
    findings: [{ severity, category, description, file, line }],
    summary: string,
    criticalCount, highCount, mediumCount, lowCount,
  },
  toolResults: { npmAudit, gitleaks, semgrep },
  cost: number,
  duration: number,
}
```
# PARTE 6: CICLO DE EJECUCION (Task Runner + Review Loop)

---

## 23. TASK RUNNER (src/cycle/task-runner.js)

### 23.1 Proposito
Pipeline completo de ejecucion de una tarea: desde seleccion hasta merge.

### 23.2 runTask(projectId, cwd)

**Flujo completo (10 fases):**

```
1. PLANNING     → Planner selecciona tarea
2. TRIAGE       → Clasificar complejidad, seleccionar modelo
3. DECOMPOSE    → Si tarea grande (>8 devPoints), descomponer
4. ARCHITECTING → Architect genera plan de implementacion
5. CODING       → Coder implementa, abre PR
6. TESTING      → QA genera tests, Tester genera tests quirurgicos
7. SECURITY     → Security agent escanea vulnerabilidades
8. PRE-PR TESTS → Ejecutar tests automaticos
9. SONARQUBE    → Analisis de calidad (si habilitado)
10. REVIEW LOOP → Reviewer ↔ Coder loop (max N ciclos)
11. MERGE       → Auto-merge o aprobacion manual
12. POST-MERGE  → Version bump, changelog, CI monitor, tech debt
```

**Implementacion detallada:**

```javascript
export async function runTask(projectId, cwd) {
  // === PHASE 1: PLANNING ===
  komodoState.setPhase('planning');
  komodoState.setAgentState('PLANNER', 'working');

  const taskResult = await pickNextTask(projectId, {
    cwd,
    lastCompletedTaskContext: komodoState.lastCompletedTaskContext,
  });

  if (!taskResult) return null; // Backlog vacio

  const taskSpec = taskResult;
  komodoState.setCurrentTask(taskSpec.title);
  komodoState.setTaskDetails(taskSpec);
  komodoState.setAgentState('PLANNER', 'done');

  // Change task status to in-progress
  await changeTaskStatus(taskSpec.taskId, 'in-progress');

  eventBus.emitEvent('TASK_STARTED', {
    taskId: taskSpec.taskId,
    title: taskSpec.title,
    devPoints: taskSpec.devPoints,
  });

  let totalCost = taskResult.cost || 0;

  try {
    // === PHASE 2: TRIAGE ===
    const complexity = classifyComplexity(taskSpec);
    const selectedModel = selectModel('coder', complexity);

    eventBus.emitEvent('TASK_CLASSIFIED', {
      taskId: taskSpec.taskId,
      complexity,
      model: selectedModel,
    });

    // === PHASE 3: DECOMPOSE (optional) ===
    if (config.taskDecomposition && taskSpec.devPoints >= config.taskDecompositionThreshold) {
      const decomposed = await decomposeTask(taskSpec, projectId);
      if (decomposed) {
        logger.info(`Task decomposed into ${decomposed.subtasks.length} subtasks`);
        // Return and let next iteration pick subtask
        return { success: true, decomposed: true };
      }
    }

    // === PHASE 4: ARCHITECTING (optional) ===
    let architectPlan = null;
    if (config.cliArchitect && taskSpec.devPoints >= 5) {
      komodoState.setPhase('architecting');
      komodoState.setAgentState('ARCHITECT', 'working');

      const archResult = await analyzeTask(taskSpec, cwd, {
        model: selectModel('architect', complexity),
      });

      if (archResult.success) {
        architectPlan = archResult.plan;
        totalCost += archResult.cost;
      }

      komodoState.setAgentState('ARCHITECT', 'done');
    }

    // === PHASE 5: CODING ===
    komodoState.setPhase('coding');
    komodoState.setAgentState('CODER', 'working');

    // Build knowledge context
    const knowledgeContext = await buildKnowledgeContext(taskSpec, projectId);
    const learningContext = await getLearningContext(cwd);
    const codingGuidelines = await getCodingGuidelines(projectId);

    const codeResult = await implementTask(taskSpec, cwd, {
      architectPlan,
      model: selectedModel,
      codingGuidelines,
      knowledgeContext,
      learningContext,
    });

    totalCost += codeResult.cost;

    if (!codeResult.success) {
      if (codeResult.rateLimited) {
        await saveCheckpoint(taskSpec, 'code', { cwd });
        return { rateLimited: true };
      }
      throw new Error(`Coder failed: ${codeResult.error}`);
    }

    const { prNumber, branchName, filesChanged } = codeResult.pr;
    const repo = extractOwnerRepo(taskSpec.repoUrl);

    komodoState.setCurrentPR({ number: prNumber });
    komodoState.setAgentState('CODER', 'done');

    eventBus.emitEvent('PR_CREATED', {
      taskId: taskSpec.taskId,
      prNumber,
      branchName,
    });

    // Record Coder decisions in Knowledge Graph
    await recordCoderDecisions(taskSpec, codeResult, projectId);

    // === PHASE 6: TESTING (optional, parallel) ===
    let qaReport = null;
    let testerReport = null;

    if (config.enableQAAgent || config.enableTesterAgent) {
      komodoState.setPhase('testing');

      const testPromises = [];

      if (config.enableQAAgent) {
        komodoState.setAgentState('TESTER', 'working'); // Visual: TESTER card
        testPromises.push(
          runQAAgent({
            taskSpec, filesChanged, branchName, repo, prNumber, cwd,
            model: selectModel('qa', complexity),
          }).then(r => { qaReport = r; totalCost += r.cost; })
        );
      }

      if (config.enableTesterAgent) {
        testPromises.push(
          runTesterAgent({
            taskSpec, filesChanged, branchName, repo, prNumber, projectId, cwd,
            model: selectModel('tester', complexity),
          }).then(r => { testerReport = r; totalCost += r.cost; })
        );
      }

      await Promise.all(testPromises);
      komodoState.setAgentState('TESTER', 'done');
    }

    // === PHASE 7: SECURITY (optional) ===
    let securityReport = null;

    if (config.enableSecurityAgent) {
      komodoState.setPhase('security');
      komodoState.setAgentState('SECURITY', 'working');

      securityReport = await runSecurityAgent({
        taskSpec, filesChanged, branchName, repo, prNumber, cwd,
        model: selectModel('security', complexity),
      });
      totalCost += securityReport.cost;

      if (securityReport.security?.verdict === 'BLOCK') {
        logger.error('Security BLOCK: Critical vulnerabilities found');
        // Continue to review - reviewer will factor this in
      }

      komodoState.setAgentState('SECURITY', 'done');
    }

    // === PHASE 8: PRE-PR TESTS (optional) ===
    if (config.prePrTests) {
      await executePrePRTests(cwd, branchName);
    }

    // === PHASE 9: SONARQUBE (optional) ===
    let sonarReport = null;

    if (config.enableSonar) {
      komodoState.setPhase('analyzing');
      sonarReport = await analyzeSonar(cwd, branchName);
    }

    // === PHASE 10: REVIEW LOOP ===
    komodoState.setPhase('reviewing');

    // Load plugins for before-review hooks
    const pluginIssues = await runPluginHook('before-review', { taskSpec, prNumber, filesChanged });

    // Get coverage report
    const coverageReport = await analyzeCoverage(cwd, branchName);

    const reviewResult = await reviewLoop({
      prNumber,
      repo,
      taskSpec,
      cwd,
      sonarReport,
      coverageReport,
      qaReport: qaReport?.qa,
      securityReport: securityReport?.security,
      reviewerModel: selectModel('reviewer', complexity),
      coderModel: selectedModel,
      codingGuidelines,
      pluginIssues,
      escalationThreshold: config.reviewEscalationThreshold,
      knowledgeContext,
      filesChanged,
    });

    totalCost += reviewResult.cost;

    // === PHASE 11: MERGE ===
    if (reviewResult.approved) {
      komodoState.setPhase('merging');

      if (config.autoMerge) {
        // Squash merge via gh CLI
        await mergePR(repo, prNumber);
        await changeTaskStatus(taskSpec.taskId, 'to-validate');

        eventBus.emitEvent('PR_MERGED', {
          taskId: taskSpec.taskId,
          prNumber,
          reviewCycles: reviewResult.cycles,
        });
      } else {
        // Mark for manual merge
        await changeTaskStatus(taskSpec.taskId, 'to-validate');
        logger.info(`PR #${prNumber} approved. Manual merge required.`);
      }

      // === PHASE 12: POST-MERGE ===

      // Version bump
      if (config.autoVersion) {
        await bumpVersion(cwd, complexity);
      }

      // Changelog
      if (config.autoChangelog) {
        await generateChangelog(cwd, taskSpec);
      }

      // CI Monitor
      if (config.ciMonitor) {
        monitorCI(repo, branchName, prNumber).catch(err => {
          logger.warn(`CI monitor error: ${err.message}`);
        });
      }

      // Tech debt
      if (reviewResult.finalReview?.issues?.length > 0) {
        const minorIssues = reviewResult.finalReview.issues.filter(i => i.severity === 'minor');
        if (minorIssues.length > 0) {
          await createTechDebtTasks(minorIssues, taskSpec, projectId);
        }
      }

      // Record metrics
      await recordTaskMetrics(taskSpec, {
        totalCost,
        reviewCycles: reviewResult.cycles,
        duration: Date.now() - startTime,
        model: selectedModel,
        approved: true,
      });

    } else {
      // Review rejected after max cycles
      logger.warn(`Task ${taskSpec.title} not approved after ${reviewResult.cycles} cycles`);
      await changeTaskStatus(taskSpec.taskId, 'to-do'); // Back to backlog
    }

    // Update context for smart ordering
    komodoState.setLastCompletedTaskContext({
      files: filesChanged,
      modules: extractModules(filesChanged),
      keywords: extractKeywords(taskSpec.title),
    });

    komodoState.setPhase('idle');
    return {
      success: reviewResult.approved,
      taskId: taskSpec.taskId,
      totalCost,
      cycles: reviewResult.cycles,
    };

  } catch (error) {
    logger.error(`Task ${taskSpec.title} failed: ${error.message}`);
    komodoState.setPhase('idle');
    return { success: false, error: error.message, totalCost };
  }
}
```

### 23.3 runTaskDryRun(projectId)

Simula la seleccion sin ejecutar:
```javascript
export async function runTaskDryRun(projectId) {
  const tasks = await fetchProjectTasks(projectId);
  const todo = tasks.filter(t => t.status === 'to-do');
  const { eligible } = filterBlockedTasks(todo, tasks);
  if (eligible.length === 0) return null;
  return { task: eligible[0] };
}
```

### 23.4 resumeTask(checkpoint, cwd)

Reanuda desde un checkpoint guardado (ej: despues de rate limit):

```javascript
export async function resumeTask(checkpoint, cwd) {
  const { taskSpec, flowStep, prNumber, branchName, sonarReport, reviewCycle } = checkpoint;

  switch (flowStep) {
    case 'code':
      // Resume from coding phase
      return runTaskFromCoding(taskSpec, cwd);
    case 'fix':
      // Resume from fix phase
      return runTaskFromFix(taskSpec, prNumber, checkpoint.reviewIssues, cwd);
    case 'review':
      // Resume from review phase
      return runTaskFromReview(taskSpec, prNumber, cwd, { sonarReport, reviewCycle });
    case 'merge':
      // Resume from merge phase
      return runTaskFromMerge(taskSpec, prNumber, cwd);
    default:
      throw new Error(`Unknown flow step: ${flowStep}`);
  }
}
```

---

## 24. REVIEW LOOP (src/cycle/review-loop.js)

### 24.1 reviewLoop(options)

**Parametros:**
```javascript
{
  prNumber, repo, taskSpec, cwd,
  sonarReport, coverageReport, qaReport, securityReport,
  reviewerModel, coderModel, codingGuidelines,
  pluginIssues, escalationThreshold,
  coderCli, knowledgeContext, filesChanged,
}
```

**Flujo del loop:**

```javascript
export async function reviewLoop(options) {
  const maxCycles = config.maxReviewCycles;
  let totalCost = 0;
  let lastReviewSHA = null;
  let sonarReport = options.sonarReport;
  let escalatedCoderModel = null;
  const depthBreakdown = {};

  for (let cycle = 1; cycle <= maxCycles; cycle++) {
    // --- REVIEW ---
    komodoState.setReviewCycle(cycle);
    eventBus.emitEvent('REVIEW_CYCLE_START', { cycle, maxCycles });

    const reviewResult = await reviewPR({
      ...options,
      reviewCycle: cycle,
      lastReviewSHA,
      // Knowledge context only on cycle 1
      knowledgeContext: cycle === 1 ? options.knowledgeContext : null,
    });

    totalCost += reviewResult.cost;
    lastReviewSHA = reviewResult.reviewSHA;
    depthBreakdown[reviewResult.reviewDepth] = (depthBreakdown[reviewResult.reviewDepth] || 0) + 1;

    // --- VERDICT CHECK ---
    if (reviewResult.review.verdict === 'APPROVED') {
      // Record avoided patterns in memory
      await recordAvoidedPatterns(reviewResult, options.taskSpec);
      return {
        approved: true,
        cycles: cycle,
        finalReview: reviewResult.review,
        cost: totalCost,
        sonarReport,
        depthBreakdown,
      };
    }

    // Last cycle and still not approved → give up
    if (cycle === maxCycles) {
      return {
        approved: false,
        cycles: cycle,
        finalReview: reviewResult.review,
        cost: totalCost,
        sonarReport,
        depthBreakdown,
        error: `Not approved after ${maxCycles} cycles`,
      };
    }

    // --- AUTO-ESCALATION (cycle 1 only) ---
    if (cycle === 1 && reviewResult.review.score < options.escalationThreshold) {
      escalatedCoderModel = escalateModel(options.coderModel);
      eventBus.emitEvent('MODEL_ESCALATED', {
        from: options.coderModel,
        to: escalatedCoderModel,
        reason: `Score ${reviewResult.review.score} < threshold ${options.escalationThreshold}`,
      });
    }

    // --- CODER FIX ---
    komodoState.setAgentState('CODER', 'working');

    const fixResult = await fixReviewIssues(
      options.taskSpec,
      options.prNumber,
      reviewResult.review,
      options.cwd,
      {
        model: escalatedCoderModel || options.coderModel,
        codingGuidelines: options.codingGuidelines,
      }
    );

    totalCost += fixResult.cost;
    komodoState.setAgentState('CODER', 'done');

    // --- RE-RUN SONARQUBE after fix ---
    if (sonarReport && config.enableSonar) {
      sonarReport = await analyzeSonar(options.cwd, options.taskSpec.branchName);
    }

    // Record review issues in memory
    await recordReviewIssues(reviewResult.review.issues, options.taskSpec);
  }
}
```

### 24.2 Model escalation

```javascript
function escalateModel(currentModel) {
  const escalation = {
    'haiku': 'sonnet',
    'sonnet': 'opus',
    'codex-mini': 'o4-mini',
    'o4-mini': 'o3',
    'gemini-2.0-flash': 'gemini-2.5-pro',
  };
  return escalation[currentModel] || currentModel;
}
```

### 24.3 Incremental review

En ciclos 2+, el reviewer solo analiza el diff desde el ultimo review:
- Se usa `lastReviewSHA` para calcular el diff incremental
- Ahorra ~40-60% de tokens
- Metricas tracked: tokens ahorrados, % reduccion

---

## 25. INCREMENTAL REVIEW (src/cycle/incremental-review.js)

```javascript
export function buildIncrementalContext(lastReviewSHA, currentSHA, fullDiff) {
  // Generate diff between lastReviewSHA and currentSHA
  // Return: { incrementalDiff, filesChanged, tokenEstimate }

  // If no previous SHA, return full diff
  if (!lastReviewSHA) return { incrementalDiff: fullDiff, isIncremental: false };

  // Use git diff between SHAs
  const diff = execSync(
    `git diff ${lastReviewSHA}..${currentSHA}`,
    { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
  );

  return {
    incrementalDiff: diff,
    isIncremental: true,
    tokensSaved: estimateTokens(fullDiff.length) - estimateTokens(diff.length),
    reductionPercent: Math.round((1 - diff.length / fullDiff.length) * 100),
  };
}
```

---

## 26. PIPELINE SCHEDULER (src/cycle/pipeline-scheduler.js)

Permite ejecutar agentes independientes en paralelo:

```javascript
export async function runParallelAgents(agents, options = {}) {
  const { maxConcurrent = config.maxConcurrentAgents || 1 } = options;

  // QA + Security pueden correr en paralelo
  // Tester puede correr en paralelo con QA
  // Reviewer SIEMPRE es secuencial (necesita resultados previos)

  const controller = new AbortController();
  const results = {};

  const parallelGroup = agents.filter(a => a.parallel);
  const sequentialGroup = agents.filter(a => !a.parallel);

  // Run parallel group
  if (parallelGroup.length > 0) {
    const promises = parallelGroup.map(agent =>
      agent.execute({ signal: controller.signal })
        .then(r => { results[agent.name] = r; })
        .catch(err => { results[agent.name] = { error: err.message }; })
    );
    await Promise.all(promises);
  }

  // Run sequential group
  for (const agent of sequentialGroup) {
    results[agent.name] = await agent.execute({ signal: controller.signal });
  }

  return results;
}
```
# PARTE 7: SUBSISTEMAS CORE (Estado, Eventos, Servidores, Autonomia, Resiliencia)

---

## 27. KOMODO STATE (src/state/komodo-state.js)

Singleton que mantiene el estado global del orquestador.

```javascript
class KomodoState {
  constructor() {
    this.agents = {
      PLANNER:  { name: 'PLANNER',  status: 'idle', currentTask: null, startedAt: null, cli: null, model: null, totalCost: 0, completedTasks: 0 },
      ARCHITECT:{ name: 'ARCHITECT', status: 'idle', currentTask: null, startedAt: null, cli: null, model: null, totalCost: 0, completedTasks: 0 },
      CODER:    { name: 'CODER',    status: 'idle', currentTask: null, startedAt: null, cli: null, model: null, totalCost: 0, completedTasks: 0 },
      TESTER:   { name: 'TESTER',   status: 'idle', currentTask: null, startedAt: null, cli: null, model: null, totalCost: 0, completedTasks: 0 },
      SECURITY: { name: 'SECURITY', status: 'idle', currentTask: null, startedAt: null, cli: null, model: null, totalCost: 0, completedTasks: 0 },
      REVIEWER: { name: 'REVIEWER', status: 'idle', currentTask: null, startedAt: null, cli: null, model: null, totalCost: 0, completedTasks: 0 },
    };
    this.phase = 'idle';          // idle|planning|architecting|coding|testing|security|analyzing|reviewing|merging
    this.executionState = 'stopped'; // stopped|running|paused|daemon:idle|daemon:running|scheduler:waiting|budget:paused|awaiting-approval
    this.currentTask = null;
    this.taskDetails = null;
    this.currentPR = null;
    this.reviewCycle = 0;
    this.totalCost = 0;
    this.tasksCompleted = 0;
    this.totalTasks = 0;
    this.sonarAnalysis = { status: 'idle', qualityGate: null, issues: null };
    this.budget = { dailySpent: 0, weeklySpent: 0, dailyBudget: 0, weeklyBudget: 0, paused: false };
    this.multiProject = null;
    this.lastCompletedTaskContext = null;
    this._pauseRequested = false;
    this._stopRequested = false;
  }

  // Setters that emit events
  setPhase(phase) { this.phase = phase; eventBus.emitEvent('PHASE_CHANGED', { phase }); }
  setExecutionState(state) { this.executionState = state; eventBus.emitEvent('EXECUTION_STATE_CHANGED', { state }); }
  setAgentState(name, status) { this.agents[name].status = status; eventBus.emitEvent('AGENT_STATE_CHANGE', { agentName: name, newState: status }); }
  setCurrentTask(title) { this.currentTask = title; }
  setCurrentPR(pr) { this.currentPR = pr; }
  setReviewCycle(n) { this.reviewCycle = n; }
  incrementTasksCompleted() { this.tasksCompleted++; }
  addCost(amount) { this.totalCost += amount; }

  // Getters
  isPauseRequested() { return this._pauseRequested; }
  isStopRequested() { return this._stopRequested; }
  requestPause() { this._pauseRequested = true; }
  requestStop() { this._stopRequested = true; }

  // Snapshot for WebSocket
  toSnapshot() {
    return {
      agents: this.agents,
      phase: this.phase,
      executionState: this.executionState,
      currentTask: this.currentTask,
      taskDetails: this.taskDetails,
      currentPR: this.currentPR,
      reviewCycle: this.reviewCycle,
      totalCost: this.totalCost,
      tasksCompleted: this.tasksCompleted,
      totalTasks: this.totalTasks,
      sonarAnalysis: this.sonarAnalysis,
      budget: this.budget,
      multiProject: this.multiProject,
    };
  }

  reset() {
    Object.values(this.agents).forEach(a => { a.status = 'idle'; a.currentTask = null; });
    this.phase = 'idle';
    this.currentTask = null;
    this.currentPR = null;
    this.reviewCycle = 0;
    this._pauseRequested = false;
    this._stopRequested = false;
  }
}

export const komodoState = new KomodoState();
```

---

## 28. CHECKPOINT MANAGER (src/state/checkpoint-manager.js)

```javascript
class CheckpointManager {
  constructor() {
    this.dir = path.join(config.rootDir, '.komodo', 'checkpoints');
  }

  saveCheckpoint(data) {
    // data: { taskSpec, flowStep, prNumber, branchName, sonarReport, reviewCycle, reviewIssues, cwd }
    const filename = `checkpoint-${Date.now()}.json`;
    const filepath = path.join(this.dir, filename);
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(filepath, JSON.stringify({ ...data, savedAt: new Date().toISOString() }, null, 2));
    return filepath;
  }

  listPendingCheckpoints() {
    if (!fs.existsSync(this.dir)) return [];
    return fs.readdirSync(this.dir)
      .filter(f => f.endsWith('.json'))
      .map(f => ({ filename: f, filepath: path.join(this.dir, f) }))
      .sort((a, b) => b.filename.localeCompare(a.filename)); // newest first
  }

  loadCheckpoint(filepath) {
    return JSON.parse(fs.readFileSync(filepath, 'utf-8'));
  }

  validateCheckpoint(checkpoint) {
    if (!checkpoint.taskSpec?.taskId) return false;
    if (!checkpoint.flowStep) return false;
    // Expire after 24 hours
    const savedAt = new Date(checkpoint.savedAt);
    if (Date.now() - savedAt.getTime() > 24 * 60 * 60 * 1000) return false;
    return true;
  }

  deleteCheckpoint(filepath) {
    if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
  }
}

export const checkpointManager = new CheckpointManager();
```

---

## 29. EVENT BUS (src/events/event-bus.js)

```javascript
class EventBus {
  constructor() {
    this.listeners = new Map(); // type → Set<callback>
  }

  on(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(callback);
    return () => this.listeners.get(type)?.delete(callback); // unsubscribe
  }

  emitEvent(type, metadata = {}) {
    const event = {
      type,
      timestamp: new Date().toISOString(),
      metadata,
    };

    // Notify specific listeners
    this.listeners.get(type)?.forEach(cb => {
      try { cb(event); } catch (e) { /* swallow */ }
    });

    // Notify wildcard listeners
    this.listeners.get('*')?.forEach(cb => {
      try { cb(event); } catch (e) { /* swallow */ }
    });
  }
}

export const eventBus = new EventBus();
```

**Tipos de eventos principales:**
- TASK_STARTED, TASK_COMPLETED
- AGENT_STATE_CHANGE, agent:output
- REVIEW_CYCLE_START, REVIEW_CYCLE_END, REVIEW_DEPTH_SELECTED
- PR_CREATED, PR_MERGED
- COST_UPDATED, BUDGET_UPDATED, BUDGET_WARNING, BUDGET_EXCEEDED
- RATE_LIMIT_DETECTED, ALL_CLIS_RATE_LIMITED, CLI_RECOVERED, AGENT_FALLBACK
- TASK_CLASSIFIED, TASK_DECOMPOSED, MODEL_SELECTED, MODEL_ESCALATED
- EARLY_TERMINATION, ANOMALY_DETECTED
- PHASE_CHANGED, EXECUTION_STATE_CHANGED
- SECURITY_SCAN_COMPLETE, SECURITY_SCAN_BLOCKED
- QA_TESTS_GENERATED, TESTER_TESTS_GENERATED
- SONAR_ANALYSIS_COMPLETE
- CI_MONITOR_START, CI_RESULTS_RECEIVED
- SESSION_CHECKPOINTED, SESSION_AUTO_RESUMED
- DAEMON_STARTED, DAEMON_IDLE, DAEMON_TASK_DETECTED, DAEMON_STOPPED

---

## 30. EVENT PERSISTENCE (src/events/event-persistence.js)

Opcionalmente persiste eventos en Firebase para analytics:

```javascript
export class EventPersistence {
  constructor(projectId) {
    this.projectId = projectId;
    this.retentionDays = 30;
  }

  async persistEvent(event) {
    const db = getDb();
    await db.ref(`events/${this.projectId}`).push({
      ...event,
      persistedAt: Date.now(),
    });
  }

  async cleanup() {
    // Delete events older than retentionDays
    const cutoff = Date.now() - this.retentionDays * 24 * 60 * 60 * 1000;
    // Query and delete old events
  }
}
```

---

## 31. WEBSOCKET SERVER (src/server/ws-server.js)

```javascript
import { WebSocketServer } from 'ws';

let wss = null;

export function startWsServer() {
  wss = new WebSocketServer({ port: config.wsPort });

  wss.on('connection', (ws) => {
    // Send snapshot on connect
    ws.send(JSON.stringify({
      type: 'snapshot',
      data: komodoState.toSnapshot(),
    }));

    // Handle commands from dashboard
    ws.on('message', (msg) => {
      try {
        const { command } = JSON.parse(msg.toString());
        switch (command) {
          case 'pause': komodoState.requestPause(); break;
          case 'stop': komodoState.requestStop(); break;
          case 'approve': /* approval gate */ break;
          case 'reject': /* approval gate */ break;
        }
        ws.send(JSON.stringify({ type: 'command:ack', command }));
      } catch {}
    });
  });

  // Forward all events to connected clients
  eventBus.on('*', (event) => {
    const msg = JSON.stringify({ type: 'event', data: event });
    wss.clients.forEach(client => {
      if (client.readyState === 1) client.send(msg);
    });
  });
}

export function stopWsServer() {
  wss?.close();
}
```

---

## 32. API SERVER (src/server/api-server.js)

HTTP API para control externo:

```javascript
import http from 'http';

let server = null;

export function startApiServer() {
  server = http.createServer(async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Komodo-Key');

    if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

    // Authentication
    if (req.headers['x-komodo-key'] !== config.apiKey) {
      res.writeHead(401); res.end('Unauthorized'); return;
    }

    const url = new URL(req.url, `http://localhost:${config.apiPort}`);

    // Routes
    switch (url.pathname) {
      case '/api/run':         // POST - trigger task execution
      case '/api/stop':        // POST - stop orchestrator
      case '/api/pause':       // POST - pause after current task
      case '/api/task':        // POST - create task dynamically
      case '/api/status':      // GET - current state snapshot
      case '/api/observability/timeline':  // GET - task timeline
      case '/api/observability/explain':   // GET - explain decisions
      case '/api/observability/tasks':     // GET - list recent tasks
      case '/api/observability/alerts':    // GET - recent alerts
      case '/api/observability/replay':    // GET - replay task execution
      case '/api/event':       // POST - receive forwarded events (from MCP)
    }
  });

  server.listen(config.apiPort);
}
```

---

## 33. AUTONOMIA Y APPROVAL GATES

### 33.1 Autonomy Engine (src/autonomy/autonomy-engine.js)

4 niveles de autonomia:

```javascript
const AUTONOMY_LEVELS = {
  'supervised': {
    pauseBeforeMerge: true,
    pauseOnLowScore: true,
    requireApprovalForAll: true,
  },
  'semi-autonomous': {
    pauseBeforeMerge: true,
    pauseOnLowScore: true,   // score < 8
    requireApprovalForAll: false,
  },
  'autonomous': {
    pauseBeforeMerge: false,
    pauseOnLowScore: false,
    requireApprovalForAll: false,
  },
  'guardian': {
    // Dynamic gates based on risk assessment
    useDynamicGates: true,
  },
};
```

### 33.2 Guardian Gates (src/autonomy/guardian-gates.js)

Triggers de pausa dinamicos:
- Diff > 500 lineas
- Token usage > 80K
- Archivos de seguridad modificados (DB migrations, auth, secrets)
- Review cycles > 3
- Database migration detectada
- Dependencias modificadas

### 33.3 Approval Gate (src/autonomy/approval-gate.js)

```javascript
export async function waitForApproval(context) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      resolve({ approved: false, reason: 'timeout' });
    }, config.approvalTimeoutMinutes * 60 * 1000);

    // Listen for approval via WebSocket or API
    const unsubscribe = eventBus.on('APPROVAL_RECEIVED', (event) => {
      clearTimeout(timeout);
      unsubscribe();
      resolve({ approved: event.metadata.approved, reason: event.metadata.reason });
    });
  });
}
```

---

## 34. RESILIENCIA

### 34.1 Circuit Breaker (src/resilience/circuit-breaker.js)

```javascript
// States: CLOSED (normal) → OPEN (fail fast) → HALF_OPEN (test) → CLOSED
// Services monitored: firebase, github, cli
// Thresholds: firebase=5, github=3, cli=4 failures
// Cooldown: 60 seconds before HALF_OPEN test
```

### 34.2 Error Budget (src/resilience/error-budget.js)

```javascript
// Tracks failure rate in 30-min sliding window
// Max failure rate: 30%
// Auto-pause when budget exhausted
// Reset: manual intervention or window expiration
```

### 34.3 Dead Letter Queue (src/resilience/dead-letter-queue.js)

```javascript
// Queue for failed operations
// Auto-retry with exponential backoff: 1s, 2s, 4s
// Max 3 retries
// Escalate to healing engine if still failing
```

---

## 35. SELF-HEALING (src/self-healing/healing-engine.js)

Strategy-based recovery:

```javascript
const STRATEGIES = {
  'RATE_LIMIT': RateLimitStrategy,        // fallback CLI or wait
  'GITHUB_API_ERROR': GitHubApiStrategy,  // retry 3x with backoff
  'MERGE_CONFLICT': MergeConflictStrategy,// resolve, test, re-push
  'TEST_FAILURE': TestFailureStrategy,    // re-run or mark flaky
  'AGENT_TIMEOUT': AgentTimeoutStrategy,  // retry with higher timeout
  'FIREBASE_DOWN': FirebaseDownStrategy,  // queue for later
};

export class HealingEngine {
  async heal(error, context) {
    const strategy = STRATEGIES[error.type];
    if (!strategy) return { healed: false };
    return new strategy().execute(error, context);
  }
}
```

### Flaky Test Registry (src/self-healing/flaky-test-registry.js)

```javascript
// Tracks tests that fail intermittently
// Retries up to 3x before marking as blocking
// Persists to Firebase per project
// Used by task runner to decide: retry vs block
```
# PARTE 8: INTELIGENCIA, TRIAGE, PRESUPUESTO, DAEMON Y FEATURES AVANZADOS

---

## 36. CODEBASE INDEXER (src/intelligence/codebase-indexer.js)

```javascript
// Scans: src/, tests/, package.json, README
// Generates semantic summary: file structure, key modules, patterns
// Cached 5 minutes (avoid re-scanning)
// Injected into Coder prompt (max 2000 tokens)
// Used when: no Architect plan available + CODEBASE_INDEX_ENABLED=true
```

## 37. STYLE DETECTOR (src/intelligence/style-detector.js)

```javascript
// Analyzes existing code for patterns:
// - Naming: camelCase, snake_case, PascalCase
// - Spacing: tabs vs spaces, indentation size
// - Patterns: arrow functions vs function, const vs let
// - Imports: named vs default, relative vs absolute
// Extracts rules as MANDATORY guidelines for Coder
// Example output: "Use camelCase, prefer const, use arrow functions, 2-space indent"
```

## 38. CODEBASE LEARNER (src/intelligence/codebase-learner.js)

```javascript
// Extracts from completed tasks:
// - Architecture patterns (folder structure, module organization)
// - Testing practices (framework, patterns, coverage approach)
// - Error handling patterns (try/catch style, error classes)
// Persists to Firebase: projects/{id}/learnings
// Forces refresh on first run per project
// Cross-project sharing if CROSS_PROJECT_INTELLIGENCE=true
```

## 39. REVIEW FEEDBACK (src/intelligence/review-feedback.js)

```javascript
// Tracks common reviewer comments:
// - Top issues by frequency (naming, error handling, etc.)
// - Time-decay: recent issues weighted more
// Builds context string: "Previous reviews found issues with: ..."
// Injected into Coder prompt to prevent recurring mistakes
```

## 40. KNOWLEDGE GRAPH (src/knowledge/knowledge-graph.js)

```javascript
// Per-task knowledge storage:
// - coderBrief: what Coder implemented and why
// - reviewerBrief: what Reviewer found
// - moduleLessons: patterns per module/file
// - testingPatterns: what tests worked well
//
// Scoped by module/file path
// Loads lessons based on taskSpec files
// Records patterns from successful reviews
//
// Storage: knowledge/{projectId}/{taskId}.json
// Firebase: knowledge/{projectId}/modules/{modulePath}
```

## 41. CROSS-PROJECT INTELLIGENCE (src/intelligence/cross-project-intelligence.js)

```javascript
// Syncs patterns across projects:
// - Universal patterns (adopted by >60% of projects)
// - Anti-patterns (failed in >40% of projects)
// - Model performance (which model works best for which task type)
// Universality threshold: 0.6
// Only active if CROSS_PROJECT_INTELLIGENCE=true
```

---

## 42. SMART ORDERING (src/smart-ordering/context-affinity.js)

```javascript
export function rankWithContextAffinity(tasks, lastContext) {
  // lastContext: { files: string[], modules: string[], keywords: string[] }
  //
  // For each task:
  // 1. Check if task files overlap with lastContext.files
  // 2. Check if task modules overlap with lastContext.modules
  // 3. Check if task keywords overlap with lastContext.keywords
  // 4. Apply boost: affinityBoost = 0.2 (configurable)
  //
  // Tasks with context overlap get boosted in sort order
  // Keeps agents "warm" in the same area of code
}

export function buildAffinityHint(task, lastContext) {
  // Generate hint string for Planner prompt:
  // "This task shares context with recently completed work in: src/agents/"
}
```

---

## 43. TRIAGE Y COMPLEJIDAD

### 43.1 Complexity Classifier (src/triage/complexity-classifier.js)

```javascript
export function classifyComplexity(taskSpec) {
  const devPoints = taskSpec.devPoints || 3;
  if (devPoints <= config.complexityThresholds.trivial) return 'trivial';  // <= 3
  if (devPoints <= config.complexityThresholds.standard) return 'standard'; // <= 6
  return 'complex'; // > 6
}
```

### 43.2 Model Selector (src/triage/model-selector.js)

```javascript
export function selectModel(role, complexity) {
  // 1. Check force override
  if (config.forceModels[role]) return config.forceModels[role];

  // 2. Get CLI for this role
  const cli = config[`cli${capitalize(role)}`] || 'claude';

  // 3. Lookup model map
  const map = config.modelMaps[cli]?.[role];
  if (!map) return null; // Use CLI default

  // 4. Select by complexity index
  const idx = complexity === 'trivial' ? 0 : complexity === 'standard' ? 1 : 2;
  return map[idx] || map[1] || null;
}
```

### 43.3 Smart Model Router (src/triage/smart-model-router.js)

```javascript
// Epsilon-greedy routing based on historical performance in Firebase
// Tracks per task: cost, review score, cycle count
// Automatically escalates model if performance degrades
// Epsilon: 10% exploration (try different model)
// 90% exploitation (use best known model)
```

### 43.4 Task Decomposer (src/triage/task-decomposer.js)

```javascript
export async function decomposeTask(taskSpec, projectId) {
  // Only decompose if devPoints >= TASK_DECOMPOSITION_THRESHOLD (default 8)
  // Uses Planner agent to split task into subtasks
  // Preserves original as parent task (parentTaskId)
  // Creates blockedBy dependencies between parts
  // Returns: { decomposed: true, subtasks: [...] }
}
```

---

## 44. ESTIMACION Y PRESUPUESTO

### 44.1 Token Estimator (src/estimation/token-estimator.js)

```javascript
export function estimateTokens(complexity) {
  const BASE = {
    trivial: 8000,    // ~8K tokens
    standard: 25000,  // ~25K tokens
    complex: 60000,   // ~60K tokens
  };

  // Phase breakdown:
  // architect: 15%
  // coder: 50%
  // security: 5%
  // reviewer: 20%
  // overhead: 10%

  return BASE[complexity] || BASE.standard;
}
```

### 44.2 Budget Manager (src/cost/budget-manager.js)

```javascript
export class BudgetManager {
  async initialize(projectId) {
    this.projectId = projectId;
    // Load current daily/weekly spend from Firebase
    // Reset daily at midnight, weekly on Monday
  }

  addCost(amount) {
    this.dailySpent += amount;
    this.weeklySpent += amount;
    komodoState.budget.dailySpent = this.dailySpent;
    komodoState.budget.weeklySpent = this.weeklySpent;

    // Check warning
    if (this.dailySpent / config.dailyBudgetUsd >= config.budgetWarningThreshold) {
      eventBus.emitEvent('BUDGET_WARNING', { daily: this.dailySpent, limit: config.dailyBudgetUsd });
    }

    // Persist to Firebase
    this.persist();
  }

  isExceeded() {
    if (config.dailyBudgetUsd > 0 && this.dailySpent >= config.dailyBudgetUsd) return true;
    if (config.weeklyBudgetUsd > 0 && this.weeklySpent >= config.weeklyBudgetUsd) return true;
    return false;
  }
}
```

### 44.3 Rate Limit Tracker (src/estimation/rate-limit-tracker.js)

```javascript
// Token window: 5 minutes (300K tokens default)
// Tracks: tokens consumed in rolling window
// Calculates headroom: tokens remaining before limit
// Preemptive wait if headroom < next task estimate
// Integration: called before each agent invocation
```

---

## 45. DAEMON MODE (src/daemon/daemon.js)

```javascript
export class Daemon {
  constructor(projectId, options = {}) {
    this.projectId = projectId;
    this.pollInterval = config.daemonPollInterval; // 60s default
    this.maxTasks = options.maxTasks || 0; // 0 = unlimited
    this.tasksCompleted = 0;
  }

  async start() {
    eventBus.emitEvent('DAEMON_STARTED', {});
    komodoState.setExecutionState('daemon:idle');

    while (true) {
      // Check scheduler windows
      if (config.schedule) {
        const inWindow = isInScheduleWindow(config.schedule, config.scheduleTimezone);
        if (!inWindow) {
          komodoState.setExecutionState('scheduler:waiting');
          await sleep(this.pollInterval);
          continue;
        }
      }

      // Check backlog
      const hasWork = await checkBacklog(this.projectId);

      if (hasWork) {
        komodoState.setExecutionState('daemon:running');
        eventBus.emitEvent('DAEMON_TASK_DETECTED', {});

        const result = await runTask(this.projectId, this.cwd);
        if (result?.success) this.tasksCompleted++;

        if (this.maxTasks > 0 && this.tasksCompleted >= this.maxTasks) {
          break;
        }
      } else {
        komodoState.setExecutionState('daemon:idle');
        eventBus.emitEvent('DAEMON_IDLE', {});
      }

      await sleep(this.pollInterval);
    }

    eventBus.emitEvent('DAEMON_STOPPED', {});
  }
}
```

## 46. SCHEDULER (src/scheduler/scheduler.js)

```javascript
// Cron-like scheduling: "02:00-06:00,14:00-18:00"
// Format: comma-separated time windows "HH:MM-HH:MM"
// Timezone-aware via SCHEDULE_TIMEZONE
// Used by daemon to pause during off-hours
export function isInScheduleWindow(schedule, timezone) {
  const now = new Date().toLocaleTimeString('en-US', { timeZone: timezone, hour12: false });
  const [hours, minutes] = now.split(':').map(Number);
  const currentMinutes = hours * 60 + minutes;

  for (const window of schedule.split(',')) {
    const [start, end] = window.trim().split('-');
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    const startMin = sh * 60 + sm;
    const endMin = eh * 60 + em;

    if (currentMinutes >= startMin && currentMinutes <= endMin) return true;
  }
  return false;
}
```

---

## 47. CI MONITOR (src/ci-monitor/ci-monitor.js)

```javascript
// Watches GitHub Actions after merge
// Polls workflow status via: gh run list --branch main --limit 1 --json conclusion
// Timeout: CI_TIMEOUT_MS (default 15 min)
// If CI fails and AUTO_REVERT=true:
//   - Reverts merge commit
//   - Re-opens PR
//   - Marks task back to 'in-progress'
//   - Emits CI_FAILURE_REVERTED event
```

## 48. CANARY MERGE (src/canary/canary-merge.js)

```javascript
// Strategy: merge to staging branch first, then promote to main
// Steps:
// 1. Merge PR to CANARY_BRANCH (default: staging)
// 2. Wait CANARY_STABILITY_MINUTES (default: 10)
// 3. Check CI on staging
// 4. If green: merge staging → main
// 5. If red: revert staging, leave PR open
//
// conflict-detector.js: checks for merge conflicts before canary merge
```

## 49. SONARQUBE INTEGRATION (src/sonar/analyzer.js)

```javascript
export async function analyzeSonar(cwd, branchName) {
  // 1. Run sonar-scanner CLI
  // 2. Wait for analysis on SonarQube server
  // 3. Fetch quality gate status via API
  // 4. Fetch issues (BLOCKER, CRITICAL, MAJOR, MINOR)
  // 5. Return report: { qualityGate, bugs, vulnerabilities, codeSmells, coverage, issues[] }
  //
  // Used in: task-runner (pre-review), review-loop (post-fix), komodo-mcp finalize
  // Blocks merge if qualityGate === 'ERROR'
}
```

## 50. PRE-PR TESTS (src/testing/pre-pr-tests.js)

```javascript
export async function executePrePRTests(cwd, branchName) {
  // Auto-detect test command: npm test, yarn test, vitest, jest
  // Execute in cwd on branchName
  // If fails: Coder must fix before PR
  // Returns: { passed: boolean, output: string }
}
```

## 51. COVERAGE ANALYZER (src/coverage/coverage-analyzer.js)

```javascript
// Checks coverage delta against MIN_COVERAGE_DELTA (default -2%)
// If PR reduces coverage by more than threshold: blocks APPROVE
// Records baseline after successful merge
// Storage: Firebase metrics/{projectId}/coverageHistory
```

## 52. VERSIONADO (src/versioning/)

```javascript
// version-bumper.js:
// - Reads package.json version
// - Bumps: patch (trivial/standard), minor (complex), major (breaking)
// - Writes back to package.json

// changelog-generator.js:
// - Groups commits by type: features, fixes, breaking
// - Generates CHANGELOG.md entry
// - Format: markdown with version header and date

// release-manager.js:
// - Creates GitHub Release via gh CLI
// - Optional: on sprint completion (RELEASE_ON_SPRINT_COMPLETE)
// - Includes release notes from changelog

// release-gate.js:
// - Checks: no blocking bugs, all tests passing
// - Can override: RELEASE_IGNORE_BUGS=true
```

## 53. TECH DEBT (src/tech-debt/tech-debt-tracker.js)

```javascript
// Auto-creates tasks from minor review issues
// Each minor issue not fixed in review → tech debt task
// Tracks: code smells, refactoring needs, documentation gaps
// Severity-based grouping: high/medium/low
// Created as child tasks in Firebase
```

## 54. AUTO-IMPROVE (src/auto-improve/)

```javascript
// auto-improve.js:
// When backlog empty, suggests improvement tasks
// Categories: performance, security, coverage, testing, documentation
// Max 5 proposals per session

// codebase-analyzer.js:
// Identifies: dead code, unused imports, duplicate patterns
// Suggests refactoring tasks

// dependency-checker.js:
// Periodic npm audit + npm outdated checks
// Creates tasks for security/patch updates
// Interval: 24 hours default
```

## 55. MULTI-PROJECT (src/multi-project/)

```javascript
// multi-project-runner.js:
// Manages N projects simultaneously
// Strategies:
//   round-robin: one task per project, rotate
//   priority: highest priority task across all projects
//   backlog-size: project with most to-do tasks first

// project-loader.js:
// Loads project configs from PROJECTS env variable
// Resolves: projectId, cwd path, repo URL
```

## 56. INTEGRACIONES (src/integrations/)

```javascript
// github-issue-sync.js:
// Polls GitHub issues with label "komodo"
// Creates planning-task-mcp tasks automatically
// Poll interval: 5 min default

// pr-comment-bugs.js:
// Monitors PR comments for "@komodo bug: ..."
// Creates bug reports in planning-task-mcp
// Poll interval: 3 min default

// webhook-outgoing.js:
// Forwards Komodo events to external URLs
// Supports custom headers
// Max 3 retries with backoff
```

## 57. PLUGIN SYSTEM (src/plugins/)

```javascript
// plugin-loader.js:
// Loads from PLUGINS_DIR directory
// Each plugin: index.js with exports { name, version, hooks }
// Hooks: before-review, after-code, on-error

// plugin-interface.js:
// Plugin receives: { taskSpec, prNumber, filesChanged, cwd }
// Returns: { issues: [{ severity, description, file }] }
// Issues injected into Reviewer prompt as MANDATORY to address
```

## 58. OBSERVABILIDAD (src/observability/)

```javascript
// anomaly-detector.js:
// Detects: token spike, review regression, model degradation
// Emits alerts when anomalies detected

// task-timeline.js:
// Stores per-task: phases, durations, costs, model, review cycles
// Used for historical analysis in dashboard

// explain-decision.js:
// Explains why Planner picked specific task
// Explains why Reviewer rejected PR
// Explains model selection rationale
```

## 59. DOCTOR (src/doctor/doctor.js)

```javascript
// Health checks:
// 1. Node version >= 18
// 2. git installed
// 3. gh installed and authenticated
// 4. AI CLIs installed (claude, codex, gemini - whichever configured)
// 5. Firebase credentials valid
// 6. Firebase connection test
// 7. npm packages installed
// 8. MCP servers startable
// Silent mode: only log errors (used pre-run)
// Verbose mode: log all checks (used by 'komodo doctor')
```

## 60. SHUTDOWN MANAGER (src/shutdown/shutdown-manager.js)

```javascript
class ShutdownManager {
  #hooks = new Map(); // name → cleanup function

  register(name, cleanupFn) {
    this.#hooks.set(name, cleanupFn);
  }

  async shutdown() {
    for (const [name, fn] of this.#hooks) {
      try { await fn(); }
      catch (e) { logger.warn(`Shutdown hook ${name} failed: ${e.message}`); }
    }
    this.#hooks.clear();
  }
}

export const shutdownManager = new ShutdownManager();
```

## 61. HEARTBEAT MONITOR (src/heartbeat/heartbeat-monitor.js)

```javascript
// Pings rate-limited CLIs every 5 minutes
// For each rate-limited CLI: try a minimal prompt
// If responds OK: mark as recovered via fallbackManager.markRecovered()
// Emits CLI_RECOVERED event
// Used by orchestrator to know when to resume
```

## 62. LOGGER (src/utils/logger.js)

```javascript
// Colored output per agent:
// PLANNER=blue, ARCHITECT=cyan, CODER=green,
// TESTER=yellow, SECURITY=magenta, REVIEWER=red,
// KOMODO=white (bold)
//
// Functions: info(), success(), warn(), error(),
//            taskHeader(), startSpinner(), stopSpinner()
// Timestamps in es-ES locale
```

## 63. PARSER (src/utils/parser.js)

```javascript
// parseJSON(text):
// 1. Try JSON.parse directly
// 2. Try extracting JSON from markdown code blocks (```json...```)
// 3. Try extracting JSON object ({...}) from text
// 4. Return null if all fail
//
// Used by all agents to extract structured responses
```

## 64. RESPONSE VALIDATOR (src/utils/response-validator.js)

```javascript
export function validateAgentResponse(response, requiredFields) {
  if (!response) return { valid: false, missing: requiredFields };
  const missing = requiredFields.filter(f => !response[f]);
  return { valid: missing.length === 0, missing };
}
```
# PARTE 9: MCP SERVERS (Komodo, GitHub, Memory, Planning-Task)

---

## 65. KOMODO-MCP (skills/komodo-mcp/)

### 65.1 Proposito
Expone el orquestador Komodo como un MCP server para usarse desde Claude Code, Cursor, etc.

### 65.2 Package.json
```json
{
  "name": "komodo-mcp",
  "version": "1.0.0",
  "type": "module",
  "bin": { "komodo-mcp": "./src/index.js" },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.1",
    "zod": "^3.24.2"
  },
  "engines": { "node": ">=18.0.0" }
}
```

### 65.3 Servidor (src/index.js)

- Carga `.env` desde KOMODO_ROOT
- Registra herramientas desde tools.js
- Event forwarding: envia eventos a WS server y dashboard API
- Transporte: stdio (standard MCP)

### 65.4 Herramientas (src/tools.js)

**1. komodo_plan** - Seleccionar tarea
```javascript
// Schema: { projectId?: string }
// Calls: pickNextTask(pid)
// Returns: { success, task: { taskId, title, branchName, repoUrl, ... }, nextStep }
// Sets state: RUNNING, PLANNER working
```

**2. komodo_code** - Implementar tarea
```javascript
// Schema: { taskId, title, branchName, repoUrl, userStoryWho?, userStoryWhat?, userStoryWhy?,
//           acceptanceCriteria?, devPoints?, bizPoints?, sprint?, cwd? }
// Calls: ARCHITECT analyzeTask() if devPoints >= 8, then implementTask()
// Handles rate limits: saves checkpoint
// Returns: { success, pr: { prNumber, branchName, ... }, nextStep }
```

**3. komodo_review** - Revisar PR
```javascript
// Schema: { prNumber, repo, taskTitle, taskId?, changedFiles?, userStory*, acceptanceCriteria?, cwd?, sonarReport? }
// Auto-runs SonarQube if not provided
// Resolves branch name from PR via gh CLI
// Runs security plugins (before-review)
// Returns: { success, review: { verdict, score, issues, positives, summary }, nextStep }
```

**4. komodo_fix** - Corregir issues
```javascript
// Schema: { taskId, title, branchName, repoUrl, prNumber, reviewSummary, reviewIssues, cwd? }
// Calls: fixReviewIssues()
// Re-runs SonarQube after fixes
// Returns: { success, fix, sonarReport, nextStep }
```

**5. komodo_finalize** - Merge o cerrar PR
```javascript
// Schema: { taskId, prNumber, repo, approved, reviewScore?, reviewCycles?, taskTitle?, devPoints?, durationSeconds? }
// If NOT approved: close PR, mark task 'to-do'
// If approved:
//   - Final SonarQube analysis
//   - Quality gate check (blocks if ERROR)
//   - If autoMerge: squash merge, mark 'to-validate'
//   - Record metrics (task, model performance)
// Returns: { success, merged, message }
```

**6. komodo_run** - Ejecutar N tareas
```javascript
// Schema: { projectId?, tasks? (default 1), cwd?, dryRun? }
// Calls: run(pid, { tasks, cwd, dryRun, skipServers: true, skipHeartbeat: true })
// Returns: result of orchestrator run
```

**7. komodo_resume** - Reanudar checkpoint
```javascript
// Schema: { cwd? }
// Checks pending checkpoints
// Validates and resumes
// Returns: { success, message }
```

**8. komodo_status** - Estado actual
```javascript
// Schema: {}
// Returns: config object with validation status
```

### 65.5 Helpers internos

```javascript
// handleRateLimitIfNeeded(result, context):
// - Detects rate limit from error text
// - Saves checkpoint
// - Returns structured paused response

// changeTaskStatus(taskId, newStatus):
// - Direct Firebase update (no sub-agent)

// _recordFinalizationMetrics(params, approved, merged):
// - Best-effort metrics recording (non-blocking)
```

### 65.6 Event forwarding

```javascript
// Forward events to:
// 1. WebSocket server: POST http://localhost:{WS_PORT}/api/event
// 2. Dashboard API: POST http://localhost:{DASHBOARD_PORT}/api/history
//
// Events persisted: task:started, task:completed, pr:created, pr:merged,
//                   review:cycle:end, fix:applied, sonar:analysis:complete
```

### 65.7 INSTRUCTIONS.md (reglas clave)

1. Siempre ejecutar paso a paso (plan → code → review → fix/finalize)
2. Informar al usuario entre cada paso
3. `cwd` es el directorio del repo TARGET, no el de Komodo
4. NUNCA usar planning-task-mcp tools directamente
5. Usar komodo_plan para activar animaciones del Planner
6. Solo usar komodo_run si usuario lo pide explicitamente
7. Formato repo siempre `owner/repo`

---

## 66. GITHUB-MCP (skills/github-mcp/)

### 66.1 Proposito
Wrapper de `gh` CLI como MCP server. 10 herramientas para branches, PRs, reviews y merges.

### 66.2 Package.json
```json
{
  "name": "github-mcp",
  "version": "1.0.0",
  "type": "module",
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.1",
    "zod": "^3.24.2"
  }
}
```

### 66.3 CLI Helpers (src/gh-cli.js)

```javascript
// runGh(args, options): ejecuta gh con timeout 30s
// runGit(args, options): ejecuta git
// runGhApi(endpoint, options): ejecuta gh api con method/body
```

### 66.4 Herramientas

**Branches:**
- `create_branch` - Schema: `{ repo, branchName, baseBranch?, cwd? }` - Crea branch (local con git si cwd, remoto con API si no)
- `list_branches` - Schema: `{ repo, pattern? }` - Lista branches filtradas

**Pull Requests:**
- `create_pr` - Schema: `{ repo, title, body?, head, base? }` - Crea PR via gh pr create
- `get_pr` - Schema: `{ repo, prNumber }` - Detalles completos del PR
- `get_pr_diff` - Schema: `{ repo, prNumber }` - Diff completo del PR
- `list_pr_files` - Schema: `{ repo, prNumber }` - Archivos modificados con stats

**Reviews:**
- `create_review` - Schema: `{ repo, prNumber, event, body, comments? }` - Crea review (APPROVE/REQUEST_CHANGES/COMMENT)
- `list_pr_comments` - Schema: `{ repo, prNumber }` - Reviews + inline comments

**Merge:**
- `merge_pr` - Schema: `{ repo, prNumber, mergeMethod?, deleteBranch? }` - Merge (squash/merge/rebase)
- `close_pr` - Schema: `{ repo, prNumber, comment? }` - Cierra PR con comentario opcional

---

## 67. MEMORY-MCP (skills/memory-mcp/)

### 67.1 Proposito
Memoria persistente de patrones de error, estadisticas de reviews y busqueda semantica.

### 67.2 Package.json
```json
{
  "name": "memory-mcp",
  "version": "1.0.0",
  "type": "module",
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.1",
    "firebase-admin": "^12.0.0",
    "google-auth-library": "^9.0.0",
    "uuid": "^9.0.0",
    "zod": "^3.24.2"
  }
}
```

### 67.3 Storage dual: local file + Firebase

**Local store** (memory/{projectId}/patterns.json):
```json
{
  "patterns": [{
    "id": "uuid",
    "type": "error|anti-pattern|style|positive",
    "description": "string",
    "tags": ["tag1"],
    "severity": "high|medium|low",
    "resolution": "string",
    "frequency": 1,
    "firstSeen": "YYYY-MM-DD",
    "lastSeen": "YYYY-MM-DD",
    "taskId": null,
    "prNumber": null,
    "embedding": [768 floats] | null
  }],
  "reviewOutcomes": [{
    "taskId": "string",
    "prNumber": 1,
    "outcome": "passed|failed",
    "cycles": 2,
    "issuesFound": 3,
    "repo": "owner/repo",
    "date": "ISO datetime"
  }]
}
```

**Firebase** (optional, USE_FIREBASE_MEMORY=true): misma estructura en RTDB.

### 67.4 Vertex AI Embeddings

- Model: text-embedding-004
- Dimension: 768
- Cache: por SHA-256 del texto
- Fallback: zero vector si falla

### 67.5 Herramientas

**record_pattern** - Schema: `{ type, description, tags?, severity, resolution?, taskId?, prNumber?, projectId? }`
- Si patron similar existe: incrementar frequency, merge tags, update resolution
- Si nuevo: crear con UUID
- Generar embedding via Vertex AI
- Persistir a local store + Firebase

**query_patterns** - Schema: `{ type?, severity?, tags?, query?, limit?, projectId?, semanticQuery? }`
- Si semanticQuery + projectId: busqueda semantica con cosine similarity
- Si no: busqueda textual (substring + tags)
- Filtros: type, severity, tags, query text

**get_review_brief** - Schema: `{ limit? }`
- Top error/anti-pattern patterns ordenados por severity y frequency
- Formato markdown para inyectar en prompt del Reviewer
- Excluye patterns tipo "style" y "positive"

**record_review_outcome** - Schema: `{ taskId, prNumber, outcome, cycles, issuesFound?, repo? }`
- Registra resultado de review (passed/failed)
- Append a reviewOutcomes

**get_stats** - Schema: `{}`
- Reviews: total, passed, failed, passRate, avgCycles
- Patterns: total, bySeverity, byType
- Top tags: por frequency
- Recent outcomes: ultimos 5

**get_relevant_memory** (semantic search) - Schema: `{ query, currentFile?, topK?, projectId?, type? }`
- Genera embedding del query
- Cosine similarity contra patterns con embeddings
- Boost 30% si mismo modulo/archivo
- Return top K resultados

### 67.6 Cosine similarity

```javascript
function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
```

---

## 68. PLANNING-TASK-MCP (skills/planning-task-mcp/)

### 68.1 Proposito
Gestion completa de proyectos via Firebase RTDB. 50+ herramientas.

### 68.2 Package.json
```json
{
  "name": "planning-task-mcp",
  "version": "1.0.0",
  "type": "module",
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.1",
    "firebase-admin": "^13.0.0",
    "dotenv": "^16.4.7",
    "zod": "^3.24.2"
  }
}
```

### 68.3 Firebase helpers (src/firebase.js)

```javascript
// getDb(): singleton Firebase RTDB connection
// getAll(path): returns all records at path
// getById(path, id): returns single record
// getFiltered(path, field, value): query by indexed field
// create(path, data): creates with auto-generated ID
// update(path, id, data): updates specific fields
// remove(path, id): deletes record
// sanitize(obj): removes undefined/null values before write
```

### 68.4 Esquema de datos Firebase

**Project:**
```javascript
{
  name, description, startDate, endDate,
  status: "planned|active|completed|archived",
  repositories: [{ url, type: "front|back|api|fullstack", isDefault }],
  languages, frameworks,
  members: { [userId]: { role: "owner|admin|member|viewer", addedAt, addedBy } },
  createdAt, createdBy,
}
```

**Task:**
```javascript
{
  title, projectId, sprintId,
  userStory: { who, what, why },
  acceptanceCriteria: string[],
  bizPoints: number (Fibonacci: 1,2,3,5,8,13),
  devPoints: number (Fibonacci: 1,2,3,5,8,13),
  priority: bizPoints / devPoints, // auto-calculated
  developer, coDeveloper,
  startDate, endDate,
  status: "to-do|in-progress|to-validate|validated|done",
  implementationPlan: { status, approach, steps, dataModelChanges, apiChanges, risks, outOfScope },
  tests: [{ description, type: "unit|integration|e2e|manual", status: "pending|passed|failed" }],
  parentTaskId, blockedBy: [], blocks: [], subtaskIds: [],
  createdAt, updatedAt, createdBy, createdByName,
  history: { [id]: { field, oldValue, newValue, changedAt, changedBy } },
}
```

**Sprint:** `{ name, projectId, startDate, endDate, status: "planned|active|completed", goal }`

**Bug:** `{ title, projectId, description, severity, status, stepsToReproduce, assignedTo, ... }`

**Proposal:** `{ title, projectId, description, status: "pending|approved|rejected", author, ... }`

### 68.5 Herramientas principales

**Projects:** list_projects, get_project, create_project, update_project, delete_project (cascade)

**Sprints:** list_sprints, get_sprint, create_sprint, update_sprint, delete_sprint

**Tasks:** list_tasks, get_task, create_task, update_task, delete_task, change_task_status, assign_task, list_subtasks, move_tasks_to_sprint, search_tasks

**Bugs:** list_bugs, get_bug, create_bug, update_bug, delete_bug

**Proposals:** list_proposals, create_proposal, update_proposal_status

**Comments:** list_comments, create_comment, update_comment, delete_comment

**Notifications:** list_notifications, mark_notification_read, mark_all_notifications_read, send_notification, clear_notifications

**Members:** list_members, add_member, remove_member, change_member_role

**Invitations:** list_invitations, send_invitation, accept_invitation, reject_invitation

**Users:** list_users, get_user, search_users

**Analytics:** project_dashboard, developer_workload, sprint_burndown, project_summary, get_project_context

**Planning:** plan_from_document, create_full_plan

### 68.6 Validaciones clave

**Priority calculation:**
```javascript
priority = Math.round((bizPoints / devPoints) * 10) / 10
```

**Circular dependency detection:**
```javascript
function hasCircularDependency(fromId, toId) {
  // Recursive graph traversal with visited set
  // Returns true if cycle would be created
}
```

**Status transitions con validacion de tests:**
```javascript
// to-validate: todos los tests definidos
// validated/done: todos los tests pasados
// Si no cumple: error con detalle de tests pendientes
```

**Fibonacci validation:** bizPoints y devPoints deben ser 1, 2, 3, 5, 8, o 13.
# PARTE 10: DASHBOARD (Next.js)

---

## 69. DASHBOARD OVERVIEW

### 69.1 Stack
- Next.js 15.3.3 con App Router
- React 19.1.0
- TypeScript 5.8.3 (strict mode)
- Tailwind CSS 4.1.8
- Recharts 3.7.0 (graficos)
- Lucide React (iconos)
- Firebase Admin SDK 13.7.0 (server-side)
- Vitest 4.0.18 (tests)

### 69.2 Package.json
```json
{
  "name": "komodo-dashboard",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint"
  },
  "dependencies": {
    "firebase-admin": "^13.7.0",
    "lucide-react": "^0.577.0",
    "next": "^15.3.3",
    "react": "^19.1.0",
    "react-dom": "^19.1.0",
    "recharts": "^3.7.0"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4.1.8",
    "@types/node": "^22.15.21",
    "@types/react": "^19.1.4",
    "@types/react-dom": "^19.1.5",
    "tailwindcss": "^4.1.8",
    "typescript": "^5.8.3",
    "vitest": "^4.0.18"
  }
}
```

### 69.3 Layout principal (app/layout.tsx)

```tsx
// Dark mode por defecto (className="dark" en <html>)
// Estructura: Sidebar + main content area
// Providers: NotificationProvider → ViewPreferenceProvider (sin 3D/pixel en V2)
// Body: flex h-screen bg-neutral-950 text-neutral-100
```

### 69.4 Nota V2: Sin 3D ni Pixel Office

En V2, se eliminan:
- `components/3d/` (Office3D, Agent3D, Environment3D, KomodoBoss, SonarScanner3D, AnimatedWhiteboard)
- `components/pixel-office/` (pixel-office-canvas, pixel-agent, office-map, pathfinding, use-pixel-agents)
- `components/view-toggle.tsx`
- `context/view-preference-context.tsx`
- Three.js, @react-three/fiber, @react-three/drei dependencies

El dashboard mantiene TODAS las funcionalidades de monitoreo, analytics, agents, settings, etc.

---

## 70. PAGINAS

### 70.1 Dashboard Home (app/page.tsx)

Pagina principal con estado en tiempo real:

**Secciones:**
1. **Header** - "Komodo Dashboard" + connection status
2. **Current Task Card** - Titulo, puntos (BP/DP), developer, sprint, PR link
3. **Phase Indicator** - Barra de progreso por fases (plan→arch→code→test→sec→review→merge)
4. **Agent Cards Grid** - 6 tarjetas: PLANNER, ARCHITECT, CODER, TESTER, SECURITY, REVIEWER
   - Cada una muestra: status (idle/working/done), CLI, model, cost, turns
5. **Execution Controls** - Pause/Stop buttons con confirmacion
6. **Budget Widget** - Costo total, barras de progreso daily/weekly
7. **Event Timeline** - Ultimos 20 eventos en tiempo real
8. **SonarQube Status** - Estado del analisis (idle/running/done/error)
9. **Agent Cost Breakdown** - Barras de costo por agente
10. **Multi-Project Selector** (si multi-project habilitado)

**Datos via WebSocket (useKomodoSocket).**

### 70.2 Agents Page (app/agents/page.tsx)

Detalle de agentes individuales:

**Grid de agentes:**
- 6 agentes + card KOMODO orquestador
- Cada card: nombre, status badge, model badge, cost, turns, completed tasks

**Panel de detalle (al seleccionar agente):**
- **Tab: Live Log** - Terminal con logs en tiempo real, auto-scroll
- **Tab: Event History** - Timeline de eventos del agente
- Stats bar: status, mode, elapsed time, cost, turns, tasks

**Colores por agente:**
- PLANNER=violet, ARCHITECT=teal, CODER=blue, TESTER=orange, SECURITY=green, REVIEWER=amber

### 70.3 Analytics Page (app/analytics/page.tsx)

5 graficos con datos de Firebase:

1. **Velocity Chart** - Tareas y devPoints por sprint (linea)
2. **Cost Chart** - Costo por sprint con promedio (barras)
3. **Review Pass Rate** - Tasa de aprobacion por sprint (linea)
4. **Duration vs Complexity** - Scatter plot estimado vs real
5. **Model Usage** - Frecuencia y scores por modelo (barras)

**Filtros:** startDate, endDate, sprint, model, complexity

### 70.4 History Page (app/history/page.tsx)

Timeline de operaciones agrupada por fecha:

**Eventos tracked:**
- task:started, task:completed
- pr:created, pr:merged
- review:cycle:end
- fix:applied
- sonar:analysis:complete

**Filtros:** date presets (today/week/month/all), custom dates, action type, agent

### 70.5 Leaderboard Page (app/leaderboard/page.tsx)

Rankings de rendimiento por modelo:

- Tabla: model, role, avgScore, avgCycles, avgDuration, avgCost, taskCount
- Optimal models: mejor modelo por rol
- Cost optimization: modelos mas baratos con rendimiento similar

**Filtros:** complexity, period (all/week/month)

### 70.6 Memory Page (app/memory/page.tsx)

Patrones de error persistentes:

- Stats: total patterns, total reviews, avg cycles, trend
- Distribution: por type (error/anti-pattern/style/positive)
- Top 10: bar chart de issues mas frecuentes
- Tabla expandible: description, type, severity, frequency, resolution, tags
- Clear memory button

### 70.7 Notifications Page (app/notifications/page.tsx)

- Lista con badges (success/info/warning/error)
- Mark read / Mark all read / Clear all
- Filtros por tipo

### 70.8 Settings Page (app/settings/page.tsx)

- Active project selector
- Coding guidelines textarea (2000 chars max)
- Agent config: CLI provider, model dropdown, max turns (por agente)
- Orchestrator: max review cycles, budget limit, continuous mode
- CLI health status display

---

## 71. COMPONENTES

### 71.1 Core Components

**sidebar.tsx** - Navegacion con 8 menu items + notification badge
**connection-status.tsx** - Dot + label (Connected/Disconnected)
**notification-provider.tsx** - Context provider + toast container
**execution-controls.tsx** - Pause/Stop con confirmacion
**task-detail-modal.tsx** - Modal con detalles completos de tarea (Firebase)
**budget-widget.tsx** - Costo + barras daily/weekly con colores
**cli-health-status.tsx** - 3 cards (claude/codex/gemini) con status
**project-selector.tsx** - Dropdown multi-project
**multi-project-overview.tsx** - Stats por proyecto
**toast-notifications.tsx** - Container de toasts (max 5, auto-dismiss 5s)
**agent-avatar.tsx** - Avatar SVG animado por agente

### 71.2 Analytics Components

**analytics-filters.tsx** - Date range, sprint, model, complexity
**velocity-chart.tsx** - Recharts LineChart
**cost-chart.tsx** - Recharts BarChart
**review-pass-rate-chart.tsx** - Recharts LineChart
**duration-complexity-chart.tsx** - Recharts ScatterChart
**model-usage-chart.tsx** - Recharts BarChart
**model-leaderboard-table.tsx** - Tabla rankeada
**leaderboard-filters.tsx** - Filtros de leaderboard

### 71.3 Data Components

**budget-history.tsx** - Historico de gasto
**coverage-trend.tsx** - Tendencia de cobertura
**estimation-chart.tsx** - Precision de estimaciones

---

## 72. HOOKS

### 72.1 useKomodoSocket (hooks/useKomodoSocket.ts)

Hook principal de WebSocket (513 lineas):

```typescript
export function useKomodoSocket() {
  // Connect to ws://localhost:3001 (NEXT_PUBLIC_WS_URL)
  // Auto-reconnect with 3s delay
  // Process messages: snapshot, event, command-ack
  // Maintain: snapshot state, events[], agentLogs{}, cliHealth{}
  // localStorage persistence for events (MAX_EVENTS=20)

  return {
    snapshot: KomodoSnapshot | null,
    connected: boolean,
    events: DashboardEvent[],
    agentLogs: Record<AgentName, AgentLog[]>,  // max 200 per agent
    cliHealth: Record<CliName, CliHealth>,
    sendCommand: (command: string) => void,
  };
}
```

**Event processing (applyEvent):**
- AGENT_STATE_CHANGE → update agents[name].status
- PHASE_CHANGED → update phase
- COST_UPDATED → update totalCost + agent costs
- TASK_STARTED → update currentTask + taskDetails
- PR_CREATED → update currentPR
- REVIEW_CYCLE_START → update reviewCycle
- EXECUTION_STATE_CHANGED → update executionState
- SONAR_ANALYSIS_* → update sonarAnalysis
- BUDGET_* → update budget
- CLI health events → update cliHealth

### 72.2 useAgentStates (hooks/useAgentStates.ts)

```typescript
// Derives visual agent states from snapshot
// Returns enriched agents with: status, activity description, reviewCycle
// Example: CODER working during 'coding' phase → activity: "Implementing code..."
// DEFAULT_AGENTS: all 6 agents with default idle state
```

### 72.3 useNotifications (hooks/useNotifications.ts)

```typescript
// WebSocket-powered notification system
// Events → notifications:
//   task:completed → success
//   pr:merged → success
//   pr:created → info
//   cost:updated (>80% budget) → warning
//   agent:state-change (failed) → error
//   review:cycle:end (changes requested) → warning
//
// Returns: { notifications, unreadCount, markRead, markAllRead, clearAll }
```

---

## 73. API ROUTES

### 73.1 Config (app/api/config/route.ts)

```
GET /api/config → KomodoConfig + availableClis (detected via `which`)
PUT /api/config → validates + saves to komodo.config.json
```

### 73.2 Projects (app/api/projects/route.ts)

```
GET /api/projects → { projects: { id, name }[] } filtered by user membership
```

### 73.3 History (app/api/history/route.ts)

```
GET /api/history?startDate=&endDate=&action=&agent=&limit=200
POST /api/history → saves event to Firebase (komodo-history)
```

### 73.4 Tasks (app/api/tasks/[taskId]/route.ts)

```
GET /api/tasks/{taskId} → full task with resolved sprint/developer names
```

### 73.5 Memory (app/api/memory/route.ts)

```
GET /api/memory → { patterns, reviewOutcomes } from patterns.json
DELETE /api/memory/clear → clear all patterns
```

### 73.6 Project-specific routes

```
GET /api/projects/{id}/analytics → velocity, cost, review rates, duration, model usage
GET /api/projects/{id}/model-leaderboard → rankings by model/role
GET /api/projects/{id}/coding-guidelines → project guidelines
PUT /api/projects/{id}/coding-guidelines → save guidelines
GET /api/projects/{id}/tech-debt → debt items
GET /api/projects/{id}/coverage-trend → coverage history
GET /api/projects/{id}/budget-history → daily spending
GET /api/projects/{id}/estimation-metrics → estimation accuracy
GET /api/schedule → schedule windows and current status
```

---

## 74. TIPOS TYPESCRIPT (lib/types.ts)

```typescript
// Core types
type AgentName = 'PLANNER' | 'CODER' | 'REVIEWER' | 'ARCHITECT' | 'SECURITY' | 'TESTER';
type AgentStatus = 'idle' | 'walking' | 'working' | 'done';
type Phase = 'idle' | 'planning' | 'architecting' | 'coding' | 'testing' | 'security' | 'analyzing' | 'reviewing' | 'merging';
type ExecutionState = 'stopped' | 'running' | 'paused';

// Interfaces: KomodoSnapshot, AgentState, TaskDetails, SonarAnalysisState,
//             CliHealth, BudgetState, MultiProjectState, DashboardEvent,
//             KomodoNotification, HistoryEntry

// WebSocket messages: WsSnapshotMessage, WsEventMessage, WsCommandAckMessage

// Config types (lib/config-types.ts):
// CliProvider, AgentModel, KomodoConfig, CLI_MODELS, DEFAULT_CONFIG

// Memory types (lib/memory-types.ts):
// Pattern, ReviewOutcome, MemoryStore, MemoryStats
```

## 75. FIREBASE CLIENT (lib/firebase.ts)

```typescript
// Admin SDK initialization with credential discovery:
// 1. GOOGLE_APPLICATION_CREDENTIALS env var
// 2. serviceAccountKey.json in cwd/parent
// 3. Glob: planning-task-firebase-adminsdk-*.json
// 4. Legacy: skills/planning-task-mcp/serviceAccountKey.json
//
// Database URL from .env
// Exports: getDb()
```

## 76. GLOBALS CSS (app/globals.css)

Animaciones custom:
```css
/* Agent avatar: breathe, blink, walk, work-bob, typing, accessory-pulse */
/* Office feedback: bubble-appear, typing-dot-bounce, confetti-fall, verdict-pop */
/* Toast: toast-slide-in, toast-slide-out */
```

Note V2: eliminar animaciones relacionadas con 3D y pixel office. Mantener: agent avatar, toast, y feedback genericos.
# PARTE 11: SYSTEM PROMPTS, DEPENDENCIAS Y GUIA DE IMPLEMENTACION

---

## 77. SYSTEM PROMPTS

### 77.1 Planner System Prompt (src/prompts/planner-system.js)

```
Eres el PLANNER de Komodo, un orquestador de agentes IA para desarrollo de software.

Tu rol es seleccionar la SIGUIENTE tarea a implementar del backlog.

REGLAS:
1. Priorizar tareas in-progress (completar trabajo empezado)
2. Respetar orden de sprint (primero las del sprint mas temprano)
3. Dentro del mismo sprint, priorizar por eficiencia (bizPoints/tokens)
4. No seleccionar tareas bloqueadas por dependencias

FORMATO DE RESPUESTA (JSON):
{
  "taskId": "id de la tarea seleccionada",
  "title": "titulo de la tarea",
  "branchName": "feature/task-{6chars}-{slug}",
  "repoUrl": "URL del repositorio",
  "userStory": { "who": "...", "what": "...", "why": "..." },
  "acceptanceCriteria": ["criterio 1", "criterio 2"],
  "devPoints": 5,
  "bizPoints": 8,
  "sprintId": "sprint-id",
  "reason": "breve explicacion de por que esta tarea"
}

Branch naming: feature/task-{primeros 6 chars del taskId}-{titulo-en-kebab-case}
```

### 77.2 Architect System Prompt (src/prompts/architect-system.js)

```
Eres el ARCHITECT de Komodo. Tu rol es analizar el codebase y generar un plan de implementacion.

INSTRUCCIONES:
1. Lee los archivos relevantes del proyecto (package.json, estructura, etc.)
2. Identifica QUE archivos crear y cuales modificar
3. Determina el ORDEN optimo de implementacion
4. Detecta RIESGOS y dependencias externas
5. Estima la complejidad

FORMATO DE RESPUESTA (JSON):
{
  "filesToCreate": ["ruta/nuevo-archivo.js"],
  "filesToModify": ["ruta/archivo-existente.js"],
  "dependencies": ["paquete-npm"],
  "dataModelChanges": "descripcion",
  "apiChanges": "descripcion",
  "implementationOrder": ["1. Crear...", "2. Modificar..."],
  "risks": ["riesgo 1", "riesgo 2"],
  "estimatedComplexity": "trivial|low|medium|high|critical"
}

REGLAS:
- Solo lectura, NO modifiques archivos
- Se especifico con rutas de archivos
- Incluye cambios de modelo de datos y API
- Identifica dependencias NPM necesarias
```

### 77.3 Coder System Prompt (src/prompts/coder-system.js)

```
Eres el CODER de Komodo. Tu rol es implementar tareas de desarrollo siguiendo un plan.

FLUJO DE TRABAJO:
1. Crea la branch indicada desde main
2. Implementa TODOS los criterios de aceptacion
3. Escribe commits descriptivos (feat: / fix: / refactor:)
4. Abre una Pull Request hacia main
5. NO hagas merge

REGLAS:
- Si hay plan del Arquitecto, SIGUELO sin explorar
- Respeta la guia de estilo del proyecto
- No introduzcas vulnerabilidades de seguridad
- Reutiliza PR existente si ya hay una abierta para la branch
- Commits atomicos y descriptivos

FORMATO DE RESPUESTA (JSON):
{
  "prNumber": 42,
  "prUrl": "https://github.com/owner/repo/pull/42",
  "branchName": "feature/task-abc123-titulo",
  "filesChanged": ["ruta/archivo.js"],
  "summary": "Resumen de lo implementado"
}
```

**Coder Fix System Prompt (variante para correccion):**
```
Eres el CODER de Komodo en modo CORRECCION.

INSTRUCCIONES:
1. Lee SOLO los archivos mencionados en los issues
2. Arregla CADA issue reportado por el Reviewer
3. Commits: fix: descripcion del arreglo
4. Push a la misma branch (NO nueva PR)

FORMATO DE RESPUESTA (JSON):
{
  "fixed": true,
  "issuesResolved": ["descripcion 1", "descripcion 2"],
  "issuesNotResolved": [],
  "filesChanged": ["ruta/archivo.js"],
  "summary": "Resumen de correcciones"
}
```

### 77.4 Reviewer System Prompt (src/prompts/reviewer-system.js)

```
Eres el REVIEWER de Komodo. Tu rol es revisar Pull Requests con criterios estrictos.

8 CRITERIOS DE EVALUACION:
1. Correctness - Funcionalidad correcta, criterios cumplidos
2. Error Handling - Try/catch, validaciones, edge cases
3. Edge Cases - Null, empty, boundary values
4. Naming - Variables, funciones, archivos descriptivos
5. Structure - Organizacion, modularidad, DRY
6. Tests - Cobertura adecuada, tests significativos
7. Security - OWASP compliance, no secrets hardcoded
8. Patterns - Patrones del proyecto, consistencia

REGLAS:
- Score 0-10 (8+ para APPROVE)
- APPROVED: score >= 8 Y sin issues critical/major
- REQUEST_CHANGES: score < 8 O issues critical/major
- NO modifiques codigo (read-only)
- Se constructivo, da sugerencias especificas

FORMATO DE RESPUESTA (JSON):
{
  "verdict": "APPROVED|REQUEST_CHANGES",
  "score": 8,
  "issues": [
    {
      "severity": "critical|major|minor",
      "description": "descripcion del problema",
      "file": "ruta/archivo.js",
      "line": 42,
      "suggestion": "como resolverlo"
    }
  ],
  "positives": ["aspecto positivo 1"],
  "summary": "resumen general"
}
```

**Variantes por profundidad:**
- `quick`: Solo criterios 1 (correctness) y 7 (security)
- `standard`: Criterios 1-5
- `deep`: Todos los 8 criterios
- `forensic`: Analisis linea por linea, todos los criterios

### 77.5 QA System Prompt (src/prompts/qa-system.js)

```
Eres el QA de Komodo. Generas y ejecutas tests automaticos.

INSTRUCCIONES:
1. Lee los criterios de aceptacion y archivos modificados
2. Detecta el framework de testing (vitest, jest, mocha, etc.)
3. Genera tests por cada criterio de aceptacion
4. Genera tests de edge cases (null, empty, boundary)
5. Ejecuta TODOS los tests
6. Push solo si TODOS pasan

Si un test falla:
- Si el codigo del Coder tiene un bug: reporta failsCoderCode: true
- Si el test esta mal escrito: arreglalo y reintenta

FORMATO DE RESPUESTA (JSON):
{
  "testsGenerated": 10,
  "testsPassed": 10,
  "testsFailed": 0,
  "filesCreated": ["tests/nuevo-test.test.js"],
  "filesChanged": [],
  "pushed": true,
  "failedTests": [],
  "summary": "10 tests generados, todos pasaron"
}
```

### 77.6 Security System Prompt (src/prompts/security-system.js)

```
Eres el SECURITY agent de Komodo. Escaneas codigo en busca de vulnerabilidades.

CHECKLIST OWASP TOP 10:
1. Injection (SQL, NoSQL, Command, LDAP)
2. Broken Authentication
3. Sensitive Data Exposure
4. XML External Entities (XXE)
5. Broken Access Control
6. Security Misconfiguration
7. Cross-Site Scripting (XSS)
8. Insecure Deserialization
9. Using Components with Known Vulnerabilities
10. Insufficient Logging & Monitoring

INSTRUCCIONES:
1. Analiza cada archivo modificado
2. Busca: hardcoded secrets, SQL injection, XSS, command injection
3. Verifica: validacion de input, sanitizacion de output
4. Incluye: severity, category, file, line

VERDICT:
- BLOCK: 1+ CRITICAL o 1+ HIGH
- WARN: 1+ MEDIUM (sin CRITICAL/HIGH)
- PASS: solo LOW o ninguno

FORMATO DE RESPUESTA (JSON):
{
  "verdict": "PASS|WARN|BLOCK",
  "findings": [{ "severity": "CRITICAL|HIGH|MEDIUM|LOW", "category": "Injection", "description": "...", "file": "...", "line": 42 }],
  "summary": "resumen del analisis"
}
```

### 77.7 Tester System Prompt (src/prompts/tester-system.js)

```
Eres el TESTER de Komodo. Generas tests QUIRURGICOS usando contexto del Knowledge Graph.

A DIFERENCIA del QA, tu tienes contexto del:
- Plan del Arquitecto (que se planeo implementar)
- Decisiones del Coder (que se implemento y por que)
- Riesgos identificados (que puede fallar)

GENERA TESTS PARA:
1. Cada criterio de aceptacion (happy path)
2. Edge cases de las funciones principales
3. Error paths (que pasa si falla X)
4. Riesgos del Arquitecto (test especifico por riesgo)
5. Regresion (si se toco codigo existente)

FORMATO: mismo que QA + campo coverage (porcentaje estimado)
```

---

## 78. DEPENDENCIAS

### 78.1 Root package.json

```json
{
  "name": "komodo-orchestrator",
  "version": "2.0.0",
  "type": "module",
  "scripts": {
    "start": "node src/index.js",
    "dev": "node --watch src/index.js",
    "test": "vitest run",
    "setup": "node src/setup.js"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.1",
    "@xenova/transformers": "^2.17.2",
    "chalk": "^5.3.0",
    "commander": "^12.0.0",
    "dotenv": "^16.4.7",
    "uuid": "^9.0.0",
    "ws": "^8.19.0",
    "zod": "^3.24.2"
  },
  "devDependencies": {
    "vitest": "^2.0.0"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
```

**Nota V2:** Eliminado `node-telegram-bot-api` y dependencias de Three.js del root.

### 78.2 Registro MCP global

```bash
# Registrar komodo-mcp como servidor MCP global
claude mcp add komodo-mcp \
  --command "node" \
  --args "c:\\path\\to\\komodo\\skills\\komodo-mcp\\src\\index.js" \
  --env "KOMODO_ROOT=c:\\path\\to\\komodo"
```

### 78.3 .claude/settings.local.json

```json
{
  "mcpServers": {
    "komodo-mcp": {
      "command": "node",
      "args": ["c:\\path\\to\\komodo\\skills\\komodo-mcp\\src\\index.js"],
      "env": { "KOMODO_ROOT": "c:\\path\\to\\komodo" }
    }
  },
  "permissions": {
    "allow": [
      "mcp__komodo-mcp__*",
      "mcp__planning-task-mcp__*",
      "mcp__github-mcp__*",
      "mcp__memory-mcp__*",
      "Bash(git *)",
      "Bash(gh *)",
      "Bash(npm *)"
    ]
  }
}
```

---

## 79. GUIA DE IMPLEMENTACION

### 79.1 Orden de implementacion recomendado

**Fase 1: Infraestructura base (Sprint 0-2)**
1. `package.json` + dependencias
2. `src/config.js` - Config loader
3. `src/utils/logger.js` - Logger con colores
4. `src/utils/parser.js` - JSON parser robusto
5. `src/utils/response-validator.js` - Validador
6. `src/events/event-bus.js` - EventBus
7. `src/state/komodo-state.js` - State singleton
8. `src/state/checkpoint-manager.js` - Checkpoints

**Fase 2: Sistema de agentes (Sprint 3-5)**
9. `src/agents/rate-limit-detector.js` - Detection patterns
10. `src/agents/fallback-manager.js` - CLI fallback
11. `src/agents/streaming-watchdog.js` - Anomaly detection
12. `src/agents/base-agent.js` - Core agent runner
13. `src/agents/multi-part-filter.js` - Multi-part tasks
14. `src/prompts/*` - Todos los system prompts

**Fase 3: Agentes individuales (Sprint 6-8)**
15. `src/agents/planner.js`
16. `src/agents/architect.js`
17. `src/agents/coder.js`
18. `src/agents/reviewer.js`
19. `src/agents/qa.js`
20. `src/agents/tester.js`
21. `src/agents/security-agent.js`

**Fase 4: Ciclo de ejecucion (Sprint 9-10)**
22. `src/cycle/incremental-review.js`
23. `src/cycle/review-loop.js`
24. `src/cycle/task-runner.js`
25. `src/cycle/pipeline-scheduler.js`

**Fase 5: Orquestacion (Sprint 11-12)**
26. `src/orchestrator.js`
27. `src/index.js` - CLI
28. `src/setup.js` - Wizard

**Fase 6: MCP Servers (Sprint 13-16)**
29. `skills/planning-task-mcp/` - Firebase task management
30. `skills/github-mcp/` - GitHub operations
31. `skills/memory-mcp/` - Pattern memory
32. `skills/komodo-mcp/` - Orchestrator MCP

**Fase 7: Subsistemas (Sprint 17-20)**
33. Triage: complexity, model-selector, smart-router, decomposer
34. Intelligence: indexer, learner, style-detector, review-feedback
35. Knowledge graph
36. Autonomy: engine, guardian-gates, approval
37. Resilience: circuit-breaker, error-budget, DLQ
38. Self-healing: engine + 6 strategies
39. Cost: budget-manager
40. Estimation: token-estimator, rate-limit-tracker

**Fase 8: Features avanzados (Sprint 21-23)**
41. Daemon mode + scheduler
42. Heartbeat monitor
43. CI monitor + canary merge
44. SonarQube integration
45. Pre-PR tests + coverage
46. Versioning + releases
47. Tech debt tracker
48. Auto-improve
49. Multi-project
50. Integrations (GitHub issues, PR comments, webhooks)
51. Plugin system

**Fase 9: Servidores (Sprint 24)**
52. WebSocket server
53. API server
54. Shutdown manager

**Fase 10: Dashboard (Sprint 25-28)**
55. Next.js setup + config
56. Types + Firebase client
57. WebSocket hook
58. Pages: dashboard, agents, analytics, history, leaderboard, memory, notifications, settings
59. Components
60. API routes

### 79.2 Prerequisitos de desarrollo

```bash
# Instalar Node.js 18+
# Instalar git
# Instalar GitHub CLI: gh auth login
# Instalar al menos un AI CLI: claude, codex, o gemini
# Configurar Firebase: crear proyecto, generar serviceAccountKey.json
# Configurar .env con todas las variables
```

### 79.3 Verificacion

```bash
# Verificar instalacion
komodo doctor

# Setup interactivo
komodo setup

# Dry run (simulacion)
komodo run --dry-run

# Ejecutar 1 tarea
komodo run -t 1

# Modo continuo
komodo run -c

# Modo daemon
komodo watch
```

---

## 80. RESUMEN FINAL

Komodo V2.0 es un sistema de 223+ archivos JS/TS que orquesta 7 agentes IA para automatizar el ciclo completo de desarrollo de software. Los componentes clave son:

1. **Base Agent** - Infraestructura de spawn CLI + stdin + MCP injection
2. **Task Runner** - Pipeline de 12 fases por tarea
3. **Review Loop** - Ciclo Coder ↔ Reviewer con escalacion
4. **4 MCP Servers** - 70+ herramientas (Firebase, GitHub, Memory, Orchestrator)
5. **Dashboard** - Next.js con WebSocket real-time
6. **Resiliencia** - Circuit breaker, self-healing, checkpoints, fallback
7. **Inteligencia** - Codebase learning, Knowledge Graph, semantic memory
8. **Observabilidad** - EventBus, timelines, anomaly detection, metricas

Todo diseñado para ser completamente replicable desde este documento.
# PARTE 12: DETALLES ADICIONALES Y REFERENCIAS CRUZADAS

---

## 81. CLAUDE CODE INTEGRATION DETALLADA

### 81.1 Slash command (/komodo)

Archivo: `.claude/commands/komodo.md`

```markdown
# Komodo Orchestrator

Usa las herramientas MCP de komodo-mcp para orquestar el desarrollo:

1. `komodo_plan` - Seleccionar siguiente tarea
2. `komodo_code` - Implementar tarea
3. `komodo_review` - Revisar PR
4. `komodo_fix` - Corregir issues
5. `komodo_finalize` - Merge o cerrar PR
6. `komodo_run` - Ejecutar N tareas completas
7. `komodo_resume` - Reanudar desde checkpoint
8. `komodo_status` - Ver configuracion actual

Flujo recomendado: plan → code → review → (fix → review)* → finalize
```

### 81.2 MCP Registration en settings.local.json

```json
{
  "mcpServers": {
    "komodo-mcp": {
      "command": "node",
      "args": ["c:\\Users\\Ramos\\Documents\\komodo\\skills\\komodo-mcp\\src\\index.js"],
      "env": {
        "KOMODO_ROOT": "c:\\Users\\Ramos\\Documents\\komodo"
      }
    }
  },
  "permissions": {
    "allow": [
      "mcp__komodo-mcp__komodo_plan",
      "mcp__komodo-mcp__komodo_code",
      "mcp__komodo-mcp__komodo_review",
      "mcp__komodo-mcp__komodo_fix",
      "mcp__komodo-mcp__komodo_finalize",
      "mcp__komodo-mcp__komodo_run",
      "mcp__komodo-mcp__komodo_resume",
      "mcp__komodo-mcp__komodo_status",
      "Bash(git *)",
      "Bash(gh *)",
      "Bash(npm *)",
      "Bash(node *)"
    ]
  }
}
```

---

## 82. FIREBASE SCHEMA COMPLETO

### 82.1 Database structure

```
firebase-rtdb/
├── projects/
│   └── {projectId}/
│       ├── name: string
│       ├── description: string
│       ├── startDate: "YYYY-MM-DD"
│       ├── endDate: "YYYY-MM-DD"
│       ├── status: "planned|active|completed|archived"
│       ├── repositories/
│       │   └── {index}/
│       │       ├── url: string
│       │       ├── type: "front|back|api|fullstack"
│       │       └── isDefault: boolean
│       ├── languages: string
│       ├── frameworks: string
│       ├── codingGuidelines: string
│       ├── members/
│       │   └── {userId}/
│       │       ├── userId: string
│       │       ├── role: "owner|admin|member|viewer"
│       │       ├── addedAt: number (timestamp)
│       │       └── addedBy: string
│       ├── createdAt: number
│       └── createdBy: string
│
├── sprints/
│   └── {sprintId}/
│       ├── name: string
│       ├── projectId: string
│       ├── startDate: "YYYY-MM-DD"
│       ├── endDate: "YYYY-MM-DD"
│       ├── status: "planned|active|completed"
│       ├── goal: string
│       ├── createdAt: number
│       └── createdBy: string
│
├── tasks/
│   └── {taskId}/
│       ├── title: string
│       ├── projectId: string
│       ├── sprintId: string | null
│       ├── userStory/
│       │   ├── who: string
│       │   ├── what: string
│       │   └── why: string
│       ├── acceptanceCriteria: string[]
│       ├── bizPoints: number (1,2,3,5,8,13)
│       ├── devPoints: number (1,2,3,5,8,13)
│       ├── priority: number (bizPoints/devPoints rounded)
│       ├── developer: string | null
│       ├── coDeveloper: string | null
│       ├── startDate: string | null
│       ├── endDate: string | null
│       ├── status: "to-do|in-progress|to-validate|validated|done"
│       ├── implementationPlan/
│       │   ├── status: "pending|in-progress|done"
│       │   ├── approach: string
│       │   ├── steps: string[]
│       │   ├── dataModelChanges: string
│       │   ├── apiChanges: string
│       │   ├── risks: string
│       │   └── outOfScope: string
│       ├── tests/
│       │   └── {index}/
│       │       ├── description: string
│       │       ├── type: "unit|integration|e2e|manual"
│       │       └── status: "pending|passed|failed"
│       ├── attachments/
│       │   └── {index}/
│       │       ├── id: string
│       │       ├── name: string
│       │       ├── url: string
│       │       └── uploadedAt: number
│       ├── parentTaskId: string | null
│       ├── blockedBy: string[]
│       ├── blocks: string[]
│       ├── subtaskIds: string[]
│       ├── decomposed: boolean
│       ├── createdAt: number
│       ├── updatedAt: number
│       ├── createdBy: string
│       ├── createdByName: string
│       └── history/
│           └── {changeId}/
│               ├── field: string
│               ├── oldValue: any
│               ├── newValue: any
│               ├── changedAt: number
│               └── changedBy: string
│
├── bugs/
│   └── {bugId}/
│       ├── title: string
│       ├── projectId: string
│       ├── description: string
│       ├── severity: "critical|high|medium|low"
│       ├── status: "open|in-progress|resolved|closed"
│       ├── stepsToReproduce: string
│       ├── assignedTo: string | null
│       ├── createdAt: number
│       └── createdBy: string
│
├── proposals/
│   └── {proposalId}/
│       ├── title: string
│       ├── projectId: string
│       ├── description: string
│       ├── status: "pending|approved|rejected"
│       ├── author: string
│       ├── createdAt: number
│       └── updatedAt: number
│
├── comments/
│   └── {taskId}/
│       └── {commentId}/
│           ├── text: string
│           ├── author: string
│           ├── authorName: string
│           ├── createdAt: number
│           └── updatedAt: number
│
├── notifications/
│   └── {userId}/
│       └── {notificationId}/
│           ├── type: "info|success|warning|error"
│           ├── title: string
│           ├── message: string
│           ├── read: boolean
│           ├── createdAt: number
│           └── metadata: object
│
├── users/
│   └── {userId}/
│       ├── name: string
│       ├── email: string
│       ├── role: string
│       └── createdAt: number
│
├── invitations/
│   └── {invitationId}/
│       ├── projectId: string
│       ├── invitedUserId: string
│       ├── role: string
│       ├── status: "pending|accepted|rejected"
│       ├── invitedBy: string
│       └── createdAt: number
│
├── events/
│   └── {projectId}/
│       └── {eventId}/
│           ├── type: string
│           ├── timestamp: string
│           ├── metadata: object
│           └── persistedAt: number
│
├── metrics/
│   └── {projectId}/
│       ├── model-performance/
│       │   └── tasks/
│       │       └── {taskId}/
│       │           ├── plannerModel: string
│       │           ├── coderModel: string
│       │           ├── reviewerModel: string
│       │           ├── reviewScore: number
│       │           ├── reviewCycles: number
│       │           ├── durationSeconds: number
│       │           ├── cost: number
│       │           └── completedAt: string
│       ├── coverageHistory/
│       │   └── {entryId}/
│       │       ├── coverage: number
│       │       ├── date: string
│       │       └── taskId: string
│       └── estimation/
│           └── {taskId}/
│               ├── estimatedTokens: number
│               ├── actualTokens: number
│               ├── estimatedDevPoints: number
│               └── actualDurationMinutes: number
│
├── budgets/
│   └── {projectId}/
│       └── daily/
│           └── {date}/
│               ├── spent: number
│               └── tasks: number
│
├── knowledge/
│   └── {projectId}/
│       └── modules/
│           └── {modulePath}/
│               ├── patterns: string[]
│               ├── antiPatterns: string[]
│               └── lessons: string[]
│
├── learnings/
│   └── {projectId}/
│       ├── architecture: string[]
│       ├── testing: string[]
│       └── errorHandling: string[]
│
└── komodo-history/
    └── {entryId}/
        ├── action: string
        ├── timestamp: string
        ├── agent: string
        ├── taskId: string
        ├── taskTitle: string
        ├── prNumber: number
        ├── repo: string
        └── metadata: object
```

---

## 83. SONAR-PROJECT.PROPERTIES

```properties
sonar.projectKey=komodo
sonar.projectName=Komodo Orchestrator
sonar.projectVersion=2.0.0
sonar.sources=src
sonar.exclusions=**/node_modules/**,**/dashboard/**,**/skills/**,**/*.test.js
sonar.javascript.lcov.reportPaths=coverage/lcov.info
sonar.sourceEncoding=UTF-8
```

---

## 84. VITEST CONFIG

```javascript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.js'],
    exclude: ['node_modules', 'skills', 'dashboard'],
    timeout: 30000,
  },
});
```

---

## 85. GITIGNORE

```
node_modules/
.env
*.log
_debug_*
.komodo/checkpoints/
.tmp/
.scannerwork/
memory/*/patterns.json
knowledge/
dashboard/.next/
dashboard/node_modules/
skills/*/node_modules/
skills/planning-task-mcp/serviceAccountKey.json
komodo.config.json
heartbeat.log
reflog.txt
coverage/
```

---

## 86. REVIEW DEPTH SELECTOR (src/review/review-depth-selector.js)

```javascript
export function selectReviewDepth(taskSpec, filesChanged, sonarReport) {
  const devPoints = taskSpec.devPoints || 3;
  const fileCount = filesChanged?.length || 0;
  const hasSecurityFiles = filesChanged?.some(f =>
    f.includes('auth') || f.includes('migration') || f.includes('secret') ||
    f.includes('password') || f.includes('.env') || f.includes('config')
  );
  const hasSonarIssues = sonarReport?.issues?.some(i =>
    i.severity === 'BLOCKER' || i.severity === 'CRITICAL'
  );

  // Forensic: critical security changes
  if (hasSecurityFiles && devPoints >= 8) return { depth: 'forensic', maxTurns: 40 };

  // Deep: complex tasks or sonar issues
  if (devPoints >= 8 || hasSonarIssues) return { depth: 'deep', maxTurns: 30 };

  // Quick: trivial tasks
  if (devPoints <= 3 && fileCount <= 5) return { depth: 'quick', maxTurns: 10 };

  // Standard: everything else
  return { depth: 'standard', maxTurns: 20 };
}
```

---

## 87. METRICS RECORDER (src/metrics/metrics-recorder.js)

```javascript
export async function recordTaskMetrics(taskSpec, metrics) {
  // Record to Firebase: metrics/{projectId}/model-performance/tasks/{taskId}
  const record = {
    taskId: taskSpec.taskId,
    plannerModel: metrics.plannerModel,
    coderModel: metrics.model,
    reviewerModel: metrics.reviewerModel,
    reviewScore: metrics.reviewScore,
    reviewCycles: metrics.reviewCycles,
    durationSeconds: Math.round(metrics.duration / 1000),
    cost: metrics.totalCost,
    completedAt: new Date().toISOString(),
    devPoints: taskSpec.devPoints,
    complexity: taskSpec.complexity,
  };
  // Write to Firebase
}

export async function recordModelPerformance(model, role, score, cost, duration) {
  // Aggregate metrics per model/role for leaderboard
}

export async function recordRoutingOutcome(model, complexity, score) {
  // Track model selection outcomes for smart router
}
```

---

## 88. SECURITY EXTERNAL TOOLS (src/security/external-tools-runner.js)

```javascript
export async function runExternalSecurityTools(cwd) {
  const results = {};

  // npm audit
  try {
    const audit = execSync('npm audit --json', { cwd, encoding: 'utf-8' });
    results.npmAudit = JSON.parse(audit);
  } catch (e) {
    results.npmAudit = { error: e.message };
  }

  // gitleaks (if installed)
  try {
    const gl = execSync('gitleaks detect --source . --report-format json --report-path -', { cwd, encoding: 'utf-8' });
    results.gitleaks = JSON.parse(gl);
  } catch (e) {
    results.gitleaks = null; // Not installed or no findings
  }

  // semgrep (if installed)
  try {
    const sg = execSync('semgrep --config auto --json .', { cwd, encoding: 'utf-8' });
    results.semgrep = JSON.parse(sg);
  } catch (e) {
    results.semgrep = null;
  }

  return results;
}
```

---

## 89. DASHBOARD LEADERBOARD COMPUTATION (lib/leaderboard.ts)

```typescript
export function computeLeaderboard(tasks: TaskRecord[], allowedTaskIds: Set<string> | null): LeaderboardRow[] {
  // Group tasks by (model, role) combination
  // For each group: calculate avg score, avg cycles, avg duration, avg cost, task count
  // Sort by: avg score DESC, then avg cost ASC
  // Return: LeaderboardRow[]
}

export function computeOptimalModels(leaderboard: LeaderboardRow[]): OptimalModel[] {
  // For each role: find model with highest avg score (min 3 tasks)
  // Return: { role, model, avgScore, taskCount, label }
}

export function computeRecommendations(leaderboard: LeaderboardRow[]): ModelRecommendation[] {
  // Find models with similar score but lower cost
  // Example: "Consider Sonnet for Coder (93% of Opus score at 40% cost)"
  // Return: { currentModel, suggestedModel, role, scoreDiff, costSavings }
}
```

---

## 90. ENV VARIABLES QUICK REFERENCE

| Variable | Default | Descripcion |
|----------|---------|-------------|
| CLI_PLANNER | claude | CLI para Planner |
| CLI_CODER | claude | CLI para Coder |
| CLI_REVIEWER | claude | CLI para Reviewer |
| CLI_ARCHITECT | claude | CLI para Architect |
| CLI_QA | claude | CLI para QA |
| CLI_SECURITY | claude | CLI para Security |
| CLI_TESTER | claude | CLI para Tester |
| GOOGLE_APPLICATION_CREDENTIALS | - | Path a serviceAccountKey.json |
| FIREBASE_DATABASE_URL | - | URL de Firebase RTDB |
| DEFAULT_USER_ID | - | UID de Firebase Auth |
| DEFAULT_USER_NAME | Komodo | Nombre del usuario |
| DEFAULT_PROJECT_ID | - | ID del proyecto activo |
| GITHUB_TOKEN | - | Token de GitHub |
| WS_PORT | 3001 | Puerto WebSocket |
| API_PORT | 3002 | Puerto API HTTP |
| API_KEY | komodo-secret-key | Key de autenticacion API |
| MAX_REVIEW_CYCLES | 3 | Max ciclos Reviewer↔Coder |
| AUTO_MERGE | true | Auto-merge PRs aprobadas |
| INCREMENTAL_REVIEW | true | Review solo diff en ciclo 2+ |
| DAILY_BUDGET_USD | 10 | Presupuesto diario |
| WEEKLY_BUDGET_USD | 50 | Presupuesto semanal |
| RATE_LIMIT_FALLBACK | true | Habilitar fallback CLI |
| FALLBACK_CLI_ORDER | claude,codex,gemini | Orden de fallback |
| RATE_LIMIT_COOLDOWN_MINUTES | 15 | Cooldown rate limit |
| AUTONOMY_LEVEL | semi-autonomous | Nivel de autonomia |
| TASK_DECOMPOSITION | true | Descomponer tareas grandes |
| TASK_DECOMPOSITION_THRESHOLD | 8 | devPoints minimos para descomponer |
| PRE_PR_TESTS | true | Tests automaticos pre-PR |
| ENABLE_QA_AGENT | true | Habilitar agente QA |
| ENABLE_TESTER_AGENT | true | Habilitar agente Tester |
| ENABLE_SECURITY_AGENT | true | Habilitar agente Security |
| CI_MONITOR | false | Monitor de CI post-merge |
| AUTO_REVERT | false | Revert automatico si CI falla |
| CANARY_ENABLED | false | Merge canary |
| ENABLE_SONAR | false | Integracion SonarQube |
| ENABLE_BROWSER_MCP | false | Chrome DevTools MCP |
| DAEMON_POLL_INTERVAL | 60000 | Intervalo polling daemon (ms) |
| CODEBASE_INDEX_ENABLED | true | Indexacion de codebase |
| STYLE_DETECTOR_ENABLED | true | Deteccion de estilo |
| MIN_COVERAGE_DELTA | -2 | Delta minimo de cobertura (%) |

---

## FIN DEL DOCUMENTO

Este documento contiene la especificacion completa de Komodo Orchestrator V2.0.
Con esta informacion, una IA puede replicar el sistema completo desde cero.

**Total de componentes:**
- 7 agentes IA especializados
- 4 MCP servers (70+ herramientas)
- 1 dashboard Next.js (8 paginas, 30+ componentes, 15+ API routes)
- 35+ subsistemas (resilience, intelligence, autonomy, etc.)
- 80+ variables de configuracion
- Firebase RTDB con 15+ colecciones
