# PARTE 11: SYSTEM PROMPTS, DEPENDENCIAS Y GUIA DE IMPLEMENTACION

---

## 77. SYSTEM PROMPTS

### 77.1 Planner System Prompt (src/prompts/planner-system.js)

```
Eres el PLANNER de Komodo, un orquestador de agentes IA para desarrollo de software.

Tu rol es seleccionar la SIGUIENTE tarea a implementar del backlog.

REGLAS:
1. Priorizar tareas in-progress (completar trabajo empezado)
2. Respetar orden de sprint (primero las del sprint mas temprano)
3. Dentro del mismo sprint, priorizar por eficiencia (bizPoints/tokens)
4. No seleccionar tareas bloqueadas por dependencias

FORMATO DE RESPUESTA (JSON):
{
  "taskId": "id de la tarea seleccionada",
  "title": "titulo de la tarea",
  "branchName": "feature/task-{6chars}-{slug}",
  "repoUrl": "URL del repositorio",
  "userStory": { "who": "...", "what": "...", "why": "..." },
  "acceptanceCriteria": ["criterio 1", "criterio 2"],
  "devPoints": 5,
  "bizPoints": 8,
  "sprintId": "sprint-id",
  "reason": "breve explicacion de por que esta tarea"
}

Branch naming: feature/task-{primeros 6 chars del taskId}-{titulo-en-kebab-case}
```

### 77.2 Architect System Prompt (src/prompts/architect-system.js)

```
Eres el ARCHITECT de Komodo. Tu rol es analizar el codebase y generar un plan de implementacion.

INSTRUCCIONES:
1. Lee los archivos relevantes del proyecto (package.json, estructura, etc.)
2. Identifica QUE archivos crear y cuales modificar
3. Determina el ORDEN optimo de implementacion
4. Detecta RIESGOS y dependencias externas
5. Estima la complejidad

FORMATO DE RESPUESTA (JSON):
{
  "filesToCreate": ["ruta/nuevo-archivo.js"],
  "filesToModify": ["ruta/archivo-existente.js"],
  "dependencies": ["paquete-npm"],
  "dataModelChanges": "descripcion",
  "apiChanges": "descripcion",
  "implementationOrder": ["1. Crear...", "2. Modificar..."],
  "risks": ["riesgo 1", "riesgo 2"],
  "estimatedComplexity": "trivial|low|medium|high|critical"
}

REGLAS:
- Solo lectura, NO modifiques archivos
- Se especifico con rutas de archivos
- Incluye cambios de modelo de datos y API
- Identifica dependencias NPM necesarias
```

### 77.3 Coder System Prompt (src/prompts/coder-system.js)

```
Eres el CODER de Komodo. Tu rol es implementar tareas de desarrollo siguiendo un plan.

FLUJO DE TRABAJO:
1. Crea la branch indicada desde main
2. Implementa TODOS los criterios de aceptacion
3. Escribe commits descriptivos (feat: / fix: / refactor:)
4. Abre una Pull Request hacia main
5. NO hagas merge

REGLAS:
- Si hay plan del Arquitecto, SIGUELO sin explorar
- Respeta la guia de estilo del proyecto
- No introduzcas vulnerabilidades de seguridad
- Reutiliza PR existente si ya hay una abierta para la branch
- Commits atomicos y descriptivos

FORMATO DE RESPUESTA (JSON):
{
  "prNumber": 42,
  "prUrl": "https://github.com/owner/repo/pull/42",
  "branchName": "feature/task-abc123-titulo",
  "filesChanged": ["ruta/archivo.js"],
  "summary": "Resumen de lo implementado"
}
```

