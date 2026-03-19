# PARTE 8: INTELIGENCIA, TRIAGE, PRESUPUESTO, DAEMON Y FEATURES AVANZADOS

---

## 36. CODEBASE INDEXER (src/intelligence/codebase-indexer.js)

```javascript
// Scans: src/, tests/, package.json, README
// Generates semantic summary: file structure, key modules, patterns
// Cached 5 minutes (avoid re-scanning)
// Injected into Coder prompt (max 2000 tokens)
// Used when: no Architect plan available + CODEBASE_INDEX_ENABLED=true
```

## 37. STYLE DETECTOR (src/intelligence/style-detector.js)

```javascript
// Analyzes existing code for patterns:
// - Naming: camelCase, snake_case, PascalCase
// - Spacing: tabs vs spaces, indentation size
// - Patterns: arrow functions vs function, const vs let
// - Imports: named vs default, relative vs absolute
// Extracts rules as MANDATORY guidelines for Coder
// Example output: "Use camelCase, prefer const, use arrow functions, 2-space indent"
```

## 38. CODEBASE LEARNER (src/intelligence/codebase-learner.js)

```javascript
// Extracts from completed tasks:
// - Architecture patterns (folder structure, module organization)
// - Testing practices (framework, patterns, coverage approach)
// - Error handling patterns (try/catch style, error classes)
// Persists to Firebase: projects/{id}/learnings
// Forces refresh on first run per project
// Cross-project sharing if CROSS_PROJECT_INTELLIGENCE=true
```

## 39. REVIEW FEEDBACK (src/intelligence/review-feedback.js)

```javascript
// Tracks common reviewer comments:
// - Top issues by frequency (naming, error handling, etc.)
// - Time-decay: recent issues weighted more
// Builds context string: "Previous reviews found issues with: ..."
// Injected into Coder prompt to prevent recurring mistakes
```

## 40. KNOWLEDGE GRAPH (src/knowledge/knowledge-graph.js)

```javascript
// Per-task knowledge storage:
// - coderBrief: what Coder implemented and why
// - reviewerBrief: what Reviewer found
// - moduleLessons: patterns per module/file
// - testingPatterns: what tests worked well
//
// Scoped by module/file path
// Loads lessons based on taskSpec files
// Records patterns from successful reviews
//
// Storage: knowledge/{projectId}/{taskId}.json
// Firebase: knowledge/{projectId}/modules/{modulePath}
```

## 41. CROSS-PROJECT INTELLIGENCE (src/intelligence/cross-project-intelligence.js)

```javascript
// Syncs patterns across projects:
// - Universal patterns (adopted by >60% of projects)
// - Anti-patterns (failed in >40% of projects)
// - Model performance (which model works best for which task type)
// Universality threshold: 0.6
// Only active if CROSS_PROJECT_INTELLIGENCE=true
```

---

## 42. SMART ORDERING (src/smart-ordering/context-affinity.js)

```javascript
export function rankWithContextAffinity(tasks, lastContext) {
  // lastContext: { files: string[], modules: string[], keywords: string[] }
  //
  // For each task:
  // 1. Check if task files overlap with lastContext.files
  // 2. Check if task modules overlap with lastContext.modules
  // 3. Check if task keywords overlap with lastContext.keywords
  // 4. Apply boost: affinityBoost = 0.2 (configurable)
  //
  // Tasks with context overlap get boosted in sort order
  // Keeps agents "warm" in the same area of code
}

export function buildAffinityHint(task, lastContext) {
  // Generate hint string for Planner prompt:
  // "This task shares context with recently completed work in: src/agents/"
}
```

---

## 43. TRIAGE Y COMPLEJIDAD

### 43.1 Complexity Classifier (src/triage/complexity-classifier.js)

```javascript
export function classifyComplexity(taskSpec) {
  const devPoints = taskSpec.devPoints || 3;
  if (devPoints <= config.complexityThresholds.trivial) return 'trivial';  // <= 3
  if (devPoints <= config.complexityThresholds.standard) return 'standard'; // <= 6
  return 'complex'; // > 6
}
```

### 43.2 Model Selector (src/triage/model-selector.js)

```javascript
export function selectModel(role, complexity) {
  // 1. Check force override
  if (config.forceModels[role]) return config.forceModels[role];

  // 2. Get CLI for this role
  const cli = config[`cli${capitalize(role)}`] || 'claude';

  // 3. Lookup model map
  const map = config.modelMaps[cli]?.[role];
  if (!map) return null; // Use CLI default

  // 4. Select by complexity index
  const idx = complexity === 'trivial' ? 0 : complexity === 'standard' ? 1 : 2;
  return map[idx] || map[1] || null;
}
```

