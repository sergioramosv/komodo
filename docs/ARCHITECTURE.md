# Arquitectura Técnica de Komodo

Documentación técnica interna del proyecto. Explica cómo está construido cada módulo, qué decisiones de diseño se tomaron y cómo encaja todo.

---

## Visión general

Komodo es un orquestador que lanza agentes IA como **subprocesos de terminal** (no APIs). Cada agente (Planner, Coder, Reviewer) es una invocación de un CLI (`claude`, `codex`, `gemini`) con un system prompt específico y MCPs conectados.

```
Usuario → komodo run --project <id>
                │
                ▼
        ┌──────────────┐
        │ ORCHESTRATOR  │   (src/orchestrator.js)
        │               │
        │  1. Planner   │──→ planning-task-mcp ──→ Firebase
        │  2. Coder     │──→ github-mcp ──→ gh CLI ──→ GitHub
        │  3. Reviewer  │──→ github-mcp + memory-mcp
        │  4. Merge     │
        └──────────────┘
```

Los agentes **NO hablan entre sí**. Komodo recoge el JSON de salida de uno y lo inyecta en el prompt del siguiente.

---

## Estructura de archivos

```
komodo/
├── KOMODO.md                        # Instrucciones para cualquier CLI de IA
├── CLAUDE.md                        # Wrapper → lee KOMODO.md (Claude Code)
├── AGENTS.md                        # Wrapper → lee KOMODO.md (Codex)
├── GEMINI.md                        # Wrapper → lee KOMODO.md (Gemini)
├── .claude/commands/komodo.md       # Slash command /komodo (Claude Code)
│
├── src/
│   ├── index.js                   # CLI entry point (commander)
│   ├── config.js                  # Carga .env, valida CLIs y credenciales
│   ├── setup.js                   # Wizard de configuración interactivo
│   ├── orchestrator.js            # run(projectId, { tasks, cwd })
│   ├── agents/
│   │   ├── base-agent.js          # spawn() de CLIs + MCP config temporal
│   │   ├── planner.js             # pickNextTask(projectId)
│   │   ├── coder.js               # implementTask() + fixReviewIssues()
│   │   └── reviewer.js            # reviewPR() + normalizeVerdict()
│   ├── cycle/
│   │   ├── review-loop.js         # Bucle Coder ↔ Reviewer (máx N rondas)
│   │   └── task-runner.js         # Flujo completo de 1 tarea
│   ├── prompts/
│   │   ├── planner-system.js      # System prompt del Planner
│   │   ├── coder-system.js        # System prompt del Coder (2 modos)
│   │   └── reviewer-system.js     # System prompt del Reviewer (8 criterios)
│   └── utils/
│       ├── logger.js              # Logs con colores por agente (chalk)
│       └── parser.js              # Extrae JSON de respuestas de IAs
│
├── skills/
│   ├── planning-task-mcp/         # Ya existía - 38 tools sobre Firebase
│   ├── github-mcp/                # 10 tools - wrapper de gh CLI
│   └── memory-mcp/                # 5 tools - patrones de error en JSON local
│
└── memory/
    └── patterns.json              # Almacén de patrones (autogenerado)
```

---

## Módulo: `src/config.js`

Carga `.env` con dotenv y exporta un objeto `config` con toda la configuración.

### Detección de CLIs

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

Si `CLI_PLANNER=claude` pero claude no está instalado, `validateConfig()` devuelve un error.

### Resolución de rutas

Usa `import.meta.url` para resolver rutas relativas al proyecto (necesario en ESM, donde `__dirname` no existe):

```javascript
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '..');
```

### `validateConfig()`

Devuelve un array de errores. Vacío = todo OK. Comprueba:

1. Al menos un CLI de IA instalado
2. Los CLIs asignados en .env existen
3. `gh` CLI instalado
4. Credenciales de Firebase (`GOOGLE_APPLICATION_CREDENTIALS`, `FIREBASE_DATABASE_URL`)
5. `DEFAULT_USER_ID` configurado

---

## Módulo: `src/utils/logger.js`

Logger con colores por agente usando chalk. Cada agente tiene un color asignado para identificarlo visualmente en la terminal.

### Colores por agente

| Agente | Color | Chalk |
|--------|-------|-------|
| KOMODO | Magenta | `chalk.magentaBright` |
| PLANNER | Azul | `chalk.blueBright` |
| CODER | Verde | `chalk.greenBright` |
| REVIEWER | Amarillo | `chalk.yellowBright` |
| SYSTEM | Gris | `chalk.gray` |

### Métodos

