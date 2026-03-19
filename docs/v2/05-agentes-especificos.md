# PARTE 5: AGENTES ESPECIFICOS (Planner, Architect, Coder, Reviewer)

---

## 16. AGENTE PLANNER (src/agents/planner.js)

### 16.1 Proposito
Selecciona la siguiente tarea del backlog usando ranking inteligente basado en sprint order, eficiencia y afinidad de contexto.

### 16.2 fetchProjectTasks(projectId)
Obtiene todas las tareas del proyecto desde Firebase via helper directo.

### 16.3 filterBlockedTasks(todoTasks, allTasks)

**Logica:**
1. Construir mapa de tareas para lookup rapido
2. Para cada tarea to-do:
   - Verificar dependencias explicitas (`blockedBy[]`) - si blocker no esta "done", bloquear
   - Verificar dependencias implicitas multi-parte via `getUnresolvedPreviousParts()`
3. Return: `{ eligible: [], blocked: [{ task, unresolvedBlockers }] }`

### 16.4 pickNextTask(projectId, options)

**Parametros:**
- `projectId` - ID del proyecto
- `options.cwd` - Directorio de trabajo
- `options.lastCompletedTaskContext` - Contexto de la ultima tarea completada (para afinidad)

**Flujo completo:**

1. **Fetch tasks** - Obtener todas las tareas del proyecto
2. **Check in-progress** - Si hay tareas in-progress, retornar la primera (completar trabajo iniciado)
3. **Filter to-do** - Obtener solo tareas con status "to-do"
4. **Filter blocked** - Separar eligible vs blocked por dependencias
5. **Fetch sprint order** - Ordenar sprints por startDate ASC
6. **Enrich tasks** - Para cada tarea eligible:
   - Clasificar complejidad (trivial/standard/complex)
   - Estimar tokens necesarios
   - Calcular eficiencia: `bizPoints / estimatedTokens`
   - Asignar indice de sprint
7. **Apply context affinity** - Boost a tareas relacionadas con archivos recientemente modificados
8. **Sort** - Sprint order ASC, eficiencia DESC dentro del mismo sprint
9. **Run Planner agent** - Enviar lista ordenada al agente para seleccion final
10. **Validate** - Verificar que respuesta tenga taskId, title, branchName

**Return value:**
```javascript
{
  taskId: string,
  title: string,
  branchName: string,        // "feature/task-{6chars}-{slug}"
  repoUrl: string,
  userStory: { who, what, why },
  acceptanceCriteria: string[],
  devPoints: number,
  bizPoints: number,
  sprintId: string,
  cost: number,
  duration: number,
}
```

---

## 17. AGENTE ARCHITECT (src/agents/architect.js)

### 17.1 Proposito
Analiza el codebase y genera un plan de implementacion estructurado antes de que el Coder empiece.

### 17.2 analyzeTask(taskSpec, cwd, options)

**Input:** taskSpec (taskId, title, userStory, acceptanceCriteria, branchName, repoUrl)

**Prompt instruye al agente a:**
1. Leer archivos relevantes del proyecto
2. Identificar archivos a crear y modificar
3. Determinar orden de implementacion
4. Detectar riesgos y dependencias
5. Devolver JSON estructurado

**Config del agente:**
- MCPs: ninguno (solo acceso read-only al filesystem)
- maxTurns: 20
- idleTimeout: 300000 (5 min)
- Model: seleccion por complejidad

**Return value:**
```javascript
{
  success: boolean,
  plan: {
    filesToCreate: string[],
    filesToModify: string[],
    dependencies: string[],
    dataModelChanges: string,
    apiChanges: string,
    implementationOrder: string[],
    risks: string[],
    estimatedComplexity: string,  // "trivial"|"low"|"medium"|"high"|"critical"
  },
  cost: number,
  duration: number,
}
```

---

## 18. AGENTE CODER (src/agents/coder.js)

### 18.1 Proposito
Implementa codigo, crea branches, abre PRs. Tiene dos modos: implementacion inicial y correccion de issues.

