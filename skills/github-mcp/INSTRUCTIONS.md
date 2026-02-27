# GitHub MCP - Instrucciones para Agentes IA

Eres un agente que tiene acceso al MCP de GitHub. Este MCP te permite gestionar branches, Pull Requests, reviews y merges en repositorios de GitHub usando el CLI `gh` internamente.

## Tools Disponibles (10)

### Branches

#### `create_branch`
Crea una nueva branch desde una branch base.
- **Input**: `{ repo, branchName, baseBranch?, cwd? }`
- **Output**: `{ branch, baseBranch, repo, method, message }`
- Si pasas `cwd` (directorio local), usa `git` directamente. Si no, crea la branch en remoto via API.

```
Ejemplo: Crear branch para una tarea
→ create_branch({ repo: "user/repo", branchName: "feature/task-123-login", baseBranch: "main" })
```

#### `list_branches`
Lista branches de un repositorio, con filtro opcional.
- **Input**: `{ repo, pattern? }`
- **Output**: `{ branches[], count, filter }`

### Pull Requests

#### `create_pr`
Abre un Pull Request.
- **Input**: `{ repo, title, body?, head, base? }`
- **Output**: `{ number, url, title, state, head, base }`
- `base` default: `main`

```
Ejemplo: Crear PR después de implementar
→ create_pr({ repo: "user/repo", title: "feat: añadir login", body: "## Cambios\n- ...", head: "feature/task-123-login" })
```

#### `get_pr`
Obtiene detalles completos de una PR.
- **Input**: `{ repo, prNumber }`
- **Output**: `{ number, url, title, body, state, author, headBranch, baseBranch, additions, deletions, changedFiles, reviewDecision }`

#### `get_pr_diff`
Obtiene el diff completo de una PR como texto.
- **Input**: `{ repo, prNumber }`
- **Output**: `{ diff, lines }`

#### `list_pr_files`
Lista archivos cambiados con estadísticas.
- **Input**: `{ repo, prNumber }`
- **Output**: `{ files[{filename, status, additions, deletions}], totalFiles, totalAdditions, totalDeletions }`

### Reviews

#### `create_review`
Envía una review formal a una PR.
- **Input**: `{ repo, prNumber, event, body, comments? }`
- `event`: `APPROVE`, `REQUEST_CHANGES` o `COMMENT`
- `comments` (opcional): Array de `{ path, line?, body }` para comentarios inline
- **Output**: `{ event, inlineComments, reviewId, message }`

```
Ejemplo: Pedir cambios con comentarios inline
→ create_review({
    repo: "user/repo",
    prNumber: 42,
    event: "REQUEST_CHANGES",
    body: "Hay 2 issues que corregir antes de aprobar",
    comments: [
      { path: "src/auth.js", line: 15, body: "Falta manejar el caso de token expirado" },
      { path: "src/auth.js", line: 32, body: "No validar input del usuario es un riesgo de seguridad" }
    ]
  })
```

#### `list_pr_comments`
Lista todas las reviews y comentarios inline de una PR.
- **Input**: `{ repo, prNumber }`
- **Output**: `{ reviews[], inlineComments[], totalReviews, totalInlineComments }`

### Merge

#### `merge_pr`
Mergea una PR aprobada.
- **Input**: `{ repo, prNumber, mergeMethod?, deleteBranch? }`
- `mergeMethod`: `merge`, `squash` (default) o `rebase`
- `deleteBranch`: default `true`
- **Output**: `{ mergeMethod, branchDeleted, message }`

#### `close_pr`
Cierra una PR sin mergear.
- **Input**: `{ repo, prNumber, comment? }`
- **Output**: `{ comment, message }`

## Flujo Recomendado

```
1. create_branch  → Crear branch de feature
2. (escribir código, commitear, push)
3. create_pr      → Abrir PR
4. get_pr_diff    → Leer diff para review
5. create_review  → Enviar review (APPROVE o REQUEST_CHANGES)
6. (si REQUEST_CHANGES: arreglar → push → volver a 4)
7. merge_pr       → Mergear cuando esté aprobada
```

## Requisitos

- **gh CLI** instalado y autenticado: `gh auth login`
- **git** instalado (para operaciones locales con `cwd`)

## Errores Comunes

- `GitHub CLI no autenticado`: Ejecutar `gh auth login`
- `Repositorio no encontrado`: Verificar formato `owner/repo`
- `Ya existe`: La branch o PR ya existe, usar otro nombre
- `merge_pr falla`: La PR no tiene reviews de aprobación
