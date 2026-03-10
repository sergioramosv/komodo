import { describe, it, expect } from 'vitest';
import {
  escapeMarkdown,
  escapeUrl,
  formatTaskStarted,
  formatPRCreated,
  formatReviewCycleEnd,
  formatFixDone,
  formatPRMerged,
  formatTaskCompleted,
  formatError,
  formatCliRecovered,
  formatAllClisRateLimited,
  formatStatus,
  formatTaskList,
  formatBacklog,
  formatWeeklyDigest,
} from './formatter.js';

describe('escapeMarkdown', () => {
  it('returns empty string for falsy input', () => {
    expect(escapeMarkdown('')).toBe('');
    expect(escapeMarkdown(null)).toBe('');
    expect(escapeMarkdown(undefined)).toBe('');
  });

  it('escapes MarkdownV2 special characters', () => {
    expect(escapeMarkdown('hello.world')).toBe('hello\\.world');
    expect(escapeMarkdown('a_b*c')).toBe('a\\_b\\*c');
    expect(escapeMarkdown('(test)')).toBe('\\(test\\)');
    expect(escapeMarkdown('[link]')).toBe('\\[link\\]');
    expect(escapeMarkdown('a~b`c>d#e+f-g=h|i{j}k!l')).toBe(
      'a\\~b\\`c\\>d\\#e\\+f\\-g\\=h\\|i\\{j\\}k\\!l'
    );
  });

  it('leaves plain text unchanged', () => {
    expect(escapeMarkdown('hello world')).toBe('hello world');
  });

  it('converts numbers to string', () => {
    expect(escapeMarkdown(42)).toBe('42');
  });
});

describe('escapeUrl', () => {
  it('returns empty string for falsy input', () => {
    expect(escapeUrl('')).toBe('');
    expect(escapeUrl(null)).toBe('');
    expect(escapeUrl(undefined)).toBe('');
  });

  it('does NOT escape dots in URLs', () => {
    const url = 'https://github.com/user/repo/pull/1';
    expect(escapeUrl(url)).toBe(url);
  });

  it('escapes closing parenthesis', () => {
    expect(escapeUrl('https://example.com/path_(test)')).toBe(
      'https://example.com/path_(test\\)'
    );
  });

  it('escapes backslashes', () => {
    expect(escapeUrl('https://example.com/a\\b')).toBe(
      'https://example.com/a\\\\b'
    );
  });

  it('preserves normal URL characters untouched', () => {
    const url = 'https://github.com/SergioRVDev/komodo/pull/30';
    expect(escapeUrl(url)).toBe(url);
  });
});

describe('formatTaskStarted', () => {
  it('formats with full metadata including priority', () => {
    const result = formatTaskStarted({
      title: 'Add login',
      branchName: 'feat/login',
      taskId: 'TASK-1',
      priority: 8,
    });
    expect(result).toContain('*Planner eligió tarea*');
    expect(result).toContain('Add login');
    expect(result).toContain('`TASK\\-1`');
    expect(result).toContain('`feat/login`');
    expect(result).toContain('*Prioridad:* 8');
  });

  it('uses defaults for missing metadata', () => {
    const result = formatTaskStarted({});
    expect(result).toContain('Sin título');
    expect(result).toContain('`?`');
    expect(result).not.toContain('*Prioridad:*');
  });
});

describe('formatPRCreated', () => {
  it('formats with full metadata including URL', () => {
    const result = formatPRCreated({
      prNumber: 30,
      repo: 'SergioRVDev/komodo',
      branchName: 'feat/login',
      filesChanged: ['a.js', 'b.js'],
      summary: 'Added login feature',
    });
    expect(result).toContain('*Coder creó PR*');
    expect(result).toContain('\\#30');
    expect(result).toContain('https://github.com/SergioRVDev/komodo/pull/30');
    expect(result).toContain('`feat/login`');
    expect(result).toContain('*Archivos:* 2');
    expect(result).toContain('*Resumen:* Added login feature');
  });

  it('does NOT escape dots in PR URL', () => {
    const result = formatPRCreated({
      prNumber: 5,
      repo: 'user/repo.name',
      branchName: 'main',
    });
    // The URL should contain unescaped dots
    expect(result).toContain('https://github.com/user/repo.name/pull/5');
    expect(result).not.toContain('repo\\.name');
  });

  it('handles missing optional fields', () => {
    const result = formatPRCreated({ prNumber: 1, branchName: 'main' });
    expect(result).toContain('*Coder creó PR*');
    expect(result).not.toContain('*Archivos:*');
    expect(result).not.toContain('*Resumen:*');
  });

  it('handles empty metadata', () => {
    const result = formatPRCreated({});
    expect(result).toContain('\\#?');
  });
});

