import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./base-agent.js', () => ({
  runAgent: vi.fn(),
}));

vi.mock('../prompts/tester-system.js', () => ({
  getTesterSystemPrompt: vi.fn().mockReturnValue('system prompt'),
}));

vi.mock('../config.js', () => ({
  config: { forceModel_TESTER: null },
}));

vi.mock('../utils/logger.js', () => ({
  logger: {
    taskHeader: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock('../utils/parser.js', () => ({
  validateAgentResponse: vi.fn().mockReturnValue({ valid: true, missing: [] }),
}));

vi.mock('../events/event-bus.js', () => ({
  eventBus: { emitEvent: vi.fn() },
  EVENT_TYPES: {
    AGENT_STATE_CHANGE: 'agent:state-change',
    TESTER_TESTS_GENERATED: 'tester:tests-generated',
  },
  AGENT_STATES: {
    IDLE: 'idle',
    WORKING: 'working',
    WAITING: 'waiting',
  },
}));

vi.mock('../knowledge/knowledge-graph.js', () => ({
  buildTesterContext: vi.fn().mockReturnValue(null),
}));

import { runTesterAgent } from './tester.js';
import { runAgent } from './base-agent.js';
import { eventBus, EVENT_TYPES, AGENT_STATES } from '../events/event-bus.js';

const taskSpec = {
  taskId: 'task-abc',
  title: 'My Task',
  acceptanceCriteria: ['criterion 1'],
};

const baseOptions = {
  taskSpec,
  filesChanged: ['src/foo.js'],
  branchName: 'feature/my-branch',
  repo: 'owner/repo',
  prNumber: 42,
  projectId: null,
};

describe('runTesterAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('emite AGENT_STATE_CHANGE working con metadata al inicio', async () => {
    runAgent.mockResolvedValue({ success: false, result: null, cost: 0, duration: 100, error: 'fail' });

    await runTesterAgent(baseOptions);

    expect(eventBus.emitEvent).toHaveBeenNthCalledWith(1, EVENT_TYPES.AGENT_STATE_CHANGE, {
      agentName: 'TESTER',
      previousState: AGENT_STATES.IDLE,
      newState: AGENT_STATES.WORKING,
      metadata: { phase: 'testing', taskId: taskSpec.taskId, taskTitle: taskSpec.title },
    });
  });

  it('emite AGENT_STATE_CHANGE idle al finalizar con error de runAgent', async () => {
    runAgent.mockResolvedValue({ success: false, result: null, cost: 0, duration: 100, error: 'fail' });

    const result = await runTesterAgent(baseOptions);

    expect(result.success).toBe(false);
    const idleCall = eventBus.emitEvent.mock.calls.find(
      ([type, data]) => type === EVENT_TYPES.AGENT_STATE_CHANGE && data.newState === AGENT_STATES.IDLE,
    );
    expect(idleCall).toBeDefined();
    expect(idleCall[1]).toMatchObject({
      agentName: 'TESTER',
      previousState: AGENT_STATES.WORKING,
      newState: AGENT_STATES.IDLE,
      metadata: { phase: 'idle' },
    });
  });

  it('emite AGENT_STATE_CHANGE idle al finalizar con éxito', async () => {
    runAgent.mockResolvedValue({
      success: true,
      result: { testsGenerated: 3, testsPassed: 3, testsFailed: 0, coverage: '80%', filesCreated: [], filesChanged: [], pushed: true, failedTests: [], summary: 'ok' },
      cost: 0.01,
      duration: 200,
    });

    const result = await runTesterAgent(baseOptions);

    expect(result.success).toBe(true);
    const idleCall = eventBus.emitEvent.mock.calls.find(
      ([type, data]) => type === EVENT_TYPES.AGENT_STATE_CHANGE && data.newState === AGENT_STATES.IDLE,
    );
    expect(idleCall).toBeDefined();
    expect(idleCall[1]).toMatchObject({
      agentName: 'TESTER',
      previousState: AGENT_STATES.WORKING,
      newState: AGENT_STATES.IDLE,
      metadata: { phase: 'idle' },
    });
  });

  it('emite exactamente 2 eventos AGENT_STATE_CHANGE en flujo exitoso (working + idle)', async () => {
    runAgent.mockResolvedValue({
      success: true,
      result: { testsGenerated: 1, testsPassed: 1, testsFailed: 0, coverage: null, filesCreated: [], filesChanged: [], pushed: true, failedTests: [], summary: 'ok' },
      cost: 0.01,
      duration: 100,
    });

    await runTesterAgent(baseOptions);

    const stateChangeCalls = eventBus.emitEvent.mock.calls.filter(
      ([type]) => type === EVENT_TYPES.AGENT_STATE_CHANGE,
    );
    expect(stateChangeCalls).toHaveLength(2);
    expect(stateChangeCalls[0][1].newState).toBe(AGENT_STATES.WORKING);
    expect(stateChangeCalls[1][1].newState).toBe(AGENT_STATES.IDLE);
  });
});
