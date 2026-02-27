# Komodo - Orquestador de Agentes IA

Komodo coordina 3 agentes IA (Planner, Coder, Reviewer) para desarrollar software automáticamente desde un backlog de tareas.

## Proyecto Activo

El Project ID está configurado en `.env` como `DEFAULT_PROJECT_ID`.
Si no se pasa `-p` al comando, Komodo usa ese default.

## Comandos

```bash
# 1 tarea (default)
node src/index.js run

# N tareas
node src/index.js run -t 3

# Todas las tareas (hasta vaciar backlog)
node src/index.js run -c

# Proyecto específico (override del default)
node src/index.js run -p <project-id>

# Directorio del repositorio target
node src/index.js run --cwd /path/to/repo

# Simulación: ver qué tarea elegiría sin ejecutar nada
node src/index.js run --dry-run
```

## Lenguaje Natural

Cuando el usuario pida ejecutar tareas de Komodo, mapea a los comandos:

| El usuario dice | Comando a ejecutar |
|---|---|
| "ejecuta 1 tarea" / "siguiente tarea" | `node src/index.js run` |
| "ejecuta N tareas" / "haz N tareas" | `node src/index.js run -t N` |
| "haz todas las tareas" / "vacía el backlog" | `node src/index.js run -c` |
| "simula" / "qué tarea haría" / "dry run" | `node src/index.js run --dry-run` |

## Flujo de Ejecución

1. **Planner** → elige la tarea de mayor prioridad del backlog
2. **Coder** → implementa: crea branch, escribe código, abre PR
3. **Reviewer** → revisa la PR estrictamente
4. Coder ↔ Reviewer repiten hasta APPROVED (máx rondas configurables)
5. Merge PR + actualizar tarea a "done"

Si algo falla a mitad: Komodo cierra PRs huérfanas y devuelve la tarea a "to-do".

## Configuración

Todo en `.env`. Para reconfigurar ejecuta: `node src/index.js setup`
