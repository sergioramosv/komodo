# Komodo - Mejoras Fase 1: Fundamentos de Autonomia

> 10 mejoras para convertir Komodo en un orquestador ultra-eficiente, seguro y autonomo.
> **Nota**: Komodo usa CLIs por suscripcion (Claude CLI, Codex CLI, Gemini CLI), no APIs. El recurso limitante son los **tokens consumidos** y **turnos de agente**, no dolares directos. Gastar menos tokens = mas tareas antes de alcanzar rate limits = mas autonomia sostenida.

---

## 1. ARCHITECT Agent (nuevo agente)

**Problema**: El Coder gasta 5-10 turnos explorando el codebase antes de escribir una linea de codigo. Eso son tokens y turnos desperdiciados que aceleran el rate limit.

**Solucion**: Un agente ARCHITECT que corre entre el Planner y el Coder.

**Que hace**:
- Recibe la tarea del Planner y analiza el codebase
- Genera un **plan de implementacion** estructurado:
  - Archivos a crear/modificar
  - Dependencias a instalar
  - Cambios en data model
  - Cambios en API
  - Cambios en frontend
  - Orden de implementacion
- El Coder recibe este plan y lo ejecuta sin perder tiempo explorando

**Modelo recomendado**: Sonnet/Flash (es analisis, no generacion pesada)

**Flujo actualizado**:
```
PLANNER → ARCHITECT → CODER → SECURITY → REVIEWER → MERGE
```

**Prompt del ARCHITECT**:
```
Eres un arquitecto de software. Analiza la tarea y genera un plan de implementacion.

TAREA: {taskSpec}
CODEBASE INDEX: {codebaseIndex}
CODING GUIDELINES: {guidelines}

Responde con JSON:
{
  "filesToCreate": [{ "path": "...", "purpose": "..." }],
  "filesToModify": [{ "path": "...", "changes": "..." }],
  "dependencies": ["package@version"],
  "dataModelChanges": "...",
  "apiChanges": "...",
  "implementationOrder": ["paso 1", "paso 2"],
  "risks": ["..."],
  "estimatedComplexity": "low|medium|high"
}
```

**Ahorro estimado**: El Architect usa ~2K-5K tokens (1-2 turnos con Sonnet). El Coder sin plan gasta ~15K-30K tokens explorando. Con plan, el Coder va directo: **30-50% menos tokens** en la fase de coding.

**Implementacion**:
- Nuevo archivo: `src/agents/architect.js` (extiende `base-agent.js`)
- Nuevo prompt: `src/prompts/architect-system.js`
- Modificar `src/cycle/task-runner.js`: insertar paso ARCHITECT entre PLANNING y CODING
- Nuevo estado: `phase: 'architecting'`
- Nuevo evento: `agent:architect:working`, `agent:architect:done`

---

## 2. Prompt Caching + Context Compression

**Problema**: Cada invocacion del agente inyecta el mismo contexto repetidamente: codebase index (~2K tokens), style guide (~500 tokens), review feedback (~1K tokens), coding guidelines (~1K tokens). En una tarea con 3 ciclos de review, eso son **~15K tokens repetidos** sin aportar informacion nueva.

**Solucion**: Sistema de cache multinivel + compresion de contexto.

### 2.1 Cache de Codebase Index
```javascript
// src/intelligence/codebase-indexer.js
const indexCache = {
  hash: null,        // hash del directorio
  index: null,       // indice generado
  generatedAt: null, // timestamp
  ttl: 300_000,      // 5 minutos
};

function getCodebaseIndex(dir) {
  const currentHash = hashDirectory(dir);
  if (indexCache.hash === currentHash && !isExpired(indexCache)) {
    return indexCache.index; // Cache hit - no regenerar
  }
  indexCache.index = generateIndex(dir);
  indexCache.hash = currentHash;
  return indexCache.index;
}
```

### 2.2 Diff-Only Context en Fix Mode
Cuando el Coder recibe feedback del Reviewer para corregir:
- **Antes**: Se inyecta todo el codebase index + todos los archivos (~5K-10K tokens de contexto)
- **Despues**: Solo inyectar los archivos mencionados en los issues del Reviewer (~500-1K tokens)

```javascript
function buildFixContext(reviewResult) {
  const relevantFiles = reviewResult.issues
    .map(i => i.file)
    .filter(Boolean);
  return relevantFiles.map(f => readFileContent(f));
}
```

