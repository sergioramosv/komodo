import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Hoisted mocks ---

const { mockDbRef, mockGetAll } = vi.hoisted(() => {
  const mockDbRef = {
    once: vi.fn().mockResolvedValue({ val: () => null }),
  };

  return {
    mockDbRef,
    mockGetAll: vi.fn().mockResolvedValue([]),
  };
});

vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../skills/planning-task-mcp/src/firebase.js', () => ({
  getAll: mockGetAll,
  getDb: vi.fn(() => ({ ref: vi.fn(() => mockDbRef) })),
}));

import { collectWeeklyMetrics, getWeekRange, calculateVelocityTrend } from './weekly-metrics.js';

// --- Helpers ---

function msToIso(ms) {
  return new Date(ms).toISOString();
}

/** Returns a timestamp within the current week (relative to a reference date). */
function thisWeekMs(referenceDate = new Date(), offsetDays = 0) {
  const ref = new Date(referenceDate);
  const dayOfWeek = ref.getDay();
  const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const monday = new Date(ref);
  monday.setDate(ref.getDate() - daysFromMonday + offsetDays);
  monday.setHours(12, 0, 0, 0);
  return monday.getTime();
}

function lastWeekMs(referenceDate = new Date()) {
  return thisWeekMs(referenceDate, -7);
}

const REFERENCE_DATE = new Date('2026-03-11T10:00:00Z'); // Wednesday

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAll.mockResolvedValue([]);
  mockDbRef.once.mockResolvedValue({ val: () => null });
});

// --- getWeekRange ---

describe('getWeekRange', () => {
  it('starts on Monday for a Wednesday reference', () => {
    const range = getWeekRange(0, REFERENCE_DATE);
    const start = new Date(range.startMs);
    expect(start.getDay()).toBe(1); // Monday
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
  });

  it('ends just before next Monday', () => {
    const range = getWeekRange(0, REFERENCE_DATE);
    const end = new Date(range.endMs + 1);
    expect(end.getDay()).toBe(1); // Next Monday at 00:00:00.000
    expect(end.getHours()).toBe(0);
  });

  it('previous week (offset -1) ends before current week start', () => {
    const current = getWeekRange(0, REFERENCE_DATE);
    const previous = getWeekRange(-1, REFERENCE_DATE);
    expect(previous.endMs).toBeLessThan(current.startMs);
  });

  it('starts on Monday for a Sunday reference', () => {
    const sunday = new Date('2026-03-15T10:00:00Z'); // Sunday
    const range = getWeekRange(0, sunday);
    const start = new Date(range.startMs);
    expect(start.getDay()).toBe(1); // Monday of that week
  });

  it('current week contains the reference date', () => {
    const range = getWeekRange(0, REFERENCE_DATE);
    expect(REFERENCE_DATE.getTime()).toBeGreaterThanOrEqual(range.startMs);
    expect(REFERENCE_DATE.getTime()).toBeLessThanOrEqual(range.endMs);
  });
});

// --- calculateVelocityTrend ---

describe('calculateVelocityTrend', () => {
  it('returns "up" when current > previous', () => {
    const result = calculateVelocityTrend(10, 8);
    expect(result.trend).toBe('up');
    expect(result.changePercent).toBe(25);
  });

  it('returns "down" when current < previous', () => {
    const result = calculateVelocityTrend(6, 10);
    expect(result.trend).toBe('down');
    expect(result.changePercent).toBe(-40);
  });

  it('returns "stable" when current equals previous', () => {
    const result = calculateVelocityTrend(8, 8);
    expect(result.trend).toBe('stable');
    expect(result.changePercent).toBe(0);
  });

  it('returns "up" when previous is 0 and current > 0', () => {
    const result = calculateVelocityTrend(5, 0);
    expect(result.trend).toBe('up');
    expect(result.changePercent).toBe(100);
  });

  it('returns "stable" when both are 0', () => {
    const result = calculateVelocityTrend(0, 0);
    expect(result.trend).toBe('stable');
    expect(result.changePercent).toBe(0);
  });
});