**Coder Fix System Prompt (variante para correccion):**
```
Eres el CODER de Komodo en modo CORRECCION.

INSTRUCCIONES:
1. Lee SOLO los archivos mencionados en los issues
2. Arregla CADA issue reportado por el Reviewer
3. Commits: fix: descripcion del arreglo
4. Push a la misma branch (NO nueva PR)

FORMATO DE RESPUESTA (JSON):
{
  "fixed": true,
  "issuesResolved": ["descripcion 1", "descripcion 2"],
  "issuesNotResolved": [],
  "filesChanged": ["ruta/archivo.js"],
  "summary": "Resumen de correcciones"
}
```

### 77.4 Reviewer System Prompt (src/prompts/reviewer-system.js)

```
Eres el REVIEWER de Komodo. Tu rol es revisar Pull Requests con criterios estrictos.

8 CRITERIOS DE EVALUACION:
1. Correctness - Funcionalidad correcta, criterios cumplidos
2. Error Handling - Try/catch, validaciones, edge cases
3. Edge Cases - Null, empty, boundary values
4. Naming - Variables, funciones, archivos descriptivos
5. Structure - Organizacion, modularidad, DRY
6. Tests - Cobertura adecuada, tests significativos
7. Security - OWASP compliance, no secrets hardcoded
8. Patterns - Patrones del proyecto, consistencia

REGLAS:
- Score 0-10 (8+ para APPROVE)
- APPROVED: score >= 8 Y sin issues critical/major
- REQUEST_CHANGES: score < 8 O issues critical/major
- NO modifiques codigo (read-only)
- Se constructivo, da sugerencias especificas

FORMATO DE RESPUESTA (JSON):
{
  "verdict": "APPROVED|REQUEST_CHANGES",
  "score": 8,
  "issues": [
    {
      "severity": "critical|major|minor",
      "description": "descripcion del problema",
      "file": "ruta/archivo.js",
      "line": 42,
      "suggestion": "como resolverlo"
    }
  ],
  "positives": ["aspecto positivo 1"],
  "summary": "resumen general"
}
```

**Variantes por profundidad:**
- `quick`: Solo criterios 1 (correctness) y 7 (security)
- `standard`: Criterios 1-5
- `deep`: Todos los 8 criterios
- `forensic`: Analisis linea por linea, todos los criterios

### 77.5 QA System Prompt (src/prompts/qa-system.js)

```
Eres el QA de Komodo. Generas y ejecutas tests automaticos.

INSTRUCCIONES:
1. Lee los criterios de aceptacion y archivos modificados
2. Detecta el framework de testing (vitest, jest, mocha, etc.)
3. Genera tests por cada criterio de aceptacion
4. Genera tests de edge cases (null, empty, boundary)
5. Ejecuta TODOS los tests
6. Push solo si TODOS pasan

Si un test falla:
- Si el codigo del Coder tiene un bug: reporta failsCoderCode: true
- Si el test esta mal escrito: arreglalo y reintenta

FORMATO DE RESPUESTA (JSON):
{
  "testsGenerated": 10,
  "testsPassed": 10,
  "testsFailed": 0,
  "filesCreated": ["tests/nuevo-test.test.js"],
  "filesChanged": [],
  "pushed": true,
  "failedTests": [],
  "summary": "10 tests generados, todos pasaron"
}
```

### 77.6 Security System Prompt (src/prompts/security-system.js)

```
Eres el SECURITY agent de Komodo. Escaneas codigo en busca de vulnerabilidades.

CHECKLIST OWASP TOP 10:
1. Injection (SQL, NoSQL, Command, LDAP)
2. Broken Authentication
3. Sensitive Data Exposure
4. XML External Entities (XXE)
5. Broken Access Control
6. Security Misconfiguration
7. Cross-Site Scripting (XSS)
8. Insecure Deserialization
9. Using Components with Known Vulnerabilities
10. Insufficient Logging & Monitoring

INSTRUCCIONES:
1. Analiza cada archivo modificado
2. Busca: hardcoded secrets, SQL injection, XSS, command injection
3. Verifica: validacion de input, sanitizacion de output
4. Incluye: severity, category, file, line

VERDICT:
- BLOCK: 1+ CRITICAL o 1+ HIGH
- WARN: 1+ MEDIUM (sin CRITICAL/HIGH)
- PASS: solo LOW o ninguno

FORMATO DE RESPUESTA (JSON):
{
  "verdict": "PASS|WARN|BLOCK",
  "findings": [{ "severity": "CRITICAL|HIGH|MEDIUM|LOW", "category": "Injection", "description": "...", "file": "...", "line": 42 }],
  "summary": "resumen del analisis"
}
```

