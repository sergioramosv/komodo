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