```javascript
logger.info(mensaje, agente)           // Info general
logger.success(mensaje, agente)        // Operación exitosa (verde)
logger.warn(mensaje, agente)           // Advertencia (amarillo)
logger.error(mensaje, agente)          // Error (rojo)
logger.logStep(actual, total, msg, ag) // [2/5] Progreso de pasos
logger.taskHeader(titulo)              // ═══ separador visual ═══
```

Cada línea lleva timestamp en formato `HH:MM:SS` (locale `es-ES`).

---

## Módulo: `src/utils/parser.js`

Extrae JSON de respuestas de agentes IA. Los LLMs devuelven el JSON mezclado con texto, dentro de code fences, o con explicaciones antes/después.

### `extractJSON(text)` — 3 estrategias en orden

```
1. JSON.parse(text)             → ¿Es JSON puro?
2. Regex /```json\n(.*)\n```/   → ¿Está en code fence?
3. Bracket balancing            → Buscar el primer { } o [ ] balanceado
```

La estrategia 3 (bracket balancing) es la más robusta. Recorre el texto carácter a carácter, trackea si está dentro de un string (para no confundir `{` dentro de strings), y encuentra el primer JSON válido:

```javascript
// Simplificado
for (let i = 0; i < text.length; i++) {
  if (text[i] === '"' && !escaped) inString = !inString;
  if (!inString) {
    if (text[i] === '{') depth++;
    if (text[i] === '}') depth--;
    if (depth === 0) return JSON.parse(text.slice(start, i + 1));
  }
}
```

### `validateAgentResponse(json, requiredFields)`

Valida que un JSON tenga los campos obligatorios:

```javascript
const { valid, missing } = validateAgentResponse(data, ['taskId', 'title']);
// → { valid: false, missing: ['title'] }
```

---

## Módulo: `src/agents/base-agent.js`

El core del sistema de agentes. Hace 3 cosas:

1. Genera un archivo temporal de MCP config
2. Spawna el CLI como subproceso
3. Parsea su salida JSON

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

Cada CLI tiene flags diferentes. `CLI_ADAPTERS` abstrae las diferencias:

```javascript
const CLI_ADAPTERS = {
  claude: {
    buildArgs({ systemPrompt, userPrompt, mcpConfigPath, maxTurns, model, ... }) {
      return [
        '-p', userPrompt,
        '--output-format', 'json',
        '--system-prompt', systemPrompt,
        '--mcp-config', mcpConfigPath,
        '--strict-mcp-config',
        '--max-turns', String(maxTurns),
        '--permission-mode', 'bypassPermissions',
      ];
    },
    parseOutput(stdout) {
      // Claude emite líneas JSON, buscamos type: "result"
      // Extraemos: result, cost_usd, num_turns
    }
  },
  codex: { /* placeholder */ },
  gemini: { /* placeholder */ },
};
```

**Flags de Claude Code:**

| Flag | Función |
|------|---------|
| `-p` | Modo print (no interactivo) |
| `--output-format json` | Salida en JSON línea a línea |
| `--system-prompt` | System prompt del agente |
| `--mcp-config` | Ruta al JSON de MCPs |
| `--strict-mcp-config` | Solo usa los MCPs pasados (ignora globales) |
| `--permission-mode bypassPermissions` | Sin pedir permisos |
| `--max-turns` | Límite de iteraciones |
| `--allowed-tools` / `--disallowed-tools` | Control de herramientas |
| `--model` | Modelo específico |

### `spawnCli()` — Proceso con idle timeout

Usa `child_process.spawn` para lanzar el CLI. El mecanismo de timeout es **idle-based**: un timer que se reinicia cada vez que el CLI produce output.

```javascript
const idleMs = options.idleTimeout || 180_000; // 3 min sin output

let idleTimer = setTimeout(() => {
  child.kill('SIGTERM');
  reject(new Error(`Idle timeout: ${idleMs / 1000}s sin output`));
}, idleMs);

function resetIdleTimer() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { /* kill */ }, idleMs);
}

child.stdout.on('data', (data) => {
  stdout += data.toString();
  resetIdleTimer();   // Sigue vivo → reiniciar timer
});

child.stderr.on('data', (data) => {
  stderr += data.toString();
  resetIdleTimer();   // stderr también cuenta
});
```

**Por qué idle y no fijo:**
- Un timeout fijo de 15 min mataría a un agente que tarda 20 min pero sigue trabajando
- Un timeout fijo muy alto (1h) no detectaría agentes colgados
- Con idle timeout: mientras el CLI produzca output (tool calls, logs), no se mata. Solo se corta si lleva 3 min en silencio total

### `runAgent()` — Flujo completo

