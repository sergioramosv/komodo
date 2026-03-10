# Komodo - Orquestador de Agentes IA

Komodo coordina 3 agentes IA (Planner, Coder, Reviewer) para desarrollar software automaticamente desde un backlog de tareas.

## Proyecto Activo

El Project ID esta configurado en `.env` como `DEFAULT_PROJECT_ID`.
Si no se pasa `-p` al comando, Komodo usa ese default.

## Comandos

```bash
# 1 tarea (default)
node src/index.js run

# N tareas
node src/index.js run -t 3

# Todas las tareas (hasta vaciar backlog)
node src/index.js run -c

# Proyecto especifico por ID o nombre (override del default)
node src/index.js run -p <project-id-o-nombre>

# Directorio del repositorio target
node src/index.js run --cwd /path/to/repo

# Simulacion: ver que tarea elegiria sin ejecutar nada
node src/index.js run --dry-run
```

## Lenguaje Natural

Cuando el usuario pida ejecutar tareas de Komodo, mapea a los comandos:

| El usuario dice | Comando a ejecutar |
|---|---|
| "ejecuta 1 tarea" / "siguiente tarea" | `node src/index.js run` |
| "ejecuta N tareas" / "haz N tareas" | `node src/index.js run -t N` |
| "haz todas las tareas" / "vacia el backlog" | `node src/index.js run -c` |
| "simula" / "que tarea haria" / "dry run" | `node src/index.js run --dry-run` |
| "ve al proyecto X" / "proyecto X" | `node src/index.js run -p X` (busca por nombre si no es un ID) |

## Flujo de Ejecucion

1. **Planner** → elige la tarea de mayor prioridad del backlog
2. **Coder** → implementa: crea branch, escribe codigo, abre PR
3. **Reviewer** → revisa la PR estrictamente
4. Coder ↔ Reviewer repiten hasta APPROVED (max rondas configurables)
5. Merge PR + actualizar tarea a "done"

Si algo falla a mitad: Komodo cierra PRs huerfanas y devuelve la tarea a "to-do".

## CLIs soportados

Komodo puede usar diferentes CLIs de IA para cada agente:

| CLI | Comando | MCP Config | Notas |
|-----|---------|------------|-------|
| **Claude Code** | `claude` | `--mcp-config` (automatico) | Soporte completo. Recomendado. |
| **Codex** | `codex` | Config global (`~/.codex/config.toml`) | Necesita MCP servers configurados globalmente |
| **Gemini** | `gemini` | Config global (`settings.json`) | Necesita MCP servers configurados globalmente |

Configurar en `.env`:
```bash
CLI_PLANNER=claude   # claude | codex | gemini
CLI_CODER=claude
CLI_REVIEWER=claude
```

**Importante**: Solo Claude soporta `--mcp-config` para configurar MCP servers por invocacion. Codex y Gemini requieren que los MCP servers (planning-task-mcp, github-mcp) esten configurados globalmente en sus respectivos archivos de configuracion.

## Modo MCP (komodo-mcp)

Komodo funciona como servidor MCP. Esto permite usar el orquestador desde **cualquier cliente MCP** (Claude Code, Codex, etc.) sin necesidad del CLI.

### Tools disponibles

| Tool | Descripcion |
|------|-------------|
| `komodo_plan` | Planner elige la siguiente tarea del backlog |
| `komodo_code` | Coder implementa: branch, codigo, PR |
| `komodo_review` | Reviewer revisa la PR (8 criterios) |
| `komodo_fix` | Coder arregla issues del review |
| `komodo_finalize` | Merge/close PR + actualizar tarea |
| `komodo_run` | Ciclo completo de N tareas |
| `komodo_status` | Configuracion actual de Komodo |

### Flujo paso a paso (RECOMENDADO para visibilidad)

```
komodo_plan → komodo_code → komodo_review → (komodo_fix →) komodo_finalize
```

**Usa siempre el flujo paso a paso.** Entre cada tool, informa al usuario que paso y que viene. Esto da visibilidad sobre el progreso.

**🚨 ¡ADVERTENCIA CRÍTICA PARA EL LLM! 🚨**
**BAJO NINGÚN CONCEPTO** intentes saltarte el flujo usando herramientas como `list_tasks`, `get_task` o `change_task_status` del servidor `planning-task-mcp` directamente. Eres el orquestador y **DEBES** usar la tool `komodo_plan` de `komodo-mcp`. Si usas las tools de la base de datos directamente, las animaciones 3D del Dashboard y los WebSockets se romperán, arruinando la experiencia del usuario. El Planner interno es quien debe llamar a la base de datos.
**SIEMPRE LLAMA A `komodo_plan` PARA ELEGIR LA TAREA.**

`komodo_run` ejecuta todo de golpe, pero el usuario no ve progreso intermedio. Solo usar para ejecucion headless/automatica.

### Configuracion MCP

El setup wizard (`node src/setup.js`) registra komodo-mcp automaticamente. Tambien se puede configurar manualmente:

```json
{
  "mcpServers": {
    "komodo-mcp": {
      "command": "node",
      "args": ["<ruta-a-komodo>/skills/komodo-mcp/src/index.js"],
      "env": { "KOMODO_ROOT": "<ruta-a-komodo>" }
    }
  }
}
```

## Configuracion

Todo en `.env`. Para reconfigurar ejecuta: `node src/index.js setup`
