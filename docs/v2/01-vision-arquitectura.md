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
