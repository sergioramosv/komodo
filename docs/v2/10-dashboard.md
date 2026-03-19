# PARTE 10: DASHBOARD (Next.js)

---

## 69. DASHBOARD OVERVIEW

### 69.1 Stack
- Next.js 15.3.3 con App Router
- React 19.1.0
- TypeScript 5.8.3 (strict mode)
- Tailwind CSS 4.1.8
- Recharts 3.7.0 (graficos)
- Lucide React (iconos)
- Firebase Admin SDK 13.7.0 (server-side)
- Vitest 4.0.18 (tests)

### 69.2 Package.json
```json
{
  "name": "komodo-dashboard",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint"
  },
  "dependencies": {
    "firebase-admin": "^13.7.0",
    "lucide-react": "^0.577.0",
    "next": "^15.3.3",
    "react": "^19.1.0",
    "react-dom": "^19.1.0",
    "recharts": "^3.7.0"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4.1.8",
    "@types/node": "^22.15.21",
    "@types/react": "^19.1.4",
    "@types/react-dom": "^19.1.5",
    "tailwindcss": "^4.1.8",
    "typescript": "^5.8.3",
    "vitest": "^4.0.18"
  }
}
```

### 69.3 Layout principal (app/layout.tsx)

```tsx
// Dark mode por defecto (className="dark" en <html>)
// Estructura: Sidebar + main content area
// Providers: NotificationProvider → ViewPreferenceProvider (sin 3D/pixel en V2)
// Body: flex h-screen bg-neutral-950 text-neutral-100
```

### 69.4 Nota V2: Sin 3D ni Pixel Office

En V2, se eliminan:
- `components/3d/` (Office3D, Agent3D, Environment3D, KomodoBoss, SonarScanner3D, AnimatedWhiteboard)
- `components/pixel-office/` (pixel-office-canvas, pixel-agent, office-map, pathfinding, use-pixel-agents)
- `components/view-toggle.tsx`
- `context/view-preference-context.tsx`
- Three.js, @react-three/fiber, @react-three/drei dependencies

El dashboard mantiene TODAS las funcionalidades de monitoreo, analytics, agents, settings, etc.

---

## 70. PAGINAS

### 70.1 Dashboard Home (app/page.tsx)

Pagina principal con estado en tiempo real:

**Secciones:**
1. **Header** - "Komodo Dashboard" + connection status
2. **Current Task Card** - Titulo, puntos (BP/DP), developer, sprint, PR link
3. **Phase Indicator** - Barra de progreso por fases (plan→arch→code→test→sec→review→merge)
4. **Agent Cards Grid** - 6 tarjetas: PLANNER, ARCHITECT, CODER, TESTER, SECURITY, REVIEWER
   - Cada una muestra: status (idle/working/done), CLI, model, cost, turns
5. **Execution Controls** - Pause/Stop buttons con confirmacion
6. **Budget Widget** - Costo total, barras de progreso daily/weekly
7. **Event Timeline** - Ultimos 20 eventos en tiempo real
8. **SonarQube Status** - Estado del analisis (idle/running/done/error)
9. **Agent Cost Breakdown** - Barras de costo por agente
10. **Multi-Project Selector** (si multi-project habilitado)

**Datos via WebSocket (useKomodoSocket).**

### 70.2 Agents Page (app/agents/page.tsx)

Detalle de agentes individuales:

**Grid de agentes:**
- 6 agentes + card KOMODO orquestador
- Cada card: nombre, status badge, model badge, cost, turns, completed tasks

**Panel de detalle (al seleccionar agente):**
- **Tab: Live Log** - Terminal con logs en tiempo real, auto-scroll
- **Tab: Event History** - Timeline de eventos del agente
- Stats bar: status, mode, elapsed time, cost, turns, tasks

**Colores por agente:**
- PLANNER=violet, ARCHITECT=teal, CODER=blue, TESTER=orange, SECURITY=green, REVIEWER=amber

### 70.3 Analytics Page (app/analytics/page.tsx)

5 graficos con datos de Firebase:

1. **Velocity Chart** - Tareas y devPoints por sprint (linea)
2. **Cost Chart** - Costo por sprint con promedio (barras)
3. **Review Pass Rate** - Tasa de aprobacion por sprint (linea)
4. **Duration vs Complexity** - Scatter plot estimado vs real
5. **Model Usage** - Frecuencia y scores por modelo (barras)

