# Arquitectura Tecnica de Komodo

Documentacion tecnica interna del proyecto. Explica como esta construido cada modulo, que decisiones de diseno se tomaron y como encaja todo.

---

## Vision general

Komodo es un orquestador que lanza agentes IA como **subprocesos de terminal** (no APIs). Cada agente (Planner, Coder, Reviewer) es una invocacion de un CLI (`claude`, `codex`, `gemini`) con MCPs conectados.

**Principio fundamental:** Todos los prompts (system + user) se envian via stdin pipe, nunca como argumentos CLI. Solo flags cortos y seguros (`--output-format json`, `--mcp-config`, etc.) van como argumentos. Esto garantiza compatibilidad total con Windows y Linux sin problemas de shell escaping. Ver [STDIN-FIX.md](STDIN-FIX.md) para la explicacion completa.

```
Usuario -> komodo run --project <id>
                |
                v
        +----------------+
        |  ORCHESTRATOR  |   (src/orchestrator.js)
        |                |
        |  1. Planner    |-->  planning-task-mcp --> Firebase
        |  2. Coder      |-->  github-mcp --> gh CLI --> GitHub
        |  3. Reviewer   |-->  github-mcp + memory-mcp
        |  4. Merge      |
        +----------------+
```

Los agentes **NO hablan entre si**. Komodo recoge el JSON de salida de uno y lo inyecta en el prompt del siguiente.

---

## Estructura de archivos

```
komodo/
+-- KOMODO.md                        # Instrucciones para cualquier CLI de IA
+-- CLAUDE.md                        # Wrapper -> lee KOMODO.md (Claude Code)
+-- AGENTS.md                        # Wrapper -> lee KOMODO.md (Codex)
+-- GEMINI.md                        # Wrapper -> lee KOMODO.md (Gemini)
+-- .claude/commands/komodo.md       # Slash command /komodo (Claude Code)
|
+-- src/
|   +-- index.js                   # CLI entry point (commander)
|   +-- config.js                  # Carga .env, valida CLIs y credenciales
|   +-- setup.js                   # Wizard de configuracion interactivo
|   +-- orchestrator.js            # run(projectId, { tasks, cwd })
|   +-- agents/
|   |   +-- base-agent.js          # Core: spawn CLIs + stdin pipe + MCP config
|   |   +-- planner.js             # pickNextTask(projectId)
|   |   +-- coder.js               # implementTask() + fixReviewIssues()
|   |   +-- reviewer.js            # reviewPR() + normalizeVerdict()
|   +-- cycle/
|   |   +-- review-loop.js         # Bucle Coder <-> Reviewer (max N rondas)
|   |   +-- task-runner.js         # Flujo completo de 1 tarea con recovery
|   +-- prompts/
|   |   +-- planner-system.js      # System prompt del Planner
|   |   +-- coder-system.js        # System prompt del Coder (2 modos)
|   |   +-- reviewer-system.js     # System prompt del Reviewer (8 criterios)
|   +-- utils/
|       +-- logger.js              # Logs con colores por agente (chalk)
|       +-- parser.js              # Extrae JSON de respuestas de IAs
|
+-- skills/
|   +-- planning-task-mcp/         # 38 tools sobre Firebase
|   +-- github-mcp/                # 10 tools - wrapper de gh CLI
|   +-- memory-mcp/                # 5 tools - patrones de error en JSON local
|   +-- komodo-mcp/                # 7 tools - orquestador como MCP
|
+-- memory/
    +-- patterns.json              # Almacen de patrones (autogenerado)
```

---

## Modulo: `src/config.js`

Carga `.env` con dotenv y exporta un objeto `config` con toda la configuracion.

### Deteccion de CLIs

Comprueba si `claude`, `codex` y `gemini` existen en el sistema:

```javascript
function cliExists(name) {
  try {
    execFileSync(name, ['--version'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}
```

