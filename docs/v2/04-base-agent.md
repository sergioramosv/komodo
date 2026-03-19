# PARTE 4: AGENTE BASE E INFRAESTRUCTURA DE AGENTES

---

## 11. BASE AGENT (src/agents/base-agent.js)

Este es el archivo mas critico del sistema. Maneja la comunicacion con todos los CLIs de IA.

### 11.1 CLI Adapters

Cada CLI tiene su propio adapter con 3 funciones: `buildArgs`, `buildStdin`, `parseOutput`.

**Claude Code Adapter:**
- Args: `--output-format json`, `--mcp-config <path>`, `--model <model>`, `--max-turns <n>`, `--disallowed-tool <tool>` (uno por cada)
- Stdin: `{systemPrompt}\n\n---\n\n{userPrompt}`
- Parse: JSON lines, buscar `type: "result"`, extraer `result`, `cost_usd`, `num_turns`

**Codex CLI Adapter:**
- Args: `exec`, `--json`, `--full-auto`, `-m <model>`, `--mcp-config <path>`
- Stdin: mismo formato
- Parse: JSON lines con `type: "message"` o campo `response`

**Gemini CLI Adapter:**
- Args: `--output-format json`, `--yolo`, `-m <model>`
- Stdin: mismo formato
- Parse: JSON lines con campo `result` o `response`

### 11.2 buildMcpServers(serverNames)

Construye definiciones de MCP servers para inyectar en el CLI:

```javascript
// Servers disponibles:
// 'planning-task-mcp' → node + skillsDir path + Firebase env vars
// 'github-mcp' → node + skillsDir path + GITHUB_TOKEN
// 'memory-mcp' → node + skillsDir path + KOMODO_ROOT
// 'chrome-devtools' → npx @anthropic-ai/chrome-devtools-mcp@latest (si enabled)
```

Genera JSON temporal en os.tmpdir() que se pasa como `--mcp-config`.

### 11.3 spawnCli(command, args, options)

Spawn de subproceso con gestion de timeouts:

**Parametros:**
- `command` (string) - CLI ejecutable
- `args` (string[]) - Argumentos
- `options.stdinData` (string) - Datos a enviar por stdin
- `options.idleTimeout` (number) - Ms sin output → kill (default 180000)
- `options.totalTimeout` (number|null) - Ms totales → kill (null = solo idle)
- `options.signal` (AbortSignal) - Cancelacion externa
- `options.onStdoutLine` (function) - Callback por linea stdout
- `options.onStderrLine` (function) - Callback por linea stderr

**Comportamiento:**
- `shell: true` para Windows .cmd file resolution
- Idle timeout: se resetea con cada chunk de output (bueno para Planner/Reviewer)
- Total timeout: limite duro que no se resetea (bueno para Coder en Windows por buffering de stdout)
- Si ambos configurados, total timeout toma precedencia
- AbortSignal: permite cancelacion desde pipeline-scheduler
- Cleanup: timers limpiados en close/error

### 11.4 runAgent(options) - Funcion principal

**Parametros:**
```javascript
{
  name,              // 'PLANNER', 'CODER', 'REVIEWER', etc.
  cli,               // 'claude', 'codex', 'gemini'
  systemPrompt,      // String completo
  userPrompt,        // String completo
  mcpServerNames,    // ['planning-task-mcp', 'github-mcp', ...]
  model,             // 'sonnet', 'opus', 'haiku', etc.
  maxTurns,          // Max conversation turns (default 30)
  idleTimeout,       // Ms idle timeout (default 180000)
  totalTimeout,      // Ms total timeout (null = use idle)
  disallowedTools,   // ['Write', 'Edit', ...] tools bloqueados
  signal,            // AbortSignal para cancelacion
}
```