**Filtros:** startDate, endDate, sprint, model, complexity

### 70.4 History Page (app/history/page.tsx)

Timeline de operaciones agrupada por fecha:

**Eventos tracked:**
- task:started, task:completed
- pr:created, pr:merged
- review:cycle:end
- fix:applied
- sonar:analysis:complete

**Filtros:** date presets (today/week/month/all), custom dates, action type, agent

### 70.5 Leaderboard Page (app/leaderboard/page.tsx)

Rankings de rendimiento por modelo:

- Tabla: model, role, avgScore, avgCycles, avgDuration, avgCost, taskCount
- Optimal models: mejor modelo por rol
- Cost optimization: modelos mas baratos con rendimiento similar

**Filtros:** complexity, period (all/week/month)

### 70.6 Memory Page (app/memory/page.tsx)

Patrones de error persistentes:

- Stats: total patterns, total reviews, avg cycles, trend
- Distribution: por type (error/anti-pattern/style/positive)
- Top 10: bar chart de issues mas frecuentes
- Tabla expandible: description, type, severity, frequency, resolution, tags
- Clear memory button

### 70.7 Notifications Page (app/notifications/page.tsx)

- Lista con badges (success/info/warning/error)
- Mark read / Mark all read / Clear all
- Filtros por tipo

### 70.8 Settings Page (app/settings/page.tsx)

- Active project selector
- Coding guidelines textarea (2000 chars max)
- Agent config: CLI provider, model dropdown, max turns (por agente)
- Orchestrator: max review cycles, budget limit, continuous mode
- CLI health status display

---

## 71. COMPONENTES

### 71.1 Core Components

**sidebar.tsx** - Navegacion con 8 menu items + notification badge
**connection-status.tsx** - Dot + label (Connected/Disconnected)
**notification-provider.tsx** - Context provider + toast container
**execution-controls.tsx** - Pause/Stop con confirmacion
**task-detail-modal.tsx** - Modal con detalles completos de tarea (Firebase)
**budget-widget.tsx** - Costo + barras daily/weekly con colores
**cli-health-status.tsx** - 3 cards (claude/codex/gemini) con status
**project-selector.tsx** - Dropdown multi-project
**multi-project-overview.tsx** - Stats por proyecto
**toast-notifications.tsx** - Container de toasts (max 5, auto-dismiss 5s)
**agent-avatar.tsx** - Avatar SVG animado por agente

### 71.2 Analytics Components

**analytics-filters.tsx** - Date range, sprint, model, complexity
**velocity-chart.tsx** - Recharts LineChart
**cost-chart.tsx** - Recharts BarChart
**review-pass-rate-chart.tsx** - Recharts LineChart
**duration-complexity-chart.tsx** - Recharts ScatterChart
**model-usage-chart.tsx** - Recharts BarChart
**model-leaderboard-table.tsx** - Tabla rankeada
**leaderboard-filters.tsx** - Filtros de leaderboard

### 71.3 Data Components

**budget-history.tsx** - Historico de gasto
**coverage-trend.tsx** - Tendencia de cobertura
**estimation-chart.tsx** - Precision de estimaciones

---

## 72. HOOKS

### 72.1 useKomodoSocket (hooks/useKomodoSocket.ts)

Hook principal de WebSocket (513 lineas):

```typescript
export function useKomodoSocket() {
  // Connect to ws://localhost:3001 (NEXT_PUBLIC_WS_URL)
  // Auto-reconnect with 3s delay
  // Process messages: snapshot, event, command-ack
  // Maintain: snapshot state, events[], agentLogs{}, cliHealth{}
  // localStorage persistence for events (MAX_EVENTS=20)

  return {
    snapshot: KomodoSnapshot | null,
    connected: boolean,
    events: DashboardEvent[],
    agentLogs: Record<AgentName, AgentLog[]>,  // max 200 per agent
    cliHealth: Record<CliName, CliHealth>,
    sendCommand: (command: string) => void,
  };
}
```

**Event processing (applyEvent):**
- AGENT_STATE_CHANGE → update agents[name].status
- PHASE_CHANGED → update phase
- COST_UPDATED → update totalCost + agent costs
- TASK_STARTED → update currentTask + taskDetails
- PR_CREATED → update currentPR
- REVIEW_CYCLE_START → update reviewCycle
- EXECUTION_STATE_CHANGED → update executionState
- SONAR_ANALYSIS_* → update sonarAnalysis
- BUDGET_* → update budget
- CLI health events → update cliHealth