describe('formatReviewCycleEnd', () => {
  it('formats APPROVED verdict', () => {
    const result = formatReviewCycleEnd({
      verdict: 'APPROVED',
      cycle: 1,
      maxCycles: 3,
      prNumber: 10,
      score: 95,
      issuesCount: 0,
    });
    expect(result).toContain('\u2705');
    expect(result).toContain('APPROVED');
    expect(result).toContain('1/3');
    expect(result).toContain('*Score:* 95');
    expect(result).toContain('*Issues:* 0');
  });

  it('formats REQUEST_CHANGES verdict', () => {
    const result = formatReviewCycleEnd({
      verdict: 'REQUEST_CHANGES',
      cycle: 2,
      maxCycles: 3,
      prNumber: 10,
    });
    expect(result).toContain('\u{1F50D}');
    expect(result).toContain('REQUEST\\_CHANGES');
  });

  it('handles missing metadata', () => {
    const result = formatReviewCycleEnd({});
    expect(result).toContain('*Review ciclo');
    expect(result).not.toContain('*Score:*');
    expect(result).not.toContain('*Issues:*');
  });
});

describe('formatFixDone', () => {
  it('formats with cycle and summary', () => {
    const result = formatFixDone({ cycle: 2, summary: 'Fixed typo' });
    expect(result).toContain('*Coder aplicó fixes*');
    expect(result).toContain('*Ciclo:* 2');
    expect(result).toContain('*Resumen:* Fixed typo');
  });

  it('handles missing metadata', () => {
    const result = formatFixDone({});
    expect(result).toContain('*Coder aplicó fixes*');
    expect(result).not.toContain('*Resumen:*');
  });
});

describe('formatPRMerged', () => {
  it('formats with full metadata including URL', () => {
    const result = formatPRMerged({
      prNumber: 30,
      repo: 'SergioRVDev/komodo',
      taskId: 'TASK-1',
    });
    expect(result).toContain('*PR mergeada*');
    expect(result).toContain('\\#30');
    expect(result).toContain('https://github.com/SergioRVDev/komodo/pull/30');
    expect(result).toContain('`TASK\\-1`');
  });

  it('does NOT escape dots in PR URL', () => {
    const result = formatPRMerged({
      prNumber: 5,
      repo: 'user/repo.name',
    });
    expect(result).toContain('https://github.com/user/repo.name/pull/5');
    expect(result).not.toContain('repo\\.name');
  });

  it('handles missing metadata', () => {
    const result = formatPRMerged({});
    expect(result).toContain('\\#?');
    expect(result).not.toContain('*Tarea:*');
  });
});

describe('formatTaskCompleted', () => {
  it('formats with full metadata (merged)', () => {
    const result = formatTaskCompleted({
      title: 'Login feature',
      prNumber: 30,
      reviewCycles: 2,
      merged: true,
      totalDuration: 123.456,
    });
    expect(result).toContain('*Tarea completada*');
    expect(result).toContain('Login feature');
    expect(result).toContain('\\#30');
    expect(result).toContain('*Review cycles:* 2');
    expect(result).toContain('\u2705 Sí');
    expect(result).toContain('123\\.5s');
  });

  it('formats with merged=false', () => {
    const result = formatTaskCompleted({ merged: false });
    expect(result).toContain('\u23F3 Manual');
  });

  it('handles missing metadata', () => {
    const result = formatTaskCompleted({});
    expect(result).toContain('Sin título');
    expect(result).toContain('*Duración:* ?');
  });
});

describe('formatError', () => {
  it('formats with full metadata', () => {
    const result = formatError({
      title: 'Login feature',
      error: 'Timeout exceeded',
      prNumber: 30,
    });
    expect(result).toContain('*Error / Rollback*');
    expect(result).toContain('Login feature');
    expect(result).toContain('Timeout exceeded');
    expect(result).toContain('\\#30');
  });

  it('uses taskId when title is missing', () => {
    const result = formatError({ taskId: 'TASK-1', error: 'fail' });
    expect(result).toContain('TASK\\-1');
  });

  it('handles empty metadata', () => {
    const result = formatError({});
    expect(result).toContain('*Tarea:* ?');
    expect(result).toContain('Error desconocido');
    expect(result).not.toContain('*PR:*');
  });
});

// --- Recovery notification formatters ---

describe('formatCliRecovered', () => {
  it('formats with full metadata including task title', () => {
    const result = formatCliRecovered({
      cli: 'claude',
      downtimeMinutes: 15,
      taskTitle: 'Add login feature',
    });
    expect(result).toContain('*CLI recuperado*');
    expect(result).toContain('`claude`');
    expect(result).toContain('15 min');
    expect(result).toContain('*Reanudando:* Add login feature');
  });

  it('formats without task title', () => {
    const result = formatCliRecovered({
      cli: 'codex',
      downtimeMinutes: 5,
    });
    expect(result).toContain('`codex`');
    expect(result).toContain('5 min');
    expect(result).not.toContain('*Reanudando:*');
  });

  it('handles missing metadata', () => {
    const result = formatCliRecovered({});
    expect(result).toContain('`?`');
    expect(result).toContain('0 min');
  });
});

