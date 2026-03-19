# PARTE 7: SUBSISTEMAS CORE (Estado, Eventos, Servidores, Autonomia, Resiliencia)

---

## 27. KOMODO STATE (src/state/komodo-state.js)

Singleton que mantiene el estado global del orquestador.

```javascript
class KomodoState {
  constructor() {
    this.agents = {
      PLANNER:  { name: 'PLANNER',  status: 'idle', currentTask: null, startedAt: null, cli: null, model: null, totalCost: 0, completedTasks: 0 },
      ARCHITECT:{ name: 'ARCHITECT', status: 'idle', currentTask: null, startedAt: null, cli: null, model: null, totalCost: 0, completedTasks: 0 },
      CODER:    { name: 'CODER',    status: 'idle', currentTask: null, startedAt: null, cli: null, model: null, totalCost: 0, completedTasks: 0 },
      TESTER:   { name: 'TESTER',   status: 'idle', currentTask: null, startedAt: null, cli: null, model: null, totalCost: 0, completedTasks: 0 },
      SECURITY: { name: 'SECURITY', status: 'idle', currentTask: null, startedAt: null, cli: null, model: null, totalCost: 0, completedTasks: 0 },
      REVIEWER: { name: 'REVIEWER', status: 'idle', currentTask: null, startedAt: null, cli: null, model: null, totalCost: 0, completedTasks: 0 },
    };
    this.phase = 'idle';          // idle|planning|architecting|coding|testing|security|analyzing|reviewing|merging
    this.executionState = 'stopped'; // stopped|running|paused|daemon:idle|daemon:running|scheduler:waiting|budget:paused|awaiting-approval
    this.currentTask = null;
    this.taskDetails = null;
    this.currentPR = null;
    this.reviewCycle = 0;
    this.totalCost = 0;
    this.tasksCompleted = 0;
    this.totalTasks = 0;
    this.sonarAnalysis = { status: 'idle', qualityGate: null, issues: null };
    this.budget = { dailySpent: 0, weeklySpent: 0, dailyBudget: 0, weeklyBudget: 0, paused: false };
    this.multiProject = null;
    this.lastCompletedTaskContext = null;
    this._pauseRequested = false;
    this._stopRequested = false;
  }

  // Setters that emit events
  setPhase(phase) { this.phase = phase; eventBus.emitEvent('PHASE_CHANGED', { phase }); }
  setExecutionState(state) { this.executionState = state; eventBus.emitEvent('EXECUTION_STATE_CHANGED', { state }); }
  setAgentState(name, status) { this.agents[name].status = status; eventBus.emitEvent('AGENT_STATE_CHANGE', { agentName: name, newState: status }); }
  setCurrentTask(title) { this.currentTask = title; }
  setCurrentPR(pr) { this.currentPR = pr; }
  setReviewCycle(n) { this.reviewCycle = n; }
  incrementTasksCompleted() { this.tasksCompleted++; }
  addCost(amount) { this.totalCost += amount; }

  // Getters
  isPauseRequested() { return this._pauseRequested; }
  isStopRequested() { return this._stopRequested; }
  requestPause() { this._pauseRequested = true; }
  requestStop() { this._stopRequested = true; }

  // Snapshot for WebSocket
  toSnapshot() {
    return {
      agents: this.agents,
      phase: this.phase,
      executionState: this.executionState,
      currentTask: this.currentTask,
      taskDetails: this.taskDetails,
      currentPR: this.currentPR,
      reviewCycle: this.reviewCycle,
      totalCost: this.totalCost,
      tasksCompleted: this.tasksCompleted,
      totalTasks: this.totalTasks,
      sonarAnalysis: this.sonarAnalysis,
      budget: this.budget,
      multiProject: this.multiProject,
    };
  }

  reset() {
    Object.values(this.agents).forEach(a => { a.status = 'idle'; a.currentTask = null; });
    this.phase = 'idle';
    this.currentTask = null;
    this.currentPR = null;
    this.reviewCycle = 0;
    this._pauseRequested = false;
    this._stopRequested = false;
  }
}

export const komodoState = new KomodoState();
```

---

## 28. CHECKPOINT MANAGER (src/state/checkpoint-manager.js)

