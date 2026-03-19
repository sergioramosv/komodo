# KOMODO V2.0 - PLAN DE TAREAS POR FASES

> Todas las tareas van en un **unico sprint**.
> Formato: [Fase.Tarea] - Titulo
> Cada tarea tiene: user story, criterios de aceptacion, devPoints, bizPoints, blockedBy

---

## FASE 1: INFRAESTRUCTURA BASE

### [1.1] Inicializar proyecto y dependencias

**User Story:** Como desarrollador, quiero tener el proyecto Node.js inicializado con todas las dependencias, para poder empezar a construir los modulos.

**Criterios de aceptacion:**
- package.json creado con name "komodo-orchestrator", version "2.0.0", type "module"
- Dependencias instaladas: @modelcontextprotocol/sdk, @xenova/transformers, chalk, commander, dotenv, uuid, ws, zod
- DevDependencies: vitest
- engines: node >= 18
- Scripts: start, dev, test, setup
- .gitignore configurado (node_modules, .env, _debug_*, .komodo/checkpoints, etc.)
- vitest.config.js creado con exclusions
- sonar-project.properties creado

**devPoints:** 2
**bizPoints:** 5

---

### [1.2] Crear sistema de logging (src/utils/logger.js)

**User Story:** Como desarrollador, quiero un logger con colores por agente, para poder identificar rapidamente que agente produce cada output.

**Criterios de aceptacion:**
- Logger con chalk: colores por agente (PLANNER=blue, ARCHITECT=cyan, CODER=green, TESTER=yellow, SECURITY=magenta, REVIEWER=red, KOMODO=white bold)
- Funciones: info(), success(), warn(), error(), taskHeader(), startSpinner(), stopSpinner()
- Timestamps en formato es-ES locale
- Export named: logger

**devPoints:** 1
**bizPoints:** 3

---

### [1.3] Crear parser de respuestas JSON (src/utils/parser.js)

**User Story:** Como sistema, quiero un parser robusto que extraiga JSON de respuestas de agentes IA, para manejar outputs que no son JSON puro.

**Criterios de aceptacion:**
- Funcion parseJSON(text) que intenta: JSON.parse directo, extraer de markdown code blocks, extraer objeto {} del texto
- Retorna null si todo falla (no lanza error)
- Export named: parseJSON

**devPoints:** 1
**bizPoints:** 3

---

### [1.4] Crear validador de respuestas (src/utils/response-validator.js)

**User Story:** Como sistema, quiero validar que las respuestas de agentes tengan los campos requeridos, para detectar respuestas invalidas temprano.

**Criterios de aceptacion:**
- Funcion validateAgentResponse(response, requiredFields) que verifica presencia de campos
- Retorna { valid: boolean, missing: string[] }
- Export named: validateAgentResponse

**devPoints:** 1
**bizPoints:** 2

---

### [1.5] Crear EventBus (src/events/event-bus.js)

**User Story:** Como sistema, quiero un bus de eventos pub/sub global, para comunicar cambios de estado entre componentes sin acoplamiento.

**Criterios de aceptacion:**
- Clase EventBus con metodos on(type, callback), emitEvent(type, metadata)
- Soporte para listener wildcard '*' que recibe todos los eventos
- on() retorna funcion de unsubscribe
- Cada evento tiene: type, timestamp (ISO), metadata
- Singleton exportado: eventBus

**devPoints:** 2
**bizPoints:** 5

---

### [1.6] Crear KomodoState (src/state/komodo-state.js)

**User Story:** Como dashboard, quiero un estado global del orquestador accesible en tiempo real, para mostrar el estado actual al usuario.

**Criterios de aceptacion:**
- Singleton con estado de 6 agentes (PLANNER, ARCHITECT, CODER, TESTER, SECURITY, REVIEWER)
- Cada agente: name, status (idle/walking/working/done), currentTask, startedAt, cli, model, totalCost, completedTasks
- Estado global: phase, executionState, currentTask, taskDetails, currentPR, reviewCycle, totalCost, tasksCompleted, totalTasks
- Subestados: sonarAnalysis, budget, multiProject, lastCompletedTaskContext
- Setters que emiten eventos via eventBus
- requestPause(), requestStop(), isPauseRequested(), isStopRequested()
- toSnapshot() que retorna todo el estado serializable
- reset() que limpia estado

**devPoints:** 3
**bizPoints:** 5
**blockedBy:** [1.5]

---

### [1.7] Crear Checkpoint Manager (src/state/checkpoint-manager.js)

**User Story:** Como sistema, quiero persistir el estado de ejecucion cuando hay rate limit, para poder reanudar desde donde se pauso.

**Criterios de aceptacion:**
- Directorio: .komodo/checkpoints/
- saveCheckpoint(data) - escribe JSON con timestamp
- listPendingCheckpoints() - retorna lista ordenada por fecha (newest first)
- loadCheckpoint(filepath) - lee y parsea JSON
- validateCheckpoint(checkpoint) - verifica taskId, flowStep, no expirado (>24h)
- deleteCheckpoint(filepath) - elimina archivo
- Singleton exportado: checkpointManager

**devPoints:** 2
**bizPoints:** 5

---

### [1.8] Crear Config Loader (src/config.js)

**User Story:** Como sistema, quiero cargar configuracion desde .env y komodo.config.json, para que el usuario pueda configurar todos los aspectos del orquestador.

**Criterios de aceptacion:**
- Lee .env via dotenv
- Lee komodo.config.json si existe (dashboard overrides)
- Parsea MODEL_MAP_* env vars a objeto modelMaps
- Parsea FORCE_MODEL_* env vars a objeto forceModels
- 80+ propiedades: agent CLIs, Firebase, GitHub, servers, review, budget, rate limit, autonomy, testing, CI, canary, sonar, daemon, versioning, intelligence, multi-project, plugins, coverage, webhooks
- Thresholds de complejidad: trivial <= 3, standard <= 6, complex > 6
- validateConfig() verifica CLIs en PATH y Firebase configurado
- cliExists(command) usa which/where segun plataforma
- Export named: config, validateConfig, cliExists

**devPoints:** 5
**bizPoints:** 8
**blockedBy:** [1.1]

---

### [1.9] Crear archivo .env.example

