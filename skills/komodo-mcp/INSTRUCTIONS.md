# Komodo MCP — Instrucciones de uso

Este MCP expone el orquestador Komodo como herramientas MCP. Permite ejecutar los agentes (Planner, Coder, Reviewer) desde cualquier cliente MCP compatible (Claude Code, Codex, etc.).

## Flujo recomendado: paso a paso

Siempre ejecuta los pasos **uno a uno**, informando al usuario entre cada paso:

### 1. `komodo_plan` — Elegir tarea

```
komodo_plan({ projectId: "..." })
```

Devuelve la tarea de mayor prioridad. **Informa al usuario**:
- Qué tarea se seleccionó (título, puntos, branch)
- Pregunta si quiere continuar con la implementación

### 2. `komodo_code` — Implementar

```
komodo_code({
  taskId: "...",
  title: "...",
  branchName: "...",
  repoUrl: "...",
  userStoryWho: "...",
  userStoryWhat: "...",
  userStoryWhy: "...",
  acceptanceCriteria: ["..."],
  cwd: "/path/to/target/repo"    // IMPORTANTE: directorio del repo target
})
```

Usa los datos devueltos por `komodo_plan`. **Informa al usuario**:
- Qué PR se creó (número, URL, archivos cambiados)
- Pregunta si quiere lanzar la review

### 3. `komodo_review` — Revisar PR

```
komodo_review({
  prNumber: 42,
  repo: "owner/repo",
  taskTitle: "...",
  acceptanceCriteria: ["..."],
  cwd: "/path/to/target/repo"
})
```

**Informa al usuario**:
- Veredicto (APPROVED / REQUEST_CHANGES)
- Score y issues encontrados
- Si aprobada: siguiente paso es `komodo_finalize`
- Si con cambios: siguiente paso es `komodo_fix`

### 4. `komodo_fix` (si hay issues) — Arreglar

```
komodo_fix({
  taskId: "...",
  title: "...",
  branchName: "...",
  repoUrl: "...",
  prNumber: 42,
  reviewSummary: "...",
  reviewIssues: ["issue1", "issue2"],
  cwd: "/path/to/target/repo"
})
```

Después de fix, vuelve al paso 3 (`komodo_review`).

### 5. `komodo_finalize` — Merge + cerrar

```
komodo_finalize({
  taskId: "...",
  prNumber: 42,
  repo: "owner/repo",
  approved: true
})
```

## Reglas importantes

1. **NUNCA uses `komodo_run` sin preguntar** — El usuario prefiere el flujo paso a paso
2. **Informa entre cada paso** — Muestra qué ocurrió y qué viene después
3. **El parámetro `cwd`** es el directorio del repositorio TARGET (donde se escribe código), NO el directorio de Komodo
4. **Si hay error**, muestra el error completo y pregunta cómo proceder
5. **El `repo`** siempre en formato `owner/repo` (ej: `SergioRVDev/my-app`)

## Tool: `komodo_status`

Para ver la configuración actual sin ejecutar nada:

```
komodo_status({})
```

Muestra: CLIs configurados, proyecto, auto-merge, max review cycles, validación de config.

## Tool: `komodo_run`

Ejecuta el ciclo completo automático. **Solo usar si el usuario lo pide explícitamente.**

```
komodo_run({ tasks: 3, cwd: "/path/to/repo" })        // 3 tareas
komodo_run({ tasks: 0 })                                // Todas hasta vaciar
komodo_run({ dryRun: true })                             // Solo simular
```