### 77.7 Tester System Prompt (src/prompts/tester-system.js)

```
Eres el TESTER de Komodo. Generas tests QUIRURGICOS usando contexto del Knowledge Graph.

A DIFERENCIA del QA, tu tienes contexto del:
- Plan del Arquitecto (que se planeo implementar)
- Decisiones del Coder (que se implemento y por que)
- Riesgos identificados (que puede fallar)

GENERA TESTS PARA:
1. Cada criterio de aceptacion (happy path)
2. Edge cases de las funciones principales
3. Error paths (que pasa si falla X)
4. Riesgos del Arquitecto (test especifico por riesgo)
5. Regresion (si se toco codigo existente)

FORMATO: mismo que QA + campo coverage (porcentaje estimado)
```

---

## 78. DEPENDENCIAS

### 78.1 Root package.json

```json
{
  "name": "komodo-orchestrator",
  "version": "2.0.0",
  "type": "module",
  "scripts": {
    "start": "node src/index.js",
    "dev": "node --watch src/index.js",
    "test": "vitest run",
    "setup": "node src/setup.js"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.1",
    "@xenova/transformers": "^2.17.2",
    "chalk": "^5.3.0",
    "commander": "^12.0.0",
    "dotenv": "^16.4.7",
    "uuid": "^9.0.0",
    "ws": "^8.19.0",
    "zod": "^3.24.2"
  },
  "devDependencies": {
    "vitest": "^2.0.0"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
```

**Nota V2:** Eliminado `node-telegram-bot-api` y dependencias de Three.js del root.

### 78.2 Registro MCP global

```bash
# Registrar komodo-mcp como servidor MCP global
claude mcp add komodo-mcp \
  --command "node" \
  --args "c:\\path\\to\\komodo\\skills\\komodo-mcp\\src\\index.js" \
  --env "KOMODO_ROOT=c:\\path\\to\\komodo"
```

### 78.3 .claude/settings.local.json

```json
{
  "mcpServers": {
    "komodo-mcp": {
      "command": "node",
      "args": ["c:\\path\\to\\komodo\\skills\\komodo-mcp\\src\\index.js"],
      "env": { "KOMODO_ROOT": "c:\\path\\to\\komodo" }
    }
  },
  "permissions": {
    "allow": [
      "mcp__komodo-mcp__*",
      "mcp__planning-task-mcp__*",
      "mcp__github-mcp__*",
      "mcp__memory-mcp__*",
      "Bash(git *)",
      "Bash(gh *)",
      "Bash(npm *)"
    ]
  }
}
```

---

## 79. GUIA DE IMPLEMENTACION

### 79.1 Orden de implementacion recomendado

**Fase 1: Infraestructura base (Sprint 0-2)**
1. `package.json` + dependencias
2. `src/config.js` - Config loader
3. `src/utils/logger.js` - Logger con colores
4. `src/utils/parser.js` - JSON parser robusto
5. `src/utils/response-validator.js` - Validador
6. `src/events/event-bus.js` - EventBus
7. `src/state/komodo-state.js` - State singleton
8. `src/state/checkpoint-manager.js` - Checkpoints

**Fase 2: Sistema de agentes (Sprint 3-5)**
9. `src/agents/rate-limit-detector.js` - Detection patterns
10. `src/agents/fallback-manager.js` - CLI fallback
11. `src/agents/streaming-watchdog.js` - Anomaly detection
12. `src/agents/base-agent.js` - Core agent runner
13. `src/agents/multi-part-filter.js` - Multi-part tasks
14. `src/prompts/*` - Todos los system prompts