**User Story:** Como desarrollador, quiero un template de .env con todas las variables documentadas, para saber que configurar.

**Criterios de aceptacion:**
- Todas las variables de entorno con valores de ejemplo
- Comentarios explicativos por seccion
- Mismo formato que la seccion 4 del documento V2

**devPoints:** 1
**bizPoints:** 3

---

## FASE 2: RATE LIMIT Y FALLBACK

### [2.1] Crear Rate Limit Detector (src/agents/rate-limit-detector.js)

**User Story:** Como sistema, quiero detectar cuando un CLI esta rate-limited, para poder reaccionar automaticamente.

**Criterios de aceptacion:**
- Patrones regex por CLI: Claude (10 patterns), Codex (extras), Gemini (extras)
- detectRateLimit(text, cli) retorna { detected, matchedPattern }
- parseRetryAfter(text) extrae duracion de 7 formatos diferentes (compound, seconds, HTTP header, "resets Xpm")
- checkAndEmitRateLimit(text, cli, agentName) integra todo: detecta, marca, emite evento
- checkAllClisRateLimited() verifica si todos los CLIs estan limitados

**devPoints:** 3
**bizPoints:** 8

---

### [2.2] Crear Fallback Manager (src/agents/fallback-manager.js)

**User Story:** Como sistema, quiero cambiar automaticamente a otro CLI cuando el principal esta rate-limited, para no detener la ejecucion.

**Criterios de aceptacion:**
- Clase FallbackManager (singleton)
- markRateLimited(cli), isRateLimited(cli) con TTL-based cleanup
- getAvailableFallbackCli(failedCli) recorre fallbackCliOrder
- resolveEffectiveCli(originalCli, agentRole) - API principal, emite AGENT_FALLBACK event
- markRecovered(cli), clear()
- Cooldown configurable via config.rateLimitCooldownMinutes

**devPoints:** 3
**bizPoints:** 8
**blockedBy:** [2.1, 1.5, 1.8]

---

### [2.3] Crear Streaming Watchdog (src/agents/streaming-watchdog.js)

**User Story:** Como sistema, quiero detectar anomalias en el stream de output de agentes en tiempo real, para terminar tempranamente y ahorrar tokens.

**Criterios de aceptacion:**
- Clase StreamingWatchdog con 7 detectores:
  1. Reviewer early approval (APPROVED en primeros 3K chars)
  2. Tool loop (5+ misma tool consecutiva)
  3. Excessive tool calls (20+ sin texto)
  4. Watchdog alert (8K+ tokens sin tool call - solo alerta)
  5. No-access detector
  6. Wandering (5K+ tokens sin code block)
  7. Wrong language detector
- feed(msg, rawOutput) procesa cada linea JSON
- _kill(reason, description) termina proceso y emite eventos
- Getters: terminated, terminationReason, tokensSavedEstimate
- Token estimation: ~4 chars per token

**devPoints:** 5
**bizPoints:** 8

---

### [2.4] Crear Multi-Part Filter (src/agents/multi-part-filter.js)

**User Story:** Como sistema, quiero detectar tareas multi-parte como "(2/4)" y bloquear partes posteriores si las anteriores no estan completadas.

**Criterios de aceptacion:**
- getUnresolvedPreviousParts(task, allTasks) detecta patrones: (N/M), (Part N of M), [N/M], (N of M)
- Part 1 nunca bloqueada
- Retorna array de IDs de partes no resueltas

**devPoints:** 2
**bizPoints:** 3

---

## FASE 3: AGENTE BASE

### [3.1] Crear Base Agent (src/agents/base-agent.js)

**User Story:** Como sistema, quiero una infraestructura comun para ejecutar cualquier agente IA como subproceso CLI, para no duplicar logica de spawn/stdin/parsing.

**Criterios de aceptacion:**
- CLI Adapters para Claude, Codex, Gemini (buildArgs, buildStdin, parseOutput cada uno)
- buildMcpServers(serverNames) genera config JSON temporal para: planning-task-mcp, github-mcp, memory-mcp, chrome-devtools
- spawnCli(command, args, options) con idle timeout, total timeout, AbortSignal, callbacks per-line
- shell: true para Windows
- runAgent(options) funcion principal con: resolve CLI fallback, build MCP config, build args/stdin, create watchdog, spawn, parse, check rate limit, cleanup temp files
- Debug files: _debug_{AGENT}_stdout.txt / stderr.txt
- Return: { success, result, cost, turns, duration, earlyTerminated, rateLimited, error }

**devPoints:** 8
**bizPoints:** 13
**blockedBy:** [2.1, 2.2, 2.3, 1.5, 1.8]

---

## FASE 4: SYSTEM PROMPTS

### [4.1] Crear Planner System Prompt (src/prompts/planner-system.js)

**User Story:** Como Planner agent, quiero un system prompt que me instruya a seleccionar tareas del backlog inteligentemente.

**Criterios de aceptacion:**
- Prompt completo con reglas de seleccion, formato JSON de respuesta, naming de branches
- Export: getPlannerSystemPrompt()

**devPoints:** 2
**bizPoints:** 5

---

### [4.2] Crear Architect System Prompt (src/prompts/architect-system.js)

**User Story:** Como Architect agent, quiero un system prompt que me instruya a generar planes de implementacion estructurados.

**Criterios de aceptacion:**
- Prompt con instrucciones de analisis, formato JSON (filesToCreate, filesToModify, risks, implementationOrder)
- Export: getArchitectSystemPrompt()

**devPoints:** 2
**bizPoints:** 5

---

### [4.3] Crear Coder System Prompt (src/prompts/coder-system.js)

**User Story:** Como Coder agent, quiero system prompts para implementacion y correccion de issues.

**Criterios de aceptacion:**
- Prompt principal: flujo branch→implement→commit→PR, formato JSON response
- Prompt fix: leer solo archivos mencionados, fix→commit→push, formato JSON response
- Exports: getCoderSystemPrompt(), getCoderFixSystemPrompt()

**devPoints:** 2
**bizPoints:** 5

---

### [4.4] Crear Reviewer System Prompt (src/prompts/reviewer-system.js)

**User Story:** Como Reviewer agent, quiero system prompts con 8 criterios estrictos y variantes por profundidad.