Si `CLI_PLANNER=claude` pero claude no esta instalado, `validateConfig()` devuelve un error.

### Resolucion de rutas

Usa `import.meta.url` para resolver rutas relativas al proyecto (necesario en ESM, donde `__dirname` no existe):

```javascript
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '..');
```

### `validateConfig()`

Devuelve un array de errores. Vacio = todo OK. Comprueba:

1. Al menos un CLI de IA instalado
2. Los CLIs asignados en .env existen
3. `gh` CLI instalado
4. Credenciales de Firebase (`GOOGLE_APPLICATION_CREDENTIALS`, `FIREBASE_DATABASE_URL`)
5. `DEFAULT_USER_ID` configurado

---

## Modulo: `src/utils/logger.js`

Logger con colores por agente usando chalk. Cada agente tiene un color asignado para identificarlo visualmente en la terminal.

### Colores por agente

| Agente | Color | Chalk |
|--------|-------|-------|
| KOMODO | Magenta | `chalk.magentaBright` |
| PLANNER | Azul | `chalk.blueBright` |
| CODER | Verde | `chalk.greenBright` |
| REVIEWER | Amarillo | `chalk.yellowBright` |
| SYSTEM | Gris | `chalk.gray` |

### Metodos

```javascript
logger.info(mensaje, agente)           // Info general
logger.success(mensaje, agente)        // Operacion exitosa (verde)
logger.warn(mensaje, agente)           // Advertencia (amarillo)
logger.error(mensaje, agente)          // Error (rojo)
logger.logStep(actual, total, msg, ag) // [2/5] Progreso de pasos
logger.taskHeader(titulo)              // === separador visual ===
```

Cada linea lleva timestamp en formato `HH:MM:SS` (locale `es-ES`).

---

## Modulo: `src/utils/parser.js`

Extrae JSON de respuestas de agentes IA. Los LLMs devuelven el JSON mezclado con texto, dentro de code fences, o con explicaciones antes/despues.

### `extractJSON(text)` -- 3 estrategias en orden

```
1. JSON.parse(text)             -> Es JSON puro?
2. Regex /```json\n(.*)\n```/   -> Esta en code fence?
3. Bracket balancing            -> Buscar el primer { } o [ ] balanceado
```

La estrategia 3 (bracket balancing) es la mas robusta. Recorre el texto caracter a caracter, trackea si esta dentro de un string (para no confundir `{` dentro de strings), y encuentra el primer JSON valido.

### `validateAgentResponse(json, requiredFields)`

Valida que un JSON tenga los campos obligatorios:

```javascript
const { valid, missing } = validateAgentResponse(data, ['taskId', 'title']);
// -> { valid: false, missing: ['title'] }
```

---

## Modulo: `src/agents/base-agent.js`

**El core del sistema de agentes.** Este modulo fue reescrito desde cero para resolver un bug critico de shell escaping en Windows (ver [STDIN-FIX.md](STDIN-FIX.md)). Hace 3 cosas:

1. Genera un archivo temporal de MCP config
2. Spawna el CLI como subproceso y envia el prompt via stdin
3. Parsea su salida JSON

### Principio de diseno: stdin pipe

**TODOS los prompts (system + user) se envian via stdin, NUNCA como argumentos CLI.**

Esto es critico porque:
- En Windows, `spawn` con `shell: true` usa `cmd.exe` que no soporta quoting complejo
- Los prompts contienen comillas, caracteres especiales, IDs que empiezan con `-`
- Al enviar via stdin, el contenido del prompt nunca pasa por el shell

```
ANTES (roto en Windows):
  spawn('claude', ['-p', 'Analiza "ID-que-empieza-con-guion"', '--system-prompt', '...'])
  -> cmd.exe rompe el quoting -> el ID se interpreta como flag

AHORA (funciona en todas las plataformas):
  spawn('claude', ['--output-format', 'json', '--mcp-config', '...'])
  child.stdin.write(systemPrompt + '\n\n---\n\n' + userPrompt)
  child.stdin.end()
  -> El prompt va por stdin, nunca toca el shell
```

