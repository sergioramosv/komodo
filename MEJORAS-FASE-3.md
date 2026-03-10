# Komodo - Mejoras Fase 3: Escala e Inteligencia Colectiva

> 10 mejoras finales asumiendo Fase 1 y Fase 2 ya implementadas.
>
> **Estado actual tras Fase 1+2**: Komodo tiene 6 agentes (Planner, Architect, Coder, Tester, Security, Reviewer), routing inteligente de modelos, knowledge graph, memoria semantica, self-healing, pipeline paralelo, codebase learning, observability completa, budget intelligence, y cross-project intelligence.
>
> **Fase 3 se enfoca en**: escalar a equipos reales, microservicios, multi-repo, auto-optimizacion de prompts, y convertir Komodo en un sistema que mejora solo con cada tarea que ejecuta.

---

## 21. DOCUMENTER Agent (nuevo agente)

**Prerequisitos**: ARCHITECT (#1), Knowledge Graph (#8), Codebase Learning (#16)

**Problema**: El Coder implementa, el Reviewer aprueba, se mergea... y nadie documenta nada. Los PRs tienen descripcion generica, no hay docstrings, no se actualiza el README, no se documentan decisiones arquitectonicas. El equipo humano que hereda el codigo no entiende por que se hizo asi.

### Que hace
Corre **despues del merge** (no bloquea el pipeline):
```
PLANNER → ARCHITECT → CODER → TESTER+SECURITY → REVIEWER → MERGE → DOCUMENTER
```

1. Lee el Knowledge Graph completo de la tarea (plan, decisiones, review)
2. Genera/actualiza:
   - **PR description**: Reescribe con contexto real (no la generica del Coder)
   - **Inline comments**: Agrega JSDoc/docstrings a funciones nuevas/modificadas
   - **ADR (Architecture Decision Record)**: Si el Architect detecto cambios de arquitectura
   - **CHANGELOG entry**: Entrada semantica para el changelog
   - **README updates**: Si se anadieron endpoints, comandos, o config nueva
3. Commitea la documentacion en un commit separado (`docs: ...`)

### Modelo recomendado
Haiku/Flash. Documentar es reformular, no razonar. ~2K-4K tokens.

### ADR Automatico
```markdown
# ADR-042: Migrar autenticacion de sessions a JWT

## Estado
Aceptado (auto-generado por Komodo)

## Contexto
La tarea "Implementar login con OAuth" requeria autenticacion stateless
para soportar multiples instancias del backend.

## Decision
Usar JWT con refresh tokens. Access token expira en 15 min, refresh en 7 dias.

## Consecuencias
- Positivas: Stateless, escala horizontalmente, compatible con OAuth providers
- Negativas: Tokens no se pueden revocar individualmente sin blacklist
- Riesgos: Si el secret key se compromete, todos los tokens son validos

## Fuente
- Tarea: task-abc123 "Implementar login con OAuth"
- Architect decision log
- Review score: 9/10
```

### Almacenamiento
```
/docs/adr/          → Architecture Decision Records
/docs/changelog/    → Entradas de changelog por tarea
project README      → Updates inline
```

### Valor
- El equipo humano entiende cada cambio sin leer el PR completo
- Las decisiones de arquitectura quedan registradas permanentemente
- El README se mantiene actualizado automaticamente
- Tokens minimos (Haiku post-merge, no bloquea nada)

---

## 22. Impact Analyzer

**Prerequisitos**: Codebase Learning (#16), Knowledge Graph (#8), ARCHITECT (#1)

**Problema**: Cuando el Architect planea "modificar user.service.ts", no sabe que ese archivo es importado por 47 otros archivos. Un cambio en la firma de una funcion puede romper medio proyecto. El Coder descubre esto a mitad de implementacion (gastando turnos), o peor, el Reviewer lo detecta tarde.

### Analisis de impacto estatico
```javascript
class ImpactAnalyzer {
  constructor(projectDir) {
    this.dependencyGraph = null; // { file → [files that import it] }
    this.hotFiles = null;        // Files with most dependents
  }

  async buildDependencyGraph(projectDir) {
    // Parse imports/requires de todos los archivos
    const files = await glob('**/*.{js,ts,jsx,tsx,py}', { cwd: projectDir });
    const graph = {};

    for (const file of files) {
      const imports = await extractImports(file);
      for (const imp of imports) {
        if (!graph[imp.resolvedPath]) graph[imp.resolvedPath] = [];
        graph[imp.resolvedPath].push(file);
      }
    }

    this.dependencyGraph = graph;
    this.hotFiles = Object.entries(graph)
      .sort(([, a], [, b]) => b.length - a.length)
      .slice(0, 20)
      .map(([file, deps]) => ({ file, dependentCount: deps.length }));
  }

  analyzeImpact(filesToModify) {
    const directImpact = new Set();
    const transitiveImpact = new Set();

    for (const file of filesToModify) {
      const dependents = this.dependencyGraph[file] || [];
      dependents.forEach(d => directImpact.add(d));

      // Segundo nivel: archivos que importan los dependientes
      for (const dep of dependents) {
        const transitive = this.dependencyGraph[dep] || [];
        transitive.forEach(t => transitiveImpact.add(t));
      }
    }

    return {
      directImpact: [...directImpact],
      transitiveImpact: [...transitiveImpact],
      riskLevel: directImpact.size > 20 ? 'high'
               : directImpact.size > 5 ? 'medium'
               : 'low',
      hotFilesAffected: this.hotFiles.filter(h =>
        filesToModify.includes(h.file)
      ),
    };
  }
}
```

### Inyeccion en el Architect
```javascript
// Antes de que el Architect genere el plan:
const impact = impactAnalyzer.analyzeImpact(candidateFiles);

architectPrompt += `
IMPACT ANALYSIS:
  Direct dependents: ${impact.directImpact.length} files
  Transitive dependents: ${impact.transitiveImpact.length} files
  Risk level: ${impact.riskLevel}
  Hot files affected: ${impact.hotFilesAffected.map(h => `${h.file} (${h.dependentCount} dependents)`).join(', ')}

  If modifying function signatures in hot files, plan backward-compatible changes
  or include ALL dependent files in the modification plan.
`;
```

### Inyeccion en el Tester
```javascript
// El Tester genera tests de regresion para archivos impactados
testerPrompt += `
FILES IMPACTED BY THIS CHANGE (generate regression tests for these):
${impact.directImpact.slice(0, 10).join('\n')}
`;
```

### Guardian Gate (Fase 1 #10)
```javascript
{
  name: 'high-impact-change',
  condition: (ctx) => ctx.impactAnalysis?.riskLevel === 'high',
  action: 'require-approval',
  message: 'Cambio de alto impacto: ${ctx.impactAnalysis.directImpact.length} archivos afectados directamente.',
}
```

### Valor
- El Architect planea cambios backward-compatible cuando toca hot files
- El Tester genera regression tests para archivos impactados
- Los Guardian gates escalan cambios de alto impacto a humanos
- 0 tokens extra (analisis estatico con parsing local, no LLM)

---

## 23. Multi-Repo Orchestration

**Prerequisitos**: Multi-Project Runner (existente), Knowledge Graph (#8), Parallel Pipeline (#15)

**Problema**: Muchos proyectos reales son microservicios: un cambio en el API del backend requiere actualizar el frontend, la documentacion, y quizas un SDK. Actualmente Komodo trata cada proyecto como isla independiente.

### Definicion de Workspace
```json
// komodo-workspace.json
{
  "workspace": "mi-plataforma",
  "repos": [
    {
      "id": "backend",
      "repo": "org/backend-api",
      "path": "./backend",
      "type": "api",
      "exposes": ["REST endpoints", "GraphQL schema", "Event types"]
    },
    {
      "id": "frontend",
      "repo": "org/frontend-app",
      "path": "./frontend",
      "type": "consumer",
      "consumes": ["backend"]
    },
    {
      "id": "mobile",
      "repo": "org/mobile-app",
      "path": "./mobile",
      "type": "consumer",
      "consumes": ["backend"]
    },
    {
      "id": "docs",
      "repo": "org/docs-site",
      "path": "./docs",
      "type": "docs",
      "documents": ["backend", "frontend"]
    }
  ],
  "contracts": {
    "backend→frontend": "openapi.yaml",
    "backend→mobile": "openapi.yaml"
  }
}
```

### Cross-Repo Task Decomposition
Cuando una tarea afecta multiples repos:
```javascript
async function decomposeForWorkspace(task, workspace) {
  // 1. El Architect analiza que repos se ven afectados
  const affected = await architectAnalyzeWorkspaceImpact(task, workspace);

  // Ejemplo para "Anadir endpoint GET /users/:id/preferences"
  // affected = ['backend', 'frontend', 'docs']

  // 2. Generar subtask por repo con dependencias
  const subtasks = [
    {
      title: `[backend] ${task.title} - API endpoint`,
      repo: 'org/backend-api',
      dependsOn: [],
      scope: 'Create endpoint, schema, tests',
    },
    {
      title: `[frontend] ${task.title} - UI integration`,
      repo: 'org/frontend-app',
      dependsOn: ['backend'], // Esperar a que el backend este mergeado
      scope: 'Call new endpoint, display preferences',
    },
    {
      title: `[docs] ${task.title} - API documentation`,
      repo: 'org/docs-site',
      dependsOn: ['backend'],
      scope: 'Document new endpoint in API reference',
    },
  ];

  return subtasks;
}
```

### Contract Validation
Despues de que el backend mergea, validar que los contratos siguen:
```javascript
async function validateContracts(workspace, changedRepo) {
  const contracts = workspace.contracts;

  for (const [relation, contractFile] of Object.entries(contracts)) {
    const [provider, consumer] = relation.split('→');
    if (provider !== changedRepo) continue;

    // Verificar que el contrato (OpenAPI, protobuf, etc.) es compatible
    const currentContract = await readContract(provider, contractFile);
    const previousContract = await readPreviousContract(provider, contractFile);

    const breaking = detectBreakingChanges(previousContract, currentContract);

    if (breaking.length > 0) {
      emit('contract:breaking-change', {
        provider, consumer,
        changes: breaking,
        // Auto-create fix tasks for consumers
      });

      // Crear tareas automaticas para actualizar consumidores
      for (const consumerRepo of getConsumers(provider, workspace)) {
        await createTask({
          title: `[${consumerRepo}] Adapt to breaking change in ${provider}: ${breaking[0].description}`,
          priority: 100, // Alta prioridad
          dependsOn: [], // Ya el breaking change esta mergeado
        });
      }
    }
  }
}
```

### Valor
- Un cambio en el backend genera automaticamente tareas para frontend, mobile, y docs
- Los contratos (OpenAPI) se validan automaticamente tras cada merge
- Breaking changes crean tareas de fix automaticas en los consumidores
- Las subtasks respetan dependencias (frontend espera a que backend merge)

---

## 24. Prompt Evolution Engine

**Prerequisitos**: Observability (#20), Smart Model Routing (#3), Codebase Learning (#16)

**Problema**: Los prompts del sistema son estaticos. Escritos una vez, nunca evolucionan. Pero los datos de Observability muestran que algunos prompts producen mejores resultados que otros. Podriamos **evolucionar los prompts automaticamente**.

### A/B Testing de Prompts
```javascript
class PromptEvolution {
  constructor() {
    this.variants = new Map(); // agentRole → [{ id, prompt, stats }]
  }

  registerVariant(role, promptText, metadata = {}) {
    const variant = {
      id: `${role}-${Date.now()}`,
      prompt: promptText,
      stats: {
        tasksCompleted: 0,
        avgReviewScore: 0,
        avgTokensUsed: 0,
        avgTurns: 0,
        firstCycleApprovalRate: 0,
        // Scores ponderados
        qualityScore: 0,    // reviewScore-based
        efficiencyScore: 0, // tokens-based
        overallScore: 0,    // combined
      },
      createdAt: Date.now(),
      metadata,
    };

    if (!this.variants.has(role)) this.variants.set(role, []);
    this.variants.get(role).push(variant);
    return variant.id;
  }

  selectPrompt(role) {
    const variants = this.variants.get(role) || [];
    if (variants.length <= 1) return variants[0]; // Solo hay uno

    // Thompson Sampling: elegir basado en distribucion de exitos
    // Los prompts con mejor performance tienen mas probabilidad de ser elegidos
    // Pero los nuevos/poco testeados tambien tienen chance (exploracion)
    return thompsonSample(variants, v => ({
      successes: v.stats.tasksCompleted * v.stats.firstCycleApprovalRate,
      failures: v.stats.tasksCompleted * (1 - v.stats.firstCycleApprovalRate),
    }));
  }

  recordResult(variantId, result) {
    const variant = this.findVariant(variantId);
    if (!variant) return;

    const s = variant.stats;
    const n = s.tasksCompleted;
    s.tasksCompleted++;
    // Incremental average update
    s.avgReviewScore = (s.avgReviewScore * n + result.reviewScore) / (n + 1);
    s.avgTokensUsed = (s.avgTokensUsed * n + result.tokensUsed) / (n + 1);
    s.avgTurns = (s.avgTurns * n + result.turns) / (n + 1);
    s.firstCycleApprovalRate = (s.firstCycleApprovalRate * n + (result.approvedFirstCycle ? 1 : 0)) / (n + 1);

    // Recalcular scores
    s.qualityScore = s.avgReviewScore / 10;
    s.efficiencyScore = 1 / (s.avgTokensUsed / 10000 + 1); // Normalizado
    s.overallScore = s.qualityScore * 0.6 + s.efficiencyScore * 0.4;
  }
}
```

### Auto-generacion de variantes
Cada 50 tareas, generar una variante nueva basada en lo aprendido:
```javascript
async function evolvePrompt(role, currentBestVariant, observabilityData) {
  // Extraer insights de las ultimas 50 tareas
  const recentTasks = observabilityData.getRecentTasks(50);

  const commonFailures = extractCommonFailurePatterns(recentTasks);
  const commonSuccesses = extractCommonSuccessPatterns(recentTasks);

  // Pedir a un LLM que mejore el prompt (meta-prompt)
  const metaPrompt = `
    Eres un experto en prompt engineering. Aqui tienes el prompt actual del agente ${role}:

    ---PROMPT ACTUAL---
    ${currentBestVariant.prompt}
    ---FIN PROMPT---

    Estadisticas:
    - Aprobacion primer ciclo: ${(currentBestVariant.stats.firstCycleApprovalRate * 100).toFixed(1)}%
    - Review score promedio: ${currentBestVariant.stats.avgReviewScore.toFixed(1)}/10
    - Tokens promedio: ${currentBestVariant.stats.avgTokensUsed}

    Patrones de fallo frecuentes:
    ${commonFailures.map(f => `- ${f.pattern}: ${f.frequency} veces`).join('\n')}

    Patrones de exito:
    ${commonSuccesses.map(s => `- ${s.pattern}: ${s.frequency} veces`).join('\n')}

    Genera una version mejorada del prompt que:
    1. Aborde los patrones de fallo mas frecuentes con instrucciones explicitas
    2. Refuerce los patrones de exito
    3. Sea mas conciso donde sea posible (menos tokens = mas eficiente)

    Devuelve SOLO el prompt mejorado, nada mas.
  `;

  const improvedPrompt = await runLLM(metaPrompt, { model: 'sonnet' });
  return improvedPrompt;
}
```

### Lifecycle
```
1. Prompt V1 (manual, escrito por humano)
2. Se usa durante 50 tareas, se recopilan stats
3. Auto-genera V2 basado en insights
4. V1 y V2 compiten via Thompson Sampling (80/20 split)
5. Tras 30 tareas mas, V2 demuestra +15% approval rate
6. V2 se convierte en default, V1 se retira
7. Tras 50 tareas mas, se genera V3...
```

### Valor
- Los prompts mejoran solos con cada tarea completada
- El sistema aprende que instrucciones producen codigo que el Reviewer aprueba
- Reduccion gradual de tokens (prompts mas concisos y efectivos)
- Sin intervencion humana: el sistema evoluciona su propio "ADN"

---

## 25. Performance Regression Detector

**Prerequisitos**: Tester Agent (#11), Canary Merge (#9), Observability (#20)

**Problema**: El Reviewer verifica correctness, el Security Agent verifica seguridad, el Tester genera tests funcionales. Pero nadie detecta que el nuevo codigo es **10x mas lento** que el anterior. Una query que antes tardaba 50ms ahora tarda 2 segundos.

### Benchmark automatico
```javascript
class PerformanceDetector {
  // Se ejecuta entre TESTER y REVIEWER (intra-pipeline)
  async analyze(task, branchName, cwd) {
    const results = {
      benchmarks: [],
      regressions: [],
      improvements: [],
    };

    // 1. Detectar archivos con benchmarks existentes
    const benchFiles = await glob('**/*.bench.{js,ts}', { cwd });
    if (benchFiles.length > 0) {
      // Ejecutar benchmarks en main (baseline)
      const baseline = await runBenchmarks(benchFiles, { branch: 'main', cwd });
      // Ejecutar en branch actual
      const current = await runBenchmarks(benchFiles, { branch: branchName, cwd });

      // Comparar
      for (const [name, baseMetric] of Object.entries(baseline)) {
        const currMetric = current[name];
        if (!currMetric) continue;

        const ratio = currMetric.avgMs / baseMetric.avgMs;
        if (ratio > 1.5) {
          results.regressions.push({
            benchmark: name,
            baselineMs: baseMetric.avgMs,
            currentMs: currMetric.avgMs,
            degradation: `${((ratio - 1) * 100).toFixed(0)}% slower`,
            severity: ratio > 3 ? 'critical' : ratio > 2 ? 'major' : 'minor',
          });
        } else if (ratio < 0.7) {
          results.improvements.push({
            benchmark: name,
            improvement: `${((1 - ratio) * 100).toFixed(0)}% faster`,
          });
        }
      }
    }

    // 2. Analisis estatico de complejidad (sin ejecutar codigo)
    const changedFiles = await getChangedFiles(branchName, cwd);
    for (const file of changedFiles) {
      const complexity = await analyzeComplexity(file, cwd);
      if (complexity.cyclomaticDelta > 10) {
        results.regressions.push({
          file,
          type: 'complexity',
          description: `Cyclomatic complexity increased by ${complexity.cyclomaticDelta}`,
          severity: 'minor',
        });
      }
      if (complexity.hasNestedLoops && complexity.depth > 3) {
        results.regressions.push({
          file,
          type: 'algorithmic',
          description: `Deeply nested loops detected (depth ${complexity.depth}) — potential O(n^3+)`,
          severity: 'major',
        });
      }
    }

    // 3. Detectar queries N+1 (patron comun)
    for (const file of changedFiles) {
      const content = await readFile(file, cwd);
      if (hasNPlusOnePattern(content)) {
        results.regressions.push({
          file,
          type: 'n+1-query',
          description: 'Potential N+1 query detected: DB call inside loop',
          severity: 'major',
        });
      }
    }

    return results;
  }
}
```

### Inyeccion en Reviewer
```javascript
// Si se detectan regresiones, el Reviewer las ve
if (perfResults.regressions.length > 0) {
  reviewerContext += `
PERFORMANCE REGRESSIONS DETECTED:
${perfResults.regressions.map(r =>
  `- [${r.severity.toUpperCase()}] ${r.benchmark || r.file}: ${r.degradation || r.description}`
).join('\n')}

These MUST be addressed or justified before approval.
`;
}
```

### Historial de performance
```
/metrics/{projectId}/performance/
  +-- benchmarks/{benchmarkName}/
  |   +-- history: [{ date, branch, avgMs, p95Ms, p99Ms }]
  +-- complexity/{file}/
      +-- history: [{ date, cyclomatic, depth }]
```

### Valor
- Detecta regresiones de performance ANTES del merge (no en produccion)
- Patterns como N+1 queries se detectan automaticamente sin ejecutar
- 0 tokens de LLM para el analisis (todo local/estatico)
- El Reviewer sabe que hay una regresion → la aborda en la review

---

## 26. Autonomous Refactoring Mode

**Prerequisitos**: Auto-Improve (existente), Codebase Learning (#16), Impact Analyzer (#22), Adaptive Review (#13)

**Problema**: Cuando el backlog esta vacio, Komodo se queda idle en daemon mode. El `auto-improve` actual es basico (propuestas genericas). Con todo el conocimiento acumulado de Fase 1+2, Komodo puede hacer refactoring inteligente y autonomo.

### Fuentes de refactoring
```javascript
const refactoringSources = {
  // 1. Tech debt acumulado (ya se trackea desde Fase 1)
  techDebt: async () => {
    const debt = await getTechDebtTasks(projectId);
    return debt.filter(d => d.severity === 'minor' && d.autoFixable);
  },

  // 2. Patterns negativos repetidos (de Memory Embeddings)
  repeatingPatterns: async () => {
    const patterns = await getTopPatterns(projectId, { minFrequency: 3 });
    return patterns.map(p => ({
      type: 'fix-pattern',
      description: `Fix recurring pattern: ${p.text}`,
      affectedFiles: p.relatedFiles,
      estimatedTokens: 5000,
    }));
  },

  // 3. Complejidad ciclomatica alta (de Performance Detector)
  complexity: async () => {
    const complex = await getHighComplexityFiles(projectId, { threshold: 20 });
    return complex.map(f => ({
      type: 'reduce-complexity',
      description: `Refactor ${f.file}: cyclomatic complexity ${f.cyclomatic}`,
      estimatedTokens: 10000,
    }));
  },

  // 4. Codigo duplicado (analisis estatico)
  duplication: async () => {
    const duplicates = await detectDuplicateCode(projectDir);
    return duplicates.map(d => ({
      type: 'deduplicate',
      description: `Extract common code from ${d.files.join(', ')}`,
      estimatedTokens: 8000,
    }));
  },

  // 5. Dependencias desactualizadas
  outdatedDeps: async () => {
    const outdated = await checkOutdatedDeps(projectDir);
    return outdated
      .filter(d => d.severity !== 'breaking') // Solo minor/patch
      .map(d => ({
        type: 'update-dependency',
        description: `Update ${d.name}: ${d.current} → ${d.latest}`,
        estimatedTokens: 3000,
      }));
  },

  // 6. Convenciones inconsistentes (de Codebase Learning)
  inconsistencies: async () => {
    const learning = await getLearning(projectId);
    const violations = await findConventionViolations(projectDir, learning);
    return violations.map(v => ({
      type: 'fix-convention',
      description: `Fix ${v.type} violation in ${v.file}: ${v.description}`,
      estimatedTokens: 2000,
    }));
  },
};
```

### Priorizacion
```javascript
function prioritizeRefactorings(candidates, tokenBudget) {
  // Score: impacto / tokens estimados
  const scored = candidates.map(c => ({
    ...c,
    impactScore: calculateRefactoringImpact(c),
    efficiency: calculateRefactoringImpact(c) / c.estimatedTokens,
  }));

  // Greedy: elegir por eficiencia hasta llenar el budget
  scored.sort((a, b) => b.efficiency - a.efficiency);

  const selected = [];
  let remaining = tokenBudget;
  for (const candidate of scored) {
    if (candidate.estimatedTokens <= remaining) {
      selected.push(candidate);
      remaining -= candidate.estimatedTokens;
    }
  }

  return selected;
}
```

### Configuracion
```env
AUTO_REFACTOR=true                     # Activar modo refactoring autonomo
AUTO_REFACTOR_MAX_TOKENS=30000         # Budget de tokens por sesion
AUTO_REFACTOR_TYPES=tech-debt,patterns,deps  # Tipos permitidos
AUTO_REFACTOR_AUTONOMY=3               # Nivel de autonomia para refactorings
AUTO_REFACTOR_MAX_FILES_PER_PR=5       # Max archivos por PR de refactoring
```

### Valor
- Komodo nunca esta idle: cuando no hay tareas, mejora el codebase
- Tech debt se paga automaticamente
- Dependencias se mantienen actualizadas
- El codigo converge hacia las convenciones del proyecto
- Todo con review automatico (Adaptive Review en modo quick para refactorings menores)

---

## 27. Conversational Dashboard

**Prerequisitos**: Observability (#20), Knowledge Graph (#8), Budget Intelligence (#18)

**Problema**: El dashboard muestra datos pero no es interactivo. Para ejecutar una tarea hay que ir al CLI. Para entender por que algo fallo hay que buscar en logs. Para cambiar configuracion hay que editar .env.

### Chat integrado en el dashboard
```
Usuario: "por que fallo la ultima tarea?"
Komodo: "La tarea 'Implementar cache de Redis' fallo en el ciclo 3 de review.
         El Reviewer encontro un issue critico: la conexion a Redis no tiene
         timeout configurado y podria bloquear el event loop.
         El Coder intento arreglarlo pero introdujo un regression test failure.
         Suggestion: re-ejecutar con Opus en vez de Sonnet para el Coder."

Usuario: "ejecutala con opus"
Komodo: "Ejecutando tarea 'Implementar cache de Redis' con Coder=opus...
         [progress bar]"

Usuario: "cuantos tokens he gastado esta semana?"
Komodo: "Esta semana: 245K tokens en 18 tareas.
         Promedio: 13.6K tokens/tarea.
         Mas eficiente: 'Fix typo in config' (1.2K tokens)
         Menos eficiente: 'Migrar DB a PostgreSQL' (52K tokens, 4 review cycles)
         Rate limit headroom: ~155K tokens (~11 tareas mas al ritmo actual)"

Usuario: "pausa despues de la siguiente tarea"
Komodo: "OK. Pausare despues de completar la tarea actual."

Usuario: "que tareas deberia priorizar?"
Komodo: "Basado en bizPoints/tokenEstimados, las 3 tareas con mejor ROI son:
         1. 'Add email validation' - 8 bizPoints, ~5K tokens estimados
         2. 'Fix pagination bug' - 5 bizPoints, ~3K tokens estimados
         3. 'Add rate limiting' - 8 bizPoints, ~15K tokens estimados
         La tarea 'Refactor auth module' (13 devPoints) tiene el peor ROI
         y ademas afecta 47 archivos. Recomiendo dejarla para cuando
         haya margen de rate limit."
```

### Implementacion
```javascript
// dashboard/app/api/chat/route.ts
export async function POST(req) {
  const { message } = await req.json();

  // Contexto automatico del estado actual
  const context = {
    state: await getKomodoState(),
    recentTasks: await getRecentTasks(10),
    recentEvents: await getRecentEvents(20),
    budget: await getBudgetStatus(),
    config: await getConfig(),
  };

  // El LLM interpreta la intencion y ejecuta acciones
  const response = await runLLM(`
    Eres el asistente de Komodo. El usuario te hace preguntas o da ordenes
    sobre el orquestador.

    ESTADO ACTUAL:
    ${JSON.stringify(context.state)}

    TAREAS RECIENTES:
    ${JSON.stringify(context.recentTasks)}

    HERRAMIENTAS DISPONIBLES:
    - executeTask(taskId, options) — ejecutar una tarea
    - pauseExecution() — pausar
    - resumeExecution() — reanudar
    - changeConfig(key, value) — cambiar configuracion
    - getTaskTimeline(taskId) — ver timeline detallado
    - estimateTokens(taskId) — estimar tokens
    - getROIRanking() — ranking de tareas por ROI

    MENSAJE DEL USUARIO: ${message}
  `, { model: 'haiku' }); // Haiku es suficiente para chat

  return NextResponse.json({ response });
}
```

### Valor
- Control completo del orquestador desde el dashboard sin tocar CLI
- Debugging conversacional ("por que fallo X?")
- Recomendaciones contextuales basadas en datos reales
- Tokens minimos (Haiku para chat)

---

## 28. Automated Rollback Learning

**Prerequisitos**: Self-Healing (#14), Canary Merge (#9), Observability (#20)

**Problema**: Cuando el CI falla post-merge o un canary detecta un problema, el self-healing revierte. Pero nadie analiza **por que fallo** para evitarlo en el futuro. El mismo tipo de fallo puede repetirse.

### Post-mortem automatico
```javascript
async function automatedPostMortem(failedTask, failureContext) {
  // 1. Clasificar el tipo de fallo
  const classification = classifyFailure(failureContext);
  // Tipos: test-regression, build-failure, runtime-error, performance-regression,
  //        dependency-conflict, environment-issue, flaky-test

  // 2. Extraer root cause
  const rootCause = await analyzeRootCause(classification, failureContext);
  // Usa el log de CI + el diff + los tests para determinar la causa

  // 3. Generar leccion aprendida
  const lesson = {
    id: `lesson-${Date.now()}`,
    classification: classification.type,
    rootCause: rootCause.description,
    affectedFiles: failureContext.filesChanged,
    affectedModules: failureContext.modules,
    preventionRule: rootCause.preventionRule,
    createdAt: Date.now(),
    taskId: failedTask.id,
  };

  // 4. Almacenar en memoria semantica (Fase 2 #12)
  await storeLesson(lesson);

  // 5. Crear regla de prevencion automatica
  if (rootCause.preventionRule) {
    await addPreventionRule(rootCause.preventionRule);
  }

  return lesson;
}
```

### Reglas de prevencion generadas automaticamente
```javascript
// Ejemplo: si una tarea fallo porque modifico un shared constant sin actualizar todos los usos
const autoRule = {
  trigger: 'file-modified',
  condition: (file) => file.match(/constants|shared|types/),
  action: 'require-grep-verification',
  description: 'When modifying shared constants/types, verify all usages are updated',
  // Se inyecta automaticamente en el prompt del Coder
  coderInstruction: 'You are modifying a shared file. Before committing, grep for all usages of the modified exports and ensure they are all compatible.',
  // Generado por post-mortem de tarea task-xyz que fallo por esto
  origin: 'auto-learned from task-xyz failure',
};
```

### Dashboard: Failure Analytics
```
Failure Trends (last 30 days):
  test-regression:    ████████ 8 (40%)
  build-failure:      ████ 4 (20%)
  dependency-conflict: ███ 3 (15%)
  flaky-test:         ██ 2 (10%)
  runtime-error:      ██ 2 (10%)
  other:              █ 1 (5%)

Auto-generated prevention rules: 12
  - 8 active, 4 retired (no longer relevant)
  - Estimated failures prevented: ~15

Top lessons learned:
  1. "Always run full test suite when modifying shared types" (prevented 5 failures)
  2. "Check Node version compatibility when updating major deps" (prevented 3 failures)
  3. "Mock external services in tests to avoid flakiness" (prevented 2 failures)
```

### Valor
- Cada fallo genera una leccion que previene el mismo fallo en el futuro
- Las reglas se inyectan automaticamente en los prompts del Coder
- Con el tiempo, la tasa de fallos baja asintoticamente
- Feedback loop completo: fallo → analisis → regla → prevencion → menos fallos

---

## 29. Agent Specialization per Module

**Prerequisitos**: Codebase Learning (#16), Knowledge Graph (#8), Prompt Evolution (#24)

**Problema**: El mismo Coder prompt se usa para tareas de backend, frontend, database, DevOps, y mobile. Pero cada dominio tiene convenciones, patrones, y errores comunes muy diferentes. Un prompt generico no es optimo para ninguno.

### Modulos detectados automaticamente
```javascript
async function detectModules(projectDir) {
  const structure = await analyzeStructure(projectDir);

  // Detectar modulos por convencion de directorios
  const modules = [];

  if (structure.has('src/api') || structure.has('src/routes')) {
    modules.push({
      id: 'api',
      patterns: ['REST endpoints', 'middleware', 'validation'],
      files: await glob('src/{api,routes}/**/*'),
      conventions: await extractConventions('api'),
    });
  }

  if (structure.has('src/components') || structure.has('src/pages')) {
    modules.push({
      id: 'frontend',
      patterns: ['React components', 'hooks', 'state management'],
      files: await glob('src/{components,pages,hooks}/**/*'),
      conventions: await extractConventions('frontend'),
    });
  }

  if (structure.has('src/models') || structure.has('src/db') || structure.has('prisma')) {
    modules.push({
      id: 'database',
      patterns: ['migrations', 'models', 'queries', 'ORM'],
      files: await glob('{src/{models,db},prisma}/**/*'),
      conventions: await extractConventions('database'),
    });
  }

  // ... mas modulos: testing, devops, auth, payments, etc.

  return modules;
}
```

### Prompts especializados por modulo
```javascript
const modulePromptExtensions = {
  api: `
    API-SPECIFIC RULES:
    - Always validate request body with schema (Zod/Joi)
    - Return consistent response format: { data, error, status }
    - Add OpenAPI/Swagger annotations to new endpoints
    - Implement rate limiting on public endpoints
    - Always handle async errors with try/catch
    - Use HTTP status codes correctly (201 for creation, 204 for delete)
  `,

  frontend: `
    FRONTEND-SPECIFIC RULES:
    - Use functional components with hooks, never class components
    - Memoize expensive computations (useMemo/useCallback)
    - Handle loading, error, and empty states for every data fetch
    - Use semantic HTML elements
    - Ensure accessibility (aria labels, keyboard navigation)
    - Use CSS modules or Tailwind, never inline styles for layout
  `,

  database: `
    DATABASE-SPECIFIC RULES:
    - NEVER write raw SQL without parameterized queries
    - Always create reversible migrations (up + down)
    - Add indexes for columns used in WHERE/JOIN
    - Use transactions for multi-table operations
    - Validate data at the model level, not just the API level
    - Test with realistic data volumes (not just 1-2 rows)
  `,

  auth: `
    AUTH-SPECIFIC RULES (HIGH SECURITY):
    - NEVER log passwords, tokens, or secrets
    - Use bcrypt/argon2 for password hashing, never MD5/SHA
    - Implement rate limiting on login/register endpoints
    - Validate JWT signature AND expiration
    - Use HttpOnly + Secure + SameSite cookies for session tokens
    - ALWAYS sanitize user input before using in queries
  `,
};
```

### Seleccion automatica
```javascript
function getSpecializedPrompt(role, task, architectPlan) {
  const basePrompt = getBasePrompt(role);

  // Detectar modulos afectados
  const modules = architectPlan.affectedModules;

  // Inyectar extensiones de modulo
  let specialization = '';
  for (const mod of modules) {
    if (modulePromptExtensions[mod]) {
      specialization += modulePromptExtensions[mod] + '\n';
    }
  }

  // Inyectar lecciones especificas del modulo (de Memory Embeddings)
  const moduleLessons = await getModuleLessons(modules);
  if (moduleLessons.length > 0) {
    specialization += '\nLESSONS LEARNED FOR THESE MODULES:\n';
    specialization += moduleLessons.map(l => `- ${l.text}`).join('\n');
  }

  return basePrompt + '\n\n' + specialization;
}
```

### Stats por especializacion
```
Module Performance (last 30 days):
  api:       92% first-cycle approval, avg 8.5K tokens
  frontend:  78% first-cycle approval, avg 14K tokens  ← needs attention
  database:  85% first-cycle approval, avg 11K tokens
  auth:      95% first-cycle approval, avg 9K tokens   ← specialized prompt works well
```

### Valor
- El Coder recibe instrucciones especificas del dominio
- Menos errores de review por "no sigue convenciones del modulo"
- Las lecciones aprendidas se agrupan por modulo (no genericas)
- Los prompts evolucionan independientemente por modulo (Prompt Evolution #24)

---

## 30. Federation: Komodo Mesh

**Prerequisitos**: Multi-Repo (#23), Cross-Project Intelligence (#19), Budget Intelligence (#18)

**Problema**: Una organizacion grande puede tener 10+ instancias de Komodo corriendo en diferentes maquinas/equipos. Cada una tiene su propio knowledge, sus propios patterns, su propio model routing. No comparten inteligencia.

### Arquitectura federada
```
                         ┌────────────────────┐
                         │   Komodo Central   │
                         │   (Coordinator)    │
                         │                    │
                         │ - Global knowledge │
                         │ - Model rankings   │
                         │ - Pattern sharing  │
                         │ - Token allocation │
                         └────────┬───────────┘
                                  │
              ┌───────────────────┼───────────────────┐
              │                   │                   │
    ┌─────────▼─────────┐ ┌──────▼──────────┐ ┌─────▼───────────┐
    │  Komodo Node A    │ │ Komodo Node B   │ │ Komodo Node C   │
    │  (Team Backend)   │ │ (Team Frontend) │ │ (Team Mobile)   │
    │                   │ │                 │ │                 │
    │  - Local tasks    │ │ - Local tasks   │ │ - Local tasks   │
    │  - Local learning │ │ - Local learning│ │ - Local learning│
    │  - Local rate lim │ │ - Local rate lim│ │ - Local rate lim│
    └───────────────────┘ └─────────────────┘ └─────────────────┘
```

### Sincronizacion de inteligencia
```javascript
class KomodoMesh {
  constructor(nodeId, centralUrl) {
    this.nodeId = nodeId;
    this.centralUrl = centralUrl;
  }

  // Periodicamente: enviar metricas locales al central
  async syncTocentral() {
    await fetch(`${this.centralUrl}/api/mesh/sync`, {
      method: 'POST',
      body: JSON.stringify({
        nodeId: this.nodeId,
        patterns: await getLocalPatterns({ minUniversality: 0.6 }),
        modelPerformance: await getLocalModelStats(),
        lessons: await getRecentLessons(50),
        tokenUsage: await getTokenUsageSummary(),
      }),
    });
  }

  // Periodicamente: recibir inteligencia global
  async syncFromCentral() {
    const global = await fetch(`${this.centralUrl}/api/mesh/intelligence`).then(r => r.json());

    // Merge global patterns con locales (sin duplicar)
    await mergePatterns(global.patterns);

    // Actualizar model routing con datos globales
    await updateModelRouting(global.modelRankings);

    // Recibir nuevas prevention rules
    await importPreventionRules(global.preventionRules);
  }
}
```

### Token allocation entre nodos
```javascript
// El Central distribuye el budget de tokens entre nodos
class TokenAllocator {
  allocate(nodes, totalBudget) {
    const allocations = {};

    // Factores de prioridad:
    // - Backlog size (mas tareas pendientes = mas tokens)
    // - ROI de tareas (mejores tareas = mas tokens)
    // - Eficiencia historica (nodo que gasta menos tokens/tarea = mas allocation)

    const scores = nodes.map(node => ({
      nodeId: node.id,
      backlogScore: node.backlogSize / 10,
      roiScore: node.avgROI,
      efficiencyScore: 1 / (node.avgTokensPerTask / 10000 + 1),
      combined: 0,
    }));

    scores.forEach(s => {
      s.combined = s.backlogScore * 0.4 + s.roiScore * 0.3 + s.efficiencyScore * 0.3;
    });

    const totalScore = scores.reduce((sum, s) => sum + s.combined, 0);

    scores.forEach(s => {
      allocations[s.nodeId] = Math.floor(totalBudget * (s.combined / totalScore));
    });

    return allocations;
  }
}
```

### Dashboard Central
```
Komodo Mesh - Organization Overview

Nodes Online: 3/3
Total Tasks Today: 47
Total Tokens Today: 580K / 1M limit

Node A (Backend):  ████████░░ 18 tasks, 210K tokens, 92% approval
Node B (Frontend): ██████░░░░ 15 tasks, 220K tokens, 78% approval
Node C (Mobile):   ████████░░ 14 tasks, 150K tokens, 88% approval

Shared Intelligence:
  Global patterns: 156 (42 nuevos esta semana)
  Prevention rules: 28 (activas)
  Model ranking: Sonnet > Opus for 82% of standard tasks across all nodes

Token Allocation (next hour):
  Node A: 150K (high backlog, good efficiency)
  Node B: 120K (lower efficiency, needs attention)
  Node C: 130K (balanced)
```

### Valor
- La inteligencia de todos los equipos se comparte (el equipo nuevo se beneficia del viejo)
- El token budget se optimiza a nivel de organizacion (no por equipo)
- Los patterns de seguridad se propagan instantaneamente a todos los nodos
- Un "super brain" que aprende de toda la organizacion, no solo de un proyecto

---

## Resumen de Impacto Fase 3

| # | Mejora | Tokens | Calidad | Escala | Esfuerzo |
|---|--------|--------|---------|--------|----------|
| 21 | DOCUMENTER Agent | +2K post-merge | +++ (docs) | + | Bajo |
| 22 | Impact Analyzer | 0 (local) | ++++ | ++ | Medio |
| 23 | Multi-Repo | Indirecto | +++ | +++++ | Alto |
| 24 | Prompt Evolution | -10-20% gradual | +++++ | +++ | Alto |
| 25 | Performance Detector | 0 (local) | ++++ | ++ | Medio |
| 26 | Auto Refactoring | Variable (budget) | ++++ | +++ | Medio |
| 27 | Conversational Dashboard | +1K/chat (Haiku) | ++ | ++ | Medio |
| 28 | Rollback Learning | -5-15% (previene fallos) | +++++ | +++ | Medio |
| 29 | Agent Specialization | -10-15% (menos reviews) | ++++ | +++ | Bajo |
| 30 | Komodo Mesh | Optimiza org-wide | +++ | +++++ | Alto |

## Orden de Implementacion Recomendado (Fase 3)

1. **Agent Specialization** (#29) → bajo esfuerzo, mejora calidad por modulo inmediata
2. **Impact Analyzer** (#22) → 0 tokens extra, previene cambios de alto impacto
3. **Performance Detector** (#25) → 0 tokens extra, detecta regresiones
4. **DOCUMENTER Agent** (#21) → bajo esfuerzo, el codebase se auto-documenta
5. **Rollback Learning** (#28) → cada fallo mejora el sistema
6. **Prompt Evolution** (#24) → los prompts mejoran solos con cada tarea
7. **Auto Refactoring** (#26) → Komodo nunca esta idle, siempre mejora
8. **Conversational Dashboard** (#27) → control conversacional
9. **Multi-Repo** (#23) → escala a microservicios
10. **Komodo Mesh** (#30) → escala a organizaciones completas

---

## Vision Final: Komodo con las 30 Mejoras

```
Fase 1 (Fundamentos):     50-70% menos tokens, seguridad robusta
Fase 2 (Inteligencia):    +30% eficiencia, self-healing, 3x throughput
Fase 3 (Escala):          Organizaciones enteras, auto-evolucion

Un solo Komodo Node:
  - 7 agentes: Planner, Architect, Coder, Tester, Security, Reviewer, Documenter
  - Prompts que evolucionan solos
  - Memoria semantica que conecta lecciones pasadas
  - Performance detection sin tokens extra
  - Impact analysis antes de cada cambio
  - Refactoring autonomo cuando el backlog esta vacio
  - Dashboard conversacional para control natural

Komodo Mesh (organizacion):
  - N nodos coordinados
  - Inteligencia compartida entre todos los equipos
  - Token budget optimizado a nivel de org
  - Patterns de seguridad propagados instantaneamente
  - Model routing global basado en datos de todos los nodos

Resultado final:
  Tokens por tarea: ~3K-30K (antes Fase 1: ~20K-100K)
  Tasa de aprobacion primer ciclo: ~90%+ (antes: ~60%)
  Intervenciones humanas: <2% de tareas
  Autonomia sostenida: semanas sin intervencion
  El sistema mejora solo con cada tarea que ejecuta
```