**Criterios de aceptacion:**
- 8 criterios: correctness, error handling, edge cases, naming, structure, tests, security, patterns
- Variantes: quick (criterios 1,7), standard (1-5), deep (1-8), forensic (linea por linea)
- Score 0-10, reglas de APPROVED vs REQUEST_CHANGES
- Formato JSON con verdict, score, issues[], positives[], summary
- Exports: getReviewerSystemPrompt(depth)

**devPoints:** 3
**bizPoints:** 5

---

### [4.5] Crear QA System Prompt (src/prompts/qa-system.js)

**User Story:** Como QA agent, quiero un prompt que me instruya a generar y ejecutar tests de aceptacion.

**Criterios de aceptacion:**
- Instrucciones: detectar framework, generar tests por criteria, ejecutar, distinguir bugs del Coder
- Formato JSON response con testsGenerated, testsPassed, failedTests
- Export: getQASystemPrompt()

**devPoints:** 2
**bizPoints:** 3

---

### [4.6] Crear Security System Prompt (src/prompts/security-system.js)

**User Story:** Como Security agent, quiero un prompt con checklist OWASP Top 10 para escanear codigo.

**Criterios de aceptacion:**
- Checklist OWASP completo
- Instrucciones de analisis por archivo
- Verdict: PASS/WARN/BLOCK con criterios claros
- Formato JSON response
- Export: getSecuritySystemPrompt()

**devPoints:** 2
**bizPoints:** 5

---

### [4.7] Crear Tester System Prompt (src/prompts/tester-system.js)

**User Story:** Como Tester agent, quiero un prompt que me instruya a generar tests quirurgicos usando Knowledge Graph.

**Criterios de aceptacion:**
- Instrucciones para usar contexto de Architect y Coder
- Tests por: criteria, happy path, error path, edge cases, riesgos
- Formato JSON con coverage percentage
- Export: getTesterSystemPrompt()

**devPoints:** 2
**bizPoints:** 3

---

## FASE 5: AGENTES INDIVIDUALES

### [5.1] Crear Planner Agent (src/agents/planner.js)

**User Story:** Como sistema, quiero un agente que seleccione la siguiente tarea del backlog usando ranking inteligente.

**Criterios de aceptacion:**
- fetchProjectTasks(projectId) obtiene tareas de Firebase
- filterBlockedTasks(todoTasks, allTasks) separa eligible vs blocked (dependencias + multi-part)
- pickNextTask(projectId, options) con flujo completo: fetch → check in-progress → filter → enrich (complexity, tokens, efficiency) → context affinity → sort → run agent → validate
- Sort: sprint order ASC, efficiency DESC
- Return: { taskId, title, branchName, repoUrl, userStory, acceptanceCriteria, devPoints, bizPoints, sprintId }

**devPoints:** 5
**bizPoints:** 8
**blockedBy:** [3.1, 4.1, 2.4]

---

### [5.2] Crear Architect Agent (src/agents/architect.js)

**User Story:** Como sistema, quiero un agente que analice el codebase y genere un plan de implementacion.

**Criterios de aceptacion:**
- analyzeTask(taskSpec, cwd, options) ejecuta agente read-only
- Sin MCPs (solo filesystem)
- idleTimeout 5 min, maxTurns 20
- Valida respuesta: filesToCreate, filesToModify, implementationOrder
- Return: { success, plan, cost, duration }

**devPoints:** 3
**bizPoints:** 5
**blockedBy:** [3.1, 4.2]

---

### [5.3] Crear Coder Agent (src/agents/coder.js)

**User Story:** Como sistema, quiero un agente que implemente codigo, cree branches y abra PRs.

**Criterios de aceptacion:**
- implementTask(taskSpec, cwd, options) con inyeccion de contexto: architect plan, codebase index, style guide, review feedback, coding guidelines, knowledge context
- Static prefix para prompt caching
- MCPs: github-mcp, planning-task-mcp
- totalTimeout 15 min, maxTurns 50
- fixReviewIssues(taskSpec, prNumber, reviewFeedback, cwd, options) con diff-only context
- Helpers: extractOwnerRepo(), extractFilesFromIssues()
- Return implementTask: { success, pr: { prNumber, prUrl, branchName, filesChanged, summary } }
- Return fixReviewIssues: { success, fix: { fixed, issuesResolved, issuesNotResolved, filesChanged, summary } }

**devPoints:** 5
**bizPoints:** 13
**blockedBy:** [3.1, 4.3]

---

### [5.4] Crear Reviewer Agent (src/agents/reviewer.js)

**User Story:** Como sistema, quiero un agente que revise PRs con 8 criterios estrictos y soporte incremental review.

**Criterios de aceptacion:**
- reviewPR(options) con parametros completos: sonarReport, coverageReport, qaReport, securityReport, reviewCycle, lastReviewSHA, pluginIssues, knowledgeContext
- Seleccion automatica de review depth (quick/standard/deep/forensic)
- Incremental review en ciclo 2+ (diff-only desde lastReviewSHA)
- Build prompt sections: acceptance criteria, sonar, coverage, QA, security, guidelines, plugins
- disallowedTools: Write, Edit, NotebookEdit (read-only)
- normalizeVerdict() con reglas de consenso: quality gate, coverage, score >= 8, no critical/major
- Early termination via watchdog (APPROVED en 3K chars)
- MCPs: github-mcp, memory-mcp
- Return: { success, review: { verdict, score, issues[], positives[], summary }, reviewSHA, reviewDepth, ... }

**devPoints:** 8
**bizPoints:** 13
**blockedBy:** [3.1, 4.4]

---

### [5.5] Crear QA Agent (src/agents/qa.js)

**User Story:** Como sistema, quiero un agente que genere y ejecute tests de aceptacion automaticamente.

**Criterios de aceptacion:**
- runQAAgent(options) con taskSpec, filesChanged, branchName, repo, prNumber
- Distingue bugs del Coder (failsCoderCode: true) vs tests mal escritos
- maxTurns 30, totalTimeout 600s
- Emite QA_TESTS_GENERATED event
- Return: { success, qa: { testsGenerated, testsPassed, testsFailed, filesCreated, pushed, failedTests, summary } }

**devPoints:** 3
**bizPoints:** 5
**blockedBy:** [3.1, 4.5]

---

### [5.6] Crear Tester Agent (src/agents/tester.js)