```
runAgent({ name, systemPrompt, userPrompt, mcpServerNames, ... })
  │
  ├── 1. Resolver CLI: cliMap[name] || config.cliXxx || 'claude'
  ├── 2. buildMcpServers(serverNames) → definiciones de MCPs
  ├── 3. generateMcpConfig(servers) → .tmp/mcp-<uuid>.json
  ├── 4. adapter.buildArgs(...) → argumentos del CLI
  ├── 5. spawnCli(cli, args) → ejecutar
  ├── 6. adapter.parseOutput(stdout) → { rawResult, cost, turns }
  ├── 7. extractJSON(rawResult) → JSON limpio
  └── 8. return { success, result, cost, turns, duration }
       └── finally: unlinkSync(mcpConfigPath)
```

### `buildMcpServers()` — Registro de MCPs

Define cómo lanzar cada MCP disponible:

```javascript
const definitions = {
  'planning-task-mcp': {
    command: 'node',
    args: [resolve(config.planningMcpDir, 'src', 'index.js')],
    env: {
      GOOGLE_APPLICATION_CREDENTIALS: config.googleCredentials,
      FIREBASE_DATABASE_URL: config.firebaseDatabaseUrl,
      DEFAULT_USER_ID: config.defaultUserId,
      DEFAULT_USER_NAME: config.defaultUserName,
    },
  },
  'github-mcp': {
    command: 'node',
    args: [resolve(config.githubMcpDir, 'src', 'index.js')],
    env: { GITHUB_TOKEN: config.githubToken },
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

**Función:** `pickNextTask(projectId)` — Elige la tarea con mayor prioridad del backlog.

**MCP:** `planning-task-mcp` (solo lectura del backlog + cambiar estado)

**Flujo interno del agente:**
1. `get_project()` → ver repositorios
2. `list_sprints()` → encontrar sprint activo
3. `list_tasks(status: 'to-do')` → tareas pendientes
4. Analizar prioridad: `bizPoints / devPoints` (más alto = más prioritario)
5. `change_task_status()` → marcar como "in-progress"
6. Devolver JSON

**Criterios de selección (en orden):**
1. Solo tareas en estado "to-do"
2. Mayor ratio `bizPoints / devPoints`
3. Dependencias (si A depende de B, hacer B primero)
4. Preferir tareas del sprint activo

**Branch naming:** `feature/task-{últimos 6 chars del ID}-{slug-del-título}`
Ejemplo: `feature/task-abc123-crear-login-con-jwt`

**Si no hay tareas:** Devuelve `{ taskId: null }` y el orquestador para.

**Config:** `maxTurns: 15` (operación simple, no necesita muchos turnos)

### Coder (`src/agents/coder.js`)

**MCP:** `github-mcp` + herramientas nativas del CLI (Read, Write, Edit, Bash, Glob, Grep)

#### Modo 1: `implementTask(taskSpec, cwd)`

Primera implementación de una tarea.

```
Recibe: taskSpec del Planner (taskId, title, userStory, branchName, repoUrl, ...)
  │
  ├── 1. Explorar código existente (Read, Glob, Grep)
  ├── 2. create_branch → branch de feature
  ├── 3. Escribir código (Write, Edit)
  ├── 4. npm test (si hay tests)
  ├── 5. git commit + push (Bash)
  └── 6. create_pr → abrir PR
  │
  Devuelve: { prNumber, prUrl, branchName, filesChanged, summary }
```

**Config:** `maxTurns: 50`

#### Modo 2: `fixReviewIssues(taskSpec, prNumber, reviewFeedback, cwd)`

Arregla issues encontrados por el Reviewer.

```
Recibe: feedback del Reviewer { issues[], summary }
  │
  ├── 1. Leer código actual
  ├── 2. Arreglar CADA issue
  ├── 3. git commit -m "fix: ..." + push
  └── 4. NO crear nueva PR (misma branch)
  │
  Devuelve: { fixed, issuesResolved, issuesNotResolved, filesChanged, summary }