### 2.3 Compresion de Review Feedback
En vez de inyectar el historial completo de patterns:
```javascript
// Antes: 50 patterns * ~100 tokens = ~5000 tokens
// Despues: Top 5 relevantes para esta tarea = ~500 tokens
function getRelevantPatterns(task, allPatterns) {
  return allPatterns
    .filter(p => p.tags.some(t => task.keywords.includes(t)))
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, 5);
}
```

### 2.4 Prompt Prefix Sharing
Los CLIs de Claude soportan prompt caching nativo. La parte estatica del system prompt se cachea automaticamente si se repite entre invocaciones:
- Colocar las instrucciones fijas (~500 tokens) al inicio del prompt
- La parte dinamica (tarea, plan, feedback) va al final
- Claude CLI cachea el prefijo: las invocaciones 2+ de la misma sesion gastan menos tokens en contexto

**Ahorro estimado**: 30-40% reduccion global de tokens por tarea.

---

## 3. Smart Model Routing con Learning

**Problema**: El model selector es estatico (trivial=Sonnet, complex=Opus). Un modelo mas capaz gasta mas tokens de la suscripcion. Sonnet resuelve el 90% de tareas triviales, pero a veces se usa Opus innecesariamente.

**Solucion**: Sistema de routing que aprende del historico para usar siempre el modelo mas ligero que funcione.

### 3.1 Metricas por Modelo
Almacenar en Firebase `/metrics/{projectId}/model-routing/`:
```json
{
  "sonnet": {
    "coder": {
      "totalTasks": 45,
      "approvedFirstCycle": 38,
      "avgTokensUsed": 12000,
      "avgTurns": 8,
      "avgReviewScore": 8.2,
      "byComplexity": {
        "trivial": { "successRate": 0.95, "avgTokens": 5000 },
        "standard": { "successRate": 0.82, "avgTokens": 15000 },
        "complex": { "successRate": 0.45, "avgTokens": 35000 }
      },
      "byTaskType": {
        "api-endpoint": { "successRate": 0.90 },
        "frontend-component": { "successRate": 0.70 },
        "database-migration": { "successRate": 0.50 }
      }
    }
  }
}
```

### 3.2 Algoritmo de Seleccion
```javascript
function selectModel(role, complexity, taskType) {
  const candidates = getAvailableModels(role);

  const scored = candidates.map(model => {
    const stats = getModelStats(model, role, complexity, taskType);
    if (stats.totalTasks < 5) {
      return { model, score: 0.5 }; // Exploration: probar modelos nuevos
    }
    // Mas liviano = mejor (menos tokens de suscripcion)
    const tokenEfficiency = 1 / (stats.avgTokens + 1);
    const qualityScore = stats.successRate * stats.avgReviewScore / 10;
    return {
      model,
      score: qualityScore * 0.6 + tokenEfficiency * 0.4
    };
  });

  // Epsilon-greedy: 90% mejor modelo, 10% exploracion
  if (Math.random() < 0.1 && scored.length > 1) {
    return randomChoice(scored.filter(s => s !== scored[0])).model;
  }
  return scored.sort((a, b) => b.score - a.score)[0].model;
}
```

### 3.3 Auto-Escalado Inteligente
Si un modelo falla en una tarea, escalar sin re-ejecutar todo:
```
Intento 1: Sonnet (ligero) → Review score 5 / REQUEST_CHANGES con issues criticos
Intento 2: Opus (potente) → Recibe el feedback + el codigo anterior como contexto
                             No empieza de cero, arregla lo que Sonnet no pudo
```

**Ahorro estimado**: Usar Sonnet donde Opus es innecesario reduce tokens un 40-60%. Los modelos ligeros consumen ~3-5x menos tokens para la misma tarea.

---

## 4. Security Agent (nuevo agente)

**Problema**: La seguridad se revisa como uno de 8 criterios del Reviewer. Es insuficiente y gasta tokens del Reviewer en algo que puede automatizarse con un modelo barato.

**Solucion**: Agente de seguridad dedicado que corre despues del Coder, antes del Reviewer.