### Archivo temporal de MCP config

Cada vez que se lanza un agente, se genera un `.tmp/mcp-<uuid>.json`:

```json
{
  "mcpServers": {
    "github-mcp": {
      "command": "node",
      "args": ["C:/.../skills/github-mcp/src/index.js"],
      "env": { "GITHUB_TOKEN": "..." }
    }
  }
}
```

Se pasa al CLI con `--mcp-config` y se borra en el `finally` (limpieza garantizada aunque falle).

### Adaptadores de CLI (`CLI_ADAPTERS`)

Cada CLI tiene flags diferentes. `CLI_ADAPTERS` abstrae las diferencias. Cada adaptador tiene 3 metodos:

```javascript
const CLI_ADAPTERS = {
  claude: {
    // Solo flags cortos y seguros. NUNCA prompts como args.
    buildArgs({ mcpConfigPath, maxTurns, model, allowedTools, disallowedTools }) {
      const args = ['--output-format', 'json'];
      if (mcpConfigPath) args.push('--mcp-config', mcpConfigPath, '--strict-mcp-config');
      if (maxTurns) args.push('--max-turns', String(maxTurns));
      if (model) args.push('--model', model);
      args.push('--permission-mode', 'bypassPermissions');
      return args;
    },

    // Combina system + user prompt para stdin pipe.
    // Claude CLI lee de stdin cuando detecta que no es un TTY.
    buildStdin({ systemPrompt, userPrompt }) {
      if (systemPrompt) {
        return `${systemPrompt}\n\n---\n\n${userPrompt}`;
      }
      return userPrompt;
    },

    // Claude emite lineas JSON; buscamos type: "result"
    parseOutput(stdout) { /* ... */ },
  },

  codex: { /* buildArgs, buildStdin, parseOutput */ },
  gemini: { /* buildArgs, buildStdin, parseOutput */ },
};
```

**Flags de Claude Code usados (solo como CLI args):**

| Flag | Funcion |
|------|---------|
| `--output-format json` | Salida en JSON linea a linea |
| `--mcp-config` | Ruta al JSON de MCPs |
| `--strict-mcp-config` | Solo usa los MCPs pasados (ignora globales) |
| `--permission-mode bypassPermissions` | Sin pedir permisos |
| `--max-turns` | Limite de iteraciones |
| `--allowed-tools` / `--disallowed-tools` | Control de herramientas |
| `--model` | Modelo especifico |

**Prompts NO van como args -- van por stdin:**

| Dato | Como se envia |
|------|---------------|
| System prompt | `child.stdin.write(systemPrompt + '\n\n---\n\n' + userPrompt)` |
| User prompt | Combinado con system prompt en stdin |

### `spawnCli()` -- Proceso con stdin pipe e idle timeout

Usa `child_process.spawn` para lanzar el CLI. El mecanismo tiene dos partes criticas:

**1. Stdin pipe (core del fix cross-platform):**

```javascript
const child = spawn(command, args, {
  cwd: options.cwd,
  stdio: ['pipe', 'pipe', 'pipe'],  // stdin es un pipe, no TTY
  env: { ...process.env },
  shell: process.platform === 'win32',  // Windows necesita shell para .cmd
});

// Enviar prompt via stdin -- nunca como CLI arg
if (options.stdinData) {
  child.stdin.write(options.stdinData);
  child.stdin.end();
}
```

El CLI detecta que stdin es un pipe (no un TTY) y lee el prompt de ahi. Funciona en todas las plataformas porque `child.stdin.write()` envia datos directamente al proceso hijo sin pasar por el shell.

**2. Idle timeout (no fijo):**

Timer de 3 minutos que se reinicia cada vez que el CLI produce output. Mientras el agente trabaje (produzca output), no se mata. Solo se corta si lleva 3 minutos en silencio total.