**User Story:** Como sistema, quiero un agente que genere tests quirurgicos usando contexto del Knowledge Graph.

**Criterios de aceptacion:**
- runTesterAgent(options) con Knowledge Graph context (architect plan + coder decisions)
- Coverage percentage tracked
- Soporte AbortSignal para cancelacion
- Emite TESTER_TESTS_GENERATED event
- Return: { success, tester: { testsGenerated, testsPassed, testsFailed, coverage, ... } }

**devPoints:** 3
**bizPoints:** 5
**blockedBy:** [3.1, 4.7]

---

### [5.7] Crear Security Agent (src/agents/security-agent.js)

**User Story:** Como sistema, quiero un agente que escanee vulnerabilidades OWASP con herramientas externas + LLM.

**Criterios de aceptacion:**
- runSecurityAgent(options) ejecuta tools externos primero: npm audit, gitleaks, semgrep
- Inyecta findings como contexto al LLM
- Verdict computado independientemente del LLM (prevent hallucination): CRITICAL/HIGH→BLOCK, MEDIUM→WARN, LOW→PASS
- Emite SECURITY_SCAN_COMPLETE y SECURITY_SCAN_BLOCKED events
- Return: { success, security: { verdict, findings[], summary, counts }, toolResults }

**devPoints:** 5
**bizPoints:** 8
**blockedBy:** [3.1, 4.6]

---

## FASE 6: CICLO DE EJECUCION

### [6.1] Crear Incremental Review (src/cycle/incremental-review.js)

**User Story:** Como sistema, quiero generar diffs incrementales entre reviews, para ahorrar tokens en ciclos de correccion.

**Criterios de aceptacion:**
- buildIncrementalContext(lastReviewSHA, currentSHA, fullDiff) genera diff entre SHAs
- Si no hay SHA anterior, retorna full diff
- Calcula tokens ahorrados y porcentaje de reduccion
- Return: { incrementalDiff, isIncremental, tokensSaved, reductionPercent }

**devPoints:** 2
**bizPoints:** 5

---

### [6.2] Crear Review Loop (src/cycle/review-loop.js)

**User Story:** Como sistema, quiero un ciclo Reviewer↔Coder que repita hasta aprobacion o max ciclos.

**Criterios de aceptacion:**
- reviewLoop(options) con max cycles configurable
- Ciclo: review → check verdict → (fix + re-sonar) → repeat
- Auto-escalation en ciclo 1 si score < threshold
- Incremental review en ciclo 2+
- Knowledge context solo en ciclo 1
- Record patterns en memory
- Emite REVIEW_CYCLE_START, MODEL_ESCALATED, COST_UPDATED events
- Return: { approved, cycles, finalReview, cost, sonarReport, depthBreakdown }

**devPoints:** 5
**bizPoints:** 13
**blockedBy:** [5.3, 5.4, 6.1]

---

### [6.3] Crear Task Runner (src/cycle/task-runner.js)

**User Story:** Como sistema, quiero un pipeline completo que ejecute una tarea desde seleccion hasta merge en 12 fases.

**Criterios de aceptacion:**
- runTask(projectId, cwd) con 12 fases: planning, triage, decompose, architecting, coding, testing, security, pre-PR tests, sonarqube, review loop, merge, post-merge
- QA + Tester en paralelo (Promise.all)
- State updates (phase, agent states) en cada fase
- Event emissions en cada transicion
- Checkpoint on rate limit
- Post-merge: version bump, changelog, CI monitor, tech debt
- Record metrics al finalizar
- runTaskDryRun(projectId) para simulacion
- resumeTask(checkpoint, cwd) para reanudar (switch por flowStep)
- Return: { success, taskId, totalCost, cycles }

**devPoints:** 13
**bizPoints:** 13
**blockedBy:** [5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 6.2]

---

### [6.4] Crear Pipeline Scheduler (src/cycle/pipeline-scheduler.js)

**User Story:** Como sistema, quiero ejecutar agentes independientes en paralelo para optimizar tiempo.

**Criterios de aceptacion:**
- runParallelAgents(agents, options) con maxConcurrent
- Separar parallel vs sequential groups
- AbortController para cancelacion
- Return: results por agente

**devPoints:** 3
**bizPoints:** 5

---

## FASE 7: ORQUESTACION

### [7.1] Crear Orchestrator (src/orchestrator.js)

**User Story:** Como sistema, quiero el motor principal que coordina el loop de tareas con lifecycle de servidores.

**Criterios de aceptacion:**
- run(projectId, options) con dry-run y real execution
- Loop principal: check pause/stop/budget → runTask → handle result
- Iniciar/detener: WS server, API server, heartbeat, budget manager, resilience manager
- Registrar shutdown hooks
- resume(options) para reanudar checkpoints
- checkForPendingCheckpoints(options) con auto-resume opcional
- Exports: run, resume, checkForPendingCheckpoints, eventBus, komodoState, checkpointManager

**devPoints:** 5
**bizPoints:** 13
**blockedBy:** [6.3, 1.6, 1.7]

---

### [7.2] Crear CLI Entry Point (src/index.js)

**User Story:** Como usuario, quiero ejecutar Komodo desde la linea de comandos con diferentes modos.

**Criterios de aceptacion:**
- Commander.js con comandos: run, resume, watch, multi, setup, doctor, dashboard
- resolveProjectIdFromEnv() para resolver project ID
- Graceful shutdown con SIGINT/SIGTERM handlers
- Auto-doctor antes de run
- Check checkpoints antes de run

**devPoints:** 3
**bizPoints:** 8
**blockedBy:** [7.1]

---

### [7.3] Crear Setup Wizard (src/setup.js)

**User Story:** Como usuario nuevo, quiero un wizard interactivo que me guie para configurar Komodo.

**Criterios de aceptacion:**
- 12 pasos interactivos con readline
- Verificacion de prerequisites
- Genera .env completo
- npm install en root + skills
- Registro MCP global via claude mcp add
- Auto-approve permisos en settings.local.json

**devPoints:** 5
**bizPoints:** 5
**blockedBy:** [1.8]

---

## FASE 8: MCP SERVERS

> **NOTA:** planning-task-mcp es un subrepo independiente de GitHub y ya esta creado. No se incluye aqui.

### [8.1] Crear GitHub-MCP (skills/github-mcp/)