### 43.3 Smart Model Router (src/triage/smart-model-router.js)

```javascript
// Epsilon-greedy routing based on historical performance in Firebase
// Tracks per task: cost, review score, cycle count
// Automatically escalates model if performance degrades
// Epsilon: 10% exploration (try different model)
// 90% exploitation (use best known model)
```

### 43.4 Task Decomposer (src/triage/task-decomposer.js)

```javascript
export async function decomposeTask(taskSpec, projectId) {
  // Only decompose if devPoints >= TASK_DECOMPOSITION_THRESHOLD (default 8)
  // Uses Planner agent to split task into subtasks
  // Preserves original as parent task (parentTaskId)
  // Creates blockedBy dependencies between parts
  // Returns: { decomposed: true, subtasks: [...] }
}
```

---

## 44. ESTIMACION Y PRESUPUESTO

### 44.1 Token Estimator (src/estimation/token-estimator.js)

```javascript
export function estimateTokens(complexity) {
  const BASE = {
    trivial: 8000,    // ~8K tokens
    standard: 25000,  // ~25K tokens
    complex: 60000,   // ~60K tokens
  };

  // Phase breakdown:
  // architect: 15%
  // coder: 50%
  // security: 5%
  // reviewer: 20%
  // overhead: 10%

  return BASE[complexity] || BASE.standard;
}
```

### 44.2 Budget Manager (src/cost/budget-manager.js)

```javascript
export class BudgetManager {
  async initialize(projectId) {
    this.projectId = projectId;
    // Load current daily/weekly spend from Firebase
    // Reset daily at midnight, weekly on Monday
  }

  addCost(amount) {
    this.dailySpent += amount;
    this.weeklySpent += amount;
    komodoState.budget.dailySpent = this.dailySpent;
    komodoState.budget.weeklySpent = this.weeklySpent;

    // Check warning
    if (this.dailySpent / config.dailyBudgetUsd >= config.budgetWarningThreshold) {
      eventBus.emitEvent('BUDGET_WARNING', { daily: this.dailySpent, limit: config.dailyBudgetUsd });
    }

    // Persist to Firebase
    this.persist();
  }

  isExceeded() {
    if (config.dailyBudgetUsd > 0 && this.dailySpent >= config.dailyBudgetUsd) return true;
    if (config.weeklyBudgetUsd > 0 && this.weeklySpent >= config.weeklyBudgetUsd) return true;
    return false;
  }
}
```

### 44.3 Rate Limit Tracker (src/estimation/rate-limit-tracker.js)

```javascript
// Token window: 5 minutes (300K tokens default)
// Tracks: tokens consumed in rolling window
// Calculates headroom: tokens remaining before limit
// Preemptive wait if headroom < next task estimate
// Integration: called before each agent invocation
```

---

## 45. DAEMON MODE (src/daemon/daemon.js)

```javascript
export class Daemon {
  constructor(projectId, options = {}) {
    this.projectId = projectId;
    this.pollInterval = config.daemonPollInterval; // 60s default
    this.maxTasks = options.maxTasks || 0; // 0 = unlimited
    this.tasksCompleted = 0;
  }

  async start() {
    eventBus.emitEvent('DAEMON_STARTED', {});
    komodoState.setExecutionState('daemon:idle');

    while (true) {
      // Check scheduler windows
      if (config.schedule) {
        const inWindow = isInScheduleWindow(config.schedule, config.scheduleTimezone);
        if (!inWindow) {
          komodoState.setExecutionState('scheduler:waiting');
          await sleep(this.pollInterval);
          continue;
        }
      }

      // Check backlog
      const hasWork = await checkBacklog(this.projectId);

      if (hasWork) {
        komodoState.setExecutionState('daemon:running');
        eventBus.emitEvent('DAEMON_TASK_DETECTED', {});

        const result = await runTask(this.projectId, this.cwd);
        if (result?.success) this.tasksCompleted++;

        if (this.maxTasks > 0 && this.tasksCompleted >= this.maxTasks) {
          break;
        }
      } else {
        komodoState.setExecutionState('daemon:idle');
        eventBus.emitEvent('DAEMON_IDLE', {});
      }

      await sleep(this.pollInterval);
    }

    eventBus.emitEvent('DAEMON_STOPPED', {});
  }
}
```

## 46. SCHEDULER (src/scheduler/scheduler.js)