**Fase 3: Agentes individuales (Sprint 6-8)**
15. `src/agents/planner.js`
16. `src/agents/architect.js`
17. `src/agents/coder.js`
18. `src/agents/reviewer.js`
19. `src/agents/qa.js`
20. `src/agents/tester.js`
21. `src/agents/security-agent.js`

**Fase 4: Ciclo de ejecucion (Sprint 9-10)**
22. `src/cycle/incremental-review.js`
23. `src/cycle/review-loop.js`
24. `src/cycle/task-runner.js`
25. `src/cycle/pipeline-scheduler.js`

**Fase 5: Orquestacion (Sprint 11-12)**
26. `src/orchestrator.js`
27. `src/index.js` - CLI
28. `src/setup.js` - Wizard

**Fase 6: MCP Servers (Sprint 13-16)**
29. `skills/planning-task-mcp/` - Firebase task management
30. `skills/github-mcp/` - GitHub operations
31. `skills/memory-mcp/` - Pattern memory
32. `skills/komodo-mcp/` - Orchestrator MCP

**Fase 7: Subsistemas (Sprint 17-20)**
33. Triage: complexity, model-selector, smart-router, decomposer
34. Intelligence: indexer, learner, style-detector, review-feedback
35. Knowledge graph
36. Autonomy: engine, guardian-gates, approval
37. Resilience: circuit-breaker, error-budget, DLQ
38. Self-healing: engine + 6 strategies
39. Cost: budget-manager
40. Estimation: token-estimator, rate-limit-tracker

**Fase 8: Features avanzados (Sprint 21-23)**
41. Daemon mode + scheduler
42. Heartbeat monitor
43. CI monitor + canary merge
44. SonarQube integration
45. Pre-PR tests + coverage
46. Versioning + releases
47. Tech debt tracker
48. Auto-improve
49. Multi-project
50. Integrations (GitHub issues, PR comments, webhooks)
51. Plugin system

**Fase 9: Servidores (Sprint 24)**
52. WebSocket server
53. API server
54. Shutdown manager

**Fase 10: Dashboard (Sprint 25-28)**
55. Next.js setup + config
56. Types + Firebase client
57. WebSocket hook
58. Pages: dashboard, agents, analytics, history, leaderboard, memory, notifications, settings
59. Components
60. API routes

### 79.2 Prerequisitos de desarrollo

```bash
# Instalar Node.js 18+
# Instalar git
# Instalar GitHub CLI: gh auth login
# Instalar al menos un AI CLI: claude, codex, o gemini
# Configurar Firebase: crear proyecto, generar serviceAccountKey.json
# Configurar .env con todas las variables
```

### 79.3 Verificacion

```bash
# Verificar instalacion
komodo doctor

# Setup interactivo
komodo setup

# Dry run (simulacion)
komodo run --dry-run

# Ejecutar 1 tarea
komodo run -t 1

# Modo continuo
komodo run -c

# Modo daemon
komodo watch
```

---

## 80. RESUMEN FINAL

Komodo V2.0 es un sistema de 223+ archivos JS/TS que orquesta 7 agentes IA para automatizar el ciclo completo de desarrollo de software. Los componentes clave son:

1. **Base Agent** - Infraestructura de spawn CLI + stdin + MCP injection
2. **Task Runner** - Pipeline de 12 fases por tarea
3. **Review Loop** - Ciclo Coder ↔ Reviewer con escalacion
4. **4 MCP Servers** - 70+ herramientas (Firebase, GitHub, Memory, Orchestrator)
5. **Dashboard** - Next.js con WebSocket real-time
6. **Resiliencia** - Circuit breaker, self-healing, checkpoints, fallback
7. **Inteligencia** - Codebase learning, Knowledge Graph, semantic memory
8. **Observabilidad** - EventBus, timelines, anomaly detection, metricas

Todo diseñado para ser completamente replicable desde este documento.
