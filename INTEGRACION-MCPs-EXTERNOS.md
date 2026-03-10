# Komodo - Plan de Integracion de MCPs Open Source

> Plan para integrar MCPs open source existentes que multiplican las capacidades de Komodo sin escribir codigo desde cero. Cada MCP se conecta como herramienta disponible para los agentes.
>
> **Criterios de seleccion**: open source, mantenido activamente, con valor directo para el ciclo de desarrollo autonomo de Komodo.

---

## Mapa de Integracion

```
                          KOMODO ORCHESTRATOR
                                 │
    ┌────────────┬───────────┬───┴───┬───────────┬────────────┐
    │            │           │       │           │            │
 PLANNER    ARCHITECT    CODER   TESTER    SECURITY     REVIEWER
    │            │           │       │           │            │
    ▼            ▼           ▼       ▼           ▼            ▼
┌────────┐ ┌─────────┐ ┌────────┐ ┌──────┐ ┌─────────┐ ┌────────┐
│Linear  │ │Postgres │ │GitHub  │ │Play- │ │Semgrep  │ │Sentry  │
│Jira    │ │Supabase │ │Official│ │wright│ │Snyk     │ │Grafana │
│        │ │         │ │        │ │      │ │         │ │        │
│Context │ │Filesystem│ │Docker  │ │      │ │OSV      │ │        │
│7       │ │         │ │K8s     │ │      │ │         │ │        │
└────────┘ └─────────┘ └────────┘ └──────┘ └─────────┘ └────────┘

Transversales (todos los agentes):
┌──────────────────────────────────────────────────────────┐
│  Slack MCP  │  Sequential Thinking  │  Fetch  │  Memory  │
└──────────────────────────────────────────────────────────┘
```

---

## 1. GitHub Official MCP Server