**Flujo:**
1. **Resolve CLI**: `fallbackManager.resolveEffectiveCli(cli, name)` - si rate-limited, usa fallback
2. **Get adapter**: Seleccionar adapter segun CLI efectivo
3. **Build MCP config**: Generar archivo JSON temporal con servers MCP
4. **Build args**: Construir argumentos via adapter
5. **Build stdin**: Construir payload stdin via adapter
6. **Create watchdog**: `new StreamingWatchdog(name, { reviewerMode })` para deteccion de anomalias
7. **Spawn process**: `spawnCli()` con callbacks:
   - `onStdoutLine`: Feed watchdog, emit agent:output event, write debug file
   - `onStderrLine`: Check rate limit, write debug file
8. **Parse output**: Extraer JSON via adapter
9. **Check rate limit**: Detectar en resultado y stderr
10. **Return**: `{ success, result, cost, turns, duration, earlyTerminated, rateLimited, error }`
11. **Cleanup**: Borrar archivo MCP config temporal

**Return value:**
```javascript
{
  success: boolean,        // true si completo sin errores
  result: string | null,   // Texto/JSON del agente
  cost: number,            // Costo en USD
  turns: number,           // Turnos de conversacion
  duration: number,        // Ms totales
  earlyTerminated: boolean,// Watchdog termino temprano
  terminationReason: string | null, // Razon de terminacion
  rateLimited: boolean,    // Rate limit detectado
  error: string | null,    // Mensaje de error
}
```

### 11.5 Debug files

Cada invocacion escribe archivos de debug en rootDir:
- `_debug_PLANNER_stdout.txt`
- `_debug_PLANNER_stderr.txt`
- `_debug_CODER_stdout.txt`
- etc.

Utiles para diagnostico cuando el parsing JSON falla.

---

## 12. FALLBACK MANAGER (src/agents/fallback-manager.js)

### 12.1 Proposito

Cuando un CLI esta rate-limited, el fallback manager redirige al siguiente CLI disponible.

### 12.2 Clase FallbackManager (singleton)

```javascript
class FallbackManager {
  #rateLimitedMap = new Map(); // cli → timestamp

  isEnabled() { return config.rateLimitFallback; }

  markRateLimited(cli) {
    this.#rateLimitedMap.set(cli, Date.now());
  }

  isRateLimited(cli) {
    const timestamp = this.#rateLimitedMap.get(cli);
    if (!timestamp) return false;
    // TTL-based cleanup
    const cooldownMs = config.rateLimitCooldownMinutes * 60 * 1000;
    if (Date.now() - timestamp > cooldownMs) {
      this.#rateLimitedMap.delete(cli);
      return false;
    }
    return true;
  }

  getAvailableFallbackCli(failedCli) {
    for (const cli of config.fallbackCliOrder) {
      if (cli === failedCli) continue;
      if (this.isRateLimited(cli)) continue;
      if (!cliExists(cli)) continue;
      return cli;
    }
    return null; // All CLIs rate-limited
  }

  resolveEffectiveCli(originalCli, agentRole) {
    if (!this.isEnabled()) return { cli: originalCli, isFallback: false };
    if (!this.isRateLimited(originalCli)) return { cli: originalCli, isFallback: false };

    const fallback = this.getAvailableFallbackCli(originalCli);
    if (fallback) {
      eventBus.emitEvent('AGENT_FALLBACK', { agent: agentRole, from: originalCli, to: fallback });
      return { cli: fallback, isFallback: true };
    }

    // All rate-limited, use original anyway
    return { cli: originalCli, isFallback: false };
  }

  markRecovered(cli) { this.#rateLimitedMap.delete(cli); }
  clear() { this.#rateLimitedMap.clear(); }
  getRateLimitedClis() { /* auto-clean expired, return array */ }
}

export const fallbackManager = new FallbackManager();
```

---

## 13. RATE LIMIT DETECTOR (src/agents/rate-limit-detector.js)

### 13.1 Patrones por CLI

**Claude:**
```javascript
const CLAUDE_PATTERNS = [
  /rate.?limit/i,
  /too many requests/i,
  /429/,
  /usage.?limit/i,
  /quota.?exceeded/i,
  /overloaded/i,
  /at capacity/i,
  /hit your.*limit/i,
  /resets?\s+\d{1,2}[ap]m/i,
];
```

