# Komodo MCP - Control del Orquestador desde Claude Code

## Que es Komodo MCP?

Komodo MCP es un servidor MCP que expone el orquestador Komodo como herramientas para Claude Code. En vez de ejecutar comandos en la terminal, puedes hablar con Claude Code y controlar los agentes (Planner, Coder, Reviewer) desde la conversacion.

**Dos interfaces, mismo motor:** Tanto el CLI (`komodo run`) como el MCP llaman a las mismas funciones internas. El MCP es una capa fina (~15 lineas por tool) que importa directamente de `src/agents/` y `src/cycle/`.

---

## Tools disponibles

### Acciones rapidas
| Tool | Que hace | Tiempo |
|------|----------|--------|
| `get_komodo_status` | Config actual y health check | Instantaneo |
| `run_dry_run` | Planner simula sin cambiar estado | 15-30s |

### Control individual de agentes
| Tool | Que hace | Tiempo |
|------|----------|--------|
| `plan_next_task` | Planner elige la siguiente tarea del backlog | 15-60s |
| `code_task` | Coder implementa una tarea y abre PR | 1-5min |
| `review_pr` | Reviewer revisa una PR | 30-90s |
| `fix_review_issues` | Coder arregla issues del review | 1-3min |

### Flujos automaticos
| Tool | Que hace | Tiempo |
|------|----------|--------|
| `run_review_loop` | Bucle Reviewer <-> Coder hasta aprobado | 2-10min |
| `run_full_cycle` | Ciclo completo: Planner -> Coder -> Review -> Merge | 3-15min |

---

## Workflows tipicos

### Ciclo completo automatico
```
Usuario: "Ejecuta el ciclo completo"
-> Claude Code llama a run_full_cycle
-> Planner elige tarea -> Coder implementa -> Reviewer revisa -> Merge
-> Claude Code muestra el resultado
```

### Paso a paso (recomendado para empezar)
```
1. "Que tarea es la siguiente?"     -> run_dry_run (preview sin cambios)
2. "Ok, elige esa tarea"            -> plan_next_task (marca in-progress)
3. "Implementala"                    -> code_task (crea branch + PR)
4. "Revisa la PR"                    -> run_review_loop (Reviewer + fixes)
```

### Solo review
```
"Revisa la PR #42 del repo owner/repo"  -> review_pr
```

---

## Mapeo lenguaje natural -> tool

| El usuario dice | Tool |
|----------------|------|
| "que tarea sigue" / "revisa el backlog" | `run_dry_run` |
| "elige la siguiente tarea" / "empieza una tarea" | `plan_next_task` |
| "implementa esta tarea" / "programa esto" | `code_task` |
| "revisa la PR" / "haz review" | `review_pr` |
| "arregla los issues" / "corrige lo del review" | `fix_review_issues` |
| "ejecuta el bucle de review" | `run_review_loop` |
| "ejecuta el ciclo completo" / "komodo run" | `run_full_cycle` |
| "que estado tiene komodo" / "esta bien configurado?" | `get_komodo_status` |

---

## Instalacion

### 1. Instalar dependencias
```bash
cd skills/komodo-mcp && npm install
```

### 2. Registrar en Claude Code

Añade a `~/.mcp.json`:
```json
{
  "mcpServers": {
    "komodo-mcp": {
      "command": "node",
      "args": ["C:/Users/Ramos/Documents/komodo/skills/komodo-mcp/src/index.js"]
    }
  }
}
```

O en VSCode, añade a `.vscode/mcp.json`:
```json
{
  "servers": {
    "komodo-mcp": {
      "command": "node",
      "args": ["C:/Users/Ramos/Documents/komodo/skills/komodo-mcp/src/index.js"]
    }
  }
}
```

### 3. Verificar
Abre Claude Code y pregunta: "que estado tiene komodo"

---

## Parametros importantes

### cwd
Las tools que ejecutan el Coder necesitan saber donde esta el repositorio:
- `code_task`
- `fix_review_issues`
- `run_review_loop`
- `run_full_cycle`

Si no se pasa, usa el directorio root de Komodo. Pregunta al usuario si trabaja en otro repo.

### projectId
Todas las tools aceptan `projectId` opcional. Si no se pasa, usan `DEFAULT_PROJECT_ID` del `.env`.

---

## Formato de respuesta

Todas las tools devuelven JSON estructurado:
```json
{
  "success": true,
  "task": { ... },
  "cost": 0.05,
  "duration": 23.4,
  "error": null,
  "nextStep": "Usa code_task con el taskSpec devuelto."
}
```

---

## Detalle tecnico: stdout vs MCP

MCP usa stdout para el protocolo stdio. El logger de Komodo (`src/utils/logger.js`) tambien escribe a stdout via `console.log`. Para evitar corrupcion del protocolo, `komodo-mcp/src/index.js` redirige `console.log` y `console.warn` a stderr como primera linea, ANTES de cualquier import:

```javascript
const _stderrWrite = process.stderr.write.bind(process.stderr);
console.log = (...args) => _stderrWrite(args.join(' ') + '\n');
console.warn = (...args) => _stderrWrite(args.join(' ') + '\n');
```

Esto hace que todo el logging existente funcione sin modificar `logger.js`.

---

## Error recovery

`run_full_cycle` tiene recovery automatico:
- Si el Coder falla -> la tarea vuelve a "to-do"
- Si el review loop falla -> la PR se cierra + tarea vuelve a "to-do"
- Si el merge falla -> se logea warning pero la tarea se actualiza