**Repo**: [github/github-mcp-server](https://github.com/github/github-mcp-server)
**Reemplaza**: Nuestro `skills/github-mcp/` custom (10 tools via `gh` CLI)
**Stars**: 20K+

### Por que
El MCP oficial de GitHub tiene **40+ tools** vs nuestros 10 wrappers de `gh` CLI. Incluye:
- Busqueda de codigo (`search_code`) — el Coder puede buscar patterns en todo el repo
- Gestion de issues (`create_issue`, `list_issues`, `update_issue`) — Tech Debt Tracker puede crear issues directamente
- Gestion de releases (`create_release`) — Release Manager ya no necesita `gh` CLI
- File operations (`get_file_contents`, `push_files`) — mas robusto que nuestro wrapper
- Code review comments (`create_pull_request_review`) — reviews inline, no solo approve/reject
- Workflows (`list_workflow_runs`, `get_workflow_run`) — CI Monitor puede leer directamente

### Que agentes lo usan
| Agente | Tools que usa | Para que |
|--------|--------------|---------|
| CODER | `create_branch`, `push_files`, `create_pull_request` | Implementar y abrir PR |
| REVIEWER | `get_pull_request`, `list_pull_request_files`, `get_file_contents`, `create_pull_request_review` | Review con comentarios inline |
| ARCHITECT | `search_code`, `get_file_contents` | Analizar codebase sin leer archivos locales |
| PLANNER | `list_issues`, `search_issues` | Sincronizar issues de GitHub con backlog |

### Implementacion
```json
// mcp-config.json
{
  "mcpServers": {
    "github": {
      "command": "docker",
      "args": ["run", "-i", "--rm",
        "-e", "GITHUB_PERSONAL_ACCESS_TOKEN",
        "ghcr.io/github/github-mcp-server"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_TOKEN}"
      }
    }
  }
}
```

### Migracion
1. Reemplazar `skills/github-mcp/` por el server oficial
2. Adaptar los prompts de los agentes para usar los nuevos nombres de tools
3. Mantener `runGh()` como fallback para operaciones no cubiertas
4. **Beneficio**: Dejamos de mantener nuestro wrapper, ganamos 30+ tools nuevas

### Valor
- **Reviews inline**: El Reviewer puede comentar linea por linea en el PR, no solo APPROVE/REQUEST_CHANGES generico
- **Busqueda de codigo**: El Architect busca patterns existentes sin gastar turnos en `grep`
- **Issues sync**: Las tareas de tech debt se crean como GitHub Issues automaticamente
- **0 mantenimiento**: GitHub mantiene el server

---

## 2. Playwright MCP (Microsoft)

**Repo**: [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp)
**Stars**: 10K+

### Por que
Komodo tiene `ENABLE_BROWSER_MCP` para Chrome DevTools, pero es limitado. Playwright MCP de Microsoft expone **25+ tools** de browser automation:
- Navegar a URLs
- Hacer click, escribir, scroll
- Leer accessibility snapshots (no screenshots — 2-5KB vs 500KB)
- Ejecutar JavaScript en la pagina
- Tomar screenshots solo cuando se necesitan

### Que agentes lo usan
| Agente | Para que |
|--------|---------|
| TESTER | **E2E tests visuales**: Navegar la app, verificar que el login funciona, que el formulario renderiza, que los botones hacen lo esperado |
| REVIEWER | **Validacion visual**: Abrir la PR en preview, verificar que no hay regresion visual |
| CODER | **Debug**: Si un test falla, abrir el browser y ver que esta pasando |
| SECURITY | **XSS testing**: Inyectar payloads en inputs y verificar que se sanitizan |

### Caso de uso estrella: E2E Validation
```
Flujo actual:
  CODER → PR → REVIEWER (solo lee codigo) → MERGE

Flujo con Playwright:
  CODER → PR → TESTER (corre Playwright, verifica visualmente) → REVIEWER → MERGE

El TESTER puede:
  1. Abrir http://localhost:3000 (si hay dev server)
  2. Navegar a la pagina afectada
  3. Verificar que los elementos existen (via accessibility tree)
  4. Llenar formularios y verificar respuestas
  5. Reportar si algo no se ve bien
```

### Implementacion
```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp@latest", "--headless"]
    }
  }
}
```

### Valor
- **E2E automatico**: Cada PR de frontend se verifica visualmente
- **XSS scanning real**: No solo analisis estatico, sino inyeccion real en el browser
- **Accessibility snapshots**: 10-100x mas rapido que screenshots, ~2-5KB
- **Sin vision model**: No necesita GPT-4V ni nada multimodal, usa el accessibility tree

---

## 3. Semgrep MCP

**Repo**: [semgrep/mcp](https://github.com/semgrep/mcp)

### Por que
Nuestro Security Agent (Fase 1 #4) usa herramientas locales como `npm audit` y `gitleaks`. Semgrep MCP anade **SAST profesional** con 3000+ reglas OWASP:

- `security_check` — Escaneo rapido de un archivo
- `semgrep_scan` — Escaneo completo del proyecto con reglas OWASP
- `semgrep_scan_with_custom_rule` — Reglas custom (podemos crear reglas especificas de nuestros patterns)
- `get_abstract_syntax_tree` — AST del codigo (para el Impact Analyzer)
- `semgrep_findings` — Resultados de escaneos previos

### Integracion con Security Agent
```javascript
// src/agents/security.js — antes de invocar el LLM
async function runSecurityTools(branchName, cwd) {
  const results = {};

  // 1. Semgrep MCP (SAST profesional)
  results.semgrep = await callMCP('semgrep', 'semgrep_scan', {
    path: cwd,
    config: 'p/owasp-top-ten',
  });

  // 2. npm audit (dependencias)
  results.npmAudit = await exec('npm audit --json', { cwd });

  // 3. gitleaks (secrets)
  results.gitleaks = await exec(`gitleaks detect --source=${cwd} --no-git`, { cwd });

  // Solo invocar LLM si hay findings ambiguos
  const ambiguous = results.semgrep.findings.filter(f => f.confidence === 'medium');
  if (ambiguous.length > 0) {
    results.llmAnalysis = await securityLLM.analyze(ambiguous);
  }

  return results;
}
```

### Custom rules de nuestros patterns
```yaml
# .semgrep/komodo-rules.yml
rules:
  - id: no-raw-sql
    patterns:
      - pattern: $DB.query($SQL)
      - pattern-not: $DB.query($SQL, $PARAMS)
    message: "Use parameterized queries instead of raw SQL"
    severity: ERROR
    # Generado automaticamente por Rollback Learning (#28)

  - id: no-console-log-in-prod
    pattern: console.log(...)
    paths:
      exclude:
        - "**/*.test.*"
        - "**/*.spec.*"
    message: "Remove console.log before merge"
    severity: WARNING
```

### Valor
- **3000+ reglas OWASP** sin escribir una sola regla nosotros
- **Custom rules** generadas automaticamente por Rollback Learning
- **AST parsing** gratis — util para Impact Analyzer y Codebase Learning
- **Confidence levels** — solo gastar tokens de LLM en findings ambiguos

---

## 4. Sentry MCP

**Repo**: [getsentry/sentry-mcp](https://docs.sentry.io/product/sentry-mcp/)
**Oficial de Sentry**

### Por que
Despues del merge, nadie sabe si el codigo produce errores en produccion hasta que un humano mira Sentry. Con el MCP de Sentry, Komodo puede **monitorear errores post-deploy automaticamente**.

### Tools disponibles
- `list_issues` — Listar errores recientes por proyecto
- `get_issue` — Detalles de un error (stack trace, frecuencia, usuarios afectados)
- `search_issues` — Buscar errores por query
- `get_event` — Evento especifico con contexto completo

### Caso de uso: Post-Deploy Monitoring
```
Flujo actual:
  MERGE → CI Monitor (pasa/falla) → FIN

Flujo con Sentry MCP:
  MERGE → CI Monitor → Sentry Watch (30 min) → Si hay nuevos errores → Auto-Fix Task

Detalle:
  1. Despues del merge, Komodo espera 30 minutos
  2. Consulta Sentry: "Hay errores nuevos en los ultimos 30 min que no existian antes?"
  3. Si hay errores nuevos que coinciden con los archivos mergeados:
     a. Crea una tarea de fix automatica con el stack trace como contexto
     b. Prioridad maxima
     c. Si es critico (>100 usuarios afectados): revertir automaticamente
```

### Implementacion
```javascript
// src/integrations/sentry-monitor.js
async function postMergeWatch(taskId, mergedFiles, duration = 30) {
  // Esperar {duration} minutos
  await sleep(duration * 60 * 1000);

  // Consultar Sentry por errores nuevos
  const newIssues = await callMCP('sentry', 'search_issues', {
    query: `is:unresolved firstSeen:-${duration}m`,
    project: config.sentryProject,
  });

  // Filtrar: solo errores relacionados con los archivos mergeados
  const relatedIssues = newIssues.filter(issue => {
    const frames = issue.stacktrace?.frames || [];
    return frames.some(f => mergedFiles.includes(f.filename));
  });

  if (relatedIssues.length > 0) {
    emit('sentry:regression-detected', {
      taskId,
      issues: relatedIssues,
      severity: relatedIssues.some(i => i.count > 100) ? 'critical' : 'warning',
    });

    // Auto-crear tarea de fix
    await createTask({
      title: `Fix production error: ${relatedIssues[0].title}`,
      priority: 100,
      context: {
        sentryIssueId: relatedIssues[0].id,
        stackTrace: relatedIssues[0].stacktrace,
        usersAffected: relatedIssues[0].userCount,
        originTask: taskId,
      },
    });
  }
}
```

### Valor
- **Cierra el loop**: Komodo detecta errores en produccion y los arregla solo
- **Stack trace como contexto**: El Coder recibe el error exacto, no tiene que reproducirlo
- **Auto-revert inteligente**: Si >100 usuarios afectados, revertir inmediatamente
- **Feedback loop**: Los errores de produccion alimentan el Learning Engine

---

## 5. Slack MCP

**Repo**: [modelcontextprotocol/servers/slack](https://github.com/modelcontextprotocol/servers) / [slack.com/mcp](https://slack.com/help/articles/48855576908307-Guide-to-the-Slack-MCP-server)
**Oficial de Slack**

### Por que
Komodo tiene integracion con Telegram, pero la mayoria de equipos de desarrollo usan Slack. El MCP oficial de Slack permite:

- `send_message` — Enviar mensajes a canales
- `reply_to_thread` — Responder en hilos
- `search_messages` — Buscar mensajes
- `list_channels` — Listar canales
- `get_channel_history` — Leer historial

### Casos de uso

#### Notificaciones ricas
```
#komodo-notifications:

🟢 Task Completed: "Implementar login con OAuth"
   PR #42 merged | Review score: 9/10 | 1 cycle | 15K tokens
   Files: src/auth/login.js, src/auth/middleware.js
   Thread: [Ver detalles]

🔴 Task Failed: "Migrar DB a PostgreSQL"
   Reason: SonarQube Quality Gate FAILED (2 critical issues)
   Action: Tarea devuelta a to-do
   Thread: [Ver post-mortem]

⚠️ Approval Required: High-impact change
   Task: "Refactor auth module"
   Impact: 47 files affected
   Reply "approve" or "reject" in this thread
```

#### Aprobaciones via Slack
```javascript
// Autonomy Level 4 Guardian gate → Slack
async function requestApprovalViaSlack(gate, context) {
  const message = await callMCP('slack', 'send_message', {
    channel: config.slackApprovalChannel,
    text: `⚠️ *Komodo needs approval*\n\n${gate.message}\n\nReply with \`approve\` or \`reject\``,
  });

  // Escuchar respuestas en el hilo
  const response = await waitForSlackReply(message.ts, {
    timeout: config.approvalTimeout,
    validResponses: ['approve', 'reject'],
  });

  return response;
}
```

#### Standup automatico diario
```
#komodo-daily (9:00 AM):

📊 *Komodo Daily Report*
  Tasks completed yesterday: 5
  Tasks failed: 1
  Tokens used: 82K / 400K limit
  Rate limit status: 🟢 Green (62% headroom)

  Top tasks:
  ✅ "Add email validation" — 5K tokens, score 9
  ✅ "Fix pagination bug" — 3K tokens, score 10
  ✅ "Add rate limiting" — 12K tokens, score 8
  ✅ "Update user profile API" — 8K tokens, score 9
  ✅ "Fix CSS responsive layout" — 4K tokens, score 8
  ❌ "Migrate DB schema" — 45K tokens, quality gate failed

  Backlog remaining: 12 tasks (~180K tokens estimated)
  Estimated completion: 2.5 days at current rate
```

### Valor
- **Aprobaciones sin salir de Slack**: El equipo aprueba/rechaza cambios desde donde ya trabaja
- **Visibilidad total**: Todo el equipo ve que esta haciendo Komodo
- **Daily reports automaticos**: Sin esfuerzo, el equipo sabe el estado
- **Reemplaza Telegram**: Un solo canal de comunicacion (el que ya usa el equipo)

---

## 6. PostgreSQL / Supabase MCP

**Repo**: [supabase-community/supabase-mcp](https://github.com/supabase-community/supabase-mcp) o [modelcontextprotocol/servers/postgres](https://github.com/modelcontextprotocol/servers)

### Por que
Si el proyecto que Komodo esta desarrollando usa PostgreSQL/Supabase, los agentes necesitan entender el esquema de la DB para escribir codigo correcto. Actualmente el Coder adivina la estructura o la lee de archivos de migracion.

### Tools
- `execute_sql` — Ejecutar queries (read-only en produccion)
- `list_tables` — Listar todas las tablas
- `describe_table` — Schema de una tabla (columnas, tipos, constraints)
- `list_migrations` — Ver migraciones aplicadas

### Caso de uso: Schema-Aware Coding
```javascript
// Inyectar en el Architect/Coder cuando la tarea toca DB
const schema = await callMCP('postgres', 'describe_table', { table: 'users' });
// → { columns: [{ name: 'id', type: 'uuid', nullable: false }, ...], indexes: [...] }

architectPrompt += `
DATABASE SCHEMA (relevant tables):
${schema.map(t => `  ${t.name}: ${t.columns.map(c => `${c.name} ${c.type}`).join(', ')}`).join('\n')}

IMPORTANT: Use exact column names and types. Do NOT guess the schema.
`;
```

### Seguridad
```env
# SIEMPRE read-only en produccion
DATABASE_URL=postgres://komodo_readonly:***@host:5432/mydb?read_only=true
```

### Valor
- **El Coder nunca adivina el schema**: Sabe exactamente que columnas y tipos existen
- **El Tester genera queries reales**: Los tests de DB usan el schema real
- **Migraciones correctas**: El Architect ve las migraciones existentes antes de crear nuevas
- **Read-only**: Sin riesgo de modificar datos de produccion

---

## 7. Kubernetes MCP

**Repo**: [Flux159/mcp-server-kubernetes](https://github.com/Flux159/mcp-server-kubernetes) o [containers/kubernetes-mcp-server](https://github.com/containers/kubernetes-mcp-server)

### Por que
Si el proyecto se despliega en Kubernetes, Komodo puede verificar que el deploy fue exitoso, leer logs de pods, y detectar errores de runtime despues del merge.

### Tools
- `get_pods` — Listar pods y su estado
- `get_pod_logs` — Leer logs de un pod
- `get_deployments` — Ver estado de deployments
- `get_events` — Eventos del cluster (CrashLoopBackOff, OOMKilled, etc.)
- `apply_manifest` — Aplicar manifests (para deploy automatico)

### Caso de uso: Post-Deploy Health Check
```javascript
// Despues del merge, verificar el deploy en K8s
async function postDeployHealthCheck(deploymentName, namespace) {
  // 1. Esperar a que el deployment se actualice
  await waitForRollout(deploymentName, namespace, { timeout: 300 });

  // 2. Verificar que los pods estan healthy
  const pods = await callMCP('kubernetes', 'get_pods', {
    namespace,
    labelSelector: `app=${deploymentName}`,
  });

  const unhealthy = pods.filter(p => p.status !== 'Running' || p.restarts > 0);

  if (unhealthy.length > 0) {
    // 3. Leer logs del pod que falla
    const logs = await callMCP('kubernetes', 'get_pod_logs', {
      name: unhealthy[0].name,
      namespace,
      tail: 100,
    });

    emit('deploy:unhealthy', {
      deployment: deploymentName,
      pods: unhealthy,
      logs,
    });

    // 4. Auto-crear tarea de fix con los logs como contexto
    await createFixTask(logs);
  }
}
```

### Valor
- **Deploy verification**: No solo CI pasa, sino que el deploy en K8s esta sano
- **Crash detection**: Si un pod entra en CrashLoopBackOff, Komodo lo detecta y crea un fix
- **Logs como contexto**: El Coder recibe los logs del pod fallido, no tiene que buscarlos
- **Complementa CI Monitor**: CI pasa ≠ deploy funciona (CI no testea OOM, health checks, etc.)

---

## 8. Grafana MCP

**Repo**: [grafana/mcp-grafana](https://github.com/grafana/mcp-grafana)
**Oficial de Grafana**

### Por que
Grafana monitorea metricas de aplicacion (latencia, errores, throughput). Con el MCP, Komodo puede detectar regresiones de performance en produccion automaticamente.

### Tools
- `search_dashboards` — Buscar dashboards
- `query_prometheus` — Queries directas a Prometheus
- `query_loki` — Buscar logs en Loki
- `list_alerts` — Ver alertas activas
- `get_incident` — Detalles de incidentes

### Caso de uso: Performance Regression Detection (produccion)
```javascript
// Complementa el Performance Detector local (#25) con datos de produccion
async function checkProductionPerformance(taskId, mergedFiles, endpoint) {
  // Query a Prometheus: latencia p95 de los ultimos 30 min vs 24h antes
  const current = await callMCP('grafana', 'query_prometheus', {
    query: `histogram_quantile(0.95, rate(http_request_duration_seconds_bucket{handler="${endpoint}"}[30m]))`,
  });

  const baseline = await callMCP('grafana', 'query_prometheus', {
    query: `histogram_quantile(0.95, rate(http_request_duration_seconds_bucket{handler="${endpoint}"}[30m] offset 24h))`,
  });

  const ratio = current.value / baseline.value;

  if (ratio > 2.0) {
    // Latencia se duplico → regresion de performance
    emit('performance:production-regression', {
      endpoint,
      baseline: `${baseline.value * 1000}ms`,
      current: `${current.value * 1000}ms`,
      degradation: `${((ratio - 1) * 100).toFixed(0)}%`,
      taskId,
    });

    // Crear tarea de fix
    await createTask({
      title: `Fix performance regression: ${endpoint} is ${((ratio - 1) * 100).toFixed(0)}% slower`,
      priority: 90,
      context: { taskId, endpoint, baseline, current },
    });
  }
}
```

### Valor
- **Datos reales de produccion**: No benchmarks locales, sino latencia/errores reales
- **Alertas como input**: Si Grafana tiene una alerta activa, Komodo la ve y puede actuar
- **Logs con Loki**: Buscar logs de error especificos sin acceso SSH al servidor
- **Complementa Sentry**: Sentry = errores, Grafana = metricas de performance

---

## 9. Sequential Thinking MCP (Official)

**Repo**: [modelcontextprotocol/servers/sequential-thinking](https://github.com/modelcontextprotocol/servers)
**Oficial MCP**

### Por que
Los agentes de Komodo a veces fallan en tareas complejas porque intentan resolver todo de golpe. Sequential Thinking fuerza un **razonamiento paso a paso** antes de actuar.

### Como funciona
El MCP expone un solo tool `create_thinking_sequence` que guia al LLM a:
1. Descomponer el problema en pasos
2. Evaluar cada paso antes de pasar al siguiente
3. Reconsiderar si detecta un error en su razonamiento
4. Bifurcar si hay multiples caminos posibles

### Integracion con Architect
```javascript
// El Architect usa Sequential Thinking para tareas complejas (>8 devPoints)
async function architectWithThinking(taskSpec) {
  if (taskSpec.devPoints >= 8) {
    // Activar Sequential Thinking como MCP adicional
    const thinkingConfig = {
      mcpServers: {
        ...standardMCPs,
        'sequential-thinking': {
          command: 'npx',
          args: ['@modelcontextprotocol/server-sequential-thinking'],
        },
      },
    };

    // El prompt le dice al Architect que use thinking antes de planificar
    architectPrompt += `
    IMPORTANT: This is a complex task. Before generating your plan,
    use the sequential_thinking tool to reason through the approach
    step by step. Consider:
    1. What modules are affected?
    2. What are the dependencies between changes?
    3. What could go wrong?
    4. What is the optimal order of implementation?
    `;
  }
}
```

### Valor
- **Menos fallos en tareas complejas**: El Architect razona antes de planificar
- **Deteccion de errores propios**: Si el LLM se da cuenta de que su plan tiene un fallo, lo corrige antes de emitirlo
- **0 coste extra de infra**: Es un server local, sin API keys
- **Reduce review cycles**: Planes mejor pensados → codigo mejor → menos fixes

---

## 10. Context7 MCP

**Repo**: [upstash/context7](https://github.com/upstash/context7)

### Por que
Cuando el Coder necesita usar una libreria (React, Express, Prisma, etc.), muchas veces genera codigo con APIs desactualizadas. Context7 proporciona **documentacion actualizada de librerias** como contexto para el LLM.

### Tools
- `resolve-library-id` — Encontrar el ID de una libreria
- `get-library-docs` — Obtener documentacion actualizada y relevante

### Caso de uso
```
Tarea: "Implementar autenticacion con NextAuth.js v5"

Sin Context7:
  El Coder genera codigo con la API de NextAuth v4 (desactualizada)
  → Review rechaza: "NextAuth v5 usa una API diferente"
  → Fix cycle extra = tokens desperdiciados

Con Context7:
  Antes de codear, el Coder llama a Context7:
    resolve-library-id("next-auth") → "next-auth-v5"
    get-library-docs("next-auth-v5", topic="configuration") → docs actualizadas

  El Coder recibe la API correcta → codigo correcto a la primera
  → Review aprueba primer ciclo
```

### Integracion
```javascript
// Inyectar en el Coder cuando el Architect detecta dependencias
async function enrichCoderContext(architectPlan) {
  const deps = architectPlan.dependencies;

  for (const dep of deps) {
    try {
      const libId = await callMCP('context7', 'resolve-library-id', {
        libraryName: dep.name,
      });

      const docs = await callMCP('context7', 'get-library-docs', {
        libraryId: libId,
        topic: dep.usage || 'getting-started',
        tokens: 2000, // Limitar tokens de docs
      });

      coderContext.libraryDocs.push({
        library: dep.name,
        docs: docs.content,
      });
    } catch {
      // Non-blocking: continuar sin docs
    }
  }
}
```

### Valor
- **Codigo correcto a la primera**: El Coder usa la API actual, no la de hace 2 anos
- **Menos review cycles**: No mas "esta usando la API desactualizada"
- **Documentacion filtrada**: Solo recibe los docs relevantes (~2K tokens), no toda la libreria
- **Funciona con cualquier libreria**: React, Vue, Express, Prisma, NextAuth, Stripe, etc.

---

## 11. Filesystem MCP (Official)

**Repo**: [modelcontextprotocol/servers/filesystem](https://github.com/modelcontextprotocol/servers)
**Oficial MCP**

### Por que
Nuestros agentes usan el filesystem via los CLIs (Claude CLI lee archivos directamente). Pero cuando un agente corre via MCP (modo komodo-mcp), no tiene acceso directo al filesystem. El Filesystem MCP lo resuelve con **sandboxing seguro**.

### Tools
- `read_file` — Leer archivo
- `write_file` — Escribir archivo
- `list_directory` — Listar directorio
- `search_files` — Buscar por patron
- `get_file_info` — Metadata (tamano, fecha, permisos)
- `move_file` — Mover/renombrar

### Seguridad
```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": [
        "@modelcontextprotocol/server-filesystem",
        "/ruta/al/proyecto"
      ]
    }
  }
}
// Solo expone /ruta/al/proyecto, nada mas del sistema
```

### Valor
- **Sandboxing**: El agente solo ve el directorio del proyecto, no puede leer `/etc/passwd`
- **Estandarizado**: Todos los agentes usan la misma interfaz, no importa si corren local o remoto
- **Modo MCP**: Esencial para cuando Komodo corre como MCP server (otro LLM lo invoca)

---

## 12. Memory MCP (Official)

**Repo**: [modelcontextprotocol/servers/memory](https://github.com/modelcontextprotocol/servers)
**Oficial MCP**

### Por que
Nuestro `skills/memory-mcp/` usa un JSON file plano. El Memory MCP oficial implementa un **knowledge graph** con entidades, relaciones, y observaciones persistentes.

### Tools
- `create_entities` — Crear entidades (archivos, funciones, patterns)
- `create_relations` — Crear relaciones entre entidades
- `add_observations` — Agregar observaciones a entidades
- `search_nodes` — Buscar en el grafo
- `open_nodes` — Abrir entidades especificas
- `delete_entities` / `delete_relations`

### Caso de uso: Knowledge Graph del proyecto
```
Entidades:
  [Module: auth] ──uses──→ [Library: jsonwebtoken]
  [Module: auth] ──contains──→ [File: src/auth/login.js]
  [File: src/auth/login.js] ──exports──→ [Function: loginHandler]
  [Function: loginHandler] ──has-pattern──→ [Pattern: missing-null-check]

