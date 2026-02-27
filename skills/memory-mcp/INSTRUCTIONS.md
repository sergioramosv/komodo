# Memory MCP - Instrucciones para Agentes IA

Eres un agente que tiene acceso al MCP de Memoria. Este MCP te permite registrar, buscar y consultar patrones de error encontrados en reviews de código. Los patrones se guardan en un archivo JSON local y persisten entre sesiones.

## Tools Disponibles (5)

### Patrones

#### `record_pattern`
Registra un patrón de error o antipatrón. Si ya existe uno similar (por descripción), incrementa su frecuencia en vez de duplicar.

- **Input**: `{ type, description, tags?, severity, resolution?, taskId?, prNumber? }`
- **Output**: `{ action: "created"|"updated", pattern, message }`

Tipos de patrón:
- `error` - Error de código (falta error handling, null checks, etc.)
- `anti-pattern` - Patrón de diseño incorrecto
- `style` - Issue de estilo o convenciones
- `positive` - Buen patrón a reforzar

```
Ejemplo: Registrar un error de manejo de excepciones
→ record_pattern({
    type: "error",
    description: "No maneja errores después de fetch",
    tags: ["error-handling", "async"],
    severity: "high",
    resolution: "Siempre envolver fetch en try/catch con manejo explícito del error",
    taskId: "task-123",
    prNumber: 42
  })
```

#### `query_patterns`
Busca patrones con filtros combinados. Los resultados se devuelven ordenados por frecuencia descendente.

- **Input**: `{ type?, severity?, tags?, query?, limit? }`
- **Output**: `{ patterns[], total, totalInStore }`

```
Ejemplo: Buscar errores de alta severidad relacionados con async
→ query_patterns({
    type: "error",
    severity: "high",
    tags: ["async"]
  })
```

### Estadísticas y Briefing

#### `get_review_brief`
Devuelve un resumen formateado de los errores más frecuentes, listo para inyectar en el prompt del Reviewer.

- **Input**: `{ limit? }` (default: 10)
- **Output**: `{ brief, patterns[], patternsCount }`

El brief tiene este formato:
```
TOP ERRORES FRECUENTES (presta especial atención a estos):
1. [HIGH, x7] [error-handling, async] No maneja errores después de fetch → Siempre usar try/catch
2. [MEDIUM, x4] [validation] Sin validación de inputs → Añadir checks con Zod
3. [MEDIUM, x3] [testing] Tests solo cubren happy path → Añadir tests de error
```

#### `record_review_outcome`
Registra el resultado de una review completa.

- **Input**: `{ taskId, prNumber, outcome, cycles, issuesFound?, repo? }`
- **Output**: `{ recorded, message }`

`outcome`: `passed` (PR aprobada) o `failed` (rechazada/abandonada)
`cycles`: Número de rondas coder↔reviewer (1 = aprobada a la primera)

```
Ejemplo: Registrar una review que pasó en 3 ciclos
→ record_review_outcome({
    taskId: "task-123",
    prNumber: 42,
    outcome: "passed",
    cycles: 3,
    issuesFound: 5,
    repo: "user/repo"
  })
```

#### `get_stats`
Estadísticas completas del sistema de memoria.

- **Input**: `{}`
- **Output**: `{ reviews, patterns, topTags, recentOutcomes }`

Incluye:
- `reviews.totalReviews`, `reviews.passRate`, `reviews.avgCycles`
- `patterns.total`, `patterns.bySeverity`, `patterns.byType`
- `topTags` - Los tags más frecuentes
- `recentOutcomes` - Últimas 5 reviews

## Flujo Recomendado

### Para el Reviewer (antes de cada review):
```
1. get_review_brief          → Obtener brief de errores frecuentes
2. (leer el diff de la PR)
3. (hacer la review)
4. record_pattern            → Por cada issue encontrado
5. record_review_outcome     → Registrar resultado final
```

### Para consultas:
```
query_patterns  → Buscar patrones específicos
get_stats       → Ver estadísticas generales
```

## Almacenamiento

Los datos se guardan en `memory/patterns.json` en la raíz del proyecto Komodo. Este archivo:
- Se crea automáticamente si no existe
- Se escribe de forma atómica (tmp + rename) para evitar corrupción
- Está en `.gitignore` (cada instancia de Komodo tiene su propia memoria)

## Esquema de un Patrón

```json
{
  "id": "uuid-v4",
  "type": "error",
  "description": "No maneja errores después de fetch",
  "tags": ["error-handling", "async"],
  "severity": "high",
  "resolution": "Siempre envolver fetch en try/catch",
  "frequency": 5,
  "firstSeen": "2026-02-27",
  "lastSeen": "2026-03-01",
  "taskId": "task-123",
  "prNumber": 42
}
```
