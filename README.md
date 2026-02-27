# Komodo - Orquestador de Agentes IA para Código

Komodo es un orquestador que coordina agentes IA (Claude Code, Codex, Gemini CLI) para desarrollar software de forma autónoma. Conectado a un sistema de planificación de tareas, gestiona el ciclo completo: planificar, programar, revisar y mergear.

## Arquitectura

```
              ┌─────────────────────────┐
              │    KOMODO ORCHESTRATOR   │
              └────────────┬────────────┘
                           │
         ┌─────────────────┼──────────────────┐
         │                 │                   │
    ┌────▼────┐      ┌────▼────┐        ┌────▼─────┐
    │ PLANNER │      │  CODER  │        │ REVIEWER  │
    │ (CLI)   │      │ (CLI)   │        │ (CLI)     │
    └────┬────┘      └────┬────┘        └────┬──────┘
         │                │                   │
    planning-mcp     github-mcp          github-mcp
                                         memory-mcp
```

**Los agentes son terminales CLI reales** (Claude Code, Codex, Gemini CLI), no APIs de pago. Cada agente se lanza como subproceso con `child_process.spawn`. Puedes mezclar CLIs: Planner con Gemini, Coder con Claude, Reviewer con Codex.

### Flujo de una tarea

1. **Planner** lee el backlog, elige la tarea con mayor prioridad, la marca "in-progress"
2. **Coder** recibe la tarea, implementa el código, crea branch, push, abre PR
3. **Reviewer** lee el diff de la PR, consulta memoria de errores, revisa estrictamente
4. Si hay cambios pedidos → **Coder** recibe feedback, arregla, push
5. Bucle Coder↔Reviewer hasta APPROVED (máximo configurable de rondas)
6. Se mergea la PR, se actualiza la tarea a "done", se guardan patrones en memoria

## Requisitos previos

Antes de instalar Komodo necesitas tener lo siguiente en tu sistema:

### 1. Node.js (se recomienda la última versión LTS o current)

```bash
# Verificar versión
node --version

# Si no lo tienes, instalar desde https://nodejs.org/
# O con nvm:
nvm install 18
```

### 2. Git

```bash
# Verificar
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
# Instalar
# Windows:
winget install GitHub.cli

# Mac:
brew install gh

# Linux:
sudo apt install gh

# Verificar instalación
gh --version

# IMPORTANTE: Autenticar con tu cuenta de GitHub
gh auth login
# Seleccionar: GitHub.com → HTTPS → Login with a web browser
```

### 4. Al menos un CLI de IA

Komodo lanza los agentes como subprocesos de terminal. Necesitas al menos uno instalado:

| CLI | Instalación | Verificar |
|-----|-------------|-----------|
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | `npm install -g @anthropic-ai/claude-code` | `claude --version` |
| [Codex](https://github.com/openai/codex) | `npm install -g @openai/codex` | `codex --version` |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | `npm install -g @anthropic-ai/gemini-cli` | `gemini --version` |

Cada CLI tiene su propia autenticación (API key o login). Asegúrate de configurarlo antes de usar Komodo.

### 5. Firebase (para planning-task-mcp)

Komodo se conecta a la app de planificación Planning Task a través de Firebase:

1. Tener un proyecto en [Firebase Console](https://console.firebase.google.com/)
2. Activar **Realtime Database**
3. Descargar el **Service Account Key** (JSON) desde Configuración del proyecto → Cuentas de servicio → Generar nueva clave privada
4. Colocar el archivo en `skills/planning-task-mcp/serviceAccountKey.json`

## Instalación

### Opción A: Setup wizard (recomendado)

```bash
git clone https://github.com/tu-usuario/komodo.git
cd komodo
node src/setup.js
```

El wizard te guía paso a paso:

```
🦎 Komodo Setup Wizard
  ─────────────────────────

[1/7] Verificando requisitos...
  ✓ Node.js v22.0.0
  ✓ git 2.42.0
  ✓ gh CLI 2.40.0
  ✓ claude CLI detectado
  ⚠ codex CLI no encontrado
  ✓ gemini CLI detectado

[2/7] Configurando agentes...
  CLIs disponibles: claude, gemini
  CLI para Planner [claude/gemini] (claude): gemini
  CLI para Coder [claude/gemini] (claude): claude
  CLI para Reviewer [claude/gemini] (claude): claude

[3/7] Configurando Firebase...
  Ruta a serviceAccountKey.json (./skills/planning-task-mcp/serviceAccountKey.json):
  ✓ Credenciales encontradas
  Firebase Database URL: https://tu-proyecto.firebasedatabase.app

[4/7] Configurando identidad...
  Tu User ID (Firebase UID): 7Vumkg7gTDVhCeVAw87W5H4rfL43
  Tu nombre: Sergio

[5/7] Configurando GitHub...
  ✓ gh CLI ya autenticado
  Token opcional (gh CLI ya autenticado)

[6/7] Preferencias...
  Auto-merge PRs aprobadas? (Y/n): y
  Máximo rondas de review (1-10) (5): 5

[7/7] Proyecto...
  Project ID del backlog: -OmFjaFM9glBQnBTT7QQ

Generando configuración...
  ✓ .env creado

Instalando dependencias...
  ✓ Dependencias del proyecto instaladas
  ✓ planning-task-mcp instalado
  ✓ github-mcp instalado
  ✓ memory-mcp instalado
  ✓ Slash command /komodo creado para Claude Code

  🦎 Komodo configurado!

  Proyecto:   -OmFjaFM9glBQnBTT7QQ
  Planner:    gemini
  Coder:      claude
  Reviewer:   claude
  Auto-merge: sí
  Max cycles: 5

  Para ejecutar:
  node src/index.js run

  Desde Claude Code:
  /komodo ejecuta 3 tareas
```

**Qué hace el wizard:**
1. Verifica que tienes node, git, gh y al menos un CLI de IA
2. Te pregunta qué CLI usar para cada agente (solo ofrece los que tienes instalados)
3. Configura Firebase, identidad y GitHub
4. Genera el archivo `.env` con toda la configuración
5. Ejecuta `npm install` del proyecto y de los 3 MCPs
6. Si tienes Claude Code → crea el slash command `/komodo`

**Re-ejecutable:** Si ya tienes `.env`, el wizard usa tus valores actuales como defaults. Ejecútalo otra vez para cambiar cualquier configuración.

### Opción B: Manual

```bash
git clone https://github.com/tu-usuario/komodo.git
cd komodo

# Instalar dependencias
npm install
cd skills/planning-task-mcp && npm install && cd ../..
cd skills/github-mcp && npm install && cd ../..
cd skills/memory-mcp && npm install && cd ../..

# Configurar
cp .env.example .env
# Editar .env con tu editor
```

## Configuración

### Variables de entorno (.env)

| Variable | Obligatorio | Descripción | Ejemplo |
|----------|:-----------:|-------------|---------|
| `CLI_PLANNER` | No | CLI para el agente Planner (default: `claude`) | `claude`, `codex`, `gemini` |
| `CLI_CODER` | No | CLI para el agente Coder (default: `claude`) | `claude` |
| `CLI_REVIEWER` | No | CLI para el agente Reviewer (default: `claude`) | `claude` |
| `GOOGLE_APPLICATION_CREDENTIALS` | Si | Ruta al Service Account Key de Firebase | `./skills/planning-task-mcp/serviceAccountKey.json` |
| `FIREBASE_DATABASE_URL` | Si | URL de Firebase Realtime DB | `https://tu-proyecto.firebasedatabase.app` |
| `DEFAULT_USER_ID` | Si | UID del usuario en Firebase Auth | `abc123...` |
| `DEFAULT_USER_NAME` | No | Nombre del usuario | `Sergio` |
| `GITHUB_TOKEN` | No | Token GitHub (opcional si gh está autenticado) | `ghp_...` |
| `WS_PORT` | No | Puerto del WebSocket para el dashboard (default: 3001) | `3001` |
| `MAX_REVIEW_CYCLES` | No | Máximo de rondas coder↔reviewer (default: 5) | `5` |
| `AUTO_MERGE` | No | Auto-merge PRs aprobadas (default: true) | `true` / `false` |
| `DEFAULT_PROJECT_ID` | No | Project ID por defecto (evita -p) | `-OmFja...` |

Puedes mezclar CLIs: por ejemplo, Planner con Gemini (gratis), Coder con Claude (mejor para código), y Reviewer con Codex.

## Uso

```bash
# Ejecutar 1 tarea (default)
node src/index.js run

# Ejecutar N tareas
node src/index.js run -t 3

# Ejecutar hasta vaciar el backlog
node src/index.js run -c

# Proyecto específico (override del default)
node src/index.js run -p <project-id>

# Directorio del repo target
node src/index.js run --cwd /path/to/repo
```

### Desde un CLI de IA

Komodo se puede controlar desde Claude Code, Codex o Gemini CLI en lenguaje natural. Cada CLI lee automáticamente su archivo de instrucciones al abrir el proyecto:

| CLI | Lee | Extra |
|-----|-----|-------|
| Claude Code | `CLAUDE.md` → `KOMODO.md` | Slash command `/komodo` |
| Codex | `AGENTS.md` → `KOMODO.md` | — |
| Gemini CLI | `GEMINI.md` → `KOMODO.md` | — |

Ejemplos desde Claude Code:
```
"hazme 3 tareas"
"ejecuta todas las tareas pendientes"
/komodo ejecuta 2 tareas
```

## Estructura del proyecto

```
komodo/
├── package.json                # Dependencias y scripts
├── .env                        # Variables de entorno (no se sube a git)
├── .env.example                # Plantilla de variables documentada
├── .gitignore                  # Excluye secretos y node_modules
├── README.md                   # Este archivo
├── KOMODO.md                   # Instrucciones para cualquier CLI de IA
├── CLAUDE.md                   # Wrapper → lee KOMODO.md (Claude Code)
├── AGENTS.md                   # Wrapper → lee KOMODO.md (Codex)
├── GEMINI.md                   # Wrapper → lee KOMODO.md (Gemini)
│
├── src/
│   ├── index.js                # CLI entry point (commander)
│   ├── config.js               # Carga .env, valida CLIs y credenciales
│   ├── setup.js                # Wizard de configuración interactivo
│   ├── orchestrator.js         # run(projectId, { tasks, cwd })
│   ├── cycle/
│   │   ├── review-loop.js      # Bucle Coder ↔ Reviewer (máx N rondas)
│   │   └── task-runner.js      # Flujo completo de 1 tarea
│   ├── agents/
│   │   ├── base-agent.js       # Lanza CLIs (claude/codex/gemini) como subprocesos
│   │   ├── planner.js          # pickNextTask(projectId) → elige tarea del backlog
│   │   ├── coder.js            # implementTask() + fixReviewIssues()
│   │   └── reviewer.js         # reviewPR() → review estricta + memoria
│   ├── prompts/
│   │   ├── planner-system.js   # System prompt del Planner
│   │   ├── coder-system.js     # System prompt del Coder (implement + fix)
│   │   └── reviewer-system.js  # System prompt del Reviewer (8 criterios)
│   └── utils/
│       ├── logger.js           # Logging con colores por agente (chalk)
│       └── parser.js           # Extrae JSON de respuestas de agentes IA
│
├── skills/
│   ├── planning-task-mcp/      # MCP de planificación (38 tools, Firebase)
│   ├── github-mcp/             # MCP de GitHub (10 tools, gh CLI)
│   │   ├── src/
│   │   │   ├── index.js        # Entry point MCP server
│   │   │   ├── config.js       # Valida gh instalado y autenticado
│   │   │   ├── gh-cli.js       # Wrapper: runGh(), runGit(), runGhApi()
│   │   │   └── tools/
│   │   │       ├── branches.js # create_branch, list_branches
│   │   │       ├── pulls.js    # create_pr, get_pr, get_pr_diff, list_pr_files
│   │   │       ├── reviews.js  # create_review, list_pr_comments
│   │   │       └── merge.js    # merge_pr, close_pr
│   │   ├── INSTRUCTIONS.md     # Guía para agentes IA
│   │   └── package.json
│   └── memory-mcp/             # MCP de memoria de errores (5 tools)
│       ├── src/
│       │   ├── index.js        # Entry point MCP server
│       │   ├── config.js       # Valida directorio de memoria
│       │   ├── store.js        # Lee/escribe memory/patterns.json (atómico)
│       │   └── tools/
│       │       ├── patterns.js # record_pattern, query_patterns
│       │       └── stats.js    # get_review_brief, record_review_outcome, get_stats
│       ├── INSTRUCTIONS.md     # Guía para agentes IA
│       └── package.json
│
└── memory/
    └── patterns.json           # Almacén local de patrones de error (autogenerado)
```

## Módulos implementados

### `src/config.js`

Carga las variables de entorno y valida que todo esté configurado.

```javascript
import { config, validateConfig } from './config.js';

const errors = validateConfig();
// Verifica: CLIs instalados (claude/codex/gemini), gh CLI, Firebase, userId
```

### `src/utils/logger.js`

Logging con colores por agente. Cada agente tiene su color para identificarlo en la terminal.

```javascript
import { logger } from './utils/logger.js';

logger.info('Leyendo backlog...', 'PLANNER');    // [PLANNER] cyan
logger.success('PR #42 creada', 'CODER');         // [CODER] verde
logger.warn('3 issues encontrados', 'REVIEWER');  // [REVIEWER] amarillo
logger.error('gh CLI no encontrado', 'SYSTEM');   // [SYSTEM] rojo
logger.logStep(2, 5, 'Creando PR...', 'CODER');   // [2/5] paso de progreso
logger.taskHeader('Implementar login');            // Separador visual de tarea
```

### `src/utils/parser.js`

Extrae JSON de las respuestas en texto de los agentes IA (que pueden venir envueltas en markdown, code fences, o mezcladas con texto).

```javascript
import { extractJSON, validateAgentResponse } from './utils/parser.js';

// Funciona con JSON puro, ```json ... ```, o JSON mezclado con texto
const result = extractJSON('Aquí el resultado: {"taskId": "123"}');
// → { taskId: "123" }

const { valid, missing } = validateAgentResponse(result, ['taskId', 'title']);
// → { valid: false, missing: ['title'] }
```

## Sistema de Agentes

Komodo lanza los agentes como **subprocesos CLI reales** (no APIs). Cada agente es una invocación de `claude -p`, `codex` o `gemini` con un system prompt específico y MCPs configurados.

### `src/agents/base-agent.js`

Wrapper que lanza cualquier CLI como subproceso. Genera un archivo temporal de configuración MCP, spawna el CLI, recoge stdout y parsea el JSON de respuesta.

```javascript
import { runAgent } from './agents/base-agent.js';

const result = await runAgent({
  name: 'PLANNER',                    // Para logs
  systemPrompt: '...',                // System prompt del agente
  userPrompt: '...',                  // Instrucción específica
  mcpServerNames: ['planning-task-mcp'],  // MCPs a conectar
  maxTurns: 15,                       // Máximo de iteraciones
});
// → { success, result, cost, turns, duration }
```

### Agentes disponibles

| Agente | CLI por defecto | MCPs | Puede escribir código | Función |
|--------|----------------|------|-----------------------|---------|
| **Planner** | `CLI_PLANNER` | planning-task-mcp | No | `pickNextTask(projectId)` |
| **Coder** | `CLI_CODER` | github-mcp | Sí (Read, Write, Edit, Bash) | `implementTask(taskSpec)` / `fixReviewIssues(...)` |
| **Reviewer** | `CLI_REVIEWER` | github-mcp, memory-mcp | No (Write/Edit bloqueados) | `reviewPR({ prNumber, repo, taskSpec })` |

### Flujo de comunicación

Los agentes NO hablan entre sí. Komodo es el intermediario:

```
Planner → devuelve { taskId, branchName, ... }
    ↓ Komodo pasa los datos
Coder → devuelve { prNumber, prUrl, ... }
    ↓ Komodo pasa los datos
Reviewer → devuelve { verdict, issues[], ... }
    ↓ Si REQUEST_CHANGES, Komodo pasa feedback al Coder
Coder → arregla y pushea
    ↓ Bucle hasta APPROVED (máx MAX_REVIEW_CYCLES)
Merge → tarea "done"
```

## MCPs (Model Context Protocol Servers)

### planning-task-mcp (existente)

38 tools para gestión completa de proyectos: tareas con User Stories, sprints, bugs, propuestas, miembros, analytics. Conectado a Firebase Realtime Database.

### github-mcp (10 tools)

Envuelve el CLI `gh` como servidor MCP. Todas las operaciones de GitHub sin tocar la API directamente.

| Tool | Descripción |
|------|-------------|
| `create_branch` | Crea branch desde main (local con git o remoto via API) |
| `list_branches` | Lista branches con filtro opcional |
| `create_pr` | Abre una Pull Request |
| `get_pr` | Detalles completos de una PR (state, author, additions, deletions) |
| `get_pr_diff` | Diff completo como texto |
| `list_pr_files` | Archivos cambiados con estadísticas |
| `create_review` | Envía review (APPROVE/REQUEST_CHANGES) con comentarios inline |
| `list_pr_comments` | Lista reviews y comentarios inline |
| `merge_pr` | Mergea PR (squash/merge/rebase) con opción de borrar branch |
| `close_pr` | Cierra PR sin mergear con comentario opcional |

**Helper interno:** `gh-cli.js` proporciona `runGh()`, `runGit()` y `runGhApi()` como wrappers del CLI `gh` con manejo de errores, parseo JSON y timeouts.

### memory-mcp (5 tools)

Sistema de memoria persistente. Guarda patrones de errores que comete el Coder para que el Reviewer los tenga en cuenta en futuras reviews. Almacena en `memory/patterns.json`.

| Tool | Descripción |
|------|-------------|
| `record_pattern` | Registra un patrón de error/antipatrón. Si ya existe uno similar, incrementa frecuencia |
| `query_patterns` | Busca patrones por tags, tipo, severidad o texto libre. Ordenados por frecuencia |
| `get_review_brief` | Devuelve resumen formateado de los top errores (se inyecta al Reviewer) |
| `record_review_outcome` | Registra si una review pasó o falló + número de ciclos |
| `get_stats` | Estadísticas: total reviews, pass rate, media de ciclos, errores más comunes |

**Esquema de un patrón:**
```json
{
  "id": "uuid",
  "type": "error | anti-pattern | style | positive",
  "description": "No maneja errores después de fetch",
  "tags": ["error-handling", "async"],
  "severity": "high | medium | low",
  "resolution": "Siempre envolver fetch en try/catch",
  "frequency": 5,
  "firstSeen": "2026-02-27",
  "lastSeen": "2026-03-01"
}
```

**Flujo del Reviewer:** Antes de cada review llama a `get_review_brief` → recibe un brief con los errores más frecuentes → revisa el código → registra issues con `record_pattern` → cierra con `record_review_outcome`.

## Dependencias

| Paquete | Uso |
|---------|-----|
| `@modelcontextprotocol/sdk` | Framework para crear MCPs |
| `commander` | CLI de Komodo (run, status, memory) |
| `chalk` | Colores en terminal |
| `dotenv` | Carga de variables de entorno |
| `zod` | Validación de schemas MCP |
| `uuid` | IDs para patrones de memoria |

## Licencia

MIT
