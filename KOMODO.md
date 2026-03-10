# Komodo - AI Agent Orchestrator for Software Development

Komodo es un **orquestador de agentes IA** que automatiza el ciclo completo de desarrollo de software: planificacion, codificacion, testing, review y merge. Coordina multiples CLIs de IA (Claude Code, Codex CLI, Gemini CLI) como subprocesos reales, no APIs, para que cada agente trabaje como un desarrollador autonomo con acceso a herramientas reales (git, gh, terminal).

La idea central: tu defines tareas en un backlog, Komodo asigna un **Planner** que elige la siguiente tarea, un **Coder** que la implementa y abre PR, un **Reviewer** que revisa el codigo, y si hay problemas el Coder corrige hasta que se apruebe. Todo automatico.

## Que puedes hacer con Komodo

- **Ejecutar tareas automaticamente** desde un backlog en Firebase
- **Usar cualquier CLI de IA** como agente: Claude Code, Codex, Gemini
- **Controlar todo desde un dashboard web** con animaciones 3D en tiempo real
- **Operar via Telegram**: recibir notificaciones, ejecutar tareas, terminal remota
- **Integrar con herramientas externas** via webhooks, API REST y plugins custom
- **Correr en modo daemon 24/7** con auto-recovery ante rate limits
- **Analisis de calidad** automatico con SonarQube integrado
- **Multi-proyecto**: gestionar varios repositorios simultaneamente

---

## Arquitectura

```
                        +---------------------------+
                        |     KOMODO ORCHESTRATOR    |
                        |   (src/orchestrator.js)    |
                        +---------------------------+
                                    |
              +---------------------+---------------------+
              |                     |                     |
        +----------+          +----------+          +-----------+
        | PLANNER  |          |  CODER   |          | REVIEWER  |
        | Agent    |          |  Agent   |          |  Agent    |
        +----------+          +----------+          +-----------+
        | CLI: claude|        | CLI: claude|        | CLI: claude|
        |  codex    |        |  codex    |        |  codex     |
        |  gemini   |        |  gemini   |        |  gemini    |
        +----------+          +----------+          +-----------+
              |                     |                     |
        +-----------+         +-----------+         +-----------+
        | planning- |         | github-   |         | github-   |
        | task-mcp  |         | mcp       |         | mcp       |
        +-----------+         +-----------+         | memory-   |
              |                     |               | mcp       |
        +-----------+         +-----------+         +-----------+
        |  Firebase |         |  GitHub   |
        |  RTDB     |         |  (gh CLI) |
        +-----------+         +-----------+

        +------------------+     +------------------+
        |   QA Agent       |     |  Dashboard       |
        |   (opcional)     |     |  (Next.js)       |
        +------------------+     +------------------+
```

**Los agentes son terminales CLI reales** (Claude Code, Codex, Gemini CLI), no APIs de pago. Cada agente se lanza como subproceso con `child_process.spawn`. Los prompts se envian via stdin (pipe), nunca como argumentos CLI, lo que garantiza compatibilidad total con Windows y Linux. Puedes mezclar CLIs: Planner con Gemini, Coder con Claude, Reviewer con Codex.

---

## Los 4 Agentes

### Planner (Planificador)
- **Que hace:** Elige la siguiente tarea del backlog
- **Como:** Lee todas las tareas `to-do`, filtra las bloqueadas por dependencias, ordena por prioridad (`bizPoints / devPoints`) y contexto (afinidad con la tarea anterior)
- **MCP:** `planning-task-mcp` (acceso a Firebase: tareas, sprints, proyectos)
- **Output:** JSON con taskId, titulo, userStory, acceptanceCriteria, branchName, repoUrl

### Coder (Programador)
- **Que hace:** Implementa la tarea o corrige issues del review
- **Como:** Crea branch, escribe codigo, ejecuta tests, hace commit y abre PR
- **MCP:** `github-mcp` (crear branch, abrir PR, push)
- **Contexto inyectado:** Indice del codebase (exports/imports/funciones), guia de estilo detectada, coding guidelines del proyecto, feedback de reviews anteriores
- **Dos modos:**
  - `implementTask()` - Implementacion completa desde cero
  - `fixReviewIssues()` - Corrige feedback del Reviewer en la misma branch

### Reviewer (Revisor)
- **Que hace:** Revisa PRs con 8 criterios estrictos
- **Criterios:** Correctitud, manejo de errores, edge cases, naming, estructura, tests, seguridad, patrones
- **MCP:** `github-mcp` + `memory-mcp` (patrones de errores comunes)
- **Output:** APPROVE o REQUEST_CHANGES con score 1-10 y lista de issues
- **Seguridad:** Solo aprueba si score >= 8 Y 0 issues criticos/mayores

### QA Agent (opcional)
- **Que hace:** Genera y ejecuta tests unitarios y edge-cases
- **Activacion:** `QA_AGENT=true`
- **Bloquea merge** si el coverage cae por debajo del umbral

---

## Flujo Completo de una Tarea

```
1. PLANNING     -> Planner elige tarea del backlog
2. TRIAGE       -> Clasifica complejidad (trivial/standard/complex)
                -> Selecciona modelo segun complejidad
                -> Decide si descomponer en subtareas
3. CODING       -> Coder implementa, crea branch y abre PR
4. PRE-PR TESTS -> Ejecuta tests automaticamente antes del PR
5. SONAR        -> Analisis de calidad (si ENABLE_SONAR=true)
6. QA           -> Genera tests adicionales (si QA_AGENT=true)
7. REVIEW LOOP  -> Reviewer revisa PR
                   -> Si REQUEST_CHANGES: Coder corrige, vuelve a review
                   -> Maximo N ciclos (MAX_REVIEW_CYCLES, default 5)
                   -> Si APPROVE: continua
8. MERGE        -> Squash merge, elimina branch
9. POST-MERGE   -> Actualiza tarea a "done"
                -> Registra metricas (duracion, costo, modelo, score)
                -> CI Monitor (si CI_MONITOR=true)
                -> Auto-revert (si CI falla y AUTO_REVERT=true)
                -> Version bump (si AUTO_VERSION=true)
                -> Changelog (si AUTO_CHANGELOG=true)
                -> GitHub Release (si AUTO_RELEASE=true)
```