```

**Config:** `maxTurns: 40`

#### Helper: `extractOwnerRepo(url)`

```javascript
"https://github.com/SergioRVDev/komodo" → "SergioRVDev/komodo"
```

### Reviewer (`src/agents/reviewer.js`)

**Función:** `reviewPR({ prNumber, repo, taskSpec, cwd })`

**MCPs:** `github-mcp` + `memory-mcp`

**Restricción:** `disallowedTools: ['Write', 'Edit', 'NotebookEdit']` — solo lee, no modifica código.

**Flujo interno del agente:**
1. `get_review_brief()` → ver errores frecuentes del coder
2. `get_pr_diff()` → leer diff completo
3. `list_pr_files()` → archivos cambiados
4. Read/Grep si necesita más contexto
5. Evaluar los 8 criterios de review
6. `record_pattern()` → registrar cada issue en memoria
7. `create_review()` → enviar review en GitHub (APPROVE / REQUEST_CHANGES)

**Los 8 criterios de review:**

| # | Criterio | Qué revisa |
|---|----------|------------|
| 1 | Correctitud | ¿Cumple la user story y criterios de aceptación? |
| 2 | Error handling | ¿try/catch donde toca? ¿Errores async? |
| 3 | Edge cases | ¿null, undefined, arrays vacíos, strings largos? |
| 4 | Naming | ¿Nombres descriptivos? ¿Se entiende sin comentarios? |
| 5 | Estructura | ¿Funciones pequeñas? ¿Sin duplicación? |
| 6 | Tests | ¿Existen? ¿Cubren happy path Y error cases? |
| 7 | Seguridad | ¿XSS, injection, secrets expuestos? |
| 8 | Patrones conocidos | ¿Repite errores que ya se han visto? (consulta memoria) |

**Clasificación de issues:**
- **critical** — no funciona, crashea, vulnerabilidad de seguridad
- **major** — error lógico, falta error handling importante
- **minor** — naming, estructura, estilo
- **suggestion** — ideas opcionales

#### `normalizeVerdict()` — Red de seguridad

El agente IA puede equivocarse y decir "APPROVED" con un score bajo. `normalizeVerdict()` fuerza consistencia:

```javascript
function normalizeVerdict(rawVerdict, score, issues = []) {
  const hasCritical = issues.some(i => i.severity === 'critical');
  const hasMajor = issues.some(i => i.severity === 'major');

  // Forzar REQUEST_CHANGES si no cumple el umbral
  if (score < 8 || hasCritical || hasMajor) {
    return 'REQUEST_CHANGES';
  }

  const normalized = (rawVerdict || '').toUpperCase().trim();
  if (normalized.includes('APPROV')) return 'APPROVED';

  return 'REQUEST_CHANGES';
}
```

**APPROVED** solo si las 3 condiciones se cumplen:
- Score >= 8/10
- 0 issues critical
- 0 issues major

---

## MCP: `skills/github-mcp`

Envuelve el CLI `gh` como servidor MCP. No usa la API REST de GitHub directamente — todo pasa por `gh`.

### `gh-cli.js` — Wrapper del CLI

3 funciones base:

```javascript
runGh(args, options)     // gh pr list --json number,title
runGit(args, options)    // git checkout -b feature/xxx
runGhApi(endpoint, opts) // gh api repos/{owner}/{repo}/pulls
```

Todas usan `execFileSync` con timeout de 30 segundos y encoding UTF-8. Parsean JSON automáticamente si `--json` está en los args.

**Errores conocidos que maneja:**
- `"not logged"` → "Necesitas autenticarte: gh auth login"
- `"Could not resolve"` → "Repositorio no encontrado"
- `"already exists"` → "Ya existe"

### `index.js` — Patrón MCP

Usa el mismo patrón que todos los MCPs del proyecto:

```javascript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = new McpServer({ name: 'github-mcp', version: '1.0.0' });

// Registrar tools
for (const [name, tool] of Object.entries(allTools)) {
  const zodSchema = jsonPropsToZod(tool.schema.properties, tool.schema.required);
  server.tool(name, tool.schema.description, zodSchema, async (params) => {
    const result = await tool.handler(params);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  });
}