### 18.2 implementTask(taskSpec, cwd, options)

**Inyeccion de contexto (static prefix para caching):**
1. **Architect Plan** - Si disponible, skip exploration del codebase
2. **Codebase Index** - Si no hay plan y indexing enabled, inyectar resumen
3. **Style Guide** - Reglas de estilo detectadas automaticamente
4. **Review Feedback** - Top patrones de reviews anteriores
5. **Coding Guidelines** - Directrices especificas del proyecto (desde dashboard)
6. **Module Lessons** - Lecciones del Knowledge Graph
7. **Learning Context** - Patrones de aprendizaje incremental

**Config del agente:**
- MCPs: `github-mcp`, `planning-task-mcp`
- maxTurns: 50
- totalTimeout: 900000 (15 min - total, no idle, para Windows)
- Model: seleccion por complejidad

**Instrucciones al agente:**
1. Crear branch desde main
2. Implementar TODOS los criterios de aceptacion
3. Commits descriptivos (feat:/fix:/refactor:)
4. Abrir PR o reutilizar existente
5. NO hacer merge

**Return value:**
```javascript
{
  success: boolean,
  pr: {
    prNumber: number,
    prUrl: string,
    branchName: string,
    filesChanged: string[],
    summary: string,
  },
  cost: number,
  duration: number,
}
```

### 18.3 fixReviewIssues(taskSpec, prNumber, reviewFeedback, cwd, options)

**Logica clave:**
- Extraer archivos mencionados en issues (diff-only context)
- Inyectar review feedback patterns
- Instrucciones: leer SOLO archivos mencionados, arreglar CADA issue, push misma branch

**Config del agente:**
- MCPs: `github-mcp`
- maxTurns: 40
- totalTimeout: 900000 (15 min)

**Return value:**
```javascript
{
  success: boolean,
  fix: {
    fixed: boolean,
    issuesResolved: string[],
    issuesNotResolved: string[],
    filesChanged: string[],
    summary: string,
  },
  cost: number,
  duration: number,
}
```

### 18.4 Helpers

```javascript
// Extraer owner/repo de URL GitHub
function extractOwnerRepo(repoUrl) {
  const match = repoUrl?.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
  return match ? `${match[1]}/${match[2]}` : null;
}

// Extraer paths de archivos mencionados en issues de review
function extractFilesFromIssues(issues) {
  const files = new Set();
  for (const issue of issues) {
    if (issue.file) files.add(issue.file);
    const desc = issue.description || (typeof issue === 'string' ? issue : '');
    const matches = desc.match(/[\w/.-]+\.(js|ts|tsx|jsx|py|go|rs|java|css|html|json|md|yaml|yml)/g);
    if (matches) matches.forEach(f => files.add(f));
  }
  return [...files];
}
```

---

## 19. AGENTE REVIEWER (src/agents/reviewer.js)

### 19.1 Proposito
Revisa PRs con 8 criterios estrictos. Genera veredicto APPROVED o REQUEST_CHANGES.

### 19.2 reviewPR(options)

**Parametros completos:**
```javascript
{
  prNumber, repo, taskSpec, cwd,
  sonarReport,         // Analisis SonarQube
  coverageReport,      // Delta de cobertura
  qaReport,            // Resultados QA
  securityReport,      // Findings de seguridad
  model,               // Override de modelo
  codingGuidelines,    // Directrices del proyecto
  reviewCycle,         // Numero de ciclo (1, 2, 3...)
  previousReview,      // Review anterior (para incremental)
  lastReviewSHA,       // SHA del ultimo review (para diff incremental)
  pluginIssues,        // Issues de plugins before-review
  knowledgeContext,     // Contexto del Knowledge Graph
  filesChanged,        // Archivos modificados
}
```

**Flujo completo:**

1. **Select review depth** via `selectReviewDepth()`:
   - `quick`: solo correctness + security critical (devPoints <= 3, < 5 files)
   - `standard`: correctness, error handling, edge cases, naming, structure
   - `deep`: 8 criterios completos (devPoints >= 8 o security flags)
   - `forensic`: analisis linea por linea (cambios criticos)