Los agentes NO hablan entre si. Komodo es el intermediario:

```
Planner -> devuelve { taskId, branchName, ... }
    | Komodo pasa los datos
Coder -> devuelve { prNumber, prUrl, ... }
    | Komodo pasa los datos
Reviewer -> devuelve { verdict, issues[], ... }
    | Si REQUEST_CHANGES, Komodo pasa feedback al Coder
Coder -> arregla y pushea
    | Bucle hasta APPROVED (max MAX_REVIEW_CYCLES)
Merge -> tarea "done"
```

---

## Requisitos previos

### 1. Node.js (se recomienda la ultima version LTS o current)

```bash
node --version

# Si no lo tienes, instalar desde https://nodejs.org/
# O con nvm:
nvm install 18
```

### 2. Git

```bash
git --version

# Windows:
winget install Git.Git

# Mac:
brew install git

# Linux:
sudo apt install git
```

### 3. GitHub CLI (gh)

Komodo usa `gh` para crear branches, PRs, reviews y merges.

```bash
# Windows:
winget install GitHub.cli

# Mac:
brew install gh

# Linux:
sudo apt install gh

# Verificar
gh --version

# IMPORTANTE: Autenticar con tu cuenta de GitHub
gh auth login
# Seleccionar: GitHub.com -> HTTPS -> Login with a web browser
```

### 4. Al menos un CLI de IA

Komodo lanza los agentes como subprocesos de terminal. Necesitas al menos uno instalado:

| CLI | Instalacion | Verificar |
|-----|-------------|-----------|
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | `npm install -g @anthropic-ai/claude-code` | `claude --version` |
| [Codex](https://github.com/openai/codex) | `npm install -g @openai/codex` | `codex --version` |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | `npm install -g @google/gemini-cli` | `gemini --version` |

Cada CLI tiene su propia autenticacion (API key o login). Asegurate de configurarlo antes de usar Komodo.

### 5. Firebase (para planning-task-mcp)

1. Tener un proyecto en [Firebase Console](https://console.firebase.google.com/)
2. Activar **Realtime Database**
3. Descargar el **Service Account Key** (JSON) desde Configuracion del proyecto -> Cuentas de servicio -> Generar nueva clave privada
4. Colocar el archivo en `./serviceAccountKey.json`

---

## Instalacion

### Opcion A: Setup wizard (recomendado)

```bash
git clone https://github.com/SergioRVDev/komodo.git
cd komodo
komodo setup
```

El wizard te guia paso a paso:

```
  Komodo Setup Wizard
  -------------------------

[1/7] Verificando requisitos...
  > Node.js v22.0.0
  > git 2.42.0
  > gh CLI 2.40.0
  > claude CLI detectado
  ! codex CLI no encontrado
  > gemini CLI detectado

[2/7] Configurando agentes...
  CLIs disponibles: claude, gemini
  CLI para Planner [claude/gemini] (claude): gemini
  CLI para Coder [claude/gemini] (claude): claude
  CLI para Reviewer [claude/gemini] (claude): claude

[3/7] Configurando Firebase...
  Ruta a serviceAccountKey.json (./skills/planning-task-mcp/serviceAccountKey.json):
  > Credenciales encontradas
  Firebase Database URL: https://tu-proyecto.firebasedatabase.app

[4/7] Configurando identidad...
  Tu User ID (Firebase UID): 7Vumkg7gTDVhCeVAw87W5H4rfL43
  Tu nombre: Sergio

[5/7] Configurando GitHub...
  > gh CLI ya autenticado
  Token opcional (gh CLI ya autenticado)

[6/7] Preferencias...
  Auto-merge PRs aprobadas? (Y/n): y
  Maximo rondas de review (1-10) (5): 5

[7/7] Proyecto...
  Project ID del backlog: -OmFjaFM9glBQnBTT7QQ

Generando configuracion...
  > .env creado

Instalando dependencias...
  > Dependencias del proyecto instaladas
  > planning-task-mcp instalado
  > github-mcp instalado
  > memory-mcp instalado
  > komodo-mcp registrado en Claude Code

  Komodo configurado!

  Proyecto:   -OmFjaFM9glBQnBTT7QQ
  Planner:    gemini
  Coder:      claude
  Reviewer:   claude
  Auto-merge: si
  Max cycles: 5

  Para ejecutar:
  komodo run

  Desde Claude Code:
  /komodo ejecuta 3 tareas
```

**Que hace el wizard:**
1. Verifica que tienes node, git, gh y al menos un CLI de IA
2. Te pregunta que CLI usar para cada agente (solo ofrece los que tienes instalados)
3. Configura Firebase, identidad y GitHub
4. Genera el archivo `.env` con toda la configuracion
5. Ejecuta `npm install` del proyecto y de los 3 MCPs
6. Si tienes Claude Code -> registra komodo-mcp en `.claude/settings.local.json` y crea el slash command `/komodo`

**Re-ejecutable:** Si ya tienes `.env`, el wizard usa tus valores actuales como defaults. Ejecutalo otra vez para cambiar cualquier configuracion.

### Opcion B: Manual

```bash
git clone https://github.com/SergioRVDev/komodo.git
cd komodo

# Instalar dependencias
npm install
cd skills/planning-task-mcp && npm install && cd ../..
cd skills/github-mcp && npm install && cd ../..
cd skills/memory-mcp && npm install && cd ../..
cd skills/komodo-mcp && npm install && cd ../..

# Configurar
cp .env.example .env
# Editar .env con tu editor
```

---

## Modos de Ejecucion

### 1. Run (una o mas tareas)

```bash
komodo run                    # 1 tarea (default)
komodo run -t 5              # 5 tareas
komodo run -c                # hasta vaciar backlog
komodo run -p <project-id>   # proyecto especifico
komodo run --cwd /path/repo  # directorio del repo target
komodo run --dry-run         # simulacion sin ejecutar
```

### 2. Resume (recuperacion)

```bash
komodo resume    # continua desde el ultimo checkpoint
```

### 3. Watch (daemon 24/7)

```bash
komodo watch -p <project-id>
```
Monitorea el backlog continuamente, respeta ventanas de horario (`SCHEDULE`) y limites de presupuesto.

### 4. Multi-proyecto

```bash
komodo multi -p <id1,id2,id3> -s round-robin
```
Estrategias: `round-robin`, `priority`, `backlog-size`

### 5. Desde un CLI de IA

Komodo se puede controlar desde Claude Code, Codex o Gemini CLI en lenguaje natural. Cada CLI lee automaticamente su archivo de instrucciones al abrir el proyecto:

| CLI | Lee | Extra |
|-----|-----|-------|
| Claude Code | `CLAUDE.md` -> `KOMODO.md` | Slash command `/komodo` + MCP tools |
| Codex | `AGENTS.md` -> `KOMODO.md` | -- |
| Gemini CLI | `GEMINI.md` -> `KOMODO.md` | -- |

Ejemplos desde Claude Code:
```
"hazme 3 tareas"
"ejecuta todas las tareas pendientes"
/komodo ejecuta 2 tareas
```

### 6. Via MCP (desde cualquier cliente)

Registrar `komodo-mcp` en Claude Code, Cursor, etc. y usar tools directamente:

```
komodo_plan -> komodo_code -> komodo_review -> (komodo_fix) -> komodo_finalize
```

### 7. Via Telegram Bot

```
/status    - Estado actual
/execute   - Ejecutar tarea
/pause     - Pausar ejecucion
/resume    - Reanudar
```

### 8. Via API REST

```bash
curl -H "X-API-Key: <key>" http://localhost:3002/api/run
```
Requiere `API_SERVER=true` y `KOMODO_API_KEY`.

---

## Skills (MCP Servers)

Komodo usa el protocolo **MCP (Model Context Protocol)** para dar herramientas a los agentes IA. Cada MCP es un servidor que expone tools que el agente puede llamar.

### komodo-mcp (8 tools)

Expone todo el orquestador como MCP, para usar Komodo desde cualquier cliente MCP.

| Tool | Descripcion |
|------|-------------|
| `komodo_plan` | Llama al Planner |
| `komodo_code` | Llama al Coder |
| `komodo_review` | Llama al Reviewer |
| `komodo_fix` | Llama al Coder para fixes |
| `komodo_finalize` | Merge + actualiza tarea |
| `komodo_run` | Ciclo completo (N tareas) |
| `komodo_resume` | Resume desde checkpoint |
| `komodo_status` | Estado actual |

**Configuracion:** El setup wizard lo registra automaticamente en Claude Code. Para configurar manualmente en cualquier cliente MCP:

```json
{
  "mcpServers": {
    "komodo-mcp": {
      "command": "node",
      "args": ["<ruta>/skills/komodo-mcp/src/index.js"],
      "env": { "KOMODO_ROOT": "<ruta>" }
    }
  }
}
```

### planning-task-mcp (38 tools)

Gestion completa de proyectos sobre Firebase Realtime Database.

| Grupo | Tools | Descripcion |
|-------|-------|-------------|
| Projects | 5 | Crear, listar, actualizar, eliminar proyectos |
| Sprints | 5 | Gestionar sprints, set active sprint |
| Tasks | 8 | CRUD de tareas, dependencias, cambio de estado |
| Bugs | 5 | Reportar, listar, asignar, resolver bugs |
| Proposals | 3 | Propuestas de mejora (auto-improve) |
| Members | 3 | Gestion de miembros del equipo |
| Notifications | 2 | Notificaciones por asignacion/cambio |
| Comments | 2 | Comentarios en tareas |
| Analytics | 3 | Velocidad, burndown, rendimiento de modelos |
| Planner | 2 | `plan_from_document` y `create_full_plan` - planificacion desde texto libre |
| Users | 1 | Perfil del usuario actual |

**Planificacion inteligente:** Puedes pasarle un documento de requisitos en texto libre y genera automaticamente sprints + tareas con user stories, acceptance criteria, devPoints (Fibonacci: 1,2,3,5,8,13) y dependencias.

### github-mcp (10 tools)

Wrapper sobre `gh` CLI para operaciones de GitHub.

| Tool | Descripcion |
|------|-------------|
| `create_branch` | Crea branch desde main/master |
| `list_branches` | Lista branches del repo |
| `create_pr` | Abre Pull Request |
| `get_pr` | Info de un PR |
| `get_pr_diff` | Diff completo del PR |
| `list_pr_files` | Archivos modificados |
| `create_review` | APPROVE o REQUEST_CHANGES con comentarios |
| `list_pr_comments` | Comentarios del PR |
| `merge_pr` | Merge (squash/merge/rebase) |
| `close_pr` | Cierra PR sin merge |

### memory-mcp (5 tools)

Memoria persistente de patrones de errores y antipatrones.

| Tool | Descripcion |
|------|-------------|
| `record_pattern` | Registra error/antipatron con severidad y tags |
| `query_patterns` | Busca patrones por tags, tipo, severidad |
| `get_review_brief` | Top errores (se inyecta en prompt del Reviewer) |
| `record_review_outcome` | Registra si el review paso o fallo |
| `get_stats` | Total reviews, pass rate, promedio de ciclos |

**Persistencia:** Archivo JSON local (`memory/patterns.json`), no Firebase.

### chrome-devtools (opcional)

MCP externo que conecta los agentes con Chrome DevTools. Permite inspeccionar la consola del navegador, tomar screenshots, analizar network, performance y DOM en tiempo real.

**Activar:**
1. En `.env`, establecer `ENABLE_BROWSER_MCP=true`
2. Lanzar Chrome con remote debugging: `npm run chrome:debug`
3. Ejecutar Komodo normalmente

---

## Seleccion Inteligente de Modelos

Komodo selecciona automaticamente el modelo segun la **complejidad** de la tarea y el **rol** del agente.

### Clasificacion de Complejidad

Basada en devPoints:
- **Trivial:** 1-3 pts
- **Standard:** 4-6 pts
- **Complex:** 7+ pts

### Mapa de Modelos por Defecto

| CLI | Rol | Trivial | Standard | Complex |
|-----|-----|---------|----------|---------|
| **Claude** | Planner | sonnet | sonnet | opus |
| | Coder | sonnet | sonnet | opus |
| | Reviewer | haiku | sonnet | sonnet |
| **Codex** | Planner | codex-mini | o4-mini | o3 |
| | Coder | codex-mini | o4-mini | o3 |
| | Reviewer | codex-mini | o4-mini | o3 |
| **Gemini** | Planner | gemini-2.0-flash | gemini-2.5-pro | gemini-2.5-pro |
| | Coder | gemini-2.0-flash | gemini-2.5-pro | gemini-2.5-pro |
| | Reviewer | gemini-2.0-flash | gemini-2.5-pro | gemini-2.5-pro |

### Prioridad de Seleccion

1. **Override por tarea** (mas alta) - el task spec puede forzar un modelo
2. **Dashboard Settings** (komodo.config.json) - el modelo elegido en la UI
3. **FORCE_MODEL_\*** del .env - fuerza un modelo por rol
4. **Mapa de complejidad** - seleccion automatica segun tabla
5. **Default del CLI** (mas baja) - si nada esta configurado

---

## Dashboard (Next.js)

Panel web en tiempo real conectado por WebSocket al orquestador.

### Paginas

| Pagina | Que muestra |
|--------|-------------|
| **/** (Home) | Visualizacion 3D de agentes trabajando, estado en tiempo real, controles play/pause/stop |
| **/analytics** | Graficas de velocidad, costo por sprint, pass rate de reviews, duracion por complejidad, uso de modelos |
| **/leaderboard** | Ranking de modelos por costo, precision, velocidad. Filtrable por periodo y complejidad |
| **/agents** | Estado detallado de cada agente, logs, turnos, costo |
| **/memory** | Patrones de errores almacenados, estadisticas de reviews |
| **/notifications** | Historial de notificaciones de tareas |
| **/settings** | Configuracion de CLI por agente, modelo, max turns, proyecto activo, coding guidelines, orchestrator settings |

### Visualizacion 3D

El dashboard usa **Three.js + React Three Fiber** para renderizar una oficina 3D donde:
- Cada agente tiene un avatar que se mueve y trabaja
- El Komodo Boss (orquestador) supervisa
- Un whiteboard animado muestra la tarea actual
- Los agentes cambian de estado visualmente (idle, walking, working, done)

### Stack del Dashboard

- Next.js 15 (App Router)
- React 19
- TypeScript
- Tailwind CSS 4
- Three.js + React Three Fiber
- Recharts (graficas)
- Firebase Admin SDK
- WebSocket (tiempo real)

---

## Sistemas de Resiliencia

### Rate Limit Recovery

```
CLI rate-limited detectado
  -> Guarda checkpoint (tarea, paso, branch, PR)
  -> Intenta CLI alternativo (claude -> codex -> gemini)
  -> Heartbeat monitor pinga CLI cada 5 min
  -> Cuando CLI recupera -> auto-resume desde checkpoint
```

### Watchdog (Agent Timeout)

Si un agente no produce output en 15 minutos:
- Mata el proceso
- Reintenta hasta 2 veces
- Si falla, pasa a la siguiente tarea

### Checkpoint Recovery

Guarda estado en `.komodo/checkpoints/` en puntos criticos:
- Despues del Planner (tiene tarea seleccionada)
- Despues del Coder (tiene PR abierto)
- Despues de cada ciclo de Review
- `komodo resume` restaura desde el ultimo checkpoint

### Fallback Manager

```javascript
// Orden de fallback configurable
FALLBACK_CLI_ORDER=claude,codex,gemini
RATE_LIMIT_COOLDOWN_MINUTES=15
```
Si claude tiene rate limit, usa codex. Si codex tambien, usa gemini. Cooldown de 15 min antes de reintentar el CLI original.

---

## Gestion de Costos

### Budget Manager

- **Presupuesto diario:** `DAILY_BUDGET_USD` (default $10)
- **Presupuesto semanal:** `WEEKLY_BUDGET_USD` (default $50)
- **Alerta al 80%:** `BUDGET_WARNING_THRESHOLD`
- **Auto-pausa:** Si se excede el presupuesto, el daemon se pausa automaticamente
- **Persistencia:** Costos diarios guardados en Firebase

### Tracking por Tarea

Cada tarea registra:
- Costo total (suma de todos los agentes)
- Costo por agente (Planner, Coder, Reviewer, QA)
- Turnos usados por agente
- Duracion total

---

## Subsistemas Inteligentes

### Codebase Knowledge Index
- Parsea JS/TS, Python y Go
- Extrae exports, imports, funciones publicas
- Genera un mapa semantico del proyecto
- Se inyecta en el prompt del Coder para que conozca la estructura
- Cache por directorio, se invalida cuando cambian archivos

### Style Detector
- Analiza el codigo existente del repo
- Detecta: indentacion (tabs/spaces), tipo de comillas, convenciones de naming, largo de linea
- Se inyecta en el prompt del Coder para que siga el estilo existente

### Review Feedback Memory
- Almacena patrones de errores de reviews anteriores
- Se inyecta en el prompt del Coder para evitar errores repetidos
- Se inyecta en el prompt del Reviewer para que revise patrones conocidos

### Smart Task Ordering
- Despues de completar una tarea, analiza los archivos y keywords tocados
- Calcula similitud Jaccard con las tareas candidatas
- Boost del 20% en prioridad para tareas relacionadas
- Reduce context switching entre tareas

### Task Decomposition
- Si una tarea tiene >= 8 devPoints, evalua si descomponerla
- Genera subtareas con sus propios devPoints y dependencias
- Las subtareas se ejecutan secuencialmente respetando el orden

### Incremental Review
- En ciclos de fix (despues del primer review), solo re-revisa los commits nuevos
- Ahorra tokens y tiempo comparado con revisar todo el PR de nuevo

### Smart Batching
- Agrupa tareas triviales (devPoints <= 2) en un solo PR
- Maximo `BATCH_MAX_TASKS` tareas por batch (default 5)
- Activar con `SMART_BATCHING=true`

### Tech Debt Tracker
- Issues menores del review (suggestion/minor) se convierten en tareas de tech-debt
- Se agregan al backlog automaticamente
- Deduplicacion por archivo + descripcion
- Activar con `TECH_DEBT_TRACKING=true` (default)

---

## Integraciones Externas

| Servicio | Para que | Config | Requerido? |
|----------|----------|--------|------------|
| **Firebase RTDB** | Backlog, proyectos, sprints, metricas, eventos | `GOOGLE_APPLICATION_CREDENTIALS`, `FIREBASE_DATABASE_URL` | Si |
| **GitHub** (gh CLI) | Branches, PRs, reviews, merge | `gh auth login` | Si |
| **Claude Code CLI** | Agente IA principal | Instalado globalmente | Al menos 1 CLI |
| **Codex CLI** | Agente IA alternativo | Instalado globalmente | Opcional |
| **Gemini CLI** | Agente IA alternativo | Instalado globalmente | Opcional |
| **SonarQube/Cloud** | Analisis de calidad de codigo | `SONAR_TOKEN`, `SONAR_HOST_URL` | Opcional |
| **GitHub Actions** | Monitoreo CI post-merge | `CI_MONITOR=true` | Opcional |
| **Chrome DevTools** | Validacion visual de frontend | `ENABLE_BROWSER_MCP=true` | Opcional |
| **Telegram** | Bot de control y notificaciones | `ENABLE_TELEGRAM=true`, `TELEGRAM_BOT_TOKEN` | Opcional |
| **Webhooks** | Forward de eventos a sistemas externos | `WEBHOOK_URLS` | Opcional |
| **GitHub Issues** | Auto-crear tareas desde issues labelados | `GITHUB_ISSUE_SYNC=true` | Opcional |

---

## Eventos (30+ tipos)

El Event Bus emite eventos en tiempo real que se envian al Dashboard (WebSocket), se persisten en Firebase, se envian por Webhooks y se notifican por Telegram.

| Tipo | Cuando |
|------|--------|
| `TASK_STARTED` | Planner selecciona tarea |
| `TASK_COMPLETED` | Tarea mergeada exitosamente |
| `TASK_CLASSIFIED` | Complejidad clasificada |
| `TASK_DECOMPOSED` | Tarea descompuesta en subtareas |
| `AGENT_STATE_CHANGE` | Agente cambia de estado |
| `PR_CREATED` | Coder abre PR |
| `PR_MERGED` | PR mergeado |
| `REVIEW_CYCLE_START` | Reviewer comienza revision |
| `REVIEW_CYCLE_END` | Reviewer termina (approve/changes) |
| `COST_UPDATED` | Costo de agente registrado |
| `BUDGET_WARNING` | 80% del presupuesto usado |
| `BUDGET_EXCEEDED` | Presupuesto excedido, pausa |
| `RATE_LIMIT_DETECTED` | CLI con rate limit |
| `AGENT_FALLBACK` | Cambiando a CLI alternativo |
| `WATCHDOG_KILL` | Agente matado por timeout |
| `MODEL_SELECTED` | Modelo elegido para rol+complejidad |
| `SONAR_ANALYSIS_COMPLETE` | Analisis de SonarQube listo |
| `TECH_DEBT_CREATED` | Tarea de tech-debt creada |
| `PRE_PR_TESTS_PASSED` | Tests pre-PR exitosos |
| `CI_RUN_COMPLETED` | GitHub Actions termino |

---

## Plugins

Sistema extensible. Los plugins se cargan desde `plugins/` y se ejecutan en puntos especificos del flujo.

### Plugin incluido: Security Audit
- **Posicion:** `before-review` (se ejecuta antes del Reviewer)
- **Que hace:** Escanea el codigo por credenciales hardcodeadas, `eval()`/`exec()` inseguros, TODOs de seguridad
- **Resultado:** Se inyecta en el prompt del Reviewer

### Crear un plugin

```javascript
// plugins/mi-plugin/index.js
export default {
  name: 'mi-plugin',
  position: 'after-review',  // before-review, after-review, after-merge
  hooks: {
    onTaskCompleted: async (task) => { /* ... */ },
    onReviewIssue: async (issue) => { /* ... */ },
  }
}
```
Activar: `ENABLED_PLUGINS=mi-plugin`

---

## CI/CD Automatizado

### Pre-PR Tests
- Auto-detecta el comando de test (npm test, pytest, go test, cargo test)
- Si fallan, el Coder intenta arreglar (max 3 intentos)
- Bloquea el PR si no pasan

### CI Monitor (post-merge)
- Observa GitHub Actions despues del merge
- Timeout configurable (`CI_MONITOR_TIMEOUT_MINUTES`, default 15)
- Si falla y `AUTO_REVERT=true`: crea PR de revert automatico

### Auto Versioning
- Detecta tipo de bump del titulo de la tarea (feat=minor, fix=patch, breaking=major)
- Actualiza `package.json` (o `VERSION_FILE` custom)
- Genera entrada en CHANGELOG.md

### Auto Release
- Crea GitHub Release cuando un sprint se completa
- Release notes generadas del changelog
- Gate: no crea release si hay bugs criticos abiertos (override con `RELEASE_IGNORE_BUGS=true`)

---

## Base de Datos (Firebase Realtime Database)

```
Firebase RTDB
|
+-- projects/{projectId}
|   +-- name, description, status
|   +-- members[], repositories[]
|   +-- codingGuidelines (texto libre inyectado en prompts)
|
+-- tasks/{taskId}
|   +-- projectId, sprintId, status
|   +-- title, userStory (Como/Quiero/Para)
|   +-- acceptanceCriteria[], implementationPlan
|   +-- devPoints, bizPoints (prioridad = biz/dev)
|   +-- branchName, repoUrl
|   +-- blockedBy[], blocks[] (dependencias)
|   +-- subtaskIds[], parentTaskId
|   +-- assignedTo, createdBy
|   +-- history{} (cambios de estado con timestamps)
|
+-- sprints/{sprintId}
|   +-- projectId, name, status (planned/active/completed)
|   +-- startDate, endDate
|
+-- bugs/{bugId}
|   +-- projectId, severity (critical/high/medium/low)
|   +-- status, title, description
|
+-- events/{projectId}/{YYYY-MM-DD}/{eventId}
|   +-- type (task:completed, agent:state-change, etc.)
|   +-- timestamp, metadata{}
|   +-- agentName, taskId
|
+-- metrics/{projectId}/
|   +-- model-performance/tasks/{taskId}
|   |   +-- plannerModel, coderModel, reviewerModel
|   |   +-- reviewScore, reviewCycles, cost, durationSeconds
|   +-- tasks/{taskId}
|   |   +-- estimatedDevPoints, actualDuration, reviewCycles
|   +-- coverageHistory/{timestamp}
|   +-- daily/{date} (costo diario)
|
+-- budgets/{projectId}/daily/{date}
|   +-- totalCost, taskCount
|
+-- proposals/{proposalId}
|   +-- projectId, title, category, status
```

---

## Configuracion Completa (.env)

### Core (requerido)

```env
CLI_PLANNER=claude              # claude | codex | gemini
CLI_CODER=claude
CLI_REVIEWER=claude
GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json
FIREBASE_DATABASE_URL=https://xxx.firebasedatabase.app
DEFAULT_USER_ID=xxxxx
```

### Ejecucion

```env
MAX_REVIEW_CYCLES=5             # Ciclos Coder<->Reviewer (1-10)
AUTO_MERGE=true                 # Merge automatico al aprobar
DEFAULT_PROJECT_ID=             # Evita pasar -p siempre
MAX_PARALLEL=1                  # Tareas en paralelo
CONTINUOUS_MODE=false           # true = no parar hasta vaciar backlog
```

### Modelos

```env
# Mapa por complejidad: trivial,standard,complex
MODEL_MAP_CLAUDE_PLANNER=sonnet,sonnet,opus
MODEL_MAP_CLAUDE_CODER=sonnet,sonnet,opus
MODEL_MAP_CLAUDE_REVIEWER=haiku,sonnet,sonnet
MODEL_MAP_CODEX_CODER=codex-mini,o4-mini,o3
MODEL_MAP_GEMINI_CODER=gemini-2.0-flash,gemini-2.5-pro,gemini-2.5-pro

# Forzar modelo (ignora complejidad)
FORCE_MODEL_PLANNER=
FORCE_MODEL_CODER=
FORCE_MODEL_REVIEWER=
```

### Triage

```env
COMPLEXITY_TRIVIAL_MAX=3        # devPoints <= 3 = trivial
COMPLEXITY_STANDARD_MAX=6       # 4-6 = standard, 7+ = complex
TASK_DECOMPOSITION=true         # Descomponer tareas grandes
DECOMPOSITION_THRESHOLD_DEVPOINTS=8
```

### Rate Limits

```env
RATE_LIMIT_FALLBACK=true
FALLBACK_CLI_ORDER=claude,codex,gemini
RATE_LIMIT_COOLDOWN_MINUTES=15
HEARTBEAT_ENABLED=true
HEARTBEAT_INTERVAL_MINUTES=5
```

### Presupuesto

```env
DAILY_BUDGET_USD=10
WEEKLY_BUDGET_USD=50
BUDGET_WARNING_THRESHOLD=0.8
```

### Testing y Calidad

```env
PRE_PR_TESTS=true
PRE_PR_TEST_CMD=auto            # o "npm test", "pytest", etc.
COVERAGE_CHECK=true
COVERAGE_CMD=auto
MIN_COVERAGE_DELTA=-2           # max caida de coverage permitida
QA_AGENT=false
CLI_QA=claude
QA_TEST_TYPES=unit,edge-cases
```

### CI/CD

```env
CI_MONITOR=false
CI_MONITOR_TIMEOUT_MINUTES=15
AUTO_REVERT=false
AUTO_VERSION=false
VERSION_FILE=package.json
AUTO_CHANGELOG=false
AUTO_RELEASE=false
```

### SonarQube

```env
ENABLE_SONAR=false
SONAR_TOKEN=
SONAR_HOST_URL=
SONAR_PROJECT_KEY=
SONAR_ORGANIZATION=
```

### Daemon

```env
DAEMON_POLL_INTERVAL=60         # segundos entre polls
DAEMON_MAX_TASKS_PER_SESSION=0  # 0 = ilimitado
AGENT_TIMEOUT_MINUTES=15        # watchdog timeout
SCHEDULE=                       # "02:00-06:00,14:00-18:00"
SCHEDULE_TIMEZONE=              # "America/New_York"
```

### Telegram

```env
ENABLE_TELEGRAM=false
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
TELEGRAM_ALLOWED_USERS=         # CSV de user IDs
TELEGRAM_VERBOSITY=verbose      # verbose | minimal
```

### GitHub Issues

```env
GITHUB_ISSUE_SYNC=false
GITHUB_ISSUE_LABEL=komodo
GITHUB_ISSUE_REPO=owner/repo
GITHUB_ISSUE_POLL_MINUTES=5
```

### PR Comment Bugs

```env
PR_COMMENT_BUGS=false           # detecta "@komodo bug: ..."
PR_COMMENT_BUGS_REPO=owner/repo
PR_COMMENT_BUGS_POLL_MINUTES=3
```

### Webhooks

```env
WEBHOOK_URLS=                   # CSV de URLs
WEBHOOK_EVENTS=*                # * o CSV de tipos
WEBHOOK_HEADERS=                # headers custom
WEBHOOK_MAX_RETRIES=3
```

### Browser

```env
ENABLE_BROWSER_MCP=false
CHROME_DEBUGGER_PORT=9222
```

### API

```env
WS_PORT=3001                    # WebSocket para dashboard
API_SERVER=false                # REST API externo
API_PORT=3002
KOMODO_API_KEY=
```

### Avanzado

```env
CODEBASE_INDEX_ENABLED=true
STYLE_DETECTOR_ENABLED=true
CONTEXT_AFFINITY_BOOST=0.2
SMART_BATCHING=false
BATCH_MAX_TASKS=5
INCREMENTAL_REVIEW=true
TECH_DEBT_TRACKING=true
ESTIMATION_TRACKING=true
MODEL_PERFORMANCE_TRACKING=true
PLUGINS_DIR=./plugins
ENABLED_PLUGINS=
AUTO_IMPROVE=false
AUTO_IMPROVE_MAX_PROPOSALS=5
```

---

## Estructura de Archivos

```
komodo/
+-- src/
|   +-- index.js                    # CLI entry point (Commander.js)
|   +-- orchestrator.js             # run(), resume(), watch()
|   +-- config.js                   # Carga .env + komodo.config.json
|   +-- setup.js                    # Wizard de configuracion interactivo
|   +-- agents/
|   |   +-- base-agent.js           # Core: spawn CLI + stdin pipe + MCP
|   |   +-- planner.js              # pickNextTask()
|   |   +-- coder.js                # implementTask(), fixReviewIssues()
|   |   +-- reviewer.js             # reviewPR(), normalizeVerdict()
|   |   +-- qa.js                   # runQAAgent()
|   |   +-- fallback-manager.js     # Rate limit fallback chain
|   |   +-- rate-limit-detector.js  # Detecta rate limits
|   +-- cycle/
|   |   +-- task-runner.js          # Orquestacion completa de 1 tarea
|   |   +-- review-loop.js          # Loop Coder <-> Reviewer
|   |   +-- parallel-runner.js      # Ejecucion paralela
|   |   +-- smart-batching.js       # Agrupar tareas triviales
|   |   +-- incremental-review.js   # Solo re-revisar cambios
|   |   +-- worker-pool.js          # Pool de workers
|   +-- prompts/
|   |   +-- planner-system.js       # System prompt del Planner
|   |   +-- coder-system.js         # System prompt del Coder
|   |   +-- reviewer-system.js      # System prompt del Reviewer (8 criterios)
|   |   +-- qa-system.js            # System prompt del QA
|   +-- triage/
|   |   +-- complexity-classifier.js # Clasifica trivial/standard/complex
|   |   +-- model-selector.js       # Elige modelo por rol+complejidad
|   |   +-- task-decomposer.js      # Descompone tareas grandes
|   +-- intelligence/
|   |   +-- codebase-indexer.js     # Mapa semantico del codebase
|   |   +-- style-detector.js       # Detecta convenciones de codigo
|   |   +-- review-feedback.js      # Feedback de reviews anteriores
|   +-- events/
|   |   +-- event-bus.js            # EventEmitter central (30+ tipos)
|   |   +-- event-persistence.js    # Persiste eventos en Firebase
|   +-- state/
|   |   +-- komodo-state.js         # Estado global serializable
|   |   +-- checkpoint-manager.js   # Checkpoints para recovery
|   +-- server/
|   |   +-- ws-server.js            # WebSocket server (dashboard)
|   |   +-- api-server.js           # REST API externo
|   +-- cost/
|   |   +-- budget-manager.js       # Presupuesto diario/semanal
|   |   +-- cost-persistence.js     # Persistencia de costos
|   +-- metrics/
|   |   +-- model-performance-tracker.js
|   +-- estimation/
|   |   +-- estimation-tracker.js
|   +-- coverage/
|   |   +-- coverage-analyzer.js
|   +-- tech-debt/
|   |   +-- tech-debt-tracker.js
|   +-- testing/
|   |   +-- pre-pr-tests.js
|   +-- sonar/
|   |   +-- analyzer.js, scanner.js
|   +-- ci-monitor/
|   |   +-- ci-monitor.js, auto-revert.js
|   +-- versioning/
|   |   +-- version-bumper.js, changelog-generator.js
|   |   +-- release-manager.js, release-gate.js
|   +-- watchdog/
|   |   +-- watchdog.js
|   +-- heartbeat/
|   |   +-- heartbeat-monitor.js
|   +-- daemon/
|   |   +-- daemon.js
|   +-- scheduler/
|   |   +-- scheduler.js
|   +-- telegram/
|   |   +-- bot.js, notifier.js, formatter.js
|   |   +-- auth.js, run-controller.js
|   +-- smart-ordering/
|   |   +-- context-affinity.js
|   +-- auto-improve/
|   |   +-- codebase-analyzer.js, dependency-checker.js
|   +-- plugins/
|   |   +-- plugin-loader.js, plugin-interface.js
|   +-- multi-project/
|   |   +-- multi-project-runner.js, project-selector.js
|   +-- integrations/
|   |   +-- github-issue-sync.js, pr-comment-bugs.js
|   |   +-- webhook-outgoing.js
|   +-- shutdown/
|   |   +-- shutdown-manager.js
|   +-- doctor/
|   |   +-- doctor.js
|   +-- utils/
|       +-- logger.js, parser.js
|
+-- skills/
|   +-- komodo-mcp/                 # Orquestador como MCP (8 tools)
|   +-- planning-task-mcp/          # Gestion de proyectos (38 tools)
|   +-- github-mcp/                 # Operaciones GitHub (10 tools)
|   +-- memory-mcp/                 # Memoria de patrones (5 tools)
|
+-- dashboard/                      # Next.js 15 + Three.js
|   +-- app/
|   |   +-- page.tsx                # Home (3D + estado real-time)
|   |   +-- analytics/              # Graficas de rendimiento
|   |   +-- leaderboard/            # Ranking de modelos
|   |   +-- agents/                 # Estado de agentes
|   |   +-- memory/                 # Patrones de errores
|   |   +-- settings/               # Configuracion
|   |   +-- api/                    # API routes (Firebase)
|   +-- components/
|   |   +-- 3d/                     # Three.js (Agent3D, KomodoBoss, etc.)
|   |   +-- *.tsx                   # UI components
|   +-- hooks/
|   |   +-- useKomodoSocket.ts      # WebSocket hook
|   +-- lib/
|       +-- firebase.ts, config-types.ts, leaderboard.ts
|
+-- plugins/
|   +-- security-audit/             # Plugin de seguridad incluido
|
+-- memory/
|   +-- patterns.json               # Patrones de errores (memory-mcp)
|
+-- scripts/
|   +-- launch-chrome-debug.js      # Lanza Chrome con remote debugging
|
+-- .env                            # Configuracion principal
+-- komodo.config.json              # Config del dashboard (generado)
+-- README.md                       # Este archivo
+-- KOMODO.md                       # Instrucciones para CLIs de IA
+-- CLAUDE.md                       # Wrapper -> lee KOMODO.md (Claude Code)
+-- AGENTS.md                       # Wrapper -> lee KOMODO.md (Codex)
+-- GEMINI.md                       # Wrapper -> lee KOMODO.md (Gemini)
```

---

## Dependencias

| Paquete | Uso |
|---------|-----|
| `@modelcontextprotocol/sdk` | Framework para crear MCPs |
| `commander` | CLI de Komodo (run, status) |
| `chalk` | Colores en terminal |
| `dotenv` | Carga de variables de entorno |
| `zod` | Validacion de schemas MCP |
| `uuid` | IDs para patrones de memoria |

---

## Historial de Sprints

### Sprint 0 — Inicializacion del Proyecto
Setup inicial: crear el repositorio en GitHub y la estructura base del proyecto.

### Sprint 1 — Scaffold y Configuracion Base
La base del proyecto: `package.json` con dependencias, sistema de configuracion via `.env` con validacion, logger con colores para la terminal, parser para extraer JSON de las respuestas de los agentes IA.

### Sprint 2 — GitHub MCP (Model Context Protocol)
Servidor MCP que da a los agentes IA acceso completo a GitHub: crear y listar branches, abrir/consultar Pull Requests, ver diffs, hacer reviews, mergear y cerrar PRs.

### Sprint 3 — Memory MCP
Servidor MCP de memoria persistente para los agentes. Almacena patrones de errores recurrentes, estadisticas de reviews y outcomes historicos en JSON local.

### Sprint 4 — Sistema de Agentes
El corazon del sistema: wrapper `base-agent.js` que lanza cualquier CLI de IA como subproceso, y los 3 agentes especializados (Planner, Coder, Reviewer) con sus system prompts.

### Sprint 5 — Orquestacion y CLI
El flujo completo: review loop (Coder <-> Reviewer hasta APPROVED), task runner (ciclo completo de 1 tarea), orquestador (ejecutar N tareas o modo continuo), y CLI con `commander`.

### Sprint 6 — Pulido, Setup y Testing
Wizard de instalacion interactivo, manejo de errores con recovery automatico, tracking de costes, modo `--dry-run`, y test end-to-end.

### Sprint 7 — API de Estado en Tiempo Real
EventBus interno, servidor WebSocket para el dashboard en tiempo real, y modelo de estado global (`komodoState`).

### Sprint 8 — Dashboard Web: Setup y Layout
Dashboard web con Next.js: panel de estado en tiempo real, pagina de Settings, y pagina de Memory.

### Sprint 9 — Visualizacion Animada: La Oficina de Komodo
Visualizacion animada: una "oficina virtual" con sprites, avatares, animaciones y feedback visual conectado al estado real via WebSocket.

### Sprint 10 — Dashboard: Pagina de Agentes y Controles
Pagina dedicada para cada agente con logs en vivo, controles de ejecucion (Start, Pause, Stop), y notificaciones.

### Sprint 11 — Komodo MCP: Control desde Claude Code
Komodo como servidor MCP: controlar Komodo desde cualquier cliente MCP con tools (`komodo_plan`, `komodo_code`, `komodo_review`, etc.).

### Sprint 12 — MCP Chrome DevTools
Integracion con Chrome DevTools via MCP: los agentes pueden abrir el navegador, inspeccionar la app, ver errores de consola y validar visualmente.

### Sprint 13 — Telegram Bot: Setup y Notificaciones
Bot de Telegram con autenticacion y notificaciones en tiempo real de cada paso del flujo.

### Sprint 14 — Telegram Bot: Control y Terminal Remota
Control completo de Komodo desde Telegram: `/run`, pause/stop remotos, y terminal de Claude Code via Telegram.

### Sprint 15 — Integracion SonarQube
Analisis estatico de codigo con SonarQube integrado en el flujo, con reporte inyectado en el prompt del Reviewer.

### Sprint 16 — Rate Limit Resilience y Task Decomposition
Resiliencia ante rate limits, sistema de dependencias entre tareas, triage automatico, clasificacion de complejidad, y seleccion automatica de modelo.

### Sprint 17 — Heartbeat: Auto-Recovery Inteligente
Monitor de heartbeat, auto-resume, dashboard de salud, backoff exponencial, y notificaciones de recovery.

### Sprint 18 — Daemon Mode: Komodo 24/7
Modo daemon continuo, scheduler con ventanas de ejecucion, watchdog timer, self-diagnostic, y graceful shutdown.

### Sprint 19 — Auto-Alimentacion: El Backlog Nunca se Vacia
GitHub Issues como tareas, PR comments como bugs, sugerencias de refactoring, tech debt tracking, y bot de dependencias.

### Sprint 20 — Inteligencia: Komodo Aprende
Indice semantico del codebase, deteccion de estilo, feedback loop, comparacion estimaciones vs realidad, ordenamiento inteligente, y coding guidelines custom.

### Sprint 21 — Quality Gate: Nunca Mergear Codigo Roto
Tests pre-PR, monitor de GitHub Actions post-merge, auto-revert, rechazo por baja cobertura, y agente QA dedicado.

### Sprint 22 — Parallel Execution: Multiplicar Throughput
Ejecucion en paralelo, worker pool, smart batching, y review incremental.

### Sprint 23 — Versionado y Releases Automaticos
Semantic versioning automatico, changelog auto-generado, GitHub Releases al cerrar sprint, y release gates.

### Sprint 24 — Observabilidad Total
Persistencia de eventos, dashboard con graficos historicos, cost tracking con alertas, leaderboard de modelos, y digest semanal via Telegram.

### Sprint 25 — Ecosystem: Webhooks, Plugins y Multi-Proyecto
Webhooks outgoing, API REST incoming, sistema de plugins, multi-proyecto con estrategias de seleccion, dashboard multi-proyecto, y rate limiting en la API.

---

## Documentacion adicional

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) - Arquitectura tecnica detallada de cada modulo
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) - Guia de despliegue
- [docs/TELEGRAM.md](docs/TELEGRAM.md) - Documentacion del bot de Telegram
- [docs/STDIN-FIX.md](docs/STDIN-FIX.md) - Como se resolvio el bug critico de shell escaping en Windows
- [KOMODO.md](KOMODO.md) - Instrucciones para CLIs de IA

---

## Licencia

MIT