**User Story:** Como MCP server, quiero 10 herramientas de GitHub via gh CLI.

**Criterios de aceptacion:**
- package.json, config.js (validateConfig), gh-cli.js (runGh, runGit, runGhApi)
- Branch tools: create_branch (local o remoto), list_branches
- PR tools: create_pr, get_pr, get_pr_diff, list_pr_files
- Review tools: create_review (APPROVE/REQUEST_CHANGES/COMMENT + inline comments), list_pr_comments
- Merge tools: merge_pr (squash/merge/rebase + delete branch), close_pr
- Timeout 30s, error handling claro

**devPoints:** 5
**bizPoints:** 13

---

### [8.2] Crear Memory-MCP (skills/memory-mcp/)

**User Story:** Como MCP server, quiero memoria persistente con busqueda semantica.

**Criterios de aceptacion:**
- package.json con firebase-admin, google-auth-library, uuid
- Local store (patterns.json) + Firebase store opcional
- Vertex AI embeddings (text-embedding-004, 768 dims, cache SHA-256)
- Tools: record_pattern (upsert con frequency), query_patterns (text + semantic), get_review_brief, record_review_outcome, get_stats, get_relevant_memory (cosine similarity + file boost)
- Atomic file writes (tmp + rename)

**devPoints:** 8
**bizPoints:** 8

---

### [8.3] Crear Komodo-MCP (skills/komodo-mcp/)

**User Story:** Como MCP server, quiero exponer el orquestador Komodo como herramientas MCP.

**Criterios de aceptacion:**
- package.json con @modelcontextprotocol/sdk, zod
- 8 herramientas: komodo_plan, komodo_code, komodo_review, komodo_fix, komodo_finalize, komodo_run, komodo_resume, komodo_status
- Event forwarding a WS server y dashboard API
- Rate limit handling con checkpoint
- changeTaskStatus helper directo a Firebase
- INSTRUCTIONS.md con reglas de uso
- Carga .env desde KOMODO_ROOT

**devPoints:** 8
**bizPoints:** 13
**blockedBy:** [7.1, 8.1]

---

## FASE 9: SUBSISTEMAS

### [9.1] Crear Triage: Complexity Classifier + Model Selector (src/triage/)

**User Story:** Como sistema, quiero clasificar tareas por complejidad y seleccionar el modelo optimo automaticamente.

**Criterios de aceptacion:**
- complexity-classifier.js: classifyComplexity(taskSpec) retorna trivial/standard/complex
- model-selector.js: selectModel(role, complexity) consulta forceModels y modelMaps
- smart-model-router.js: epsilon-greedy routing con historico Firebase
- task-decomposer.js: decomposeTask() divide tareas grandes (>threshold devPoints)

**devPoints:** 5
**bizPoints:** 8
**blockedBy:** [1.8]

---

### [9.2] Crear Intelligence: Codebase Indexer + Style Detector (src/intelligence/)

**User Story:** Como sistema, quiero indexar el codebase y detectar estilo de codigo automaticamente.

**Criterios de aceptacion:**
- codebase-indexer.js: scan src/, generar resumen, cache 5 min, max 2000 tokens
- style-detector.js: detectar naming, spacing, patterns, imports → reglas obligatorias
- codebase-learner.js: extraer patterns de tareas completadas, persistir a Firebase
- review-feedback.js: top issues por frequency con time-decay
- cross-project-intelligence.js: sync patterns entre proyectos (threshold 0.6)

**devPoints:** 5
**bizPoints:** 8

---

### [9.3] Crear Knowledge Graph (src/knowledge/knowledge-graph.js)

**User Story:** Como sistema, quiero almacenar y recuperar conocimiento por tarea para enriquecer agentes.

**Criterios de aceptacion:**
- Almacena: coderBrief, reviewerBrief, moduleLessons, testingPatterns
- Scoped por module/file path
- Carga lessons basado en archivos del taskSpec
- Registra patterns de reviews exitosos
- Storage: JSON local + Firebase

**devPoints:** 3
**bizPoints:** 5

---

### [9.4] Crear Autonomy Engine (src/autonomy/)

**User Story:** Como sistema, quiero controlar el nivel de autonomia del orquestador con gates dinamicos.

**Criterios de aceptacion:**
- autonomy-engine.js: 4 niveles (supervised, semi-autonomous, autonomous, guardian)
- guardian-gates.js: triggers dinamicos (diff >500 lines, security files, >3 cycles, DB migration, deps changed)
- approval-gate.js: waitForApproval() con timeout configurable
- approval-channels.js: soporte dashboard + API

**devPoints:** 5
**bizPoints:** 5
**blockedBy:** [1.5, 1.8]

---

### [9.5] Crear Resilience (src/resilience/)

**User Story:** Como sistema, quiero patrones de resiliencia para manejar fallos de servicios externos.

**Criterios de aceptacion:**
- circuit-breaker.js: estados CLOSED→OPEN→HALF_OPEN, thresholds por servicio (firebase=5, github=3, cli=4), cooldown 60s
- error-budget.js: tasa de fallos en ventana 30min, max 30%, auto-pause
- dead-letter-queue.js: cola de operaciones fallidas, retry exponential (1s,2s,4s), max 3
- resilience-manager.js: coordinador principal

**devPoints:** 5
**bizPoints:** 8

---

### [9.6] Crear Self-Healing (src/self-healing/)

**User Story:** Como sistema, quiero recuperacion automatica de errores comunes.

**Criterios de aceptacion:**
- healing-engine.js: strategy-based recovery con 6 estrategias
- strategies/: rate-limit, github-api-error, merge-conflict, test-failure, agent-timeout, firebase-down
- flaky-test-registry.js: track tests inestables, retry 3x, persistir a Firebase

**devPoints:** 5
**bizPoints:** 8
**blockedBy:** [9.5]

---

### [9.7] Crear Cost: Budget Manager (src/cost/budget-manager.js)

**User Story:** Como sistema, quiero tracking de presupuesto diario/semanal con auto-pause.

**Criterios de aceptacion:**
- Initialize desde Firebase, reset daily/weekly
- addCost(), isExceeded()
- Warning a 80% threshold (configurable)
- Persist a Firebase
- Emite BUDGET_WARNING, BUDGET_EXCEEDED events