### 4.1 Que escanea
```
OWASP Top 10:
  [x] A01 - Broken Access Control
  [x] A02 - Cryptographic Failures
  [x] A03 - Injection (SQL, XSS, Command)
  [x] A04 - Insecure Design
  [x] A05 - Security Misconfiguration
  [x] A06 - Vulnerable Components
  [x] A07 - Authentication Failures
  [x] A08 - Data Integrity Failures
  [x] A09 - Logging Failures
  [x] A10 - SSRF

Adicional:
  [x] Hardcoded secrets (API keys, passwords, tokens)
  [x] Insecure dependencies (npm audit / pip audit)
  [x] Exposed .env files
  [x] Missing rate limiting
  [x] Insecure headers
```

### 4.2 Herramientas externas (sin usar tokens)
Antes de invocar al LLM, correr herramientas locales que no gastan tokens:
- `npm audit` / `pip-audit` → dependencias vulnerables
- `gitleaks` → secrets en el diff
- `semgrep --config=p/owasp-top-ten` → analisis estatico con reglas OWASP

Solo si las herramientas detectan algo ambiguo, pasar al LLM para confirmar.

### 4.3 Severidades y acciones
```
CRITICAL → Bloquear. Coder corrige. NO pasar al Reviewer (ahorra esos tokens).
HIGH     → Bloquear. Incluir en review del Reviewer.
MEDIUM   → Warning. Reviewer decide.
LOW      → Informativo. Registrar en tech debt.
```

### 4.4 Output
```json
{
  "verdict": "BLOCK" | "WARN" | "PASS",
  "findings": [
    {
      "severity": "critical",
      "category": "A03-Injection",
      "title": "SQL injection in user query",
      "file": "src/db/users.js",
      "line": 42,
      "remediation": "Use parameterized queries"
    }
  ],
  "toolResults": {
    "npmAudit": { "vulnerabilities": 2, "critical": 0, "high": 1 },
    "gitleaks": { "findings": 0 },
    "semgrep": { "findings": 1 }
  }
}
```

**Modelo recomendado**: Haiku/Flash. Es pattern matching sobre un diff, no razonamiento complejo. ~1K-3K tokens por scan.

**Valor clave**: Si bloquea un CRITICAL antes del Reviewer, ahorra **todos los tokens del review** (10K-20K) que se habrian desperdiciado revisando codigo inseguro.

---

## 5. Circuit Breaker + Error Budget

**Problema**: Si algo falla sistematicamente (CLI rate limited, GitHub caido, modelo generando basura), Komodo sigue intentando y quemando tokens/turnos sin producir nada.

### 5.1 Circuit Breaker
```javascript
class CircuitBreaker {
  constructor(name, { threshold = 3, cooldown = 300_000 } = {}) {
    this.name = name;
    this.failures = 0;
    this.state = 'CLOSED';     // CLOSED → OPEN → HALF_OPEN
    this.threshold = threshold;
    this.cooldown = cooldown;
  }

  async execute(fn) {
    if (this.state === 'OPEN') {
      if (Date.now() - this.openedAt > this.cooldown) {
        this.state = 'HALF_OPEN';
      } else {
        throw new Error(`Circuit ${this.name} is OPEN`);
      }
    }
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }
}

// Circuitos independientes por integracion
const firebaseBreaker = new CircuitBreaker('firebase', { threshold: 3, cooldown: 60_000 });
const githubBreaker = new CircuitBreaker('github', { threshold: 5, cooldown: 120_000 });
const cliBreaker = new CircuitBreaker('cli', { threshold: 2, cooldown: 300_000 });
```

### 5.2 Error Budget
```javascript
class ErrorBudget {
  constructor({ windowSize = 10, maxFailureRate = 0.3 } = {}) {
    this.results = [];
    this.windowSize = windowSize;
    this.maxFailureRate = maxFailureRate;
  }

  record(success) {
    this.results.push(success);
    if (this.results.length > this.windowSize) this.results.shift();
  }

  isExhausted() {
    if (this.results.length < 3) return false;
    const failures = this.results.filter(r => !r).length;
    return (failures / this.results.length) > this.maxFailureRate;
  }
}

// En el orchestrator:
if (errorBudget.isExhausted()) {
  emit('error-budget:exhausted');
  state.executionState = 'paused';
  notify('30% de las ultimas tareas fallaron. Komodo pausado.');
}
```

### 5.3 Dead Letter Queue
Tareas que fallan 3+ veces:
```
/dead-letter/{projectId}/{taskId}
  +-- taskId, title, failCount
  +-- lastError, lastAttemptAt
  +-- status: 'pending-review'
```

Requieren intervencion humana. Evita que una tarea imposible consuma tokens infinitamente.