### `runAgent()` -- Flujo completo

```
runAgent({ name, systemPrompt, userPrompt, mcpServerNames, ... })
  |
  +-- 1. Resolver CLI: cliMap[name] || config.cliXxx || 'claude'
  +-- 2. buildMcpServers(serverNames) -> definiciones de MCPs
  +-- 3. generateMcpConfig(servers) -> .tmp/mcp-<uuid>.json
  +-- 4. adapter.buildArgs(...) -> argumentos CLI (solo flags cortos)
  +-- 5. adapter.buildStdin(...) -> systemPrompt + userPrompt combinados
  +-- 6. spawnCli(cli, args, { stdinData }) -> ejecutar con stdin pipe
  +-- 7. adapter.parseOutput(stdout) -> { rawResult, cost, turns }
  +-- 8. extractJSON(rawResult) -> JSON limpio
  +-- return { success, result, cost, turns, duration }
       +-- finally: unlinkSync(mcpConfigPath)
```

### `buildMcpServers()` -- Registro de MCPs

Define como lanzar cada MCP disponible:

```javascript
const definitions = {
  'planning-task-mcp': {
    command: 'node',
    args: [resolve(config.planningMcpDir, 'src', 'index.js')],
    env: { GOOGLE_APPLICATION_CREDENTIALS, FIREBASE_DATABASE_URL, ... },
  },
  'github-mcp': {
    command: 'node',
    args: [resolve(config.githubMcpDir, 'src', 'index.js')],
    env: { GITHUB_TOKEN },
  },
  'memory-mcp': {
    command: 'node',
    args: [resolve(config.memoryMcpDir, 'src', 'index.js')],
    env: {},
  },
};
```

---

## Los 3 agentes

### Planner (`src/agents/planner.js`)

**Funcion:** `pickNextTask(projectId)` -- Elige la tarea con mayor prioridad del backlog.

**MCP:** `planning-task-mcp` (solo lectura del backlog + cambiar estado)

**Criterios de seleccion (en orden):**
1. Solo tareas en estado "to-do"
2. Mayor ratio `bizPoints / devPoints`
3. Dependencias (si A depende de B, hacer B primero)
4. Preferir tareas del sprint activo

**Branch naming:** `feature/task-{ultimos 6 chars del ID}-{slug-del-titulo}`

**Config:** `maxTurns: 15`

### Coder (`src/agents/coder.js`)

**MCP:** `github-mcp` + herramientas nativas del CLI (Read, Write, Edit, Bash, Glob, Grep)

#### Modo 1: `implementTask(taskSpec, cwd)` -- `maxTurns: 50`

Explora codigo, crea branch, implementa, hace tests, commit, push, abre PR.

#### Modo 2: `fixReviewIssues(taskSpec, prNumber, reviewFeedback, cwd)` -- `maxTurns: 40`

Lee feedback del Reviewer, arregla cada issue, commit + push al mismo branch. NO crea nueva PR.

### Reviewer (`src/agents/reviewer.js`)

**MCPs:** `github-mcp` + `memory-mcp`

**Restriccion:** `disallowedTools: ['Write', 'Edit', 'NotebookEdit']` -- solo lee, no modifica.

**8 criterios:** Correctitud, error handling, edge cases, naming, estructura, tests, seguridad, patrones conocidos.

**`normalizeVerdict()`:** Red de seguridad que fuerza consistencia. APPROVED solo si score >= 8 Y 0 critical Y 0 major.

---

## MCP: `skills/github-mcp`

Envuelve el CLI `gh` como servidor MCP. 10 tools: create_branch, list_branches, create_pr, get_pr, get_pr_diff, list_pr_files, create_review, list_pr_comments, merge_pr, close_pr.

## MCP: `skills/memory-mcp`

Memoria persistente en `memory/patterns.json`. 5 tools: record_pattern, query_patterns, get_review_brief, record_review_outcome, get_stats. Escritura atomica con rename.

