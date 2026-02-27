# Komodo MCP - Control del Orquestador desde Claude Code

## Que es Komodo?

Komodo es un orquestador de agentes IA que coordina 3 agentes (Planner, Coder, Reviewer) para desarrollar software de forma autonoma. Este MCP te permite controlar Komodo desde Claude Code.

## Tools disponibles

### Acciones rapidas
- **get_komodo_status** - Config y health check (instantaneo)
- **run_dry_run** - Planner simula sin cambiar estado (15-30s)

### Control individual de agentes
- **plan_next_task** - Planner elige la siguiente tarea del backlog (15-60s)
- **code_task** - Coder implementa una tarea y abre PR (1-5min)
- **review_pr** - Reviewer revisa una PR (30-90s)
- **fix_review_issues** - Coder arregla issues del review (1-3min)

### Flujos automaticos
- **run_review_loop** - Bucle Reviewer <-> Coder hasta aprobado (2-10min)
- **run_full_cycle** - Ciclo completo: Planner -> Coder -> Review -> Merge (3-15min)

## Workflows tipicos

### Ciclo completo automatico
Usuario: "Ejecuta el ciclo completo"
-> Llama a run_full_cycle con projectId y cwd

### Paso a paso
1. "Que tarea es la siguiente?" -> run_dry_run (preview sin cambios)
2. "Ok, elige esa tarea" -> plan_next_task (marca in-progress)
3. "Implementala" -> code_task con el taskSpec devuelto
4. "Revisa la PR" -> run_review_loop con prNumber, repo, y taskSpec

### Solo review
"Revisa la PR #42 del repo owner/repo" -> review_pr con prNumber y repo

## Mapeo lenguaje natural -> tool

| El usuario dice | Tool a llamar |
|----------------|---------------|
| "que tarea sigue" / "revisa el backlog" | run_dry_run |
| "elige la siguiente tarea" / "empieza una tarea" | plan_next_task |
| "implementa esta tarea" / "programa esto" | code_task |
| "revisa la PR" / "haz review" | review_pr |
| "arregla los issues" / "corrige lo del review" | fix_review_issues |
| "ejecuta el bucle de review" | run_review_loop |
| "ejecuta el ciclo completo" / "komodo run" | run_full_cycle |
| "que estado tiene komodo" / "esta bien configurado?" | get_komodo_status |

## Notas importantes

### Parametro cwd
Las tools que ejecutan el Coder (code_task, fix_review_issues, run_review_loop, run_full_cycle) necesitan saber el directorio del repositorio donde escribir codigo. Pregunta al usuario si no esta claro.

### Tiempos de ejecucion
Estas tools lanzan agentes IA como subprocesos y tardan entre 15 segundos y 15 minutos. Esto es normal. La tool devolvera el resultado cuando el agente termine.

### Formato de resultado
Todas las tools devuelven JSON con:
- success: si la operacion fue exitosa
- El resultado principal (task, pr, review, etc.)
- cost: coste en USD (si disponible)
- duration: segundos que tardo
- error: mensaje de error si fallo
- nextStep: sugerencia de que hacer a continuacion

### Error recovery
run_full_cycle tiene recovery automatico:
- Si el Coder falla -> la tarea vuelve a "to-do"
- Si el review loop falla -> la PR se cierra y la tarea vuelve a "to-do"