**Ahorro estimado**: 10-20% de tokens que se desperdiciaban en reintentos fallidos y cascadas de errores.

---

## 6. Token Usage Estimator

**Problema**: No sabes cuantos tokens consumira una tarea. Podrias llegar al rate limit a mitad de una tarea compleja.

### 6.1 Modelo de estimacion
```javascript
function estimateTokenUsage(task, historicalData) {
  const similar = historicalData.filter(h =>
    h.devPoints === task.devPoints &&
    h.complexity === task.complexity
  );

  if (similar.length < 5) {
    // Fallback: formula basica
    const baseTokens = {
      trivial: 8_000,    // ~5K coder + 3K reviewer
      standard: 25_000,  // ~15K coder + 8K reviewer + 2K architect
      complex: 60_000,   // ~35K coder + 15K reviewer + 5K architect + 5K retries
    };
    return {
      estimated: baseTokens[task.complexity],
      confidence: 'low',
      breakdown: {
        architect: baseTokens[task.complexity] * 0.08,
        coder: baseTokens[task.complexity] * 0.55,
        security: baseTokens[task.complexity] * 0.05,
        reviewer: baseTokens[task.complexity] * 0.25,
        overhead: baseTokens[task.complexity] * 0.07,
      },
    };
  }

  const tokens = similar.map(h => h.totalTokens).sort();
  return {
    estimated: median(tokens),
    confidence: 'high',
    range: [percentile(tokens, 25), percentile(tokens, 75)],
  };
}
```

### 6.2 Rate Limit Awareness
Antes de empezar una tarea, verificar si hay suficiente margen:
```javascript
async function canStartTask(estimatedTokens) {
  const recentUsage = await getRecentTokenUsage(30); // ultimos 30 min
  const estimatedLimit = getEstimatedRateLimit(currentCLI);

  const headroom = estimatedLimit - recentUsage;
  if (estimatedTokens > headroom * 0.8) {
    // Riesgo de rate limit a mitad de tarea
    emit('rate-limit:preemptive-wait', {
      reason: 'Not enough headroom for estimated task tokens',
      estimatedTokens,
      headroom,
      waitMinutes: 10,
    });
    return false;
  }
  return true;
}
```

### 6.3 Prioridad por Eficiencia
En daemon mode, priorizar tareas con mejor ratio valor/tokens:
```
Eficiencia = bizPoints / estimatedTokens

Tarea A: 8 bizPoints / 8K tokens  = 0.001 (alta eficiencia)
Tarea B: 3 bizPoints / 60K tokens = 0.00005 (baja eficiencia)
→ Ejecutar A primero, especialmente si el rate limit esta cerca
```

### 6.4 Dashboard
```
Tarea: "Implementar login con OAuth"
Tokens estimados: ~25K (rango: 15K - 40K)
Confianza: alta (basado en 12 tareas similares)
Breakdown: Architect 2K | Coder 14K | Security 1K | Reviewer 6K | Overhead 2K
Rate limit headroom: 80K tokens (~3 tareas mas antes de rate limit)
```

---

## 7. Streaming + Early Termination

**Problema**: Los agentes buffean toda la salida. Si algo va mal, se queman tokens hasta que termina o timeout.

### 7.1 Deteccion de Anomalias en Streaming
```javascript
const anomalyDetectors = [
  // Lenguaje equivocado
  {
    pattern: /```(python|java|ruby)/i,
    when: (task) => !task.languages?.includes('python'),
    action: 'kill',
    reason: 'Generating code in wrong language',
    // Ahorro: mata a los ~2K tokens en vez de esperar 20K+
  },
  // Stuck en loop de herramientas
  {
    detect: (toolCalls) => {
      const last5 = toolCalls.slice(-5);
      return last5.length === 5 && new Set(last5.map(t => t.name)).size === 1;
    },
    action: 'kill',
    reason: 'Agent stuck in tool call loop (same tool 5x)',
    // Ahorro: mata ~5K tokens de loop infinito
  },
  // Agente sin acceso
  {
    pattern: /I don't have access|I cannot|I'm unable to/i,
    action: 'kill',
    reason: 'Agent reports no access to required tools',
    // Ahorro: mata inmediatamente en vez de ~10K tokens de disculpas
  },
  // Divagando sin producir codigo
  {
    detect: (chunks, totalTokens) => totalTokens > 5000 && !chunks.some(c => c.includes('```')),
    action: 'warn', // No matar, pero alertar
    reason: 'Agent producing text without code after 5K tokens',
  },
];
```

### 7.2 Early Termination del Reviewer
```javascript
// Si el Reviewer emite el veredicto en el primer cuarto del output,
// podemos terminar antes de leer el analisis detallado
function onReviewerOutput(accumulatedText) {
  if (accumulatedText.length < 3000) {
    const earlyApproval = accumulatedText.match(/"verdict"\s*:\s*"APPROVED"/);
    if (earlyApproval && accumulatedText.match(/"score"\s*:\s*(\d+)/)) {
      return { earlyTerminate: true, verdict: 'APPROVED' };
      // Ahorro: ~5-10K tokens de analisis detallado que no necesitamos
    }
  }
}
```

### 7.3 Watchdog Inteligente
En vez de timeout fijo (15 min), detectar **inactividad real**:
```javascript
class SmartWatchdog {
  onAgentOutput(chunk) {
    this.lastOutputAt = Date.now();
    this.tokensSinceLastTool += estimateTokens(chunk);

    // Si lleva 8K+ tokens sin llamar a ninguna herramienta → probablemente divagando
    if (this.tokensSinceLastTool > 8000) {
      emit('watchdog:verbose-warning', { tokens: this.tokensSinceLastTool });
    }
  }