## MCP: `skills/komodo-mcp`

7 tools que wrappean el orquestador. Cada tool spawna un subproceso CLI con stdin pipe. Registrado en `.claude/settings.local.json` con key `komodo-mcp`.

**Nota cache:** El MCP server cachea modulos ESM en memoria. Tras cambios en codigo, reiniciar el proceso (matar y dejar que el cliente lo relance).

---

## Orquestacion

### Task Runner (`src/cycle/task-runner.js`)

Flujo completo de 1 tarea: Planner -> Coder -> Review Loop -> Merge. Con error recovery automatico (rollback tareas, cerrar PRs huerfanas).

### Review Loop (`src/cycle/review-loop.js`)

Bucle Coder <-> Reviewer hasta APPROVED o max ciclos (`MAX_REVIEW_CYCLES`, default 5).

---

## Decisiones de diseno

### CLIs como subprocesos (no APIs)

Los CLIs de terminal tienen acceso a herramientas nativas (Read, Write, Edit, Bash) que no estan disponibles por API. El Coder necesita escribir archivos y hacer git push -- solo posible con el CLI.

### Stdin pipe en vez de argumentos CLI

En Windows, `spawn` con `shell: true` usa `cmd.exe` que no soporta quoting complejo. Los prompts con comillas e IDs que empiezan con `-` rompen el parsing. Stdin pipe evita el shell completamente. Ver [STDIN-FIX.md](STDIN-FIX.md).

### Idle timeout en vez de fijo

Timer de 3 min que se reinicia con cada output. Permite tareas largas pero detecta agentes colgados.

### `normalizeVerdict()` como red de seguridad

Verifica programaticamente el verdict -- un LLM puede decir "APPROVED" con score 5/10.

### MCP config temporal por ejecucion

`.tmp/mcp-<uuid>.json` por agente, UUID para evitar colisiones, `finally` para limpieza.

### Escritura atomica en memory-mcp

Escribe a `.tmp` y renombra. `renameSync` es atomico en el mismo filesystem.

---

## Configuracion de entorno

### Variables (.env)

| Variable | Obligatorio | Default | Descripcion |
|----------|:-----------:|---------|-------------|
| `CLI_PLANNER` | No | `claude` | CLI del Planner |
| `CLI_CODER` | No | `claude` | CLI del Coder |
| `CLI_REVIEWER` | No | `claude` | CLI del Reviewer |
| `GOOGLE_APPLICATION_CREDENTIALS` | Si | -- | Ruta a serviceAccountKey.json |
| `FIREBASE_DATABASE_URL` | Si | -- | URL de Firebase Realtime DB |
| `DEFAULT_USER_ID` | Si | -- | UID del usuario en Firebase |
| `DEFAULT_USER_NAME` | No | `Komodo` | Nombre del usuario |
| `GITHUB_TOKEN` | No | -- | Token GitHub (opcional si gh autenticado) |
| `MAX_REVIEW_CYCLES` | No | `5` | Max rondas Coder<->Reviewer |
| `AUTO_MERGE` | No | `true` | Si true, mergea PR automaticamente |
| `DEFAULT_PROJECT_ID` | No | -- | Project ID por defecto |

### Dependencias

| Paquete | Version | Uso |
|---------|---------|-----|
| `@modelcontextprotocol/sdk` | ^1.12.1 | Framework para crear MCPs |
| `commander` | ^12.0.0 | CLI de Komodo |
| `chalk` | ^5.3.0 | Colores en terminal |
| `dotenv` | ^16.4.7 | Carga de .env |
| `zod` | ^3.24.2 | Validacion de schemas MCP |
| `uuid` | ^9.0.0 | IDs para patrones de memoria |

### Requisitos del sistema

- Node.js >= 18
- `gh` CLI instalado y autenticado (`gh auth login`)
- `git` instalado
- Al menos un CLI de IA (claude, codex, o gemini)