**devPoints:** 3
**bizPoints:** 8
**blockedBy:** [1.5, 1.8]

---

### [9.8] Crear Estimation: Token Estimator + Rate Limit Tracker (src/estimation/)

**User Story:** Como sistema, quiero estimar tokens por tarea y trackear ventana de rate limit.

**Criterios de aceptacion:**
- token-estimator.js: bases trivial=8K, standard=25K, complex=60K, phase breakdown
- rate-limit-tracker.js: token window 5min, headroom calculation, preemptive wait

**devPoints:** 3
**bizPoints:** 5

---

## FASE 10: FEATURES AVANZADOS

### [10.1] Crear Daemon Mode + Scheduler (src/daemon/ + src/scheduler/)

**User Story:** Como sistema, quiero ejecucion continua 24/7 con ventanas horarias configurables.

**Criterios de aceptacion:**
- daemon.js: clase Daemon con polling continuo, respeta schedule, budget tracking, max tasks
- scheduler.js: isInScheduleWindow() parsea "HH:MM-HH:MM,HH:MM-HH:MM" con timezone
- Emite DAEMON_STARTED, DAEMON_IDLE, DAEMON_TASK_DETECTED, DAEMON_STOPPED

**devPoints:** 5
**bizPoints:** 5
**blockedBy:** [7.1]

---

### [10.2] Crear Heartbeat Monitor (src/heartbeat/heartbeat-monitor.js)

**User Story:** Como sistema, quiero pings periodicos a CLIs rate-limited para detectar recuperacion.

**Criterios de aceptacion:**
- Ping cada 5 min a CLIs rate-limited
- Si responde OK: markRecovered() y emite CLI_RECOVERED event

**devPoints:** 2
**bizPoints:** 5
**blockedBy:** [2.2]

---

### [10.3] Crear CI Monitor + Canary Merge (src/ci-monitor/ + src/canary/)

**User Story:** Como sistema, quiero monitorear CI post-merge y soportar estrategia canary.

**Criterios de aceptacion:**
- ci-monitor.js: watch GitHub Actions, poll status, auto-revert si falla + AUTO_REVERT=true
- canary-merge.js: merge a staging → wait stability → promote a main
- conflict-detector.js: detectar conflictos pre-merge

**devPoints:** 5
**bizPoints:** 5
**blockedBy:** [8.1]

---

### [10.4] Crear SonarQube Integration (src/sonar/analyzer.js)

**User Story:** Como sistema, quiero integracion con SonarQube para quality gates automaticos.

**Criterios de aceptacion:**
- analyzeSonar(cwd, branchName) ejecuta scanner, espera resultados, fetch quality gate
- Return: { qualityGate, bugs, vulnerabilities, codeSmells, coverage, issues[] }
- Bloquea merge si qualityGate === 'ERROR'

**devPoints:** 3
**bizPoints:** 5
**blockedBy:** [1.8]

---

### [10.5] Crear Testing: Pre-PR Tests + Coverage Analyzer (src/testing/ + src/coverage/)

**User Story:** Como sistema, quiero tests automaticos pre-PR y analisis de delta de cobertura.

**Criterios de aceptacion:**
- pre-pr-tests.js: auto-detect test command, ejecutar, retornar passed/failed
- coverage-analyzer.js: check delta vs MIN_COVERAGE_DELTA, bloquear si excede, record baseline

**devPoints:** 3
**bizPoints:** 5

---

### [10.6] Crear Versioning (src/versioning/)

**User Story:** Como sistema, quiero semantic versioning automatico con changelog y releases.

**Criterios de aceptacion:**
- version-bumper.js: lee/escribe package.json, bump patch/minor/major
- changelog-generator.js: genera CHANGELOG.md entry por tipo (features, fixes, breaking)
- release-manager.js: crea GitHub Release via gh CLI
- release-gate.js: verifica no blocking bugs antes de release

**devPoints:** 5
**bizPoints:** 5
**blockedBy:** [8.1]

---

### [10.7] Crear Tech Debt + Auto-Improve (src/tech-debt/ + src/auto-improve/)

**User Story:** Como sistema, quiero trackear deuda tecnica y sugerir mejoras automaticamente.

**Criterios de aceptacion:**
- tech-debt-tracker.js: crear tareas de minor review issues
- auto-improve.js: sugerir mejoras cuando backlog vacio (max 5 propuestas)
- codebase-analyzer.js: detectar dead code, unused imports
- dependency-checker.js: npm audit + npm outdated periodico (24h)

**devPoints:** 5
**bizPoints:** 5

---

### [10.8] Crear Multi-Project (src/multi-project/)

**User Story:** Como sistema, quiero orquestar multiples repositorios simultaneamente.

**Criterios de aceptacion:**
- multi-project-runner.js: 3 estrategias (round-robin, priority, backlog-size)
- project-loader.js: cargar configs desde PROJECTS env

**devPoints:** 3
**bizPoints:** 5
**blockedBy:** [7.1]

---

### [10.9] Crear Integrations (src/integrations/)

**User Story:** Como sistema, quiero sincronizar GitHub Issues con el backlog y forwarding de webhooks.

**Criterios de aceptacion:**
- github-issue-sync.js: poll issues con label "komodo", crear tareas, interval 5 min
- pr-comment-bugs.js: detectar "@komodo bug:", crear bugs, interval 3 min
- webhook-outgoing.js: forward eventos a URLs externas, max 3 retries

**devPoints:** 5
**bizPoints:** 5
**blockedBy:** [1.5]

---

### [10.10] Crear Plugin System (src/plugins/)

**User Story:** Como sistema, quiero soporte para plugins custom con hooks before-review y after-code.

**Criterios de aceptacion:**
- plugin-loader.js: carga desde PLUGINS_DIR, cada plugin exporta { name, version, hooks }
- plugin-interface.js: hooks reciben context, retornan issues[]
- Issues de plugins inyectados como MANDATORY en review

**devPoints:** 3
**bizPoints:** 3

---

### [10.11] Crear Observability (src/observability/ + src/metrics/)

**User Story:** Como sistema, quiero observabilidad completa: anomalias, timelines y decision explanation.