  onToolCall(tool) {
    this.tokensSinceLastTool = 0;
    this.toolCallCount++;

    // Si lleva 20+ tool calls en la misma tarea → probablemente stuck
    if (this.toolCallCount > 20) {
      emit('watchdog:excessive-tools', { count: this.toolCallCount });
    }
  }
}
```

**Ahorro estimado**: 10-20% de tokens en ejecuciones fallidas, loops, y output innecesario.

---

## 8. Knowledge Graph entre Agentes

**Problema**: Cada agente trabaja aislado. El Coder no sabe lo que el Architect descubrio. El Reviewer no sabe que decisiones tomo el Coder.

### 8.1 Estructura
```
/knowledge/{projectId}/{taskId}/
  +-- planner/
  |   +-- selectedReason: "High priority, auth module"
  |   +-- relatedTasks: ["task-abc", "task-def"]
  +-- architect/
  |   +-- plan: { filesToModify, dependencies, order }
  |   +-- affectedModules: ["auth", "api"]
  +-- coder/
  |   +-- actualFilesChanged: ["src/auth/login.js"]
  |   +-- decisionsLog: ["Used JWT instead of sessions because..."]
  +-- security/
  |   +-- findings: [...]
  +-- reviewer/
  |   +-- issues: [...]
  |   +-- score: 8
  |   +-- patternsDetected: ["missing-null-check"]
```

### 8.2 Context Injection Inteligente
Cada agente recibe solo lo relevante del anterior. Nada de contexto duplicado:

```javascript
function buildCoderContext(taskId) {
  const k = getKnowledge(taskId);
  return {
    taskSpec: k.planner.taskSpec,           // ~500 tokens (ya filtrado)
    implementationPlan: k.architect.plan,    // ~1K tokens (en vez de 5K de codebase index)
    relevantPatterns: getRelevantPatterns(   // ~300 tokens (top 3, no los 50)
      k.architect.affectedModules
    ),
    // Total: ~2K tokens de contexto vs ~8K sin Knowledge Graph
  };
}

