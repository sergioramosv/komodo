import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AUTONOMY_LEVELS, AUTONOMY_STEPS, createAutonomyEngine } from './autonomy-engine.js';

// Mock dependencies
vi.mock('../config.js', () => ({
  config: {
    autonomyLevel: 'autonomous',
    approvalTimeoutMinutes: 0.05, // 3 seconds for tests
    guardianMaxDiffLines: 500,
    guardianMaxComplexity: 8,
    autonomyLowScoreThreshold: 5.0,
  },
}));

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../events/event-bus.js', () => ({
  eventBus: { emitEvent: vi.fn() },
  EVENT_TYPES: {
    AUTONOMY_LEVEL_CHANGED: 'autonomy:level-changed',
    AUTONOMY_APPROVAL_REQUESTED: 'autonomy:approval-requested',
    AUTONOMY_APPROVAL_GRANTED: 'autonomy:approval-granted',
    AUTONOMY_APPROVAL_TIMED_OUT: 'autonomy:approval-timed-out',
  },
}));

vi.mock('../state/komodo-state.js', () => {
  const EXECUTION_STATES = {
    STOPPED: 'stopped',
    RUNNING: 'running',
    PAUSED: 'paused',
    AWAITING_APPROVAL: 'awaiting-approval',
  };
  const komodoState = {
    _approvalGranted: false,
    executionState: EXECUTION_STATES.RUNNING,
    setExecutionState: vi.fn(function(s) { this.executionState = s; }),
    resetApproval: vi.fn(function() { this._approvalGranted = false; }),
    isApprovalGranted: vi.fn(function() { return this._approvalGranted; }),
    grantApproval: vi.fn(function() { this._approvalGranted = true; this.executionState = EXECUTION_STATES.RUNNING; }),
  };
  return { komodoState, EXECUTION_STATES };
});

describe('AUTONOMY_LEVELS', () => {
  it('exports all 4 levels', () => {
    expect(AUTONOMY_LEVELS.SUPERVISED).toBe('supervised');
    expect(AUTONOMY_LEVELS.SEMI_AUTONOMOUS).toBe('semi-autonomous');
    expect(AUTONOMY_LEVELS.AUTONOMOUS).toBe('autonomous');
    expect(AUTONOMY_LEVELS.GUARDIAN).toBe('guardian');
  });
});

describe('AUTONOMY_STEPS', () => {
  it('exports all 4 steps', () => {
    expect(AUTONOMY_STEPS.AFTER_PLAN).toBeDefined();
    expect(AUTONOMY_STEPS.AFTER_ARCHITECT).toBeDefined();
    expect(AUTONOMY_STEPS.AFTER_CODE).toBeDefined();
    expect(AUTONOMY_STEPS.BEFORE_MERGE).toBeDefined();
  });
});