**Codex:**
```javascript
const CODEX_PATTERNS = [
  /rate_limit_exceeded/i,
  /tokens?.?per.?min/i,
  /requests?.?per.?min/i,
  ...CLAUDE_PATTERNS, // shared patterns
];
```

**Gemini:**
```javascript
const GEMINI_PATTERNS = [
  /resource_exhausted/i,
  /RESOURCE_EXHAUSTED/,
  ...CLAUDE_PATTERNS,
];
```

### 13.2 detectRateLimit(text, cli)

```javascript
export function detectRateLimit(text, cli) {
  const patterns = CLI_PATTERNS[cli] || CLAUDE_PATTERNS;
  for (const pattern of patterns) {
    if (pattern.test(text)) {
      return { detected: true, matchedPattern: pattern.source };
    }
  }
  return { detected: false, matchedPattern: null };
}
```

### 13.3 parseRetryAfter(text)

Extrae duracion de retry-after de 7 formatos diferentes:

```javascript
export function parseRetryAfter(text) {
  // "retry after 2m30s" → compound
  // "retry after 22s" → seconds
  // "Retry-After: 120" → HTTP header
  // "try again in 45 seconds"
  // "wait 60s before"
  // "retry in 5 minutes"
  // "resets 8pm" → calculate seconds until next occurrence
  // Returns: seconds (number) or null
}
```

### 13.4 checkAndEmitRateLimit(text, cli, agentName)

Punto de integracion principal - llamado desde base-agent:

```javascript
export function checkAndEmitRateLimit(text, cli, agentName) {
  const { detected, matchedPattern } = detectRateLimit(text, cli);
  if (!detected) return false;

  const retryAfterSeconds = parseRetryAfter(text);
  fallbackManager.markRateLimited(cli);

  eventBus.emitEvent('RATE_LIMIT_DETECTED', {
    cli, agentName, matchedPattern, retryAfterSeconds
  });

  checkAllClisRateLimited();
  return true;
}
```

### 13.5 checkAllClisRateLimited()

```javascript
export function checkAllClisRateLimited() {
  const usedClis = new Set([config.cliPlanner, config.cliCoder, config.cliReviewer]);
  const allLimited = [...usedClis].every(cli => fallbackManager.isRateLimited(cli));
  if (allLimited) {
    eventBus.emitEvent('ALL_CLIS_RATE_LIMITED', {});
    logger.warn('All CLIs rate-limited. Komodo on standby.');
  }
}
```

---

## 14. STREAMING WATCHDOG (src/agents/streaming-watchdog.js)

### 14.1 Proposito

Monitorea el stream de output de agentes en tiempo real para detectar 7 tipos de anomalias y terminar tempranamente.

### 14.2 Clase StreamingWatchdog

```javascript
export class StreamingWatchdog {
  constructor(agentName, options = {}) {
    this.agentName = agentName;
    this.reviewerMode = options.reviewerMode || false;
    this._terminated = false;
    this._terminationReason = null;
    this._killCallback = null;

    // Counters
    this.totalTokensEstimate = 0;
    this.lastToolName = null;
    this.consecutiveSameToolCount = 0;
    this.consecutiveToolsWithoutText = 0;
    this.tokensSinceLastCodeBlock = 0;
    this.tokensSinceLastToolCall = 0;
  }
```

### 14.3 Detectores de anomalias

**1. Reviewer Early Approval (solo reviewerMode):**
- En los primeros 3K chars, buscar patron `"verdict":"APPROVED"` o `"verdict": "APPROVED"`
- Si encontrado: kill, emit REVIEWER_EARLY_APPROVED
- Ahorra ~20% tokens en reviews rapidas

**2. Tool Loop (5+ misma tool consecutiva):**
- Track `lastToolName` y `consecutiveSameToolCount`
- Si mismo tool 5+ veces → kill (loop infinito)