2. **Capture HEAD SHA** para incremental review futuro

3. **Build prompt sections:**
   - Acceptance criteria list
   - Browser validation (si ENABLE_BROWSER_MCP)
   - SonarQube analysis (si disponible)
   - Coverage delta (si disponible)
   - QA test results (si disponible)
   - Security findings (si disponible)
   - Coding guidelines
   - Plugin issues (obligatorio resolver)
   - Incremental context (ciclo > 1: solo diff desde lastReviewSHA)
   - Knowledge Graph context (solo ciclo 1)

4. **Incremental review** (ciclo > 1):
   - Solo diff desde lastReviewSHA
   - Estimar tokens ahorrados
   - Log metricas de reduccion

5. **Run agent** con disallowedTools: ['Write', 'Edit', 'NotebookEdit'] (read-only)

6. **Early termination** detection:
   - Si watchdog detecta APPROVED en primeros 3K chars → score 10

7. **Normalize verdict** via `normalizeVerdict()`

**Config del agente:**
- MCPs: `github-mcp`, `memory-mcp`
- maxTurns: depends on depth (quick=10, standard=20, deep=30, forensic=40)
- totalTimeout: 600000 (10 min)
- disallowedTools: Write, Edit, NotebookEdit

### 19.3 normalizeVerdict(rawVerdict, score, issues, sonarReport, coverageReport)

Reglas de consenso:

```javascript
export function normalizeVerdict(rawVerdict, score, issues, sonarReport, coverageReport) {
  // 1. Quality Gate FAILED → force REQUEST_CHANGES
  if (sonarReport?.qualityGate === 'ERROR') return 'REQUEST_CHANGES';

  // 2. Coverage below threshold → force REQUEST_CHANGES
  if (coverageReport?.belowThreshold) return 'REQUEST_CHANGES';

  // 3. Check issues severity
  const hasCritical = issues?.some(i => i.severity === 'critical');
  const hasMajor = issues?.some(i => i.severity === 'major');

  // 4. Score < 8 OR critical/major → REQUEST_CHANGES
  if (score < 8 || hasCritical || hasMajor) return 'REQUEST_CHANGES';

  // 5. Normalize variant names
  const normalized = rawVerdict?.toUpperCase?.()?.trim?.();
  if (normalized?.includes('APPROVE')) return 'APPROVED';
  if (normalized?.includes('REQUEST') || normalized?.includes('CHANGE')) return 'REQUEST_CHANGES';

  // 6. Default based on score
  return score >= 8 ? 'APPROVED' : 'REQUEST_CHANGES';
}
```

### 19.4 Return value

```javascript
{
  success: boolean,
  review: {
    verdict: 'APPROVED' | 'REQUEST_CHANGES',
    score: number,       // 0-10
    issues: [{
      severity: 'critical' | 'major' | 'minor',
      description: string,
      file: string,
      line: number,
      suggestion: string,
    }],
    positives: string[],
    summary: string,
  },
  cost: number,
  duration: number,
  reviewSHA: string,        // HEAD SHA at review time
  reviewDepth: string,      // quick|standard|deep|forensic
  earlyTerminated: boolean,
  tokensSavedEstimate: number,
  incremental: boolean,
  incrementalMetrics: { tokensSaved, reductionPercent },
}
```

### 19.5 8 Criterios de review

1. **Correctness** - Funcionalidad correcta, criterios cumplidos
2. **Error Handling** - Try/catch, validaciones, edge cases
3. **Edge Cases** - Null, empty, boundary values
4. **Naming** - Variables, funciones, archivos descriptivos
5. **Structure** - Organizacion, modularidad, DRY
6. **Tests** - Cobertura adecuada, tests significativos
7. **Security** - OWASP compliance, no secrets hardcoded
8. **Patterns** - Patrones del proyecto, consistencia

### 19.6 Seccion SonarQube