function buildReviewerContext(taskId) {
  const k = getKnowledge(taskId);
  return {
    architectPlan: k.architect.plan,         // Saber que se planeaba
    coderDecisions: k.coder.decisionsLog,    // Saber por que se hizo asi
    securityFindings: k.security.findings,   // Ya escaneado
    // El Reviewer no re-escanea seguridad → ahorra esos tokens
  };
}
```

### 8.3 Aprendizaje Cross-Task
Despues de completar, extraer lecciones para futuras tareas del mismo modulo:
```javascript
function extractLessons(taskKnowledge) {
  return {
    module: taskKnowledge.architect.affectedModules,
    whatWorked: taskKnowledge.reviewer.positives,
    whatFailed: taskKnowledge.reviewer.patternsDetected,
    decisions: taskKnowledge.coder.decisionsLog,
  };
}
// Proxima tarea que toca "auth" recibe: "En tareas anteriores del modulo auth,
// siempre faltaba null-check en el middleware. Ten cuidado."
```

**Ahorro**: 20-30% menos tokens en Coder (recibe plan directo), 10-15% menos en Reviewer (no re-escanea seguridad).

---

## 9. Canary Merge + Rollback Mejorado

**Problema**: El auto-revert actual solo revierte despues del merge a main. El dano ya esta hecho.

### 9.1 Pre-Merge Validation
Antes de merge, validar en un entorno aislado (no gasta tokens de LLM, solo CPU):
```javascript
async function preMergeValidation(prNumber, branchName) {
  // 1. Checkout temporal
  await exec(`git worktree add /tmp/validate origin/${branchName}`);

  // 2. Merge main para detectar conflictos
  const mergeResult = await exec(`git merge origin/main --no-commit`, { cwd: '/tmp/validate' });
  if (mergeResult.conflicts) {
    return { pass: false, reason: 'Merge conflicts with main' };
  }

  // 3. Test suite completa
  const testResult = await runTests({ cwd: '/tmp/validate' });
  if (!testResult.pass) {
    return { pass: false, reason: 'Tests fail', output: testResult.output };
  }

  // 4. Cleanup
  await exec(`git worktree remove /tmp/validate`);
  return { pass: true };
}
```

### 9.2 Canary Branch Strategy
```
main ← staging ← feature/task-xxx

1. Coder pushea a feature/task-xxx
2. Reviewer aprueba
3. Merge a staging (rama intermedia)
4. CI corre en staging
5. Si pasa → merge staging a main
6. Si falla → revert en staging solamente, main no se toca

Config:
  CANARY_BRANCH=staging
  CANARY_WAIT_MINUTES=5
  CANARY_AUTO_PROMOTE=true