### 72.2 useAgentStates (hooks/useAgentStates.ts)

```typescript
// Derives visual agent states from snapshot
// Returns enriched agents with: status, activity description, reviewCycle
// Example: CODER working during 'coding' phase → activity: "Implementing code..."
// DEFAULT_AGENTS: all 6 agents with default idle state
```

### 72.3 useNotifications (hooks/useNotifications.ts)

```typescript
// WebSocket-powered notification system
// Events → notifications:
//   task:completed → success
//   pr:merged → success
//   pr:created → info
//   cost:updated (>80% budget) → warning
//   agent:state-change (failed) → error
//   review:cycle:end (changes requested) → warning
//
// Returns: { notifications, unreadCount, markRead, markAllRead, clearAll }
```

---

## 73. API ROUTES

### 73.1 Config (app/api/config/route.ts)

```
GET /api/config → KomodoConfig + availableClis (detected via `which`)
PUT /api/config → validates + saves to komodo.config.json
```

### 73.2 Projects (app/api/projects/route.ts)

```
GET /api/projects → { projects: { id, name }[] } filtered by user membership
```

### 73.3 History (app/api/history/route.ts)

```
GET /api/history?startDate=&endDate=&action=&agent=&limit=200
POST /api/history → saves event to Firebase (komodo-history)
```

### 73.4 Tasks (app/api/tasks/[taskId]/route.ts)

```
GET /api/tasks/{taskId} → full task with resolved sprint/developer names
```

### 73.5 Memory (app/api/memory/route.ts)

```
GET /api/memory → { patterns, reviewOutcomes } from patterns.json
DELETE /api/memory/clear → clear all patterns
```

### 73.6 Project-specific routes

```
GET /api/projects/{id}/analytics → velocity, cost, review rates, duration, model usage
GET /api/projects/{id}/model-leaderboard → rankings by model/role
GET /api/projects/{id}/coding-guidelines → project guidelines
PUT /api/projects/{id}/coding-guidelines → save guidelines
GET /api/projects/{id}/tech-debt → debt items
GET /api/projects/{id}/coverage-trend → coverage history
GET /api/projects/{id}/budget-history → daily spending
GET /api/projects/{id}/estimation-metrics → estimation accuracy
GET /api/schedule → schedule windows and current status
```

---

## 74. TIPOS TYPESCRIPT (lib/types.ts)

```typescript
// Core types
type AgentName = 'PLANNER' | 'CODER' | 'REVIEWER' | 'ARCHITECT' | 'SECURITY' | 'TESTER';
type AgentStatus = 'idle' | 'walking' | 'working' | 'done';
type Phase = 'idle' | 'planning' | 'architecting' | 'coding' | 'testing' | 'security' | 'analyzing' | 'reviewing' | 'merging';
type ExecutionState = 'stopped' | 'running' | 'paused';

// Interfaces: KomodoSnapshot, AgentState, TaskDetails, SonarAnalysisState,
//             CliHealth, BudgetState, MultiProjectState, DashboardEvent,
//             KomodoNotification, HistoryEntry

// WebSocket messages: WsSnapshotMessage, WsEventMessage, WsCommandAckMessage

// Config types (lib/config-types.ts):
// CliProvider, AgentModel, KomodoConfig, CLI_MODELS, DEFAULT_CONFIG

// Memory types (lib/memory-types.ts):
// Pattern, ReviewOutcome, MemoryStore, MemoryStats
```

## 75. FIREBASE CLIENT (lib/firebase.ts)

```typescript
// Admin SDK initialization with credential discovery:
// 1. GOOGLE_APPLICATION_CREDENTIALS env var
// 2. serviceAccountKey.json in cwd/parent
// 3. Glob: planning-task-firebase-adminsdk-*.json
// 4. Legacy: skills/planning-task-mcp/serviceAccountKey.json
//
// Database URL from .env
// Exports: getDb()
```

## 76. GLOBALS CSS (app/globals.css)

Animaciones custom:
```css
/* Agent avatar: breathe, blink, walk, work-bob, typing, accessory-pulse */
/* Office feedback: bubble-appear, typing-dot-bounce, confetti-fall, verdict-pop */
/* Toast: toast-slide-in, toast-slide-out */
```

Note V2: eliminar animaciones relacionadas con 3D y pixel office. Mantener: agent avatar, toast, y feedback genericos.