const transport = new StdioServerTransport();
await server.connect(transport);
```

### `jsonPropsToZod()` — Conversión de schemas

Los tools definen sus parámetros como JSON Schema. `jsonPropsToZod()` los convierte a Zod schemas para validación automática del MCP SDK:

```javascript
// JSON Schema → Zod
{ type: 'string', enum: ['merge', 'squash'] } → z.enum(['merge', 'squash'])
{ type: 'number' }                            → z.number()
{ type: 'boolean' }                           → z.boolean()
{ type: 'array', items: { type: 'string' } }  → z.array(z.string())
```

### 10 tools disponibles

| Tool | Módulo | Qué hace |
|------|--------|----------|
| `create_branch` | branches.js | Crea branch local (git) o remota (API) |
| `list_branches` | branches.js | Lista branches con filtro |
| `create_pr` | pulls.js | Abre Pull Request |
| `get_pr` | pulls.js | Detalles de una PR |
| `get_pr_diff` | pulls.js | Diff completo como texto |
| `list_pr_files` | pulls.js | Archivos cambiados con stats |
| `create_review` | reviews.js | APPROVE o REQUEST_CHANGES |
| `list_pr_comments` | reviews.js | Reviews y comentarios inline |
| `merge_pr` | merge.js | Mergea PR (squash/merge/rebase) |
| `close_pr` | merge.js | Cierra PR sin mergear |

---

## MCP: `skills/memory-mcp`

Sistema de memoria persistente. Guarda patrones de errores que comete el Coder para que el Reviewer los tenga en cuenta en futuras reviews.

### Almacenamiento: `memory/patterns.json`

Archivo JSON local en la raíz del proyecto. Estructura:

```json
{
  "patterns": [
    {
      "id": "uuid",
      "type": "error",
      "description": "No maneja errores después de fetch",
      "tags": ["error-handling", "async"],
      "severity": "high",
      "resolution": "Siempre envolver fetch en try/catch",
      "frequency": 5,
      "firstSeen": "2026-02-27",
      "lastSeen": "2026-03-01"
    }
  ],
  "reviewOutcomes": [
    {
      "id": "uuid",
      "timestamp": "2026-02-27T10:00:00.000Z",
      "passed": false,
      "cycles": 3
    }
  ]
}
```

### `store.js` — Motor de persistencia

**Escritura atómica:** Escribe en un archivo temporal y lo renombra. Si el proceso crashea a mitad de escritura, el archivo original no se corrompe:

```javascript
function writeStore(data) {
  const tmpPath = PATTERNS_FILE + '.tmp';
  writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
  renameSync(tmpPath, PATTERNS_FILE);  // Atómico en el mismo filesystem
}
```

**Detección de patrones similares:** `findSimilarPattern()` busca si ya existe un patrón similar (case-insensitive, substring match). Si se encuentra, incrementa `frequency` en vez de crear duplicado.

**Escalado de severidad:** Cuando se registra un patrón similar con mayor severidad, se sube (`low` → `medium`, `medium` → `high`). Nunca baja.

### 5 tools disponibles

| Tool | Módulo | Qué hace |
|------|--------|----------|
| `record_pattern` | patterns.js | Registra error/antipatrón. Si similar existe, incrementa frecuencia |
| `query_patterns` | patterns.js | Busca por tags, tipo, severidad o texto. Ordenado por frecuencia |
| `get_review_brief` | stats.js | Top errores formateados (se inyecta en el prompt del Reviewer) |
| `record_review_outcome` | stats.js | Registra si review pasó/falló + ciclos |
| `get_stats` | stats.js | Dashboard: total reviews, pass rate, media de ciclos, top errores |

### Ciclo de la memoria

```
Antes de review:
  get_review_brief() → brief de errores frecuentes → se inyecta al Reviewer

Durante review:
  record_pattern() × N → registra cada issue encontrado

Después de review:
  record_review_outcome() → { passed: false, cycles: 2 }
```

---

## MCP: `skills/planning-task-mcp`

MCP preexistente con 38 tools sobre Firebase Realtime Database. Gestiona proyectos, sprints, tareas, bugs, propuestas, miembros, notificaciones y analytics.

**Komodo lo usa para:**
- Leer el backlog de tareas del proyecto
- Cambiar estado de tareas (to-do → in-progress → done)
- Leer detalles del proyecto (repositorios, sprints activos)

**No se modifica.** Es un sistema externo que ya existía.

---

## System Prompts

### Planner (`prompts/planner-system.js`)

`getPlannerSystemPrompt({ projectId, defaultUserId, defaultUserName })`

Le dice al agente:
- Eres el Planner de Komodo
- Tu trabajo es elegir la tarea más importante del backlog
- Criterios de prioridad: bizPoints/devPoints, dependencias, sprint activo
- Formato de branch: `feature/task-{6chars}-{slug}`
- Responde con JSON: `{ taskId, title, userStory, acceptanceCriteria, branchName, repoUrl, ... }`
- Si no hay tareas: `{ taskId: null, message: "..." }`

### Coder (`prompts/coder-system.js`)

Dos funciones:

**`getCoderSystemPrompt()`** — Modo implementación:
- Explora el código existente antes de escribir
- Sigue las convenciones del repo
- Código limpio, nombres descriptivos
- Error handling con try/catch
- No sobreingeniería, no hardcodear secrets
- Commits descriptivos: `feat: ...`
- Responde con JSON: `{ prNumber, prUrl, branchName, filesChanged, summary }`

**`getCoderFixSystemPrompt()`** — Modo fix:
- Lee el feedback del Reviewer
- Arregla CADA issue
- Push al mismo branch
- NO crear nueva PR
- Commits: `fix: ...`
- Responde con JSON: `{ fixed, issuesResolved, filesChanged, summary }`

### Reviewer (`prompts/reviewer-system.js`)

`getReviewerSystemPrompt()`

Le dice al agente:
- Eres el Reviewer de Komodo, estricto pero justo
- Revisa los 8 criterios (correctitud, error handling, edge cases, naming, estructura, tests, seguridad, patrones)
- Primero llama a `get_review_brief()` para ver errores frecuentes
- Clasifica issues: critical, major, minor, suggestion
- APPROVE solo si score >= 8 y 0 critical/major
- Registra CADA issue con `record_pattern()`
- Responde con JSON: `{ verdict, score, issues[], positives[], summary }`

---

## Orquestación

### CLI (`src/index.js`)

Entry point del proyecto. Usa commander para parsear argumentos.

```bash
# 1 tarea (default)
node src/index.js run