describe('formatAllClisRateLimited', () => {
  it('formats with list of CLIs', () => {
    const result = formatAllClisRateLimited({
      clis: ['claude', 'codex', 'gemini'],
    });
    expect(result).toContain('*Todos los CLIs en cooldown*');
    expect(result).toContain('claude, codex, gemini');
    expect(result).toContain('Komodo en espera');
  });

  it('handles empty CLIs array', () => {
    const result = formatAllClisRateLimited({ clis: [] });
    expect(result).toContain('?');
  });

  it('handles missing metadata', () => {
    const result = formatAllClisRateLimited({});
    expect(result).toContain('*Todos los CLIs en cooldown*');
  });
});

// --- Query command formatters ---

describe('formatStatus', () => {
  it('formats running status with active agent', () => {
    const result = formatStatus({
      executionState: 'running',
      phase: 'coding',
      activeAgent: { name: 'CODER', status: 'working' },
      currentTask: { title: 'Add login', devPoints: 5 },
      currentPR: 42,
      reviewCycle: 0,
      tasksCompleted: 2,
      totalTasks: 5,
      elapsedMs: 323000,
    });
    expect(result).toContain('RUNNING');
    expect(result).toContain('Programando');
    expect(result).toContain('CODER');
    expect(result).toContain('Add login');
    expect(result).toContain('\\#42');
    expect(result).toContain('5m');
    expect(result).toContain('2/5 tareas');
  });

  it('formats stopped/idle status', () => {
    const result = formatStatus({
      executionState: 'stopped',
      phase: 'idle',
      activeAgent: null,
      currentTask: null,
      currentPR: null,
      reviewCycle: 0,
      tasksCompleted: 0,
      totalTasks: 0,
      elapsedMs: null,
    });
    expect(result).toContain('STOPPED');
    expect(result).toContain('Inactivo');
    expect(result).not.toContain('*Agente activo:*');
    expect(result).not.toContain('*Tarea:*');
    expect(result).not.toContain('*Tiempo:*');
  });

  it('formats paused status', () => {
    const result = formatStatus({
      executionState: 'paused',
      phase: 'reviewing',
      activeAgent: null,
      currentTask: null,
      currentPR: null,
      reviewCycle: 2,
      tasksCompleted: 0,
      totalTasks: 0,
      elapsedMs: null,
    });
    expect(result).toContain('PAUSED');
    expect(result).toContain('Revisando');
    expect(result).toContain('*Review cycle:* 2');
  });
});

describe('formatTaskList', () => {
  it('formats list of tasks', () => {
    const tasks = [
      { id: '1', title: 'Add login', devPoints: 5, priority: 10 },
      { id: '2', title: 'Fix bug #123', devPoints: 2, priority: 4 },
    ];
    const result = formatTaskList(tasks);
    expect(result).toContain('Tareas to\\-do');
    expect(result).toContain('2');
    expect(result).toContain('5 pts');
    expect(result).toContain('Add login');
    expect(result).toContain('2 pts');
    expect(result).toContain('Fix bug \\#123');
  });

  it('shows empty message when no tasks', () => {
    const result = formatTaskList([]);
    expect(result).toContain('No hay tareas pendientes');
  });

  it('truncates beyond 15 items', () => {
    const tasks = Array.from({ length: 20 }, (_, i) => ({
      id: String(i), title: `Task ${i}`, devPoints: 3, priority: 1,
    }));
    const result = formatTaskList(tasks);
    expect(result).toContain('y 5 más');
    expect(result).not.toContain('Task 15');
  });
});

describe('formatBacklog', () => {
  it('formats backlog with active sprint', () => {
    const result = formatBacklog({
      pendingCount: 5,
      inProgressCount: 2,
      doneCount: 3,
      totalTasks: 10,
      totalDevPoints: 25,
      activeSprint: {
        name: 'Sprint 1',
        startDate: '2026-03-01',
        endDate: '2026-03-14',
        totalTasks: 8,
        completedTasks: 3,
      },
    });
    expect(result).toContain('Resumen del backlog');
    expect(result).toContain('*Tareas pendientes:* 5');
    expect(result).toContain('*En progreso:* 2');
    expect(result).toContain('*Completadas:* 3');
    expect(result).toContain('*Dev points pendientes:* 25');
    expect(result).toContain('Sprint 1');
    expect(result).toContain('38%');
  });

  it('formats backlog without active sprint', () => {
    const result = formatBacklog({
      pendingCount: 0,
      inProgressCount: 0,
      doneCount: 0,
      totalTasks: 0,
      totalDevPoints: 0,
      activeSprint: null,
    });
    expect(result).toContain('No hay sprint activo');
  });

  it('formats error response', () => {
    const result = formatBacklog({ error: 'No project ID configured' });
    expect(result).toContain('Error');
    expect(result).toContain('No project ID configured');
  });
});