```javascript
class CheckpointManager {
  constructor() {
    this.dir = path.join(config.rootDir, '.komodo', 'checkpoints');
  }

  saveCheckpoint(data) {
    // data: { taskSpec, flowStep, prNumber, branchName, sonarReport, reviewCycle, reviewIssues, cwd }
    const filename = `checkpoint-${Date.now()}.json`;
    const filepath = path.join(this.dir, filename);
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(filepath, JSON.stringify({ ...data, savedAt: new Date().toISOString() }, null, 2));
    return filepath;
  }

  listPendingCheckpoints() {
    if (!fs.existsSync(this.dir)) return [];
    return fs.readdirSync(this.dir)
      .filter(f => f.endsWith('.json'))
      .map(f => ({ filename: f, filepath: path.join(this.dir, f) }))
      .sort((a, b) => b.filename.localeCompare(a.filename)); // newest first
  }

  loadCheckpoint(filepath) {
    return JSON.parse(fs.readFileSync(filepath, 'utf-8'));
  }

  validateCheckpoint(checkpoint) {
    if (!checkpoint.taskSpec?.taskId) return false;
    if (!checkpoint.flowStep) return false;
    // Expire after 24 hours
    const savedAt = new Date(checkpoint.savedAt);
    if (Date.now() - savedAt.getTime() > 24 * 60 * 60 * 1000) return false;
    return true;
  }

  deleteCheckpoint(filepath) {
    if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
  }
}

export const checkpointManager = new CheckpointManager();
```

---

## 29. EVENT BUS (src/events/event-bus.js)

```javascript
class EventBus {
  constructor() {
    this.listeners = new Map(); // type → Set<callback>
  }

  on(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(callback);
    return () => this.listeners.get(type)?.delete(callback); // unsubscribe
  }

  emitEvent(type, metadata = {}) {
    const event = {
      type,
      timestamp: new Date().toISOString(),
      metadata,
    };

    // Notify specific listeners
    this.listeners.get(type)?.forEach(cb => {
      try { cb(event); } catch (e) { /* swallow */ }
    });

    // Notify wildcard listeners
    this.listeners.get('*')?.forEach(cb => {
      try { cb(event); } catch (e) { /* swallow */ }
    });
  }
}

export const eventBus = new EventBus();
```

**Tipos de eventos principales:**
- TASK_STARTED, TASK_COMPLETED
- AGENT_STATE_CHANGE, agent:output
- REVIEW_CYCLE_START, REVIEW_CYCLE_END, REVIEW_DEPTH_SELECTED
- PR_CREATED, PR_MERGED
- COST_UPDATED, BUDGET_UPDATED, BUDGET_WARNING, BUDGET_EXCEEDED
- RATE_LIMIT_DETECTED, ALL_CLIS_RATE_LIMITED, CLI_RECOVERED, AGENT_FALLBACK
- TASK_CLASSIFIED, TASK_DECOMPOSED, MODEL_SELECTED, MODEL_ESCALATED
- EARLY_TERMINATION, ANOMALY_DETECTED
- PHASE_CHANGED, EXECUTION_STATE_CHANGED
- SECURITY_SCAN_COMPLETE, SECURITY_SCAN_BLOCKED
- QA_TESTS_GENERATED, TESTER_TESTS_GENERATED
- SONAR_ANALYSIS_COMPLETE
- CI_MONITOR_START, CI_RESULTS_RECEIVED
- SESSION_CHECKPOINTED, SESSION_AUTO_RESUMED
- DAEMON_STARTED, DAEMON_IDLE, DAEMON_TASK_DETECTED, DAEMON_STOPPED

---

## 30. EVENT PERSISTENCE (src/events/event-persistence.js)

Opcionalmente persiste eventos en Firebase para analytics:

```javascript
export class EventPersistence {
  constructor(projectId) {
    this.projectId = projectId;
    this.retentionDays = 30;
  }

  async persistEvent(event) {
    const db = getDb();
    await db.ref(`events/${this.projectId}`).push({
      ...event,
      persistedAt: Date.now(),
    });
  }

  async cleanup() {
    // Delete events older than retentionDays
    const cutoff = Date.now() - this.retentionDays * 24 * 60 * 60 * 1000;
    // Query and delete old events
  }
}
```

---

## 31. WEBSOCKET SERVER (src/server/ws-server.js)

```javascript
import { WebSocketServer } from 'ws';

let wss = null;

export function startWsServer() {
  wss = new WebSocketServer({ port: config.wsPort });

  wss.on('connection', (ws) => {
    // Send snapshot on connect
    ws.send(JSON.stringify({
      type: 'snapshot',
      data: komodoState.toSnapshot(),
    }));

    // Handle commands from dashboard
    ws.on('message', (msg) => {
      try {
        const { command } = JSON.parse(msg.toString());
        switch (command) {
          case 'pause': komodoState.requestPause(); break;
          case 'stop': komodoState.requestStop(); break;
          case 'approve': /* approval gate */ break;
          case 'reject': /* approval gate */ break;
        }
        ws.send(JSON.stringify({ type: 'command:ack', command }));
      } catch {}
    });
  });

  // Forward all events to connected clients
  eventBus.on('*', (event) => {
    const msg = JSON.stringify({ type: 'event', data: event });
    wss.clients.forEach(client => {
      if (client.readyState === 1) client.send(msg);
    });
  });
}

export function stopWsServer() {
  wss?.close();
}
```

---