# N tareas secuenciales
node src/index.js run -t 3

# Loop hasta vaciar el backlog
node src/index.js run -c

# Especificar directorio del repositorio
node src/index.js run --cwd /path/to/repo

# Simulación: ver qué tarea elegiría sin ejecutar
node src/index.js run --dry-run

# Proyecto específico (override del default)
node src/index.js run -p <project-id>
```

**`-p` es opcional** si `DEFAULT_PROJECT_ID` está configurado en `.env`.

### Orquestador (`src/orchestrator.js`)

`run(projectId, { tasks, cwd, dryRun })` — Función principal.

- `tasks = 1` → ejecuta 1 tarea
- `tasks = 3` → ejecuta 3 secuenciales
- `tasks = 0` → modo continuo (hasta vaciar backlog)
- `dryRun = true` → solo muestra qué tarea elegiría (no ejecuta)

```
run(projectId, { tasks: 3 })
  │
  ├── Validar config
  ├── Si dryRun → runTaskDryRun(projectId) → return
  ├── for taskNumber = 1..3:
  │     ├── runTask(projectId, cwd)
  │     ├── Si no hay tareas → parar
  │     ├── Si éxito → siguiente tarea
  │     └── Si fallo en modo no-continuo → parar
  │
  └── Resumen: completadas, fallidas
```

**Modos de ejecución:**
- Modo single/N: para al primer fallo
- Modo continuo: si una tarea falla, continúa con la siguiente
- Modo dry-run: lanza Planner en modo lectura, no cambia estados

### Task Runner (`src/cycle/task-runner.js`)

`runTask(projectId, cwd)` — Flujo completo de 1 tarea con **error recovery**:

```
[1/4] PLANNER → pickNextTask(projectId)
         │ devuelve: { taskId, title, branchName, repoUrl, ... }
         │ si no hay tareas → return { taskId: null }
         ▼
[2/4] CODER → implementTask(taskSpec, cwd)
         │ devuelve: { prNumber, prUrl, branchName, ... }
         │ si falla → rollbackTask (to-do) → return error
         ▼
[3/4] REVIEW LOOP → reviewLoop({ prNumber, repo, taskSpec, cwd })
         │ bucle Coder ↔ Reviewer hasta APPROVED o máx ciclos
         │ al terminar: recordOutcome(passed, cycles) en memoria
         │ si no aprobada → closePR + rollbackTask → return error
         ▼
[4/4] FINALIZAR
         ├── Si AUTO_MERGE=true:
         │     ├── gh pr merge (squash + delete branch)
         │     └── change_task_status → "done"
         └── Si AUTO_MERGE=false:
               └── change_task_status → "to-validate"
               └── (usuario mergea a mano)
```

#### Error recovery

Todo el flujo está envuelto en try/catch. Si algo falla a mitad, se ejecuta cleanup automático:

| Fallo en | Recovery |
|----------|----------|
| Coder (implementación) | `rollbackTask()` → tarea vuelve a "to-do" |
| Review (no aprobada) | `closePR()` + `rollbackTask()` |
| Error inesperado | `closePR()` (si existe) + `rollbackTask()` (si existe) |

**`closePR(repo, prNumber, reason)`** — Cierra la PR con un comentario explicativo y elimina la branch:

```javascript
runGh(['pr', 'close', String(prNumber), '--repo', repo,
       '--comment', `Cerrada automáticamente por Komodo: ${reason}`,
       '--delete-branch']);
```

**`rollbackTask(taskId)`** — Devuelve la tarea a "to-do" usando un agente mini:

```javascript
await changeTaskStatus(taskId, 'to-do');
```

**`makeResult()`** — Helper que construye el objeto de resultado con valores por defecto, evitando repetición en cada return.

#### Dry-run mode

`runTaskDryRun(projectId)` — Lanza el Planner con un prompt especial que prohíbe cambiar estados:

```
getDryRunPlannerPrompt(projectId):
  - Eres el PLANNER en modo DRY-RUN
  - Llama a list_sprints y list_tasks para ver el backlog
  - Analiza prioridades (bizPoints/devPoints)
  - NO llames a change_task_status
  - Solo reporta qué tarea elegirías
