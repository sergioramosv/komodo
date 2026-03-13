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
import { eventBus, EVENT_TYPES } from '../events/event-bus.js';
import { validateAgentResponse } from '../utils/parser.js';

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

  it('no emite AGENT_STATE_CHANGE directamente (task-runner lo maneja via updateAgent)', async () => {
    runAgent.mockResolvedValue({ success: false, result: null, cost: 0, duration: 100, error: 'fail' });

    await runTesterAgent(baseOptions);

    const stateChangeCalls = eventBus.emitEvent.mock.calls.filter(
      ([type]) => type === EVENT_TYPES.AGENT_STATE_CHANGE,
    );
    expect(stateChangeCalls).toHaveLength(0);
  });

  it('retorna error cuando runAgent falla', async () => {
    runAgent.mockResolvedValue({ success: false, result: null, cost: 0, duration: 100, error: 'fail' });

    const result = await runTesterAgent(baseOptions);

    expect(result.success).toBe(false);
    expect(result.error).toBe('fail');
    expect(result.tester).toBeNull();
  });

  it('retorna error cuando validateAgentResponse retorna valid: false', async () => {
    runAgent.mockResolvedValue({
      success: true,
      result: { someField: 'value' },
      cost: 0.01,
      duration: 200,
    });
    validateAgentResponse.mockReturnValueOnce({ valid: false, missing: ['testsGenerated', 'testsPassed'] });

    const result = await runTesterAgent(baseOptions);

    expect(result.success).toBe(false);
    expect(result.tester).toBeNull();
    expect(result.error).toContain('testsGenerated');
    expect(result.error).toContain('testsPassed');
  });

  it('no emite AGENT_STATE_CHANGE en path !valid (task-runner lo maneja)', async () => {
    runAgent.mockResolvedValue({
      success: true,
      result: { someField: 'value' },
      cost: 0.01,
      duration: 200,
    });
    validateAgentResponse.mockReturnValueOnce({ valid: false, missing: ['testsGenerated'] });

    await runTesterAgent(baseOptions);

    const stateChangeCalls = eventBus.emitEvent.mock.calls.filter(
      ([type]) => type === EVENT_TYPES.AGENT_STATE_CHANGE,
    );
    expect(stateChangeCalls).toHaveLength(0);
  });

  it('emite TESTER_TESTS_GENERATED al finalizar con éxito', async () => {
    runAgent.mockResolvedValue({
      success: true,
      result: { testsGenerated: 3, testsPassed: 3, testsFailed: 0, coverage: '80%', filesCreated: ['foo.test.js'], filesChanged: [], pushed: true, failedTests: [], summary: 'ok' },
      cost: 0.01,
      duration: 200,
    });

    await runTesterAgent(baseOptions);

    const testsGeneratedCall = eventBus.emitEvent.mock.calls.find(
      ([type]) => type === EVENT_TYPES.TESTER_TESTS_GENERATED,
    );
    expect(testsGeneratedCall).toBeDefined();
    expect(testsGeneratedCall[1]).toMatchObject({
      agentName: 'TESTER',
      metadata: { count: 3, passed: 3, failed: 0, coverage: '80%', prNumber: 42 },
    });
  });

  it('retorna datos correctos en flujo exitoso', async () => {
    runAgent.mockResolvedValue({
      success: true,
      result: { testsGenerated: 1, testsPassed: 1, testsFailed: 0, coverage: null, filesCreated: [], filesChanged: [], pushed: true, failedTests: [], summary: 'ok' },
      cost: 0.01,
      duration: 100,
    });

    const result = await runTesterAgent(baseOptions);

    expect(result.success).toBe(true);
    expect(result.tester).toMatchObject({
      testsGenerated: 1,
      testsPassed: 1,
      testsFailed: 0,
      pushed: true,
      summary: 'ok',
    });
  });
});