**Criterios de aceptacion:**
- anomaly-detector.js: detectar token spike, review regression, model degradation
- task-timeline.js: almacenar fases, duraciones, costos por tarea
- explain-decision.js: explicar seleccion de tarea, rechazo de PR, seleccion de modelo
- metrics-recorder.js: recordTaskMetrics, recordModelPerformance, recordRoutingOutcome

**devPoints:** 5
**bizPoints:** 5
**blockedBy:** [1.5]

---

## FASE 11: SERVIDORES

### [11.1] Crear WebSocket Server (src/server/ws-server.js)

**User Story:** Como dashboard, quiero recibir actualizaciones en tiempo real via WebSocket.

**Criterios de aceptacion:**
- WebSocketServer en WS_PORT (3001)
- Snapshot completo al conectar
- Forward todos los eventos a clients conectados
- Recibir comandos: pause, stop, approve, reject
- command:ack response

**devPoints:** 3
**bizPoints:** 8
**blockedBy:** [1.5, 1.6]

---

### [11.2] Crear API Server (src/server/api-server.js)

**User Story:** Como sistema externo, quiero controlar Komodo via HTTP API.

**Criterios de aceptacion:**
- HTTP server en API_PORT (3002)
- Auth: X-Komodo-Key header
- CORS headers
- Endpoints: /api/run, /api/stop, /api/pause, /api/task, /api/status, /api/event
- Observability endpoints: /api/observability/timeline, explain, tasks, alerts, replay

**devPoints:** 5
**bizPoints:** 5
**blockedBy:** [1.5, 1.6]

---

### [11.3] Crear Shutdown Manager + Doctor (src/shutdown/ + src/doctor/)

**User Story:** Como sistema, quiero shutdown graceful y diagnosticos de salud.

**Criterios de aceptacion:**
- shutdown-manager.js: register(name, cleanupFn), shutdown() ejecuta todos los hooks
- doctor.js: health checks (Node, git, gh, CLIs, Firebase, npm, MCPs), silent mode + verbose mode

**devPoints:** 3
**bizPoints:** 5

---

## FASE 12: DASHBOARD

### [12.1] Inicializar Dashboard Next.js

**User Story:** Como desarrollador, quiero el proyecto Next.js configurado con todas las dependencias.

**Criterios de aceptacion:**
- package.json con next 15, react 19, tailwind 4, recharts, lucide, firebase-admin, vitest
- tsconfig.json con strict mode
- next.config.ts, postcss.config.mjs, vitest.config.ts
- app/layout.tsx: dark mode, sidebar + main, providers
- app/globals.css: tailwind imports + animaciones (agent avatar, toast)
- Sin dependencias de Three.js ni pixel art

**devPoints:** 3
**bizPoints:** 5

---

### [12.2] Crear Types + Firebase Client (dashboard/lib/)

**User Story:** Como dashboard, quiero tipos TypeScript completos y cliente Firebase.

**Criterios de aceptacion:**
- types.ts: AgentName, AgentStatus, Phase, ExecutionState, KomodoSnapshot, AgentState, TaskDetails, SonarAnalysisState, CliHealth, BudgetState, MultiProjectState, DashboardEvent, KomodoNotification, HistoryEntry, WsMessage
- config-types.ts: CliProvider, AgentModel, KomodoConfig, CLI_MODELS, DEFAULT_CONFIG
- memory-types.ts: Pattern, ReviewOutcome, MemoryStore, MemoryStats
- firebase.ts: getDb() con credential discovery (4 rutas)
- leaderboard.ts: computeLeaderboard, computeOptimalModels, computeRecommendations

**devPoints:** 5
**bizPoints:** 5

---

### [12.3] Crear Hooks del Dashboard

**User Story:** Como dashboard, quiero hooks de WebSocket, agent states y notificaciones.

**Criterios de aceptacion:**
- useKomodoSocket.ts: connect, auto-reconnect, snapshot state, events, agentLogs (max 200), cliHealth, sendCommand, localStorage persistence
- useAgentStates.ts: derive visual states + activity descriptions
- useNotifications.ts: event-based notifications, budget warnings, markRead/clearAll
- useHistoryPersist.ts: history persistence utility

**devPoints:** 8
**bizPoints:** 8
**blockedBy:** [12.2]

---

### [12.4] Crear Dashboard Home Page (app/page.tsx)

**User Story:** Como usuario, quiero ver el estado completo del orquestador en tiempo real.

**Criterios de aceptacion:**
- Current Task Card con titulo, puntos, developer, sprint, PR link
- Phase Indicator con barra de progreso
- Agent Cards Grid (6 agentes con status, CLI, model, cost)
- Execution Controls (pause/stop)
- Budget Widget
- Event Timeline (ultimos 20)
- SonarQube Status
- Agent Cost Breakdown
- Task Detail Modal (click on task)

**devPoints:** 8
**bizPoints:** 8
**blockedBy:** [12.3]

---

### [12.5] Crear Agents Page (app/agents/page.tsx)

**User Story:** Como usuario, quiero ver detalle individual de cada agente con logs en tiempo real.

**Criterios de aceptacion:**
- Grid de 6 agentes + KOMODO card
- Panel de detalle con tabs: Live Log Terminal + Event History
- Stats: elapsed time, cost, turns, tasks completed
- Model badges, status indicators
- Colores por agente

**devPoints:** 5
**bizPoints:** 5
**blockedBy:** [12.3]

---

### [12.6] Crear Analytics + Leaderboard Pages

**User Story:** Como usuario, quiero graficos de analytics y rankings de modelos.

**Criterios de aceptacion:**
- Analytics: 5 charts (velocity, cost, review rate, duration/complexity, model usage) + filtros
- Leaderboard: tabla rankeada, optimal models, cost recommendations + filtros
- Componentes analytics/: velocity-chart, cost-chart, review-pass-rate-chart, duration-complexity-chart, model-usage-chart, model-leaderboard-table, analytics-filters, leaderboard-filters

**devPoints:** 8
**bizPoints:** 5
**blockedBy:** [12.2]

---

### [12.7] Crear History + Memory + Notifications Pages

**User Story:** Como usuario, quiero historial de ejecucion, patrones de memoria y notificaciones.

**Criterios de aceptacion:**
- History: timeline agrupada por fecha, filtros (date presets, action, agent), task modal
- Memory: stats, distribution chart, top 10 bar chart, tabla expandible con filtros, clear button
- Notifications: lista con badges, mark read, filtros por tipo