```

Muestra en terminal: tarea elegida, ID, branch sugerida, puntos, coste de la simulación.

#### Funciones auxiliares

**Auto-merge configurable:** La variable `AUTO_MERGE` controla qué pasa después de la aprobación:
- `AUTO_MERGE=true` (default) → Komodo mergea la PR y pasa la tarea a "done" automáticamente
- `AUTO_MERGE=false` → Komodo solo marca la tarea como "to-validate" y para. El usuario revisa la PR, la mergea, y la cierra manualmente

**Merge directo con `gh`:** El merge no usa un agente IA — es una llamada directa a `runGh(['pr', 'merge', ...])` porque es una operación mecánica que no necesita inteligencia.

**Actualización de estado:** Para cambiar el estado de la tarea se usa `changeTaskStatus()` que lanza un agente mini con planning-task-mcp y `maxTurns: 5` (operación de 1 solo tool call).

### Review Loop (`src/cycle/review-loop.js`)

`reviewLoop({ prNumber, repo, taskSpec, cwd })` — Bucle Coder ↔ Reviewer.

```
for cycle = 1..MAX_REVIEW_CYCLES:
  │
  ├── Reviewer: reviewPR() → { verdict, score, issues[] }
  │
  ├── Si APPROVED → return { approved: true }
  │
  ├── Si última ronda → return { approved: false }
  │
  └── Coder: fixReviewIssues() → arregla y pushea
       └── Siguiente ciclo
```

**Comportamiento en cada ciclo:**
1. Reviewer revisa la PR
2. Si devuelve APPROVED → éxito, sale del bucle
3. Si devuelve REQUEST_CHANGES y quedan rondas → Coder arregla y pushea al mismo branch
4. Si devuelve REQUEST_CHANGES y es la última ronda → fallo, no intenta arreglar

**`MAX_REVIEW_CYCLES`** (default: 5) se configura en `.env`. Si se agotan los ciclos, la tarea queda sin resolver y el orquestador reporta fallo.

---

## Decisiones de diseño

### CLIs como subprocesos (no APIs)

**Decisión:** Usar `child_process.spawn('claude', [...])` en vez de la API de Anthropic.

**Por qué:**
- Los CLIs de terminal (Claude Code, Codex, Gemini) tienen acceso a herramientas nativas (Read, Write, Edit, Bash, Glob, Grep) que no están disponibles por API
- El Coder necesita escribir archivos, ejecutar comandos, hacer git push — todo esto solo es posible con el CLI
- Se pueden mezclar diferentes CLIs sin cambiar código

### Idle timeout en vez de fijo

**Decisión:** Timer de 3 minutos que se reinicia con cada output, en vez de un timeout fijo.

**Por qué:**
- Un agente puede tardar 30 minutos legítimamente (tarea compleja con muchos tool calls)
- Mientras produzca output, está trabajando
- Si lleva 3 minutos en silencio total, probablemente se colgó
- Los CLIs de IA producen output constantemente (cada tool call, cada respuesta intermedia)

### `normalizeVerdict()` como red de seguridad

**Decisión:** Verificar programáticamente el verdict del Reviewer, no fiarse solo del LLM.

**Por qué:**
- Un LLM puede decir "APPROVED" con un score de 5/10 (inconsistencia)
- `normalizeVerdict()` fuerza que APPROVED solo pase si score >= 8, 0 critical, 0 major
- Es la última línea de defensa antes de que se mergee código malo

### MCP config temporal por ejecución

**Decisión:** Generar un `.tmp/mcp-<uuid>.json` para cada agente y borrarlo al terminar.

**Por qué:**
- Cada agente necesita MCPs diferentes (Planner: planning, Coder: github, Reviewer: github+memory)
- `--mcp-config` del CLI espera un archivo en disco
- Usar UUID evita colisiones si se lanzan agentes en paralelo
- `finally` garantiza limpieza aunque el agente falle

### Escritura atómica en memory-mcp

**Decisión:** Escribir a un archivo `.tmp` y renombrar (rename) en vez de escribir directo.

**Por qué:**
- `writeFileSync` puede dejar el archivo corrupto si el proceso muere a mitad
- `renameSync` en el mismo filesystem es atómico (garantizado por el OS)
- Si crashea, el peor caso es que se pierde la última escritura, no que se corrompa todo

### `jsonPropsToZod()` — No definir schemas dos veces

**Decisión:** Definir los schemas de tools en JSON Schema y convertirlos a Zod automáticamente.

**Por qué:**
- El MCP SDK requiere Zod para validación
- Definir schemas tanto en JSON como en Zod sería duplicación que puede desincronizarse
- `jsonPropsToZod()` convierte automáticamente: `{ type: 'string' }` → `z.string()`, etc.

---

## Configuración de entorno

### Variables (.env)

| Variable | Obligatorio | Default | Descripción |
|----------|:-----------:|---------|-------------|
| `CLI_PLANNER` | No | `claude` | CLI del Planner |
| `CLI_CODER` | No | `claude` | CLI del Coder |
| `CLI_REVIEWER` | No | `claude` | CLI del Reviewer |
| `GOOGLE_APPLICATION_CREDENTIALS` | Sí | — | Ruta a serviceAccountKey.json |
| `FIREBASE_DATABASE_URL` | Sí | — | URL de Firebase Realtime DB |
| `DEFAULT_USER_ID` | Sí | — | UID del usuario en Firebase |
| `DEFAULT_USER_NAME` | No | `Komodo` | Nombre del usuario |
| `GITHUB_TOKEN` | No | — | Token GitHub (opcional si gh autenticado) |
| `WS_PORT` | No | `3001` | Puerto WebSocket dashboard |
| `MAX_REVIEW_CYCLES` | No | `5` | Máx rondas Coder↔Reviewer |
| `AUTO_MERGE` | No | `true` | Si true, mergea PR y pasa tarea a done. Si false, para en to-validate |
| `DEFAULT_PROJECT_ID` | No | — | Project ID por defecto (evita -p en cada ejecución) |

### Dependencias

| Paquete | Versión | Uso |
|---------|---------|-----|
| `@modelcontextprotocol/sdk` | ^1.12.1 | Framework para crear MCPs |
| `commander` | ^12.0.0 | CLI (`komodo run`, `komodo status`) |
| `chalk` | ^5.3.0 | Colores en terminal |
| `dotenv` | ^16.4.7 | Carga de .env |
| `zod` | ^3.24.2 | Validación de schemas MCP |
| `uuid` | ^9.0.0 | IDs para patrones de memoria |

### Requisitos del sistema

- Node.js >= 18
- `gh` CLI instalado y autenticado (`gh auth login`)
- `git` instalado
- Al menos un CLI de IA (claude, codex, o gemini)

---

## Integración multi-CLI

Komodo es multi-CLI: funciona con claude, codex y gemini. Para que cualquier CLI de IA pueda controlar Komodo desde su terminal, se usa un sistema de archivos markdown.

### Arquitectura de archivos

```
KOMODO.md          ← Fuente de verdad (instrucciones reales)
  ▲  ▲  ▲
  │  │  │