Observaciones:
  [Module: auth]:
    - "Last modified by task-abc, review score 9"
    - "Uses JWT, decision made in task-abc"
    - "Known issue: no rate limiting on login endpoint"
```

### Migracion
1. Migrar `skills/memory-mcp/` patterns al knowledge graph
2. Agregar entidades automaticamente durante la ejecucion de tareas
3. El Architect consulta el grafo antes de planificar
4. El Reviewer consulta patterns asociados a los modulos afectados

### Valor
- **Relaciones entre conceptos**: "auth usa JWT" no es un pattern, es una relacion
- **Consultas semanticas**: "Que se sabe sobre el modulo de auth?" → todo relacionado
- **Reemplaza nuestro JSON plano**: Mas robusto, con busqueda, sin race conditions
- **Complementa Memory Embeddings** (Fase 2 #12): Embeddings para similarity, knowledge graph para relaciones explicitas

---

## Plan de Implementacion

### Prioridad 1 — Alto valor, bajo esfuerzo (Semana 1-2)
| MCP | Razon |
|-----|-------|
| **GitHub Official** | Reemplaza nuestro wrapper, 30+ tools nuevas, 0 mantenimiento |
| **Context7** | Elimina reviews rechazados por APIs desactualizadas |
| **Sequential Thinking** | Reduce fallos en tareas complejas, 0 coste |

### Prioridad 2 — Alto valor, esfuerzo medio (Semana 3-4)
| MCP | Razon |
|-----|-------|
| **Semgrep** | SAST profesional para Security Agent, 3000+ reglas OWASP |
| **Slack** | Notificaciones ricas + aprobaciones donde el equipo ya trabaja |
| **Playwright** | E2E testing visual para PRs de frontend |

### Prioridad 3 — Valor operativo, esfuerzo medio (Semana 5-6)
| MCP | Razon |
|-----|-------|
| **Sentry** | Cierra el loop: errores de produccion → auto-fix tasks |
| **PostgreSQL/Supabase** | Schema-aware coding, el Coder nunca adivina la DB |
| **Memory Official** | Knowledge graph reemplaza nuestro JSON plano |

### Prioridad 4 — Valor infraestructura, alto esfuerzo (Semana 7-8)
| MCP | Razon |
|-----|-------|
| **Kubernetes** | Post-deploy health checks, log reading |
| **Grafana** | Performance monitoring en produccion |
| **Filesystem** | Sandboxing seguro para modo MCP remoto |

---

## Configuracion Final

```json
// komodo-mcp-config.json — Todos los MCPs integrados
{
  "mcpServers": {
    "github": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "-e", "GITHUB_PERSONAL_ACCESS_TOKEN", "ghcr.io/github/github-mcp-server"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_TOKEN}" }
    },
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp@latest", "--headless"]
    },
    "semgrep": {
      "command": "uvx",
      "args": ["semgrep-mcp"]
    },
    "sentry": {
      "command": "npx",
      "args": ["@sentry/mcp-server"],
      "env": { "SENTRY_AUTH_TOKEN": "${SENTRY_TOKEN}" }
    },
    "slack": {
      "command": "npx",
      "args": ["@modelcontextprotocol/server-slack"],
      "env": { "SLACK_BOT_TOKEN": "${SLACK_BOT_TOKEN}" }
    },
    "postgres": {
      "command": "npx",
      "args": ["@modelcontextprotocol/server-postgres", "${DATABASE_URL}?read_only=true"]
    },
    "kubernetes": {
      "command": "npx",
      "args": ["mcp-server-kubernetes"]
    },
    "grafana": {
      "command": "npx",
      "args": ["mcp-grafana"],
      "env": { "GRAFANA_URL": "${GRAFANA_URL}", "GRAFANA_API_KEY": "${GRAFANA_API_KEY}" }
    },
    "sequential-thinking": {
      "command": "npx",
      "args": ["@modelcontextprotocol/server-sequential-thinking"]
    },
    "context7": {
      "command": "npx",
      "args": ["@upstash/context7-mcp@latest"]
    },
    "filesystem": {
      "command": "npx",
      "args": ["@modelcontextprotocol/server-filesystem", "${PROJECT_DIR}"]
    },
    "memory": {
      "command": "npx",
      "args": ["@modelcontextprotocol/server-memory"]
    }
  }
}
```

## Asignacion de MCPs por Agente

```
PLANNER:
  ├── planning-task-mcp (nuestro, tareas Firebase)
  ├── github (issues sync)
  └── memory (knowledge graph del proyecto)