describe('createAutonomyEngine', () => {
  describe('SUPERVISED level', () => {
    it('should pause on every step', () => {
      const engine = createAutonomyEngine({ level: AUTONOMY_LEVELS.SUPERVISED });
      expect(engine.shouldPause(AUTONOMY_STEPS.AFTER_PLAN)).toBe(true);
      expect(engine.shouldPause(AUTONOMY_STEPS.AFTER_ARCHITECT)).toBe(true);
      expect(engine.shouldPause(AUTONOMY_STEPS.AFTER_CODE)).toBe(true);
      expect(engine.shouldPause(AUTONOMY_STEPS.BEFORE_MERGE)).toBe(true);
    });
  });

  describe('AUTONOMOUS level', () => {
    it('should never pause on any step', () => {
      const engine = createAutonomyEngine({ level: AUTONOMY_LEVELS.AUTONOMOUS });
      expect(engine.shouldPause(AUTONOMY_STEPS.AFTER_PLAN)).toBe(false);
      expect(engine.shouldPause(AUTONOMY_STEPS.AFTER_ARCHITECT)).toBe(false);
      expect(engine.shouldPause(AUTONOMY_STEPS.AFTER_CODE)).toBe(false);
      expect(engine.shouldPause(AUTONOMY_STEPS.BEFORE_MERGE)).toBe(false);
    });
  });

  describe('SEMI_AUTONOMOUS level', () => {
    it('should pause before merge', () => {
      const engine = createAutonomyEngine({ level: AUTONOMY_LEVELS.SEMI_AUTONOMOUS });
      expect(engine.shouldPause(AUTONOMY_STEPS.BEFORE_MERGE)).toBe(true);
    });

    it('should NOT pause after plan or architect', () => {
      const engine = createAutonomyEngine({ level: AUTONOMY_LEVELS.SEMI_AUTONOMOUS });
      expect(engine.shouldPause(AUTONOMY_STEPS.AFTER_PLAN)).toBe(false);
      expect(engine.shouldPause(AUTONOMY_STEPS.AFTER_ARCHITECT)).toBe(false);
    });

    it('should pause after code when review score is low', () => {
      const engine = createAutonomyEngine({ level: AUTONOMY_LEVELS.SEMI_AUTONOMOUS });
      expect(engine.shouldPause(AUTONOMY_STEPS.AFTER_CODE, { reviewScore: 4.5 })).toBe(true);
    });

    it('should NOT pause after code when review score is above threshold', () => {
      const engine = createAutonomyEngine({ level: AUTONOMY_LEVELS.SEMI_AUTONOMOUS });
      expect(engine.shouldPause(AUTONOMY_STEPS.AFTER_CODE, { reviewScore: 7.0 })).toBe(false);
    });

    it('should NOT pause after code when no review score provided', () => {
      const engine = createAutonomyEngine({ level: AUTONOMY_LEVELS.SEMI_AUTONOMOUS });
      expect(engine.shouldPause(AUTONOMY_STEPS.AFTER_CODE)).toBe(false);
    });
  });

  describe('GUARDIAN level', () => {
    it('should pause when diff lines exceed threshold', () => {
      const engine = createAutonomyEngine({ level: AUTONOMY_LEVELS.GUARDIAN });
      expect(engine.shouldPause(AUTONOMY_STEPS.BEFORE_MERGE, { diffLines: 501 })).toBe(true);
    });

    it('should pause when complexity exceeds threshold', () => {
      const engine = createAutonomyEngine({ level: AUTONOMY_LEVELS.GUARDIAN });
      expect(engine.shouldPause(AUTONOMY_STEPS.BEFORE_MERGE, { complexity: 9 })).toBe(true);
    });

    it('should NOT pause when within thresholds', () => {
      const engine = createAutonomyEngine({ level: AUTONOMY_LEVELS.GUARDIAN });
      expect(engine.shouldPause(AUTONOMY_STEPS.BEFORE_MERGE, { diffLines: 100, complexity: 3 })).toBe(false);
    });

    it('should NOT pause when no context provided', () => {
      const engine = createAutonomyEngine({ level: AUTONOMY_LEVELS.GUARDIAN });
      expect(engine.shouldPause(AUTONOMY_STEPS.BEFORE_MERGE)).toBe(false);
    });
  });

  describe('checkPoint', () => {
    it('returns true immediately when shouldPause is false (AUTONOMOUS)', async () => {
      const engine = createAutonomyEngine({ level: AUTONOMY_LEVELS.AUTONOMOUS });
      const result = await engine.checkPoint(AUTONOMY_STEPS.AFTER_PLAN);
      expect(result).toBe(true);
    });

    it('returns false on timeout when no approval comes (SUPERVISED)', async () => {
      const { komodoState } = await import('../state/komodo-state.js');
      komodoState._approvalGranted = false;
      komodoState.isApprovalGranted.mockReturnValue(false);

      const engine = createAutonomyEngine({ level: AUTONOMY_LEVELS.SUPERVISED });
      // approvalTimeoutMinutes is 0.05 (3s) in mocked config
      const result = await engine.checkPoint(AUTONOMY_STEPS.AFTER_PLAN, { taskId: 'test-task' });
      expect(result).toBe(false);
    }, 10000);

    it('returns true when approval is granted before timeout (SUPERVISED)', async () => {
      const { komodoState } = await import('../state/komodo-state.js');
      komodoState._approvalGranted = false;

      // Grant approval after 500ms
      let callCount = 0;
      komodoState.isApprovalGranted.mockImplementation(() => {
        callCount++;
        return callCount > 2; // returns true on 3rd call (~1s)
      });

      const engine = createAutonomyEngine({ level: AUTONOMY_LEVELS.SUPERVISED });
      const result = await engine.checkPoint(AUTONOMY_STEPS.AFTER_PLAN, { taskId: 'test-task' });
      expect(result).toBe(true);
    }, 10000);
  });
});