Si sonarReport disponible, inyecta:
- Quality gate status
- Metricas (bugs, vulnerabilities, code smells, coverage)
- Issues BLOCKER y CRITICAL como tabla
- Instrucciones: mencionar findings, no duplicar esfuerzo

### 19.7 Seccion QA

Si qaReport disponible:
- Tests generados/pasados/fallidos
- Archivos creados
- Tests que fallan el codigo del Coder (failsCoderCode: true)
- Instrucciones: factor test failures into verdict

### 19.8 Seccion Security

Si securityReport disponible:
- Verdict (PASS/WARN/BLOCK)
- Counts por severidad
- Summary y tabla de findings (CRITICAL/HIGH/MEDIUM)
- Instrucciones: focus en logica, no duplicar analisis

---

## 20. AGENTE QA (src/agents/qa.js)

### 20.1 runQAAgent(options)

**Parametros:** taskSpec, filesChanged[], branchName, repo, prNumber, cwd, model

**Flujo:**
1. Prompt con: tarea, criterios, archivos modificados, tipos de test
2. Instrucciones: detectar framework, generar tests por criteria + edge cases, ejecutar, push si pasan
3. Distinguir bugs del Coder (failsCoderCode: true) vs tests mal escritos
4. Config: maxTurns 30, totalTimeout 600s
5. Emit QA_TESTS_GENERATED event

**Return:**
```javascript
{
  success: boolean,
  qa: {
    testsGenerated: number,
    testsPassed: number,
    testsFailed: number,
    filesCreated: string[],
    filesChanged: string[],
    pushed: boolean,
    failedTests: [{ name, error, failsCoderCode }],
    summary: string,
  },
  cost: number,
  duration: number,
}
```

---

## 21. AGENTE TESTER (src/agents/tester.js)

### 21.1 runTesterAgent(options)

Similar a QA pero usa Knowledge Graph para tests "quirurgicos":
- Inyecta contexto del Architect plan y decisiones del Coder
- Tests basados en riesgos identificados
- Coverage percentage tracked

**Diferencia con QA:** Tester tiene contexto completo del Knowledge Graph (plan + decisiones), QA solo tiene archivos modificados.

**Return:**
```javascript
{
  success: boolean,
  tester: {
    testsGenerated: number,
    testsPassed: number,
    testsFailed: number,
    coverage: number,        // percentage
    filesCreated: string[],
    filesChanged: string[],
    pushed: boolean,
    failedTests: [],
    summary: string,
  },
  cost: number,
  duration: number,
}
```

---

## 22. AGENTE SECURITY (src/agents/security-agent.js)

### 22.1 runSecurityAgent(options)

**Flujo unico:** Ejecuta herramientas EXTERNAS antes del LLM:
1. `npm audit` - vulnerabilidades de dependencias
2. `gitleaks` - secretos hardcoded (si instalado)
3. `semgrep` - patrones de seguridad (si instalado)
4. Inyectar findings como contexto
5. LLM analiza cada archivo contra OWASP Top 10

**Verdict computation (independiente del LLM):**
```javascript
// Re-derive verdict from findings (prevent hallucination)
const criticalCount = findings.filter(f => f.severity === 'CRITICAL').length;
const highCount = findings.filter(f => f.severity === 'HIGH').length;
const mediumCount = findings.filter(f => f.severity === 'MEDIUM').length;

let computedVerdict;
if (criticalCount > 0 || highCount > 0) computedVerdict = 'BLOCK';
else if (mediumCount > 0) computedVerdict = 'WARN';
else computedVerdict = 'PASS';

// Use computed verdict (not LLM's, prevent bypass)
```

**Return:**
```javascript
{
  success: boolean,
  security: {
    verdict: 'PASS' | 'WARN' | 'BLOCK',
    findings: [{ severity, category, description, file, line }],
    summary: string,
    criticalCount, highCount, mediumCount, lowCount,
  },
  toolResults: { npmAudit, gitleaks, semgrep },
  cost: number,
  duration: number,
}
```