ARCHITECT:
  ├── github (search_code, get_file_contents)
  ├── postgres (describe_table, schema)
  ├── filesystem (read_file, list_directory)
  ├── sequential-thinking (tareas complejas)
  ├── memory (knowledge graph)
  └── context7 (docs de librerias)

CODER:
  ├── github (create_branch, push_files, create_pr)
  ├── filesystem (read_file, write_file)
  ├── postgres (describe_table para queries correctas)
  ├── context7 (docs actualizadas de librerias)
  └── memory (patterns a evitar)

TESTER:
  ├── playwright (E2E testing visual)
  ├── filesystem (read test files)
  └── postgres (schema para tests de DB)

SECURITY:
  ├── semgrep (SAST, 3000+ reglas OWASP)
  ├── playwright (XSS testing real)
  └── github (get_file_contents para review)

REVIEWER:
  ├── github (get_pr_diff, create_review con comentarios inline)
  ├── sentry (errores recientes del modulo)
  ├── grafana (metricas de performance del endpoint)
  └── memory (patterns conocidos)

POST-MERGE:
  ├── sentry (monitoring de errores nuevos)
  ├── kubernetes (health check de pods)
  ├── grafana (regression de performance)
  └── slack (notificaciones al equipo)
```

---

## Impacto Total

| Area | Sin MCPs externos | Con MCPs externos |
|------|-------------------|-------------------|
| **Security scanning** | npm audit + gitleaks | + Semgrep 3000 reglas OWASP + XSS real con Playwright |
| **Code review** | Solo approve/reject | + Comentarios inline por linea + metricas de produccion |
| **Testing** | Unit tests locales | + E2E visual con Playwright + schema-aware DB tests |
| **Post-deploy** | CI pass/fail | + Sentry errores + K8s pod health + Grafana performance |
| **Context** | Codebase index estatico | + Docs actualizadas (Context7) + DB schema real + Knowledge graph |
| **Comunicacion** | Telegram | + Slack con aprobaciones inline + daily reports |
| **Razonamiento** | Prompt directo | + Sequential Thinking para tareas complejas |
| **Mantenimiento** | 4 MCPs custom | 4 custom + 12 open source mantenidos por la comunidad |

Sources:
- [GitHub MCP Server](https://github.com/github/github-mcp-server)
- [Playwright MCP (Microsoft)](https://github.com/microsoft/playwright-mcp)
- [Semgrep MCP](https://github.com/semgrep/mcp)
- [Sentry MCP](https://docs.sentry.io/product/sentry-mcp/)
- [Slack MCP Guide](https://slack.com/help/articles/48855576908307-Guide-to-the-Slack-MCP-server)
- [Supabase MCP](https://github.com/supabase-community/supabase-mcp)
- [Kubernetes MCP](https://github.com/Flux159/mcp-server-kubernetes)
- [Grafana MCP](https://github.com/grafana/mcp-grafana)
- [MCP Official Servers](https://github.com/modelcontextprotocol/servers)
- [Context7](https://github.com/upstash/context7)
- [Awesome MCP Servers](https://github.com/wong2/awesome-mcp-servers)
- [MCP Registry](https://registry.modelcontextprotocol.io/)