describe('formatWeeklyDigest', () => {
  const baseMetrics = {
    projectId: 'proj-1',
    weekStart: '2026-03-02T00:00:00.000Z',
    weekEnd: '2026-03-08T23:59:59.999Z',
    tasksCompleted: 5,
    prsMerged: 4,
    bugsFound: 2,
    bugsResolved: 1,
    totalCost: 3.25,
    velocity: {
      currentWeekDevPoints: 21,
      previousWeekDevPoints: 15,
      trend: 'up',
      changePercent: 40,
    },
    topTasks: [
      { taskId: 't1', title: 'Auth system', bizPoints: 13, devPoints: 8, completedAt: '2026-03-03T10:00:00Z' },
      { taskId: 't2', title: 'Dashboard', bizPoints: 8, devPoints: 5, completedAt: '2026-03-04T10:00:00Z' },
      { taskId: 't3', title: 'CI pipeline', bizPoints: 5, devPoints: 3, completedAt: '2026-03-05T10:00:00Z' },
    ],
    criticalBugsOpen: [],
  };

  it('includes all main sections', () => {
    const result = formatWeeklyDigest(baseMetrics);
    expect(result).toContain('*Resumen semanal*');
    expect(result).toContain('*Resumen*');
    expect(result).toContain('*Top tareas completadas*');
    expect(result).toContain('*Costes*');
    expect(result).toContain('*Velocity*');
  });

  it('shows correct summary numbers', () => {
    const result = formatWeeklyDigest(baseMetrics);
    expect(result).toContain('*Tareas completadas:* 5');
    expect(result).toContain('*PRs mergeados:* 4');
    expect(result).toContain('*Bugs encontrados:* 2');
    expect(result).toContain('*Bugs resueltos:* 1');
  });

  it('shows top tasks with medals and bizPoints', () => {
    const result = formatWeeklyDigest(baseMetrics);
    expect(result).toContain('\u{1F947}');
    expect(result).toContain('Auth system');
    expect(result).toContain('13 bizPts');
    expect(result).toContain('\u{1F948}');
    expect(result).toContain('Dashboard');
    expect(result).toContain('\u{1F949}');
    expect(result).toContain('CI pipeline');
  });

  it('shows up trend emoji for increasing velocity', () => {
    const result = formatWeeklyDigest(baseMetrics);
    expect(result).toContain('\u{1F4C8}');
    expect(result).toContain('21 devPts');
    expect(result).toContain('15 devPts');
    expect(result).toContain('40%');
  });

  it('shows down trend emoji for decreasing velocity', () => {
    const metrics = {
      ...baseMetrics,
      velocity: { currentWeekDevPoints: 10, previousWeekDevPoints: 20, trend: 'down', changePercent: -50 },
    };
    const result = formatWeeklyDigest(metrics);
    expect(result).toContain('\u{1F4C9}');
    expect(result).toContain('50%');
  });

  it('shows stable trend emoji', () => {
    const metrics = {
      ...baseMetrics,
      velocity: { currentWeekDevPoints: 10, previousWeekDevPoints: 10, trend: 'stable', changePercent: 0 },
    };
    const result = formatWeeklyDigest(metrics);
    expect(result).toContain('\u27A1');
  });

  it('shows critical bugs warning when present', () => {
    const metrics = {
      ...baseMetrics,
      criticalBugsOpen: [
        { id: 'b1', title: 'Login crash', severity: 'critical', status: 'open', warning: true },
        { id: 'b2', title: 'Data loss on save', severity: 'critical', status: 'open', warning: true },
      ],
    };
    const result = formatWeeklyDigest(metrics);
    expect(result).toContain('\u26A0\uFE0F');
    expect(result).toContain('Bugs critical abiertos');
    expect(result).toContain('2');
    expect(result).toContain('Login crash');
    expect(result).toContain('Data loss on save');
    expect(result).toContain('\u{1F534}');
  });

  it('omits critical bugs section when none exist', () => {
    const result = formatWeeklyDigest(baseMetrics);
    expect(result).not.toContain('Bugs critical abiertos');
  });

  it('omits top tasks section when no tasks completed', () => {
    const metrics = { ...baseMetrics, topTasks: [] };
    const result = formatWeeklyDigest(metrics);
    expect(result).not.toContain('Top tareas completadas');
  });

  it('shows cost', () => {
    const result = formatWeeklyDigest(baseMetrics);
    expect(result).toContain('$3\\.25');
  });
});
