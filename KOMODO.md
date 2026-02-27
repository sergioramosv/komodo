# Komodo - Orquestador de Agentes IA

Komodo coordina 3 agentes IA (Planner, Coder, Reviewer) para desarrollar software automaticamente desde un backlog de tareas.

Hay **dos formas** de usar Komodo: por comandos (CLI) o por chat (MCP en Claude Code).

---

## Modo 1: Comandos (CLI)

Ejecuta Komodo desde la terminal como proceso batch.

```bash
# 1 tarea (default)
komodo run

# N tareas
komodo run -t 3

# Todas las tareas (hasta vaciar backlog)
komodo run -c

# Proyecto especifico (override del default)
komodo run -p <project-id>

# Directorio del repositorio target
komodo run --cwd /path/to/repo

# Simulacion: ver que tarea elegiria sin ejecutar nada
komodo run --dry-run
```

### Lenguaje Natural (slash command)

| El usuario dice | Comando |
|---|---|
| "ejecuta 1 tarea" / "siguiente tarea" | `komodo run` |
| "ejecuta N tareas" / "haz N tareas" | `komodo run -t N` |
| "haz todas las tareas" / "vacia el backlog" | `komodo run -c` |
| "simula" / "que tarea haria" / "dry run" | `komodo run --dry-run` |

---

## Modo 2: Chat (MCP en Claude Code)

Registra `komodo-mcp` como MCP server en Claude Code y controla Komodo conversando.

### Tools disponibles

| Tool | Que hace | Tiempo |
|------|----------|--------|
| `get_komodo_status` | Config y health check | Instantaneo |
| `run_dry_run` | Planner simula sin cambiar estado | 15-30s |
| `plan_next_task` | Planner elige tarea, la marca in-progress | 15-60s |
| `code_task` | Coder implementa y abre PR | 1-5min |
| `review_pr` | Reviewer revisa PR | 30-90s |
| `fix_review_issues` | Coder arregla issues del review | 1-3min |
| `run_review_loop` | Bucle Reviewer-Coder hasta aprobado | 2-10min |
| `run_full_cycle` | Ciclo completo automatico | 3-15min |

### Lenguaje Natural (chat)

| El usuario dice | Tool que se llama |
|---|---|
| "que tarea sigue" / "revisa el backlog" | `run_dry_run` |
| "elige la siguiente tarea" | `plan_next_task` |
| "implementa esta tarea" | `code_task` |
| "revisa la PR" | `review_pr` |
| "arregla los issues" | `fix_review_issues` |
| "ejecuta el ciclo completo" | `run_full_cycle` |
| "que estado tiene komodo" | `get_komodo_status` |

### Como registrar el MCP

Añade a `~/.mcp.json` o `.vscode/mcp.json`:

```json
{
  "mcpServers": {
    "komodo-mcp": {
      "command": "node",
      "args": ["<ruta>/komodo/skills/komodo-mcp/src/index.js"]
    }
  }
}
```

---

## Flujo de Ejecucion

Ambos modos ejecutan el mismo flujo:

1. **Planner** → elige la tarea de mayor prioridad del backlog
2. **Coder** → implementa: crea branch, escribe codigo, abre PR
3. **Reviewer** → revisa la PR estrictamente
4. Coder ↔ Reviewer repiten hasta APPROVED (max rondas configurables)
5. Merge PR + actualizar tarea a "done"

Si algo falla a mitad: Komodo cierra PRs huerfanas y devuelve la tarea a "to-do".

## Configuracion

Todo en `.env`. Para reconfigurar ejecuta: `komodo setup`