## 32. API SERVER (src/server/api-server.js)

HTTP API para control externo:

```javascript
import http from 'http';

let server = null;

export function startApiServer() {
  server = http.createServer(async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Komodo-Key');

    if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

    // Authentication
    if (req.headers['x-komodo-key'] !== config.apiKey) {
      res.writeHead(401); res.end('Unauthorized'); return;
    }

    const url = new URL(req.url, `http://localhost:${config.apiPort}`);

    // Routes
    switch (url.pathname) {
      case '/api/run':         // POST - trigger task execution
      case '/api/stop':        // POST - stop orchestrator
      case '/api/pause':       // POST - pause after current task
      case '/api/task':        // POST - create task dynamically
      case '/api/status':      // GET - current state snapshot
      case '/api/observability/timeline':  // GET - task timeline
      case '/api/observability/explain':   // GET - explain decisions
      case '/api/observability/tasks':     // GET - list recent tasks
      case '/api/observability/alerts':    // GET - recent alerts
      case '/api/observability/replay':    // GET - replay task execution
      case '/api/event':       // POST - receive forwarded events (from MCP)
    }
  });

  server.listen(config.apiPort);
}
```

---

## 33. AUTONOMIA Y APPROVAL GATES

### 33.1 Autonomy Engine (src/autonomy/autonomy-engine.js)

4 niveles de autonomia:

```javascript
const AUTONOMY_LEVELS = {
  'supervised': {
    pauseBeforeMerge: true,
    pauseOnLowScore: true,
    requireApprovalForAll: true,
  },
  'semi-autonomous': {
    pauseBeforeMerge: true,
    pauseOnLowScore: true,   // score < 8
    requireApprovalForAll: false,
  },
  'autonomous': {
    pauseBeforeMerge: false,
    pauseOnLowScore: false,
    requireApprovalForAll: false,
  },
  'guardian': {
    // Dynamic gates based on risk assessment
    useDynamicGates: true,
  },
};
```

### 33.2 Guardian Gates (src/autonomy/guardian-gates.js)

Triggers de pausa dinamicos:
- Diff > 500 lineas
- Token usage > 80K
- Archivos de seguridad modificados (DB migrations, auth, secrets)
- Review cycles > 3
- Database migration detectada
- Dependencias modificadas

### 33.3 Approval Gate (src/autonomy/approval-gate.js)

```javascript
export async function waitForApproval(context) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      resolve({ approved: false, reason: 'timeout' });
    }, config.approvalTimeoutMinutes * 60 * 1000);

    // Listen for approval via WebSocket or API
    const unsubscribe = eventBus.on('APPROVAL_RECEIVED', (event) => {
      clearTimeout(timeout);
      unsubscribe();
      resolve({ approved: event.metadata.approved, reason: event.metadata.reason });
    });
  });
}
```

---

## 34. RESILIENCIA

### 34.1 Circuit Breaker (src/resilience/circuit-breaker.js)

```javascript
// States: CLOSED (normal) → OPEN (fail fast) → HALF_OPEN (test) → CLOSED
// Services monitored: firebase, github, cli
// Thresholds: firebase=5, github=3, cli=4 failures
// Cooldown: 60 seconds before HALF_OPEN test
```

### 34.2 Error Budget (src/resilience/error-budget.js)

```javascript
// Tracks failure rate in 30-min sliding window
// Max failure rate: 30%
// Auto-pause when budget exhausted
// Reset: manual intervention or window expiration
```

### 34.3 Dead Letter Queue (src/resilience/dead-letter-queue.js)

```javascript
// Queue for failed operations
// Auto-retry with exponential backoff: 1s, 2s, 4s
// Max 3 retries
// Escalate to healing engine if still failing
```

---

## 35. SELF-HEALING (src/self-healing/healing-engine.js)

Strategy-based recovery:

```javascript
const STRATEGIES = {
  'RATE_LIMIT': RateLimitStrategy,        // fallback CLI or wait
  'GITHUB_API_ERROR': GitHubApiStrategy,  // retry 3x with backoff
  'MERGE_CONFLICT': MergeConflictStrategy,// resolve, test, re-push
  'TEST_FAILURE': TestFailureStrategy,    // re-run or mark flaky
  'AGENT_TIMEOUT': AgentTimeoutStrategy,  // retry with higher timeout
  'FIREBASE_DOWN': FirebaseDownStrategy,  // queue for later
};

export class HealingEngine {
  async heal(error, context) {
    const strategy = STRATEGIES[error.type];
    if (!strategy) return { healed: false };
    return new strategy().execute(error, context);
  }
}
```

### Flaky Test Registry (src/self-healing/flaky-test-registry.js)

```javascript
// Tracks tests that fail intermittently
// Retries up to 3x before marking as blocking
// Persists to Firebase per project
// Used by task runner to decide: retry vs block
```
