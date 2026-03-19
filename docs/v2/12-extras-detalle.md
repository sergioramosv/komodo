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