**devPoints:** 8
**bizPoints:** 5
**blockedBy:** [12.3]

---

### [12.8] Crear Settings Page (app/settings/page.tsx)

**User Story:** Como usuario, quiero configurar agentes, presupuesto y proyecto desde el dashboard.

**Criterios de aceptacion:**
- Active project selector
- Coding guidelines textarea (2000 chars)
- Per-agent config: CLI toggle (claude/codex/gemini), model dropdown, max turns
- Orchestrator: max review cycles, budget limit, continuous mode
- CLI health status display
- Save con validacion

**devPoints:** 5
**bizPoints:** 5
**blockedBy:** [12.2]

---

### [12.9] Crear Dashboard API Routes

**User Story:** Como dashboard, quiero API routes server-side para config, history, projects y analytics.

**Criterios de aceptacion:**
- GET/PUT /api/config → komodo.config.json
- GET /api/projects → Firebase filtered
- GET/POST /api/history → Firebase komodo-history
- GET /api/tasks/{taskId} → Firebase with resolved names
- GET/DELETE /api/memory → patterns.json
- GET /api/schedule → parse SCHEDULE env
- GET /api/projects/{id}/analytics → velocity, cost, review, duration, model
- GET /api/projects/{id}/model-leaderboard → rankings
- GET/PUT /api/projects/{id}/coding-guidelines → Firebase
- GET /api/projects/{id}/tech-debt → debt items
- GET /api/projects/{id}/coverage-trend → coverage history
- GET /api/projects/{id}/budget-history → daily spending
- GET /api/projects/{id}/estimation-metrics → estimation accuracy

**devPoints:** 8
**bizPoints:** 8
**blockedBy:** [12.2]

---

### [12.10] Crear Componentes Core del Dashboard

**User Story:** Como dashboard, quiero todos los componentes UI reutilizables.

**Criterios de aceptacion:**
- sidebar.tsx: 8 menu items + notification badge
- connection-status.tsx: dot + label
- execution-controls.tsx: pause/stop con confirmacion
- task-detail-modal.tsx: modal completo con Firebase fetch
- budget-widget.tsx: costo + barras progress
- cli-health-status.tsx: 3 cards con status
- project-selector.tsx: dropdown
- multi-project-overview.tsx: stats por proyecto
- toast-notifications.tsx: container max 5, auto-dismiss 5s
- agent-avatar.tsx: SVG animado
- budget-history.tsx, coverage-trend.tsx, estimation-chart.tsx

**devPoints:** 8
**bizPoints:** 5
**blockedBy:** [12.2]

---

## FASE 13: EVENT PERSISTENCE + SMART ORDERING + REVIEW DEPTH

### [13.1] Crear Event Persistence (src/events/event-persistence.js)

**User Story:** Como sistema, quiero persistir eventos en Firebase para analytics historico.

**Criterios de aceptacion:**
- persistEvent(event) escribe a Firebase events/{projectId}
- cleanup() elimina eventos > retentionDays (30)
- Opcional: solo activo si Firebase configurado

**devPoints:** 2
**bizPoints:** 3
**blockedBy:** [1.5]

---

### [13.2] Crear Smart Ordering (src/smart-ordering/context-affinity.js)

**User Story:** Como sistema, quiero boost a tareas relacionadas con trabajo reciente para mantener contexto.

**Criterios de aceptacion:**
- rankWithContextAffinity(tasks, lastContext) aplica boost (0.2) a tareas con overlap de files/modules/keywords
- buildAffinityHint(task, lastContext) genera hint string para prompt

**devPoints:** 3
**bizPoints:** 5

---

### [13.3] Crear Review Depth Selector (src/review/review-depth-selector.js)

**User Story:** Como sistema, quiero seleccionar automaticamente la profundidad de review basado en complejidad.

**Criterios de aceptacion:**
- selectReviewDepth(taskSpec, filesChanged, sonarReport)
- forensic: security files + devPoints >= 8
- deep: devPoints >= 8 o sonar BLOCKER/CRITICAL
- quick: devPoints <= 3 y < 5 files
- standard: todo lo demas
- Return: { depth, maxTurns }

**devPoints:** 2
**bizPoints:** 5

---

### [13.4] Crear Security Policies + External Tools Runner

**User Story:** Como sistema, quiero ejecutar herramientas de seguridad externas (npm audit, gitleaks, semgrep).

**Criterios de aceptacion:**
- security-policies.js: reglas OWASP configurables
- external-tools-runner.js: ejecutar npm audit, gitleaks, semgrep con error handling
- Return resultados estructurados por herramienta

**devPoints:** 3
**bizPoints:** 5

---

### [13.5] Crear Metrics Recorder (src/metrics/metrics-recorder.js)

**User Story:** Como sistema, quiero registrar metricas de cada tarea para analytics.

**Criterios de aceptacion:**
- recordTaskMetrics(): escribe a Firebase metrics/{projectId}/model-performance/tasks/
- recordModelPerformance(): agrega metricas por model/role
- recordRoutingOutcome(): track seleccion de modelo para smart router

**devPoints:** 3
**bizPoints:** 5
**blockedBy:** [1.8]

---

## RESUMEN

| Fase | Tareas | Total devPoints |
|------|--------|----------------|
| 1. Infraestructura Base | 9 tareas | 18 |
| 2. Rate Limit y Fallback | 4 tareas | 13 |
| 3. Agente Base | 1 tarea | 8 |
| 4. System Prompts | 7 tareas | 15 |
| 5. Agentes Individuales | 7 tareas | 32 |
| 6. Ciclo de Ejecucion | 4 tareas | 23 |
| 7. Orquestacion | 3 tareas | 13 |
| 8. MCP Servers (sin planning-task-mcp) | 3 tareas | 21 |
| 9. Subsistemas | 8 tareas | 34 |
| 10. Features Avanzados | 11 tareas | 44 |
| 11. Servidores | 3 tareas | 11 |
| 12. Dashboard | 10 tareas | 66 |
| 13. Extras | 5 tareas | 13 |
| **TOTAL** | **75 tareas** | **311 devPoints** |

> **Nota:** planning-task-mcp es un subrepo independiente de GitHub y no se incluye en este plan.
