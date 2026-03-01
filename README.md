# Komodo - Orquestador de Agentes IA para Codigo

Komodo es un orquestador que coordina agentes IA (Claude Code, Codex, Gemini CLI) para desarrollar software de forma autonoma. Conectado a un sistema de planificacion de tareas, gestiona el ciclo completo: planificar, programar, revisar y mergear.

## Arquitectura

```
              +---------------------------+
              |    KOMODO ORCHESTRATOR    |
              +-----------+---------------+
                          |
         +----------------+------------------+
         |                |                  |
    +----v----+      +----v----+       +-----v-----+
    | PLANNER |      |  CODER  |       | REVIEWER  |
    | (CLI)   |      | (CLI)   |       | (CLI)     |
    +----+----+      +----+----+       +-----+-----+
         |                |                  |
    planning-mcp     github-mcp          github-mcp
                                         memory-mcp
```

**Los agentes son terminales CLI reales** (Claude Code, Codex, Gemini CLI), no APIs de pago. Cada agente se lanza como subproceso con `child_process.spawn`. Los prompts se envian via stdin (pipe), nunca como argumentos CLI, lo que garantiza compatibilidad total con Windows y Linux. Puedes mezclar CLIs: Planner con Gemini, Coder con Claude, Reviewer con Codex.

### Flujo de una tarea

1. **Planner** lee el backlog, elige la tarea con mayor prioridad, la marca "in-progress"
2. **Coder** recibe la tarea, implementa el codigo, crea branch, push, abre PR
3. **Reviewer** lee el diff de la PR, consulta memoria de errores, revisa estrictamente
4. Si hay cambios pedidos -> **Coder** recibe feedback, arregla, push
5. Bucle Coder<->Reviewer hasta APPROVED (maximo configurable de rondas)
6. Se mergea la PR, se actualiza la tarea a "done", se guardan patrones en memoria

## Requisitos previos

Antes de instalar Komodo necesitas tener lo siguiente en tu sistema:

### 1. Node.js (se recomienda la ultima version LTS o current)

```bash
# Verificar version
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

# Verificar instalacion
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

Komodo se conecta a la app de planificacion Planning Task a traves de Firebase:

1. Tener un proyecto en [Firebase Console](https://console.firebase.google.com/)
2. Activar **Realtime Database**
3. Descargar el **Service Account Key** (JSON) desde Configuracion del proyecto -> Cuentas de servicio -> Generar nueva clave privada
4. Colocar el archivo en `skills/planning-task-mcp/serviceAccountKey.json`

## Instalacion

### Opcion A: Setup wizard (recomendado)

```bash
git clone https://github.com/SergioRVDev/komodo.git
cd komodo
node src/setup.js
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
  node src/index.js run

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

## Configuracion

### Variables de entorno (.env)

| Variable | Obligatorio | Descripcion | Ejemplo |
|----------|:-----------:|-------------|---------|
| `CLI_PLANNER` | No | CLI para el agente Planner (default: `claude`) | `claude`, `codex`, `gemini` |
| `CLI_CODER` | No | CLI para el agente Coder (default: `claude`) | `claude` |
| `CLI_REVIEWER` | No | CLI para el agente Reviewer (default: `claude`) | `claude` |
| `GOOGLE_APPLICATION_CREDENTIALS` | Si | Ruta al Service Account Key de Firebase | `./skills/planning-task-mcp/serviceAccountKey.json` |
| `FIREBASE_DATABASE_URL` | Si | URL de Firebase Realtime DB | `https://tu-proyecto.firebasedatabase.app` |
| `DEFAULT_USER_ID` | Si | UID del usuario en Firebase Auth | `abc123...` |
| `DEFAULT_USER_NAME` | No | Nombre del usuario | `Sergio` |
| `GITHUB_TOKEN` | No | Token GitHub (opcional si gh esta autenticado) | `ghp_...` |
| `WS_PORT` | No | Puerto del WebSocket para el dashboard (default: 3001) | `3001` |
| `MAX_REVIEW_CYCLES` | No | Maximo de rondas coder<->reviewer (default: 5) | `5` |
| `AUTO_MERGE` | No | Auto-merge PRs aprobadas (default: true) | `true` / `false` |
| `DEFAULT_PROJECT_ID` | No | Project ID por defecto (evita -p) | `-OmFja...` |
| `ENABLE_BROWSER_MCP` | No | Habilitar Chrome DevTools MCP (default: false) | `true` / `false` |
| `CHROME_DEBUGGER_PORT` | No | Puerto de Chrome remote debugging (default: 9222) | `9222` |

Puedes mezclar CLIs: por ejemplo, Planner con Gemini (gratis), Coder con Claude (mejor para codigo), y Reviewer con Codex.

## Uso