```

### 9.3 Rollback con Auto-Fix
En vez de solo revertir, intentar arreglar (gastando pocos tokens extra pero salvando la tarea):
```javascript
async function handleCIFailure(task, ciLog) {
  // 1. Crear mini-tarea de fix
  const fixTask = {
    title: `Fix CI failure: ${task.title}`,
    context: {
      originalTask: task.id,
      ciLog: ciLog.substring(-2000), // Solo las ultimas lineas del error
      failedTests: extractFailedTests(ciLog),
    },
    priority: 100,
    devPoints: 1,
  };

  // 2. Un intento de auto-fix (Sonnet, barato, ~5K tokens)
  const result = await coder.implementTask(fixTask, { model: 'sonnet', maxTurns: 5 });

  if (result.testsPass) return; // Arreglado
  await autoRevert(task);       // Si no, revertir
}
```

### 9.4 Deteccion de Conflictos entre Tareas Paralelas
```javascript
function detectConflicts(activeTasks) {
  const fileMap = {};
  for (const task of activeTasks) {
    const plan = getKnowledge(task.id)?.architect?.plan;
    if (!plan) continue;
    for (const file of [...(plan.filesToCreate || []), ...(plan.filesToModify || [])]) {
      if (!fileMap[file.path]) fileMap[file.path] = [];
      fileMap[file.path].push(task.id);
    }
  }
  const conflicts = Object.entries(fileMap).filter(([, tasks]) => tasks.length > 1);
  if (conflicts.length > 0) {
    emit('conflict:detected', { conflicts });
    // Serializar estas tareas, no ejecutar en paralelo
  }
}
```

---

## 10. Autonomy Levels + Human-in-the-Loop Gates

**Problema**: Komodo es todo-o-nada: o full manual o full auto. Necesita granularidad para produccion.

### 10.1 Niveles
```javascript
const AUTONOMY_LEVELS = {
  1: {
    name: 'Supervised',
    description: 'Pausa despues de cada paso para aprobacion',
    gates: ['after-plan', 'after-architect', 'after-code', 'after-security', 'after-review', 'before-merge'],
  },
  2: {
    name: 'Semi-Autonomous',
    description: 'Solo pausa en merge y si review score < 8',
    gates: ['before-merge', 'low-review-score'],
  },
  3: {
    name: 'Autonomous',
    description: 'Full auto con merge automatico',
    gates: [],
  },
  4: {
    name: 'Guardian',
    description: 'Full auto con gates de seguridad dinamicos',
    gates: ['auto'],
  },
};
```

### 10.2 Guardian Gates (Nivel 4)
Reglas que se evaluan automaticamente:
```javascript
const guardianRules = [
  {
    name: 'large-diff',
    condition: (ctx) => ctx.linesChanged > 500,
    action: 'require-approval',
    message: 'Diff de ${ctx.linesChanged} lineas. Aprobar?',
  },
  {
    name: 'security-files',
    condition: (ctx) => ctx.filesChanged.some(f =>
      /auth|crypto|secret|\.env|password|token/i.test(f)
    ),
    action: 'require-approval',
    message: 'Modifica archivos sensibles de seguridad.',
  },
  {
    name: 'high-token-usage',
    condition: (ctx) => ctx.totalTokensUsed > 80_000,
    action: 'require-approval',
    message: 'Tarea ha consumido ${ctx.totalTokensUsed} tokens (mucho mas de lo esperado).',
  },
  {
    name: 'review-cycles',
    condition: (ctx) => ctx.reviewCycle >= 3,
    action: 'escalate',
    message: '3+ ciclos de review sin aprobar. Escalar a humano.',
  },
  {
    name: 'database-migration',
    condition: (ctx) => ctx.filesChanged.some(f => /migration/i.test(f)),
    action: 'require-approval',
    message: 'Incluye migracion de base de datos.',
  },
  {
    name: 'dependency-change',
    condition: (ctx) => ctx.filesChanged.some(f => /package\.json|requirements\.txt/i.test(f)),
    action: 'notify',
    message: 'Se modificaron dependencias.',
  },
];
```

### 10.3 Mecanismo de Aprobacion
```javascript
async function requestApproval(gate, context) {
  emit('approval:requested', { gate, context });

  // Notificar por todos los canales configurados
  if (telegramEnabled) await telegram.send(`Komodo necesita aprobacion: ${gate.message}`);
  if (webhookEnabled) await webhook.send({ type: 'approval:requested', gate });

  // Dashboard muestra boton de aprobar/rechazar
  state.executionState = 'awaiting-approval';
  state.pendingApproval = { gate: gate.name, message: gate.message };

  // Esperar (timeout configurable)
  const response = await waitForApproval(gate.name, APPROVAL_TIMEOUT);

  if (response === 'approved') return true;
  if (response === 'timeout') return config.approvalAutoApprove;
  return false; // rejected
}
```

### 10.4 Configuracion
```env
AUTONOMY_LEVEL=4
APPROVAL_TIMEOUT_MINUTES=30
APPROVAL_AUTO_APPROVE=false
APPROVAL_CHANNELS=telegram,webhook,dashboard
GUARDIAN_MAX_DIFF_LINES=500
GUARDIAN_MAX_TOKENS_PER_TASK=80000
GUARDIAN_MAX_REVIEW_CYCLES=3
```

---

## Resumen de Impacto

| # | Mejora | Ahorro Tokens | Seguridad | Autonomia | Esfuerzo |
|---|--------|--------------|-----------|-----------|----------|
| 1 | ARCHITECT Agent | -30-50% en Coder | - | +++ | Medio |
| 2 | Prompt Caching | -30-40% global | - | + | Bajo |
| 3 | Smart Model Routing | -40-60% (modelos ligeros) | - | +++ | Medio |
| 4 | Security Agent | +5% (nuevo agente) | +++++ | +++ | Medio |
| 5 | Circuit Breaker | -10-20% (evita waste) | ++ | +++ | Bajo |
| 6 | Token Estimator | Indirecto (evita rate limits) | - | ++ | Bajo |
| 7 | Streaming + Early Term | -10-20% (kill fallidos) | - | ++ | Alto |
| 8 | Knowledge Graph | -20-30% en Coder | - | +++ | Medio |
| 9 | Canary Merge | - | ++++ | ++++ | Medio |
| 10 | Autonomy Levels | - | +++++ | +++++ | Alto |

**Impacto total**: 50-70% reduccion de tokens, ejecuciones mas largas antes de rate limit, seguridad robusta, autonomia configurable.

## Orden de Implementacion Recomendado

1. **Prompt Caching** → rapido, alto impacto inmediato
2. **Circuit Breaker** → rapido, previene waste
3. **Smart Model Routing** → medio, gran ahorro a largo plazo
4. **ARCHITECT Agent** → medio, desbloquea Knowledge Graph
5. **Knowledge Graph** → medio, multiplica efecto del Architect
6. **Streaming + Early Term** → medio, reduce waste
7. **Security Agent** → medio, critico para produccion
8. **Token Estimator** → bajo esfuerzo, buen valor operativo
9. **Autonomy Levels** → alto esfuerzo, necesario para produccion real
10. **Canary Merge** → alto esfuerzo, ultima capa de seguridad