// --- collectWeeklyMetrics ---

describe('collectWeeklyMetrics', () => {
  const PROJECT_ID = 'proj-1';

  it('returns zeroed metrics when no data exists', async () => {
    const result = await collectWeeklyMetrics(PROJECT_ID, { referenceDate: REFERENCE_DATE });

    expect(result.projectId).toBe(PROJECT_ID);
    expect(result.tasksCompleted).toBe(0);
    expect(result.prsMerged).toBe(0);
    expect(result.bugsFound).toBe(0);
    expect(result.bugsResolved).toBe(0);
    expect(result.totalCost).toBe(0);
    expect(result.velocity.currentWeekDevPoints).toBe(0);
    expect(result.topTasks).toEqual([]);
    expect(result.criticalBugsOpen).toEqual([]);
  });

  it('counts tasks completed this week from metrics records', async () => {
    const completedAtMs = thisWeekMs(REFERENCE_DATE);

    mockDbRef.once.mockResolvedValue({
      val: () => ({
        'task-1': { taskId: 'task-1', completedAt: msToIso(completedAtMs), merged: true, cost: 0.1, estimatedDevPoints: 3 },
        'task-2': { taskId: 'task-2', completedAt: msToIso(completedAtMs), merged: false, cost: 0.05, estimatedDevPoints: 2 },
      }),
    });

    const result = await collectWeeklyMetrics(PROJECT_ID, { referenceDate: REFERENCE_DATE });

    expect(result.tasksCompleted).toBe(2);
    expect(result.prsMerged).toBe(1);
    expect(result.totalCost).toBeCloseTo(0.15, 4);
  });

  it('excludes metrics records from outside the current week', async () => {
    const lastWeekMs_ = lastWeekMs(REFERENCE_DATE);
    const currentWeekMs = thisWeekMs(REFERENCE_DATE);

    mockDbRef.once.mockResolvedValue({
      val: () => ({
        'task-old': { taskId: 'task-old', completedAt: msToIso(lastWeekMs_), merged: true, cost: 0.2 },
        'task-new': { taskId: 'task-new', completedAt: msToIso(currentWeekMs), merged: true, cost: 0.1 },
      }),
    });

    const result = await collectWeeklyMetrics(PROJECT_ID, { referenceDate: REFERENCE_DATE });

    expect(result.tasksCompleted).toBe(1);
    expect(result.prsMerged).toBe(1);
  });

  it('calculates velocity using devPoints from task data when available', async () => {
    const currentMs = thisWeekMs(REFERENCE_DATE);
    const prevMs = lastWeekMs(REFERENCE_DATE);

    mockGetAll.mockResolvedValue([
      { id: 'task-1', projectId: PROJECT_ID, title: 'Task 1', bizPoints: 8, devPoints: 5, status: 'done' },
      { id: 'task-2', projectId: PROJECT_ID, title: 'Task 2', bizPoints: 5, devPoints: 3, status: 'done' },
    ]);

    mockDbRef.once.mockResolvedValue({
      val: () => ({
        'task-1': { taskId: 'task-1', completedAt: msToIso(currentMs), merged: true, estimatedDevPoints: 3 },
        'task-2': { taskId: 'task-2', completedAt: msToIso(prevMs), merged: true, estimatedDevPoints: 2 },
      }),
    });

    const result = await collectWeeklyMetrics(PROJECT_ID, { referenceDate: REFERENCE_DATE });

    // Current week: task-1 with devPoints=5 (from task data, not estimatedDevPoints=3)
    expect(result.velocity.currentWeekDevPoints).toBe(5);
    // Previous week: task-2 with devPoints=3
    expect(result.velocity.previousWeekDevPoints).toBe(3);
    expect(result.velocity.trend).toBe('up');
  });

  it('falls back to estimatedDevPoints when task data is not found', async () => {
    const currentMs = thisWeekMs(REFERENCE_DATE);

    mockDbRef.once.mockResolvedValue({
      val: () => ({
        'task-unknown': { taskId: 'task-unknown', completedAt: msToIso(currentMs), merged: false, estimatedDevPoints: 8 },
      }),
    });

    const result = await collectWeeklyMetrics(PROJECT_ID, { referenceDate: REFERENCE_DATE });

    expect(result.velocity.currentWeekDevPoints).toBe(8);
  });

  it('returns top 3 tasks sorted by bizPoints descending', async () => {
    const currentMs = thisWeekMs(REFERENCE_DATE);

    mockGetAll.mockResolvedValue([
      { id: 'task-1', projectId: PROJECT_ID, title: 'Low value', bizPoints: 2, devPoints: 1 },
      { id: 'task-2', projectId: PROJECT_ID, title: 'High value', bizPoints: 13, devPoints: 5 },
      { id: 'task-3', projectId: PROJECT_ID, title: 'Medium value', bizPoints: 5, devPoints: 3 },
      { id: 'task-4', projectId: PROJECT_ID, title: 'Very high', bizPoints: 8, devPoints: 2 },
    ]);

    mockDbRef.once.mockResolvedValue({
      val: () => ({
        'task-1': { taskId: 'task-1', completedAt: msToIso(currentMs), merged: true },
        'task-2': { taskId: 'task-2', completedAt: msToIso(currentMs), merged: true },
        'task-3': { taskId: 'task-3', completedAt: msToIso(currentMs), merged: true },
        'task-4': { taskId: 'task-4', completedAt: msToIso(currentMs), merged: true },
      }),
    });

    const result = await collectWeeklyMetrics(PROJECT_ID, { referenceDate: REFERENCE_DATE });

    expect(result.topTasks).toHaveLength(3);
    expect(result.topTasks[0].title).toBe('High value');
    expect(result.topTasks[1].title).toBe('Very high');
    expect(result.topTasks[2].title).toBe('Medium value');
  });

  it('counts bugs found this week by createdAt', async () => {
    const currentMs = thisWeekMs(REFERENCE_DATE);
    const oldMs = lastWeekMs(REFERENCE_DATE);

    mockGetAll.mockResolvedValue([
      { id: 'bug-1', projectId: PROJECT_ID, title: 'Old bug', severity: 'high', status: 'open', createdAt: oldMs, updatedAt: oldMs },
      { id: 'bug-2', projectId: PROJECT_ID, title: 'New bug', severity: 'medium', status: 'open', createdAt: currentMs, updatedAt: currentMs },
      { id: 'bug-3', projectId: PROJECT_ID, title: 'Another new', severity: 'low', status: 'open', createdAt: currentMs, updatedAt: currentMs },
    ]);

    const result = await collectWeeklyMetrics(PROJECT_ID, { referenceDate: REFERENCE_DATE });

    expect(result.bugsFound).toBe(2);
  });

  it('counts bugs resolved this week by updatedAt and status', async () => {
    const currentMs = thisWeekMs(REFERENCE_DATE);
    const oldMs = lastWeekMs(REFERENCE_DATE);

    mockGetAll.mockResolvedValue([
      { id: 'bug-1', projectId: PROJECT_ID, title: 'Old resolved', severity: 'high', status: 'resolved', createdAt: oldMs, updatedAt: oldMs },
      { id: 'bug-2', projectId: PROJECT_ID, title: 'New resolved', severity: 'medium', status: 'resolved', createdAt: oldMs, updatedAt: currentMs },
      { id: 'bug-3', projectId: PROJECT_ID, title: 'New closed', severity: 'low', status: 'closed', createdAt: oldMs, updatedAt: currentMs },
      { id: 'bug-4', projectId: PROJECT_ID, title: 'Still open', severity: 'high', status: 'open', createdAt: oldMs, updatedAt: currentMs },
    ]);

    const result = await collectWeeklyMetrics(PROJECT_ID, { referenceDate: REFERENCE_DATE });

    expect(result.bugsResolved).toBe(2); // bug-2 and bug-3
  });

  it('detects critical open bugs with warning flag', async () => {
    mockGetAll.mockResolvedValue([
      { id: 'bug-1', projectId: PROJECT_ID, title: 'Critical open', severity: 'critical', status: 'open', createdAt: 0, updatedAt: 0 },
      { id: 'bug-2', projectId: PROJECT_ID, title: 'Critical resolved', severity: 'critical', status: 'resolved', createdAt: 0, updatedAt: 0 },
      { id: 'bug-3', projectId: PROJECT_ID, title: 'High open', severity: 'high', status: 'open', createdAt: 0, updatedAt: 0 },
    ]);

    const result = await collectWeeklyMetrics(PROJECT_ID, { referenceDate: REFERENCE_DATE });

    expect(result.criticalBugsOpen).toHaveLength(1);
    expect(result.criticalBugsOpen[0].id).toBe('bug-1');
    expect(result.criticalBugsOpen[0].warning).toBe(true);
    expect(result.criticalBugsOpen[0].severity).toBe('critical');
  });

  it('filters data by projectId to avoid mixing projects', async () => {
    const currentMs = thisWeekMs(REFERENCE_DATE);

    mockGetAll.mockResolvedValue([
      { id: 'task-1', projectId: PROJECT_ID, title: 'My task', bizPoints: 5, devPoints: 3 },
      { id: 'task-other', projectId: 'other-proj', title: 'Other task', bizPoints: 8, devPoints: 5 },
      { id: 'bug-1', projectId: PROJECT_ID, title: 'My bug', severity: 'critical', status: 'open', createdAt: currentMs, updatedAt: currentMs },
      { id: 'bug-other', projectId: 'other-proj', title: 'Other bug', severity: 'critical', status: 'open', createdAt: currentMs, updatedAt: currentMs },
    ]);

    mockDbRef.once.mockResolvedValue({
      val: () => ({
        'task-1': { taskId: 'task-1', completedAt: msToIso(currentMs), merged: true },
      }),
    });

    const result = await collectWeeklyMetrics(PROJECT_ID, { referenceDate: REFERENCE_DATE });

    expect(result.tasksCompleted).toBe(1);
    expect(result.criticalBugsOpen).toHaveLength(1);
    expect(result.criticalBugsOpen[0].id).toBe('bug-1');
    expect(result.bugsFound).toBe(1);
  });

  it('handles Firebase errors gracefully and returns partial data', async () => {
    mockGetAll.mockRejectedValue(new Error('Firebase down'));
    mockDbRef.once.mockRejectedValue(new Error('Firebase down'));

    const result = await collectWeeklyMetrics(PROJECT_ID, { referenceDate: REFERENCE_DATE });

    expect(result.tasksCompleted).toBe(0);
    expect(result.bugsFound).toBe(0);
    expect(result.criticalBugsOpen).toEqual([]);
  });

  it('includes weekStart and weekEnd in ISO format', async () => {
    const result = await collectWeeklyMetrics(PROJECT_ID, { referenceDate: REFERENCE_DATE });

    expect(result.weekStart).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.weekEnd).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(new Date(result.weekStart).getDay()).toBe(1); // Monday
  });

  it('rounds totalCost to 4 decimal places', async () => {
    const currentMs = thisWeekMs(REFERENCE_DATE);

    mockDbRef.once.mockResolvedValue({
      val: () => ({
        'task-1': { taskId: 'task-1', completedAt: msToIso(currentMs), cost: 0.123456789 },
        'task-2': { taskId: 'task-2', completedAt: msToIso(currentMs), cost: 0.111111111 },
      }),
    });

    const result = await collectWeeklyMetrics(PROJECT_ID, { referenceDate: REFERENCE_DATE });

    // 0.123456789 + 0.111111111 = 0.2346 (rounded to 4 dp)
    expect(result.totalCost).toBe(Math.round((0.123456789 + 0.111111111) * 10000) / 10000);
  });
});