```bash
# Ejecutar 1 tarea (default)
node src/index.js run

# Ejecutar N tareas
node src/index.js run -t 3

# Ejecutar hasta vaciar el backlog
node src/index.js run -c

# Proyecto especifico (override del default)
node src/index.js run -p <project-id>

# Directorio del repo target
node src/index.js run --cwd /path/to/repo

# Simulacion: ver que tarea elegiria sin ejecutar nada
node src/index.js run --dry-run
```

### Desde un CLI de IA

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

### Modo MCP (komodo-mcp)

Ademas del CLI, Komodo funciona como servidor MCP. Esto permite usar el orquestador desde **cualquier cliente MCP** (Claude Code Pro, Codex, etc.) sin el CLI, directamente como tools:

```
komodo_plan -> komodo_code -> komodo_review -> (komodo_fix) -> komodo_finalize
```

| Tool | Descripcion |
|------|-------------|
| `komodo_plan` | Planner elige la siguiente tarea del backlog |
| `komodo_code` | Coder implementa: crea branch, escribe codigo, abre PR |
| `komodo_review` | Reviewer revisa la PR (8 criterios estrictos) |
| `komodo_fix` | Coder arregla issues encontrados en el review |
| `komodo_finalize` | Merge/close PR + actualizar estado de tarea |
| `komodo_run` | Ciclo completo automatico de N tareas |
| `komodo_status` | Configuracion actual de Komodo |

## Estructura del proyecto

```
komodo/
+-- package.json                  # Dependencias y scripts
+-- .env                          # Variables de entorno (no se sube a git)
+-- .env.example                  # Plantilla de variables documentada
+-- .gitignore                    # Excluye secretos y node_modules
+-- README.md                     # Este archivo
+-- KOMODO.md                     # Instrucciones para cualquier CLI de IA
+-- CLAUDE.md                     # Wrapper -> lee KOMODO.md (Claude Code)
+-- AGENTS.md                     # Wrapper -> lee KOMODO.md (Codex)
+-- GEMINI.md                     # Wrapper -> lee KOMODO.md (Gemini)
|
+-- src/
|   +-- index.js                  # CLI entry point (commander)
|   +-- config.js                 # Carga .env, valida CLIs y credenciales
|   +-- setup.js                  # Wizard de configuracion interactivo
|   +-- orchestrator.js           # run(projectId, { tasks, cwd })
|   +-- cycle/
|   |   +-- review-loop.js        # Bucle Coder <-> Reviewer (max N rondas)
|   |   +-- task-runner.js        # Flujo completo de 1 tarea con error recovery
|   +-- agents/
|   |   +-- base-agent.js         # Core: lanza CLIs via stdin pipe + MCP config
|   |   +-- planner.js            # pickNextTask(projectId) -> elige tarea del backlog
|   |   +-- coder.js              # implementTask() + fixReviewIssues()
|   |   +-- reviewer.js           # reviewPR() -> review estricta + memoria
|   +-- prompts/
|   |   +-- planner-system.js     # System prompt del Planner
|   |   +-- coder-system.js       # System prompt del Coder (implement + fix)
|   |   +-- reviewer-system.js    # System prompt del Reviewer (8 criterios)
|   +-- utils/
|       +-- logger.js             # Logging con colores por agente (chalk)
|       +-- parser.js             # Extrae JSON de respuestas de agentes IA
|
+-- scripts/
|   +-- launch-chrome-debug.js    # Lanza Chrome con remote debugging
|
+-- skills/
|   +-- planning-task-mcp/        # MCP de planificacion (38 tools, Firebase)
|   +-- github-mcp/               # MCP de GitHub (10 tools, gh CLI)
|   +-- memory-mcp/               # MCP de memoria de errores (5 tools)
|   +-- komodo-mcp/               # MCP del orquestador (7 tools)
|       +-- src/
|       |   +-- index.js           # Entry point MCP server
|       |   +-- tools.js           # Tools: plan, code, review, fix, finalize, run, status
|       +-- package.json
|
+-- memory/
    +-- patterns.json             # Almacen local de patrones de error (autogenerado)
```

## Sistema de Agentes

Komodo lanza los agentes como **subprocesos CLI reales** (no APIs). Cada agente es una invocacion de `claude`, `codex` o `gemini` como subproceso con un system prompt especifico y MCPs conectados.

### Como se comunican los agentes con los CLIs

**Todos los prompts se envian via stdin pipe**, nunca como argumentos de linea de comandos. Esto evita problemas de shell escaping en cualquier plataforma (Windows, Linux, macOS). Solo se pasan flags cortos y seguros como argumentos CLI (`--output-format json`, `--mcp-config`, etc.). Ver [docs/STDIN-FIX.md](docs/STDIN-FIX.md) para la explicacion completa.

```javascript
import { runAgent } from './agents/base-agent.js';

const result = await runAgent({
  name: 'PLANNER',                        // Para logs
  systemPrompt: '...',                    // Se envia via stdin
  userPrompt: '...',                      // Se envia via stdin
  mcpServerNames: ['planning-task-mcp'],  // MCPs a conectar
  maxTurns: 15,                           // Maximo de iteraciones
});
// -> { success, result, cost, turns, duration }
```