```javascript
// Cron-like scheduling: "02:00-06:00,14:00-18:00"
// Format: comma-separated time windows "HH:MM-HH:MM"
// Timezone-aware via SCHEDULE_TIMEZONE
// Used by daemon to pause during off-hours
export function isInScheduleWindow(schedule, timezone) {
  const now = new Date().toLocaleTimeString('en-US', { timeZone: timezone, hour12: false });
  const [hours, minutes] = now.split(':').map(Number);
  const currentMinutes = hours * 60 + minutes;

  for (const window of schedule.split(',')) {
    const [start, end] = window.trim().split('-');
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    const startMin = sh * 60 + sm;
    const endMin = eh * 60 + em;

    if (currentMinutes >= startMin && currentMinutes <= endMin) return true;
  }
  return false;
}
```

---

## 47. CI MONITOR (src/ci-monitor/ci-monitor.js)

```javascript
// Watches GitHub Actions after merge
// Polls workflow status via: gh run list --branch main --limit 1 --json conclusion
// Timeout: CI_TIMEOUT_MS (default 15 min)
// If CI fails and AUTO_REVERT=true:
//   - Reverts merge commit
//   - Re-opens PR
//   - Marks task back to 'in-progress'
//   - Emits CI_FAILURE_REVERTED event
```

## 48. CANARY MERGE (src/canary/canary-merge.js)

```javascript
// Strategy: merge to staging branch first, then promote to main
// Steps:
// 1. Merge PR to CANARY_BRANCH (default: staging)
// 2. Wait CANARY_STABILITY_MINUTES (default: 10)
// 3. Check CI on staging
// 4. If green: merge staging → main
// 5. If red: revert staging, leave PR open
//
// conflict-detector.js: checks for merge conflicts before canary merge
```

## 49. SONARQUBE INTEGRATION (src/sonar/analyzer.js)

```javascript
export async function analyzeSonar(cwd, branchName) {
  // 1. Run sonar-scanner CLI
  // 2. Wait for analysis on SonarQube server
  // 3. Fetch quality gate status via API
  // 4. Fetch issues (BLOCKER, CRITICAL, MAJOR, MINOR)
  // 5. Return report: { qualityGate, bugs, vulnerabilities, codeSmells, coverage, issues[] }
  //
  // Used in: task-runner (pre-review), review-loop (post-fix), komodo-mcp finalize
  // Blocks merge if qualityGate === 'ERROR'
}
```

## 50. PRE-PR TESTS (src/testing/pre-pr-tests.js)

```javascript
export async function executePrePRTests(cwd, branchName) {
  // Auto-detect test command: npm test, yarn test, vitest, jest
  // Execute in cwd on branchName
  // If fails: Coder must fix before PR
  // Returns: { passed: boolean, output: string }
}
```

## 51. COVERAGE ANALYZER (src/coverage/coverage-analyzer.js)

```javascript
// Checks coverage delta against MIN_COVERAGE_DELTA (default -2%)
// If PR reduces coverage by more than threshold: blocks APPROVE
// Records baseline after successful merge
// Storage: Firebase metrics/{projectId}/coverageHistory
```

## 52. VERSIONADO (src/versioning/)

```javascript
// version-bumper.js:
// - Reads package.json version
// - Bumps: patch (trivial/standard), minor (complex), major (breaking)
// - Writes back to package.json

// changelog-generator.js:
// - Groups commits by type: features, fixes, breaking
// - Generates CHANGELOG.md entry
// - Format: markdown with version header and date

// release-manager.js:
// - Creates GitHub Release via gh CLI
// - Optional: on sprint completion (RELEASE_ON_SPRINT_COMPLETE)
// - Includes release notes from changelog

// release-gate.js:
// - Checks: no blocking bugs, all tests passing
// - Can override: RELEASE_IGNORE_BUGS=true
```

## 53. TECH DEBT (src/tech-debt/tech-debt-tracker.js)

```javascript
// Auto-creates tasks from minor review issues
// Each minor issue not fixed in review → tech debt task
// Tracks: code smells, refactoring needs, documentation gaps
// Severity-based grouping: high/medium/low
// Created as child tasks in Firebase
```

## 54. AUTO-IMPROVE (src/auto-improve/)

```javascript
// auto-improve.js:
// When backlog empty, suggests improvement tasks
// Categories: performance, security, coverage, testing, documentation
// Max 5 proposals per session

// codebase-analyzer.js:
// Identifies: dead code, unused imports, duplicate patterns
// Suggests refactoring tasks

// dependency-checker.js:
// Periodic npm audit + npm outdated checks
// Creates tasks for security/patch updates
// Interval: 24 hours default
```