CLAUDE.md  AGENTS.md  GEMINI.md    ← Wrappers (3 líneas cada uno)
  │
.claude/commands/komodo.md          ← Slash command /komodo (solo Claude Code)
```

- **`KOMODO.md`** — Archivo principal con todos los comandos, mapeo de lenguaje natural, y documentación de uso. Cualquier CLI lee este archivo.
- **`CLAUDE.md`** / **`AGENTS.md`** / **`GEMINI.md`** — Archivos mínimos que dicen "lee KOMODO.md". Cada CLI lee el suyo al abrir el proyecto.
- **`.claude/commands/komodo.md`** — Slash command solo para Claude Code. Permite `/komodo ejecuta 3 tareas`.

### Mapeo lenguaje natural → CLI

Definido en `KOMODO.md`. Cuando el usuario dice algo como "hazme 3 tareas", el CLI de IA lee KOMODO.md y traduce:

| Usuario dice | Comando |
|---|---|
| "ejecuta 1 tarea" / "siguiente tarea" | `node src/index.js run` |
| "ejecuta N tareas" | `node src/index.js run -t N` |
| "haz todas las tareas" / "vacía el backlog" | `node src/index.js run -c` |

### `DEFAULT_PROJECT_ID`

Configurado en `.env` por el setup wizard. Hace que `-p` sea opcional en el CLI:

```bash
# Sin DEFAULT_PROJECT_ID → obligatorio
node src/index.js run -p -OmFjaFM9glBQnBTT7QQ

# Con DEFAULT_PROJECT_ID → automático
node src/index.js run
```

### Setup wizard (`src/setup.js`)

Script interactivo que configura Komodo paso a paso:

```bash
node src/setup.js
```

**Pasos del wizard:**

1. **Requisitos** — Verifica node, git, gh, y detecta CLIs de IA instalados
2. **Agentes** — Elige qué CLI usa cada agente (solo ofrece los instalados)
3. **Firebase** — Ruta a credenciales y URL de la base de datos
4. **Identidad** — User ID y nombre para planning-task-mcp
5. **GitHub** — Token (o detecta si gh ya está autenticado)
6. **Preferencias** — Auto-merge, máximo de rondas de review
7. **Proyecto** — Project ID del backlog

**Genera:**
- `.env` con toda la configuración
- `npm install` del proyecto y de los MCPs
- `.claude/commands/komodo.md` si Claude Code está instalado

**Re-ejecutable:** Si `.env` ya existe, usa los valores actuales como defaults. Se puede volver a ejecutar para cambiar configuración.