**3. Excessive Tool Calls (20+ sin texto):**
- Track `consecutiveToolsWithoutText`
- Si 20+ tool calls sin texto entre ellas → kill

**4. Watchdog Alert (8K+ tokens sin tool call):**
- Track `tokensSinceLastToolCall`
- Si > 8K tokens sin herramienta → alerta (NO kill)
- Reset counter para evitar spam

**5. No Access Detector:**
- Buscar frases: "cannot access", "don't have access", "i don't have access"
- Si encontrado → kill

**6. Wandering Detector (5K+ tokens sin code block):**
- Track `tokensSinceLastCodeBlock`
- Si > 5K tokens de texto sin bloque de codigo → kill (divagando)

**7. Wrong Language Detector:**
- Marcadores espanol: "tambien", "ademas", "segun", etc.
- Marcadores ingles: "i will", "let me", "we need", etc.
- Si 2+ marcadores del idioma incorrecto → kill

### 14.4 feed(msg, rawAccumulatedOutput)

```javascript
feed(msg, rawAccumulatedOutput) {
  if (this._terminated) return;

  // Estimate tokens (~4 chars per token)
  const text = JSON.stringify(msg);
  const tokens = Math.ceil(text.length / 4);
  this.totalTokensEstimate += tokens;

  // 1. Reviewer early approval check
  if (this.reviewerMode && this.totalTokensEstimate < 750) { // ~3K chars
    if (/"verdict"\s*:\s*"APPROVED"/i.test(text)) {
      this._kill('REVIEWER_EARLY_APPROVED', 'Reviewer approved in first 3K chars');
      return;
    }
  }

  // 2-7. Other detectors...
  // (check each anomaly type and kill if threshold exceeded)
}
```

### 14.5 _kill(reason, description)

```javascript
_kill(reason, description) {
  this._terminated = true;
  this._terminationReason = reason;
  this.tokensSavedEstimate = Math.ceil(this.totalTokensEstimate * 0.2);

  logger.warn(`[WATCHDOG:${this.agentName}] ${reason}: ${description}`);

  eventBus.emitEvent('EARLY_TERMINATION', {
    agentName: this.agentName, reason, description
  });
  eventBus.emitEvent('ANOMALY_DETECTED', {
    agentName: this.agentName, type: reason
  });

  // Execute kill callback (terminates subprocess)
  this._killCallback?.();
}
```

---

## 15. MULTI-PART FILTER (src/agents/multi-part-filter.js)

Detecta tareas multi-parte como "(2/4)" y bloquea partes posteriores si anteriores no estan completadas.

```javascript
export function getUnresolvedPreviousParts(task, allTasks) {
  // Patterns: "(2/4)", "(Part 2 of 4)", "[2/4]", "(2 of 4)"
  const patterns = [
    /\((\d+)\/(\d+)\)/,
    /\(Part\s+(\d+)\s+of\s+(\d+)\)/i,
    /\[(\d+)\/(\d+)\]/,
    /\((\d+)\s+of\s+(\d+)\)/i,
  ];

  for (const pattern of patterns) {
    const match = task.title.match(pattern);
    if (!match) continue;

    const currentPart = parseInt(match[1]);
    const totalParts = parseInt(match[2]);
    if (currentPart <= 1) return []; // Part 1 never blocked

    const baseTitle = task.title.replace(pattern, '').trim();
    const unresolved = [];

    for (let i = 1; i < currentPart; i++) {
      const prevTask = allTasks.find(t => {
        const prevMatch = t.title.match(pattern);
        if (!prevMatch) return false;
        const prevBase = t.title.replace(pattern, '').trim();
        return prevBase === baseTitle && parseInt(prevMatch[1]) === i;
      });

      if (!prevTask || prevTask.status !== 'done') {
        unresolved.push(prevTask?.id || `part-${i}-of-${baseTitle}`);
      }
    }

    return unresolved;
  }

  return [];
}
```