## 55. MULTI-PROJECT (src/multi-project/)

```javascript
// multi-project-runner.js:
// Manages N projects simultaneously
// Strategies:
//   round-robin: one task per project, rotate
//   priority: highest priority task across all projects
//   backlog-size: project with most to-do tasks first

// project-loader.js:
// Loads project configs from PROJECTS env variable
// Resolves: projectId, cwd path, repo URL
```

## 56. INTEGRACIONES (src/integrations/)

```javascript
// github-issue-sync.js:
// Polls GitHub issues with label "komodo"
// Creates planning-task-mcp tasks automatically
// Poll interval: 5 min default

// pr-comment-bugs.js:
// Monitors PR comments for "@komodo bug: ..."
// Creates bug reports in planning-task-mcp
// Poll interval: 3 min default

// webhook-outgoing.js:
// Forwards Komodo events to external URLs
// Supports custom headers
// Max 3 retries with backoff
```

## 57. PLUGIN SYSTEM (src/plugins/)

```javascript
// plugin-loader.js:
// Loads from PLUGINS_DIR directory
// Each plugin: index.js with exports { name, version, hooks }
// Hooks: before-review, after-code, on-error

// plugin-interface.js:
// Plugin receives: { taskSpec, prNumber, filesChanged, cwd }
// Returns: { issues: [{ severity, description, file }] }
// Issues injected into Reviewer prompt as MANDATORY to address
```

## 58. OBSERVABILIDAD (src/observability/)

```javascript
// anomaly-detector.js:
// Detects: token spike, review regression, model degradation
// Emits alerts when anomalies detected

// task-timeline.js:
// Stores per-task: phases, durations, costs, model, review cycles
// Used for historical analysis in dashboard

// explain-decision.js:
// Explains why Planner picked specific task
// Explains why Reviewer rejected PR
// Explains model selection rationale
```

## 59. DOCTOR (src/doctor/doctor.js)

```javascript
// Health checks:
// 1. Node version >= 18
// 2. git installed
// 3. gh installed and authenticated
// 4. AI CLIs installed (claude, codex, gemini - whichever configured)
// 5. Firebase credentials valid
// 6. Firebase connection test
// 7. npm packages installed
// 8. MCP servers startable
// Silent mode: only log errors (used pre-run)
// Verbose mode: log all checks (used by 'komodo doctor')
```

## 60. SHUTDOWN MANAGER (src/shutdown/shutdown-manager.js)

```javascript
class ShutdownManager {
  #hooks = new Map(); // name → cleanup function

  register(name, cleanupFn) {
    this.#hooks.set(name, cleanupFn);
  }

  async shutdown() {
    for (const [name, fn] of this.#hooks) {
      try { await fn(); }
      catch (e) { logger.warn(`Shutdown hook ${name} failed: ${e.message}`); }
    }
    this.#hooks.clear();
  }
}

export const shutdownManager = new ShutdownManager();
```

## 61. HEARTBEAT MONITOR (src/heartbeat/heartbeat-monitor.js)

```javascript
// Pings rate-limited CLIs every 5 minutes
// For each rate-limited CLI: try a minimal prompt
// If responds OK: mark as recovered via fallbackManager.markRecovered()
// Emits CLI_RECOVERED event
// Used by orchestrator to know when to resume
```

## 62. LOGGER (src/utils/logger.js)

```javascript
// Colored output per agent:
// PLANNER=blue, ARCHITECT=cyan, CODER=green,
// TESTER=yellow, SECURITY=magenta, REVIEWER=red,
// KOMODO=white (bold)
//
// Functions: info(), success(), warn(), error(),
//            taskHeader(), startSpinner(), stopSpinner()
// Timestamps in es-ES locale
```

## 63. PARSER (src/utils/parser.js)

```javascript
// parseJSON(text):
// 1. Try JSON.parse directly
// 2. Try extracting JSON from markdown code blocks (```json...```)
// 3. Try extracting JSON object ({...}) from text
// 4. Return null if all fail
//
// Used by all agents to extract structured responses
```

## 64. RESPONSE VALIDATOR (src/utils/response-validator.js)

```javascript
export function validateAgentResponse(response, requiredFields) {
  if (!response) return { valid: false, missing: requiredFields };
  const missing = requiredFields.filter(f => !response[f]);
  return { valid: missing.length === 0, missing };
}
```