### Agentes disponibles

| Agente | CLI por defecto | MCPs | Puede escribir codigo | Funcion |
|--------|----------------|------|-----------------------|---------|
| **Planner** | `CLI_PLANNER` | planning-task-mcp | No | `pickNextTask(projectId)` |
| **Coder** | `CLI_CODER` | github-mcp | Si (Read, Write, Edit, Bash) | `implementTask(taskSpec)` / `fixReviewIssues(...)` |
| **Reviewer** | `CLI_REVIEWER` | github-mcp, memory-mcp | No (Write/Edit bloqueados) | `reviewPR({ prNumber, repo, taskSpec })` |

### Flujo de comunicacion

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

## MCPs (Model Context Protocol Servers)

### komodo-mcp (7 tools)

MCP del propio orquestador. Permite usar Komodo desde cualquier cliente MCP (Claude Code Pro, Codex, etc.) **sin necesidad del CLI**.

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

Internamente, cada tool lanza un agente CLI (claude/codex/gemini) como subproceso con stdin pipe, igual que el CLI de Komodo. El MCP es un wrapper que expone la misma funcionalidad como herramientas MCP.

### planning-task-mcp (38 tools)

Sistema completo de gestion de proyectos sobre Firebase Realtime Database: tareas con User Stories, sprints, bugs, propuestas, miembros, analytics, notificaciones.

### github-mcp (10 tools)

Envuelve el CLI `gh` como servidor MCP. Todas las operaciones de GitHub sin tocar la API directamente.

| Tool | Descripcion |
|------|-------------|
| `create_branch` | Crea branch desde main (local con git o remoto via API) |
| `list_branches` | Lista branches con filtro opcional |
| `create_pr` | Abre una Pull Request |
| `get_pr` | Detalles completos de una PR |
| `get_pr_diff` | Diff completo como texto |
| `list_pr_files` | Archivos cambiados con estadisticas |
| `create_review` | Envia review (APPROVE/REQUEST_CHANGES) con comentarios inline |
| `list_pr_comments` | Lista reviews y comentarios inline |
| `merge_pr` | Mergea PR (squash/merge/rebase) con opcion de borrar branch |
| `close_pr` | Cierra PR sin mergear con comentario opcional |

### memory-mcp (5 tools)

Sistema de memoria persistente. Guarda patrones de errores que comete el Coder para que el Reviewer los tenga en cuenta en futuras reviews. Almacena en `memory/patterns.json`.

| Tool | Descripcion |
|------|-------------|
| `record_pattern` | Registra un patron de error/antipatron. Si ya existe uno similar, incrementa frecuencia |
| `query_patterns` | Busca patrones por tags, tipo, severidad o texto libre |
| `get_review_brief` | Devuelve resumen de los top errores (se inyecta al Reviewer) |
| `record_review_outcome` | Registra si una review paso o fallo + numero de ciclos |
| `get_stats` | Estadisticas: total reviews, pass rate, media de ciclos |

### chrome-devtools (opcional)

MCP externo que conecta los agentes con Chrome DevTools. Permite inspeccionar la consola del navegador, tomar screenshots, analizar network, performance y DOM en tiempo real. Util para detectar errores de runtime que solo se ven en el navegador.

**Requisitos:** Chrome instalado y Node.js v20.19+.

**Activar:**

1. En `.env`, establecer `ENABLE_BROWSER_MCP=true`
2. Lanzar Chrome con remote debugging antes de ejecutar Komodo:

```bash
# Opcion A: Usar el script incluido (detecta Chrome automaticamente)
npm run chrome:debug

# Opcion B: Lanzar Chrome manualmente
# Windows:
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222

# macOS:
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222

# Linux:
google-chrome --remote-debugging-port=9222
```

3. Ejecutar Komodo normalmente. Los agentes que incluyan `chrome-devtools` en su lista de MCPs podran inspeccionar el navegador.

**Puerto personalizado:** Cambiar `CHROME_DEBUGGER_PORT` en `.env` (default: 9222). El script `npm run chrome:debug` acepta `--port`:

```bash
npm run chrome:debug -- --port 9333
```

## Dependencias

| Paquete | Uso |
|---------|-----|
| `@modelcontextprotocol/sdk` | Framework para crear MCPs |
| `commander` | CLI de Komodo (run, status) |
| `chalk` | Colores en terminal |
| `dotenv` | Carga de variables de entorno |
| `zod` | Validacion de schemas MCP |
| `uuid` | IDs para patrones de memoria |

## Documentacion adicional

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) - Arquitectura tecnica detallada de cada modulo
- [docs/STDIN-FIX.md](docs/STDIN-FIX.md) - Como se resolvio el bug critico de shell escaping en Windows (explicacion tecnica y no tecnica)
- [KOMODO.md](KOMODO.md) - Instrucciones para CLIs de IA

## Licencia

MIT
