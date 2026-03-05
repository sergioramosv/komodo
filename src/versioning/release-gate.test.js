import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../config.js', () => ({
  config: {
    releaseIgnoreBugs: false,
  },
}));

vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../events/event-bus.js', () => ({
  eventBus: { emitEvent: vi.fn() },
  EVENT_TYPES: {
    RELEASE_GATE_PASSED: 'release:gate:passed',
    RELEASE_GATE_BLOCKED: 'release:gate:blocked',
  },
}));

vi.mock('../../skills/planning-task-mcp/src/firebase.js', () => ({
  getAll: vi.fn(),
}));

const { config } = await import('../config.js');
const { eventBus, EVENT_TYPES } = await import('../events/event-bus.js');
const { getAll } = await import('../../skills/planning-task-mcp/src/firebase.js');
const { checkReleaseGate, evaluateReleaseGate } = await import('./release-gate.js');

describe('release-gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    config.releaseIgnoreBugs = false;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── checkReleaseGate ───

  describe('checkReleaseGate', () => {
    it('returns ready=true when no bugs exist', async () => {
      getAll.mockResolvedValue([]);

      const result = await checkReleaseGate('proj1');
      expect(result.ready).toBe(true);
      expect(result.blockingBugs).toHaveLength(0);
    });

    it('returns ready=true when only low/medium bugs exist', async () => {
      getAll.mockResolvedValue([
        { id: 'b1', projectId: 'proj1', severity: 'low', status: 'open', title: 'Minor UI issue' },
        { id: 'b2', projectId: 'proj1', severity: 'medium', status: 'open', title: 'Moderate issue' },
      ]);

      const result = await checkReleaseGate('proj1');
      expect(result.ready).toBe(true);
      expect(result.blockingBugs).toHaveLength(0);
    });

    it('returns ready=false when critical bugs are open', async () => {
      getAll.mockResolvedValue([
        { id: 'b1', projectId: 'proj1', severity: 'critical', status: 'open', title: 'Data loss bug' },
      ]);

      const result = await checkReleaseGate('proj1');
      expect(result.ready).toBe(false);
      expect(result.blockingBugs).toHaveLength(1);
      expect(result.blockingBugs[0].severity).toBe('critical');
    });

    it('returns ready=false when high bugs are in-progress', async () => {
      getAll.mockResolvedValue([
        { id: 'b1', projectId: 'proj1', severity: 'high', status: 'in-progress', title: 'Auth bypass' },
      ]);

      const result = await checkReleaseGate('proj1');
      expect(result.ready).toBe(false);
      expect(result.blockingBugs).toHaveLength(1);
    });

    it('ignores resolved/closed critical bugs', async () => {
      getAll.mockResolvedValue([
        { id: 'b1', projectId: 'proj1', severity: 'critical', status: 'resolved', title: 'Fixed bug' },
        { id: 'b2', projectId: 'proj1', severity: 'high', status: 'closed', title: 'Closed bug' },
      ]);

      const result = await checkReleaseGate('proj1');
      expect(result.ready).toBe(true);
      expect(result.blockingBugs).toHaveLength(0);
    });

    it('only considers bugs from the specified project', async () => {
      getAll.mockResolvedValue([
        { id: 'b1', projectId: 'proj1', severity: 'critical', status: 'open', title: 'Bug in proj1' },
        { id: 'b2', projectId: 'proj2', severity: 'critical', status: 'open', title: 'Bug in proj2' },
      ]);

      const result = await checkReleaseGate('proj1');
      expect(result.blockingBugs).toHaveLength(1);
      expect(result.blockingBugs[0].id).toBe('b1');
    });

    it('returns multiple blocking bugs of mixed severity', async () => {
      getAll.mockResolvedValue([
        { id: 'b1', projectId: 'proj1', severity: 'critical', status: 'open', title: 'Critical bug' },
        { id: 'b2', projectId: 'proj1', severity: 'high', status: 'open', title: 'High bug' },
        { id: 'b3', projectId: 'proj1', severity: 'low', status: 'open', title: 'Low bug' },
      ]);

      const result = await checkReleaseGate('proj1');
      expect(result.ready).toBe(false);
      expect(result.blockingBugs).toHaveLength(2);
    });
  });

  // ─── evaluateReleaseGate ───

  describe('evaluateReleaseGate', () => {
    it('emits RELEASE_GATE_PASSED when no blocking bugs', async () => {
      getAll.mockResolvedValue([]);

      const result = await evaluateReleaseGate('proj1');
      expect(result.allowed).toBe(true);
      expect(result.overridden).toBe(false);
      expect(eventBus.emitEvent).toHaveBeenCalledWith(
        EVENT_TYPES.RELEASE_GATE_PASSED,
        expect.objectContaining({ metadata: { projectId: 'proj1' } }),
      );
    });

    it('emits RELEASE_GATE_BLOCKED and denies release with blocking bugs', async () => {
      getAll.mockResolvedValue([
        { id: 'b1', projectId: 'proj1', severity: 'critical', status: 'open', title: 'Crash on login' },
      ]);

      const result = await evaluateReleaseGate('proj1');
      expect(result.allowed).toBe(false);
      expect(result.overridden).toBe(false);
      expect(result.blockingBugs).toHaveLength(1);

      expect(eventBus.emitEvent).toHaveBeenCalledWith(
        EVENT_TYPES.RELEASE_GATE_BLOCKED,
        expect.objectContaining({
          metadata: expect.objectContaining({
            projectId: 'proj1',
            overridden: false,
            blockingBugs: [
              expect.objectContaining({ id: 'b1', severity: 'critical' }),
            ],
          }),
        }),
      );
    });

    it('allows release with RELEASE_IGNORE_BUGS=true override', async () => {
      config.releaseIgnoreBugs = true;

      getAll.mockResolvedValue([
        { id: 'b1', projectId: 'proj1', severity: 'critical', status: 'open', title: 'Known issue' },
      ]);

      const result = await evaluateReleaseGate('proj1');
      expect(result.allowed).toBe(true);
      expect(result.overridden).toBe(true);
      expect(result.blockingBugs).toHaveLength(1);

      expect(eventBus.emitEvent).toHaveBeenCalledWith(
        EVENT_TYPES.RELEASE_GATE_BLOCKED,
        expect.objectContaining({
          metadata: expect.objectContaining({ overridden: true }),
        }),
      );
    });

    it('re-evaluates correctly after bugs are resolved', async () => {
      // First call: bug open
      getAll.mockResolvedValue([
        { id: 'b1', projectId: 'proj1', severity: 'critical', status: 'open', title: 'Bug' },
      ]);

      const result1 = await evaluateReleaseGate('proj1');
      expect(result1.allowed).toBe(false);

      // Second call: bug resolved
      getAll.mockResolvedValue([
        { id: 'b1', projectId: 'proj1', severity: 'critical', status: 'resolved', title: 'Bug' },
      ]);

      const result2 = await evaluateReleaseGate('proj1');
      expect(result2.allowed).toBe(true);
    });
  });
});
