# Komodo - Mejoras Fase 2: Inteligencia Avanzada

> 10 mejoras adicionales asumiendo que la Fase 1 ya esta implementada:
> ARCHITECT agent, Prompt Caching, Smart Model Routing, Security Agent, Circuit Breaker, Token Estimator, Streaming + Early Termination, Knowledge Graph, Canary Merge, y Autonomy Levels.
>
> Fase 2 se enfoca en hacer Komodo **mas inteligente, mas resiliente, y capaz de funcionar durante dias sin intervencion**.

---

## 11. TESTER Agent (nuevo agente)

**Prerequisitos Fase 1**: ARCHITECT Agent (#1), Knowledge Graph (#8)

**Problema**: El QA Agent actual genera tests genericos. Pero con el Knowledge Graph, el TESTER puede recibir el plan del Architect y el codigo del Coder para generar tests **quirurgicos** que prueban exactamente lo que se implemento.

**Diferencia con QA Agent existente**: QA genera tests a ciegas. TESTER los genera con contexto completo.

### Que hace
```
Flujo con TESTER:
PLANNER → ARCHITECT → CODER → TESTER → SECURITY → REVIEWER → MERGE
```

1. Recibe del Knowledge Graph:
   - Plan del Architect (que se iba a hacer)
   - Archivos del Coder (que se hizo realmente)
   - Acceptance criteria de la tarea
2. Genera tests que cubren:
   - Cada acceptance criteria → al menos 1 test
   - Happy path + error path por funcion nueva
   - Edge cases detectados por el Architect en `risks`
   - Regression tests si toca codigo existente
3. **Ejecuta** los tests localmente
4. Si fallan → devuelve al Coder con el output del test (no al Reviewer)
5. Si pasan → continua al Security Agent

### Output
```json
{
  "testsGenerated": 8,
  "testsPassed": 7,
  "testsFailed": 1,
  "coverage": {
    "newLines": "92%",
    "acceptanceCriteria": "4/4 covered"
  },
  "failedTests": [
    {
      "name": "should handle expired token",
      "error": "Expected 401, got 500",
      "file": "src/auth/login.test.js",
      "line": 42
    }
  ]
}
```

### Modelo recomendado
Sonnet. Los tests son codigo repetitivo/predecible, no necesita Opus.

### Valor
- El Reviewer no pierde turnos pidiendo "falta test para X" (ahorra ~3K-5K tokens por ciclo de review)
- Coverage sube automaticamente
- Los tests se generan con contexto del plan → son mas relevantes que tests genericos

---

## 12. Agent Memory con Embeddings

**Prerequisitos Fase 1**: Knowledge Graph (#8), Smart Model Routing (#3)

**Problema**: El memory-mcp actual almacena patterns como texto plano con tags manuales. Buscar patterns relevantes requiere coincidencia exacta de tags. Si el Coder cometio un error en "auth middleware" y la nueva tarea es "session management", no se conectan.

### Solucion: Memory con busqueda semantica

```
/memory/{projectId}/
  +-- patterns/
  |   +-- {patternId}/
  |       +-- text: "Missing null check on req.user in middleware"
  |       +-- embedding: [0.023, -0.145, ...] (768 dims)
  |       +-- severity: "major"
  |       +-- frequency: 5
  |       +-- lastSeen: timestamp
  |       +-- relatedFiles: ["src/middleware/auth.js"]
  +-- decisions/
  |   +-- {decisionId}/
  |       +-- context: "Auth module"
  |       +-- decision: "Used JWT over sessions"
  |       +-- reasoning: "Stateless, scales better"
  |       +-- embedding: [...]
  |       +-- outcome: "approved-first-cycle"
  +-- lessons/
      +-- {lessonId}/
          +-- module: "api"
          +-- lesson: "Always validate request body schema"
          +-- embedding: [...]
```

### Busqueda semantica
```javascript
async function getRelevantMemory(taskDescription, modules, topK = 5) {
  const queryEmbedding = await embed(taskDescription);

  // Buscar en patterns, decisions, y lessons
  const allMemories = await getAllMemories(projectId);

  const scored = allMemories.map(m => ({
    ...m,
    similarity: cosineSimilarity(queryEmbedding, m.embedding),
  }));

  // Filtrar por modulos afectados (boost)
  scored.forEach(m => {
    if (m.relatedFiles?.some(f => modules.some(mod => f.includes(mod)))) {
      m.similarity *= 1.3; // 30% boost por mismo modulo
    }
  });

  return scored
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK);
}
```

### Generacion de embeddings sin tokens de LLM
Usar un modelo de embeddings local (no gasta tokens de suscripcion):
- `all-MiniLM-L6-v2` via `@xenova/transformers` (runs en Node.js, CPU)
- 384 dimensiones, rapido, 0 tokens gastados
- Solo para similarity search, no para generacion

### Valor
- Memoria semantica: conecta "auth middleware" con "session management"
- Decisiones pasadas se reutilizan: "La ultima vez que tocamos auth, usamos JWT, mantener consistencia"
- 0 tokens extra (embeddings locales)

---

## 13. Adaptive Review Depth

**Prerequisitos Fase 1**: Smart Model Routing (#3), Token Estimator (#6)

**Problema**: El Reviewer siempre hace review completo con 8 criterios. Para una tarea trivial de 1 devPoint que cambia un string, es overkill (gasta ~10K tokens). Para una tarea compleja de 13 devPoints con cambios de seguridad, puede ser insuficiente.

### Profundidades de Review
```javascript
const REVIEW_DEPTHS = {
  quick: {
    criteria: ['correctness', 'tests'],
    model: 'haiku',
    maxTokens: 3000,
    // Para: trivial tasks, string changes, config changes
  },
  standard: {
    criteria: ['correctness', 'error-handling', 'tests', 'naming', 'structure'],
    model: 'sonnet',
    maxTokens: 10000,
    // Para: standard tasks, CRUD, UI components
  },
  deep: {
    criteria: ['correctness', 'error-handling', 'edge-cases', 'naming', 'structure', 'tests', 'security', 'patterns'],
    model: 'sonnet',
    maxTokens: 20000,
    // Para: complex tasks, auth, payments, data migrations
  },
  forensic: {
    criteria: ['all + line-by-line analysis'],
    model: 'opus',
    maxTokens: 40000,
    // Para: security-critical, crypto, financial logic
  },
};
```

### Seleccion automatica
```javascript
function selectReviewDepth(task, securityFindings, architectPlan) {
  // Forensic: si Security Agent encontro findings
  if (securityFindings?.findings?.some(f => f.severity === 'critical')) {
    return 'forensic';
  }

  // Deep: archivos sensibles o alta complejidad
  if (architectPlan.affectedModules.some(m => /auth|payment|crypto|migration/.test(m))) {
    return 'deep';
  }

  // Quick: trivial y pocos archivos
  if (task.devPoints <= 2 && architectPlan.filesToModify.length <= 3) {
    return 'quick';
  }

  return 'standard';
}
```

### Ahorro
- Tareas triviales: de ~10K tokens a ~3K tokens en review (-70%)
- Tareas normales: sin cambio
- Tareas criticas: gasta mas tokens pero detecta mas → menos ciclos de fix
- **Promedio**: -25-35% tokens en la fase de review

---

## 14. Self-Healing Pipeline

**Prerequisitos Fase 1**: Circuit Breaker (#5), Streaming + Early Term (#7), Canary Merge (#9)

**Problema**: Cuando algo falla, Komodo pausa y espera intervencion. Con los circuit breakers de Fase 1, al menos no gasta tokens de mas. Pero podria **auto-diagnosticar y auto-reparar** muchos fallos comunes.

### Diagnostico automatico
```javascript
const selfHealingStrategies = {
  'test-failure': {
    detect: (error) => error.type === 'pre-pr-tests-failed',
    diagnose: async (error) => {
      const failedTests = parseTestOutput(error.output);
      const isFlaky = await checkIfFlaky(failedTests); // Historial de este test
      const isNewTest = failedTests.every(t => t.isNew);
      return { failedTests, isFlaky, isNewTest };
    },
    heal: async (diagnosis) => {
      if (diagnosis.isFlaky) {
        // Re-run tests (no gastar tokens de LLM, solo CPU)
        return { action: 'retry-tests', maxRetries: 2 };
      }
      if (diagnosis.isNewTest) {
        // El Coder escribio un test que falla → fix especifico
        return {
          action: 'fix-code',
          context: `Tests written by Coder fail. Fix the implementation, not the tests.`,
          maxTokens: 5000,
        };
      }
      // Regression en tests existentes
      return {
        action: 'fix-code',
        context: `Existing tests broken. Regression caused by: ${diagnosis.failedTests.map(t => t.name).join(', ')}`,
      };
    },
  },

  'merge-conflict': {
    detect: (error) => error.message?.includes('merge conflict'),
    heal: async () => {
      // Rebase automatico
      return { action: 'rebase-and-retry' };
    },
  },

  'rate-limit': {
    detect: (error) => error.type === 'rate-limit',
    heal: async (diagnosis) => {
      const fallbackCLI = getNextFallbackCLI();
      if (fallbackCLI) {
        return { action: 'switch-cli', cli: fallbackCLI };
      }
      // Todos los CLIs rate limited → esperar al que se recupere primero
      const recovery = await estimateRecoveryTime();
      return { action: 'wait', minutes: recovery.minutes, cli: recovery.cli };
    },
  },

  'github-api-error': {
    detect: (error) => error.source === 'github',
    heal: async () => {
      // Exponential backoff
      return { action: 'retry-with-backoff', baseMs: 5000, maxRetries: 3 };
    },
  },

  'agent-timeout': {
    detect: (error) => error.type === 'watchdog-timeout',
    heal: async (diagnosis) => {
      // Relanzar con modelo mas rapido y menos contexto
      return {
        action: 'retry-with-lighter-model',
        model: 'haiku',
        maxTurns: 10,
        reducedContext: true,
      };
    },
  },

  'firebase-down': {
    detect: (error) => error.source === 'firebase',
    heal: async () => {
      // Modo offline: guardar en local, sincronizar cuando vuelva
      return { action: 'switch-to-offline-mode' };
    },
  },
};
```

### Pipeline de auto-reparacion
```javascript
async function handleFailure(error, context) {
  for (const [name, strategy] of Object.entries(selfHealingStrategies)) {
    if (strategy.detect(error)) {
      emit('self-heal:attempting', { strategy: name, error: error.message });

      const diagnosis = strategy.diagnose ? await strategy.diagnose(error) : null;
      const action = await strategy.heal(diagnosis);

      emit('self-heal:action', { strategy: name, action });

      const result = await executeHealingAction(action, context);

      if (result.success) {
        emit('self-heal:recovered', { strategy: name });
        return { healed: true, action };
      }

      emit('self-heal:failed', { strategy: name });
      // Siguiente estrategia o escalar a humano
    }
  }

  // Ninguna estrategia funciono
  emit('self-heal:exhausted', { error: error.message });
  return { healed: false };
}
```

### Valor
- Reduce intervenciones humanas en ~70% de los fallos comunes
- Tests flaky se reintentan sin gastar tokens
- Rate limits se manejan automaticamente con fallback + espera
- Merge conflicts se resuelven con rebase automatico

---

## 15. Multi-Agent Parallel Pipeline

**Prerequisitos Fase 1**: ARCHITECT Agent (#1), Knowledge Graph (#8), Canary Merge (#9)

**Problema**: Actualmente el pipeline es estrictamente secuencial: PLANNER → CODER → REVIEWER → MERGE. Incluso con `MAX_PARALLEL > 1`, cada tarea individual es secuencial. Con el Architect, hay oportunidades de paralelismo.

### Paralelismo intra-tarea
```
Sin paralelismo (actual):
  PLANNER ──→ ARCHITECT ──→ CODER ──→ SECURITY ──→ TESTER ──→ REVIEWER ──→ MERGE
  Total: suma de todos los tiempos

Con paralelismo:
  PLANNER ──→ ARCHITECT ──→ CODER ──→ ┬─ SECURITY ─┐
                                       └─ TESTER ───┤──→ REVIEWER ──→ MERGE
                                                     │
  (Security y Tester corren en paralelo sobre el mismo diff)
```

### Paralelismo inter-tarea con pipeline
```
Tarea 1: [PLAN] [ARCH] [CODE] [SEC+TEST] [REVIEW] [MERGE]
Tarea 2:        [PLAN] [ARCH] [CODE]      [SEC+TEST] [REVIEW] [MERGE]
Tarea 3:               [PLAN] [ARCH]      [CODE]     [SEC+TEST] [REVIEW] ...

Mientras Tarea 1 esta en Review, Tarea 2 ya esta en Coding, y Tarea 3 en Planning.
```

### Implementacion
```javascript
class PipelineScheduler {
  constructor({ maxConcurrentAgents = 3 }) {
    this.stages = ['plan', 'architect', 'code', 'security+test', 'review', 'merge'];
    this.running = new Map(); // taskId → currentStage
    this.maxConcurrent = maxConcurrentAgents;
  }

  canStart(taskId, stage) {
    // No exceder max agentes concurrentes
    if (this.running.size >= this.maxConcurrent) return false;

    // No dos tareas en el mismo stage si usan el mismo CLI
    const sameStage = [...this.running.values()].filter(s => s === stage);
    if (sameStage.length > 0 && this.stageUsesSameCLI(stage)) return false;

    // No conflict detection (de Fase 1 #9.4)
    if (stage === 'code' && this.hasFileConflict(taskId)) return false;

    return true;
  }

  async advanceTask(taskId) {
    const currentStage = this.running.get(taskId);
    const nextStage = this.stages[this.stages.indexOf(currentStage) + 1];

    if (!nextStage) {
      this.running.delete(taskId); // Tarea completada
      return;
    }

    if (this.canStart(taskId, nextStage)) {
      this.running.set(taskId, nextStage);
      await this.executeStage(taskId, nextStage);
    } else {
      // Esperar a que se libere un slot
      this.queue.push({ taskId, stage: nextStage });
    }
  }
}
```

### Rate limit awareness
```javascript
// Si un CLI esta rate limited, solo las tareas que usan OTRO CLI avanzan
function canUseAgent(agent, cli) {
  if (cliHealth[cli].status === 'rate-limited') {
    const fallback = getFallbackCLI(cli);
    if (!fallback || cliHealth[fallback].status === 'rate-limited') {
      return false; // Todos los CLIs para este agente estan rate limited
    }
    agent.cli = fallback; // Usar fallback
  }
  return true;
}
```

### Valor
- **2-3x mas tareas por hora** con el mismo rate limit
- El bottleneck deja de ser el tiempo total y pasa a ser el rate limit
- Security + Tester en paralelo no compiten (uno usa LLM, otro ejecuta tests locales)

---

## 16. Codebase Learning Engine

**Prerequisitos Fase 1**: Knowledge Graph (#8), Prompt Caching (#2)

**Problema**: Cada vez que el Coder trabaja en un proyecto, tiene que re-descubrir las convenciones, patrones, y estructura. El Style Detector actual es superficial (indentation, quotes). Falta entender patrones de arquitectura.

### Que aprende
```
/learning/{projectId}/
  +-- architecture/
  |   +-- patterns: ["Repository pattern in /src/repos/", "Controller → Service → Repository"]
  |   +-- conventions: ["All API routes return { data, error, status }"]
  |   +-- antiPatterns: ["Never use direct DB queries outside repos/"]
  +-- testing/
  |   +-- framework: "vitest"
  |   +-- patterns: ["describe/it/expect structure", "Use fixtures from __fixtures__/"]
  |   +-- mocks: ["Always mock Firebase with src/test/firebase-mock.ts"]
  +-- api/
  |   +-- style: "REST with /api/v1/ prefix"
  |   +-- auth: "JWT in Authorization header"
  |   +-- validation: "Zod schemas in /src/schemas/"
  +-- naming/
  |   +-- files: "kebab-case for files, PascalCase for components"
  |   +-- functions: "camelCase, prefix handlers with handle*"
  |   +-- types: "PascalCase, suffix with Type/Interface for ambiguous names"
  +-- dependencies/
      +-- preferred: { "http": "axios", "testing": "vitest", "validation": "zod" }
      +-- forbidden: ["moment.js (use date-fns)", "lodash (use native)"]
```

### Como aprende
Se ejecuta una vez al configurar el proyecto + se actualiza incrementalmente:

```javascript
async function learnFromCodebase(projectDir) {
  // 1. Analizar estructura de directorios
  const structure = await analyzeDirectoryStructure(projectDir);

  // 2. Leer archivos clave (package.json, tsconfig, .eslintrc, etc.)
  const config = await readProjectConfig(projectDir);

  // 3. Extraer patterns de 10 archivos representativos
  const samples = await getSampleFiles(projectDir, 10);
  const patterns = await extractPatterns(samples);

  // 4. Analizar tests existentes
  const testPatterns = await analyzeTestPatterns(projectDir);

  // 5. Guardar en Firebase (persistente entre sesiones)
  await saveToFirebase(`learning/${projectId}`, {
    architecture: patterns,
    testing: testPatterns,
    config,
    learnedAt: Date.now(),
  });
}

// Actualizacion incremental despues de cada tarea
async function updateLearning(taskKnowledge) {
  const newPatterns = taskKnowledge.reviewer.positives; // Lo que el Reviewer aprobo
  const newAntiPatterns = taskKnowledge.reviewer.issues; // Lo que el Reviewer rechazo

  // Merge con learning existente
  await mergePatterns(projectId, newPatterns, newAntiPatterns);
}
```

### Inyeccion en Coder
```javascript
function buildCoderPrompt(task) {
  const learning = await getLearning(projectId);
  return `
    ${STATIC_SYSTEM_PROMPT}

    PROJECT CONVENTIONS:
    ${learning.architecture.conventions.join('\n')}

    TESTING PATTERNS:
    Framework: ${learning.testing.framework}
    ${learning.testing.patterns.join('\n')}

    NAMING:
    ${JSON.stringify(learning.naming)}

    FORBIDDEN:
    ${learning.dependencies.forbidden.join('\n')}
  `;
}
```

### Valor
- El Coder **nunca** genera codigo con lodash si el proyecto usa native
- El Coder **siempre** sigue el pattern del proyecto (Repository, Controller, etc.)
- Menos reviews rechazados por "no sigue convenciones" → menos ciclos → menos tokens
- **Se actualiza solo**: cada tarea completada refina el learning

---

## 17. Intelligent Task Decomposition v2

**Prerequisitos Fase 1**: ARCHITECT Agent (#1), Token Estimator (#6)

**Problema**: El Task Decomposer actual solo mira devPoints (>=8 → descomponer). Pero un task de 5 devPoints que toca 4 modulos diferentes es mas complejo que uno de 8 que toca 1 modulo. Ademas, la descomposicion es generica.

### Descomposicion basada en el plan del Architect
```javascript
async function smartDecompose(task, architectPlan) {
  // 1. Analizar el plan
  const modulesAffected = architectPlan.affectedModules.length;
  const filesAffected = architectPlan.filesToModify.length + architectPlan.filesToCreate.length;
  const hasDependencyChanges = architectPlan.dependencies.length > 0;
  const hasDataModelChanges = !!architectPlan.dataModelChanges;
  const hasAPIChanges = !!architectPlan.apiChanges;

  // 2. Calcular complejidad real (no solo devPoints)
  const realComplexity = calculateRealComplexity({
    devPoints: task.devPoints,
    modulesAffected,
    filesAffected,
    hasDependencyChanges,
    hasDataModelChanges,
    hasAPIChanges,
    risks: architectPlan.risks.length,
  });

  // 3. Decidir si descomponer
  if (realComplexity < DECOMPOSITION_THRESHOLD) return null;

  // 4. Descomponer siguiendo el plan del Architect
  const subtasks = architectPlan.implementationOrder.map((step, i) => ({
    title: `${task.title} - Step ${i + 1}: ${step}`,
    devPoints: Math.ceil(task.devPoints / architectPlan.implementationOrder.length),
    scope: step,
    dependsOn: i > 0 ? [subtaskIds[i - 1]] : [],
    filesToTouch: architectPlan.filesToModify.filter(f => f.relatedStep === i),
  }));

  return subtasks;
}
```

### Ejemplo
```
Tarea original: "Implementar sistema de autenticacion completo" (13 devPoints)

Architect plan:
  1. Crear modelo User y migracion DB
  2. Crear endpoints auth (register, login, refresh)
  3. Crear middleware de auth
  4. Crear tests de integracion

Subtasks generadas:
  1. "Auth - Step 1: User model + migration" (3 pts) → toca: schema, migration
  2. "Auth - Step 2: Auth endpoints" (5 pts) → toca: routes, controllers → depende de 1
  3. "Auth - Step 3: Auth middleware" (3 pts) → toca: middleware → depende de 1
  4. "Auth - Step 4: Integration tests" (2 pts) → toca: tests → depende de 2,3
```

### Valor
- Subtasks son coherentes (siguen el plan del Architect, no son arbitrarias)
- Cada subtask es independientemente revisable (PRs mas pequenos → reviews mas rapidos → menos tokens)
- Paralelizable: Steps 2 y 3 pueden correr en paralelo (no dependen entre si)

---

## 18. Budget Intelligence

**Prerequisitos Fase 1**: Token Estimator (#6), Smart Model Routing (#3)

**Problema**: El Budget Manager actual solo trackea gasto y pausa cuando se excede. Es reactivo. Necesita ser **predictivo y estrategico**.

### Rate Limit Forecasting
```javascript
class RateLimitForecaster {
  constructor() {
    this.usageHistory = []; // { timestamp, tokens, cli }
  }

  record(tokens, cli) {
    this.usageHistory.push({ timestamp: Date.now(), tokens, cli });
    // Mantener solo ultimas 2 horas
    this.usageHistory = this.usageHistory.filter(
      u => Date.now() - u.timestamp < 2 * 60 * 60 * 1000
    );
  }

  forecast(cli, minutesAhead = 30) {
    const recent = this.usageHistory.filter(u => u.cli === cli);
    if (recent.length < 3) return { confident: false };

    // Tokens por minuto (media movil)
    const tokensPerMinute = recent.reduce((sum, u) => sum + u.tokens, 0)
      / ((Date.now() - recent[0].timestamp) / 60_000);

    const projectedTokens = tokensPerMinute * minutesAhead;
    const estimatedLimit = getEstimatedRateLimit(cli); // Aprendido del historico

    return {
      confident: true,
      tokensPerMinute,
      projectedUsage: projectedTokens,
      estimatedHeadroom: estimatedLimit - projectedTokens,
      minutesToRateLimit: (estimatedLimit - this.getCurrentUsage(cli)) / tokensPerMinute,
      recommendation: this.getRecommendation(tokensPerMinute, estimatedLimit),
    };
  }

  getRecommendation(rate, limit) {
    const minutesLeft = (limit - this.getCurrentUsage()) / rate;
    if (minutesLeft > 60) return 'green';     // Mas de 1 hora de margen
    if (minutesLeft > 20) return 'yellow';    // Reducir uso, usar modelos ligeros
    if (minutesLeft > 5) return 'orange';     // Solo tareas triviales
    return 'red';                              // Parar y esperar recovery
  }
}
```

### Estrategia adaptativa
```javascript
async function selectTaskStrategy(forecast) {
  switch (forecast.recommendation) {
    case 'green':
      // Normal: ejecutar cualquier tarea con modelo optimo
      return { filter: 'all', modelStrategy: 'optimal' };

    case 'yellow':
      // Conservador: solo tareas standard/trivial, modelos ligeros
      return {
        filter: (task) => task.devPoints <= 5,
        modelStrategy: 'lightweight', // Sonnet/Haiku para todo
      };

    case 'orange':
      // Minimo: solo triviales, Haiku
      return {
        filter: (task) => task.devPoints <= 2,
        modelStrategy: 'minimum', // Haiku/Flash para todo
      };

    case 'red':
      // Parar, esperar recovery
      return { action: 'pause', waitForRecovery: true };
  }
}
```

### Dashboard Widget
```
Rate Limit Status: [======----] 62% used
Tokens/min: 1,200
Estimated headroom: 38 min
Recommendation: YELLOW - using lightweight models
Next task estimated: 8K tokens (~7 min of headroom)

Today's efficiency:
  Tasks completed: 12
  Avg tokens/task: 15K
  Tokens saved vs baseline: 45K (23%)
```

### Valor
- Nunca llegar a rate limit por sorpresa (el forecast avisa 20 min antes)
- Adaptar automaticamente la agresividad del modelo al headroom disponible
- Maximizar tareas completadas dentro del rate limit del dia

---

## 19. Cross-Project Intelligence

**Prerequisitos Fase 1**: Knowledge Graph (#8), Smart Model Routing (#3)

**Problema**: Si Komodo trabaja en 5 proyectos, cada uno aprende por separado. Pero patterns como "null check en middleware" o "tests para edge cases" son universales.

### Knowledge Sharing entre Proyectos
```
/global-intelligence/
  +-- patterns/
  |   +-- {patternId}/
  |       +-- text: "Always validate request body before processing"
  |       +-- projectsSeenIn: ["project-a", "project-b", "project-c"]
  |       +-- universalityScore: 0.85 (visto en 85% de proyectos)
  |       +-- embedding: [...]
  +-- model-performance/
  |   +-- aggregated/
  |       +-- "sonnet"/
  |           +-- avgSuccessRate: 0.88
  |           +-- bestFor: ["trivial", "api-crud", "config-changes"]
  |           +-- worstFor: ["complex-algorithms", "multi-file-refactor"]
  +-- anti-patterns/
      +-- {id}/
          +-- pattern: "Using string concatenation for SQL"
          +-- remedy: "Use parameterized queries"
          +-- severity: "critical"
          +-- universalityScore: 1.0
```

### Transferencia de conocimiento
```javascript
async function getGlobalInsights(task, projectId) {
  // 1. Patterns universales (vistos en 3+ proyectos)
  const universalPatterns = await getUniversalPatterns(0.6); // 60%+ universalidad

  // 2. Model performance global
  const modelInsights = await getGlobalModelPerformance();

  // 3. Anti-patterns globales
  const antiPatterns = await getGlobalAntiPatterns();

  // 4. Filtrar por relevancia a esta tarea
  const relevant = filterByRelevance(
    [...universalPatterns, ...antiPatterns],
    task.description,
    500 // Max tokens de contexto
  );

  return {
    patterns: relevant,
    modelRecommendation: modelInsights[task.complexity]?.bestModel,
  };
}
```

### Promotion de patterns
```javascript
// Despues de cada tarea, evaluar si los patterns son universales
async function evaluatePatternUniversality(pattern, projectId) {
  pattern.projectsSeenIn.add(projectId);
  const totalProjects = await getProjectCount();
  pattern.universalityScore = pattern.projectsSeenIn.size / totalProjects;

  if (pattern.universalityScore >= 0.6 && !pattern.isGlobal) {
    // Promover a global intelligence
    await saveToGlobalIntelligence(pattern);
    pattern.isGlobal = true;
  }
}
```

### Valor
- Proyecto nuevo se beneficia inmediatamente del conocimiento de los anteriores
- Model routing se optimiza con datos de todos los proyectos (no solo del actual)
- Anti-patterns criticos (seguridad) se propagan a todos los proyectos automaticamente

---

## 20. Observability + Replay System

**Prerequisitos Fase 1**: Autonomy Levels (#10), Knowledge Graph (#8)

**Problema**: Cuando Komodo lleva 8 horas ejecutando en daemon mode y algo salio mal, no hay forma de entender que paso. Los logs son textuales y no estructurados.

### Structured Event Log
Cada decision y accion se registra como un evento estructurado:
```javascript
const eventSchema = {
  id: 'evt_123',
  timestamp: '2026-03-10T15:30:00Z',
  taskId: 'task-abc',
  phase: 'review',
  agent: 'REVIEWER',
  action: 'review-completed',
  input: {
    prNumber: 42,
    reviewDepth: 'standard',
    model: 'sonnet',
  },
  output: {
    verdict: 'REQUEST_CHANGES',
    score: 6,
    issueCount: 3,
  },
  metrics: {
    tokensUsed: 8500,
    turnsUsed: 4,
    durationMs: 45000,
  },
  context: {
    reviewCycle: 2,
    previousScore: 5,
    modelRoutingReason: 'standard-complexity + learned-preference',
  },
  parentEventId: 'evt_120', // Traceability chain
};
```

### Timeline View en Dashboard
```
Timeline de Task "Implementar Login"

15:30 ─── PLANNER selecciono tarea (2K tokens, 1 turn)
15:31 ─── ARCHITECT genero plan: 5 files, medium complexity (3K tokens, 2 turns)
15:32 ─── MODEL SELECTOR: Sonnet (reason: standard + 82% success rate)
15:33 ─── CODER inicio implementacion
15:37 ─── CODER completo: 4 files, 280 lines, PR #42 (12K tokens, 8 turns)
15:37 ─── SECURITY scan: PASS (npm audit clean, 0 findings) (1K tokens)
15:37 ─── TESTER: 6 tests generated, 6 passed (3K tokens, 3 turns)
15:38 ─── REVIEWER review (standard depth)
15:39 ─── REVIEWER: REQUEST_CHANGES, score 6, 3 issues (8K tokens, 4 turns)
         ├── MAJOR: Missing error handling in login controller
         ├── MINOR: Inconsistent naming in auth middleware
         └── SUGGESTION: Add rate limiting to login endpoint
15:40 ─── CODER fixing issues...
15:42 ─── CODER fix complete: 2 files changed (5K tokens, 3 turns)
15:42 ─── REVIEWER incremental review
15:43 ─── REVIEWER: APPROVED, score 9 (4K tokens, 2 turns)
15:43 ─── PRE-MERGE validation: PASS
15:44 ─── MERGED: PR #42 squash merged
15:44 ─── Task completed. Total: 38K tokens, 23 turns, 14 minutes

Total tokens: 38,500
Tokens saved (vs no Fase 1): ~25,000 (39% reduction)
```

### Replay System
Poder "rebobinar" y ver exactamente que paso:
```javascript
class ReplaySystem {
  async getTaskTimeline(taskId) {
    const events = await getEventsForTask(taskId);
    return events.map(e => ({
      ...e,
      // Incluir el contexto completo que tenia el agente
      agentContext: await getKnowledge(taskId, e.phase),
      // Diff del estado antes/despues
      stateDiff: computeStateDiff(e.previousState, e.newState),
    }));
  }

  // Para debugging: "por que el Reviewer rechazo esto?"
  async explainDecision(eventId) {
    const event = await getEvent(eventId);
    return {
      decision: event.output,
      inputContext: event.input,
      agentPrompt: await reconstructPrompt(event), // El prompt exacto que recibio
      modelUsed: event.context.model,
      tokensUsed: event.metrics.tokensUsed,
    };
  }
}
```

### Alerting basado en anomalias
```javascript
const alertRules = [
  {
    name: 'token-spike',
    condition: (event) => event.metrics.tokensUsed > event.expectedTokens * 2,
    alert: 'Task used 2x expected tokens',
  },
  {
    name: 'review-regression',
    condition: (events) => {
      const lastScores = events.filter(e => e.action === 'review-completed').slice(-5);
      return lastScores.every(s => s.output.score < 7);
    },
    alert: 'Last 5 reviews scored below 7 - quality regression',
  },
  {
    name: 'model-degradation',
    condition: (events) => {
      const sonnetTasks = events.filter(e => e.context.model === 'sonnet');
      const recentFailRate = computeFailRate(sonnetTasks.slice(-10));
      return recentFailRate > 0.4;
    },
    alert: 'Sonnet fail rate above 40% - consider escalating to Opus',
  },
];
```

### Valor
- Entender exactamente que paso en cualquier tarea
- Debugging de decisiones del orquestador sin adivinar
- Alertas proactivas antes de que los problemas se acumulen
- Datos para mejorar los prompts basandose en decisiones reales

---

## Resumen de Impacto Fase 2

| # | Mejora | Tokens | Resiliencia | Inteligencia | Esfuerzo |
|---|--------|--------|-------------|--------------|----------|
| 11 | TESTER Agent | -3-5K/review cycle | + | ++ | Medio |
| 12 | Memory Embeddings | -10-15% contexto | + | +++++ | Medio |
| 13 | Adaptive Review | -25-35% en review | + | +++ | Bajo |
| 14 | Self-Healing | Evita waste en fallos | +++++ | +++ | Alto |
| 15 | Parallel Pipeline | 2-3x throughput | ++ | ++ | Alto |
| 16 | Codebase Learning | -15-20% en Coder | + | +++++ | Medio |
| 17 | Smart Decomposition v2 | Indirecto (PRs chicos) | + | +++ | Bajo |
| 18 | Budget Intelligence | Maximiza throughput | +++ | +++ | Medio |
| 19 | Cross-Project Intel | -10% en proyectos nuevos | + | +++++ | Medio |
| 20 | Observability + Replay | Indirecto (debugging) | +++ | ++ | Medio |

## Orden de Implementacion Recomendado (Fase 2)

1. **Adaptive Review Depth** (#13) → bajo esfuerzo, ahorro inmediato en tokens
2. **TESTER Agent** (#11) → medio, reduce ciclos de review
3. **Self-Healing Pipeline** (#14) → alto valor, reduce intervenciones humanas
4. **Codebase Learning** (#16) → el Coder se vuelve cada vez mejor
5. **Budget Intelligence** (#18) → maximiza tareas antes de rate limit
6. **Memory Embeddings** (#12) → memoria semantica mas inteligente
7. **Observability** (#20) → necesario para operar en produccion
8. **Smart Decomposition v2** (#17) → mejora quality of PRs
9. **Cross-Project Intelligence** (#19) → efecto red entre proyectos
10. **Parallel Pipeline** (#15) → ultimo por complejidad, pero mayor impacto en throughput

---

## Vision Final: Komodo con Fase 1 + Fase 2

```
Flujo optimizado de una tarea:

1. PLANNER selecciona tarea (Haiku, ~1K tokens)
   → Knowledge Graph: "Esta tarea esta relacionada con task-xyz del sprint pasado"
   → Cross-Project: "Pattern universal: siempre validar input en endpoints"

2. ARCHITECT genera plan (Sonnet, ~3K tokens)
   → Codebase Learning: "Este proyecto usa Repository pattern"
   → Smart Decomposition: "Complejidad real: medium, no decompose"

3. CODER implementa (modelo segun Smart Routing, ~8K tokens gracias al plan)
   → Knowledge Graph: recibe plan exacto del Architect
   → Memory Embeddings: "Ojo, en este modulo siempre falta null check"
   → Prompt Caching: contexto estatico cacheado

4. SECURITY + TESTER en paralelo (~2K + ~3K tokens)
   → Security: herramientas locales primero, LLM solo si ambiguo
   → Tester: tests quirurgicos basados en plan + codigo real

5. REVIEWER con Adaptive Depth (quick/standard/deep, ~3K-15K tokens)
   → Codebase Learning: sabe las convenciones del proyecto
   → Knowledge Graph: sabe que planeo el Architect y que decidio el Coder

6. MERGE con Canary + Pre-validation
   → Self-Healing: si CI falla, auto-fix antes de revert
   → Conflict Detection: avisa si otra tarea toca los mismos archivos

7. POST-MERGE
   → Actualizar Learning Engine con lo aprendido
   → Actualizar Memory Embeddings con patterns nuevos
   → Promover patterns universales a Cross-Project Intelligence
   → Registrar en Observability para replay futuro

Resultado:
  Tokens por tarea trivial: ~5K (antes: ~20K) = 75% reduccion
  Tokens por tarea standard: ~20K (antes: ~45K) = 55% reduccion
  Tokens por tarea compleja: ~50K (antes: ~100K+) = 50% reduccion
  Intervenciones humanas: ~5% de tareas (antes: ~30%)
  Throughput: 3x mas tareas por sesion de rate limit
  Uptime autonomo: dias en vez de horas
```
