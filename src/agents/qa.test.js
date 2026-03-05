import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./base-agent.js', () => ({
  runAgent: vi.fn(),
}));

vi.mock('../prompts/qa-system.js', () => ({
  getQASystemPrompt: vi.fn().mockReturnValue('QA system prompt'),
}));

vi.mock('../config.js', () => ({
  config: {
    qaAgent: true,
    cliQA: 'claude',
    qaTestTypes: ['unit', 'edge-cases'],
  },
}));

vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    success: vi.fn(),
    taskHeader: vi.fn(),
  },
}));

vi.mock('../utils/parser.js', () => ({
  validateAgentResponse: vi.fn((data, required) => {
    const missing = required.filter(k => data[k] === undefined || data[k] === null);
    return { valid: missing.length === 0, missing };
  }),
}));

vi.mock('../events/event-bus.js', () => ({
  eventBus: {
    emitEvent: vi.fn().mockReturnValue({}),
    emitAgentEvent: vi.fn().mockReturnValue({}),
  },
  EVENT_TYPES: {
    QA_TESTS_GENERATED: 'qa:tests-generated',
    AGENT_STATE_CHANGE: 'agent:state-change',
    COST_UPDATED: 'cost:updated',
  },
}));

import { runQAAgent } from './qa.js';
import { runAgent } from './base-agent.js';
import { eventBus, EVENT_TYPES } from '../events/event-bus.js';

const baseOptions = {
  taskSpec: {
    taskId: 'task-123',
    title: 'Add login feature',
    acceptanceCriteria: ['User can login with email', 'Invalid credentials show error'],
  },
  filesChanged: ['src/auth.js', 'src/login.js'],
  branchName: 'feature/task-123-login',
  repo: 'SergioRVDev/komodo',
  prNumber: 42,
  cwd: '/tmp/repo',
};

describe('QA Agent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return success when all tests pass', async () => {
    runAgent.mockResolvedValue({
      success: true,
      result: {
        testsGenerated: 5,
        testsPassed: 5,
        testsFailed: 0,
        filesCreated: ['src/auth.test.js'],
        filesChanged: [],
        pushed: true,
        failedTests: [],
        summary: 'All 5 QA tests passed',
      },
      cost: 0.05,
      duration: 30,
    });

    const result = await runQAAgent(baseOptions);

    expect(result.success).toBe(true);
    expect(result.qa.testsGenerated).toBe(5);
    expect(result.qa.testsPassed).toBe(5);
    expect(result.qa.testsFailed).toBe(0);
    expect(result.qa.pushed).toBe(true);

    expect(eventBus.emitEvent).toHaveBeenCalledWith(
      EVENT_TYPES.QA_TESTS_GENERATED,
      expect.objectContaining({
        agentName: 'QA',
        metadata: expect.objectContaining({
          count: 5,
          passed: 5,
          failed: 0,
        }),
      }),
    );
  });

  it('should report failed tests that indicate coder bugs', async () => {
    runAgent.mockResolvedValue({
      success: true,
      result: {
        testsGenerated: 4,
        testsPassed: 3,
        testsFailed: 1,
        filesCreated: ['src/auth.test.js'],
        filesChanged: [],
        pushed: true,
        failedTests: [
          {
            name: 'should handle null input',
            error: 'TypeError: Cannot read property of null',
            type: 'edge-case',
            failsCoderCode: true,
          },
        ],
        summary: '3/4 tests passed, 1 edge-case failed',
      },
      cost: 0.04,
      duration: 25,
    });

    const result = await runQAAgent(baseOptions);

    expect(result.success).toBe(true);
    expect(result.qa.testsFailed).toBe(1);
    expect(result.qa.failedTests).toHaveLength(1);
    expect(result.qa.failedTests[0].failsCoderCode).toBe(true);
  });

  it('should return failure when agent returns no result', async () => {
    runAgent.mockResolvedValue({
      success: false,
      result: null,
      cost: null,
      duration: 5,
      error: 'Agent timeout',
    });

    const result = await runQAAgent(baseOptions);

    expect(result.success).toBe(false);
    expect(result.qa).toBeNull();
    expect(result.error).toBe('Agent timeout');
  });

  it('should return failure when response is missing required fields', async () => {
    runAgent.mockResolvedValue({
      success: true,
      result: {
        summary: 'incomplete response',
      },
      cost: 0.02,
      duration: 10,
    });

    const result = await runQAAgent(baseOptions);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Campos faltantes');
  });

  it('should pass correct parameters to runAgent', async () => {
    runAgent.mockResolvedValue({
      success: true,
      result: {
        testsGenerated: 2,
        testsPassed: 2,
        testsFailed: 0,
        filesCreated: [],
        pushed: true,
        failedTests: [],
        summary: 'All tests passed',
      },
      cost: 0.03,
      duration: 15,
    });

    await runQAAgent({ ...baseOptions, model: 'claude-sonnet' });

    expect(runAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'QA',
        mcpServerNames: ['github-mcp'],
        maxTurns: 30,
        totalTimeout: 600_000,
        model: 'claude-sonnet',
      }),
    );
  });

  it('should emit qa:tests-generated event with correct counts', async () => {
    runAgent.mockResolvedValue({
      success: true,
      result: {
        testsGenerated: 6,
        testsPassed: 4,
        testsFailed: 2,
        filesCreated: ['test1.js', 'test2.js'],
        pushed: true,
        failedTests: [
          { name: 'test-a', error: 'err', type: 'unit', failsCoderCode: true },
          { name: 'test-b', error: 'err', type: 'edge-case', failsCoderCode: false },
        ],
        summary: '4/6 passed',
      },
      cost: 0.05,
      duration: 20,
    });

    await runQAAgent(baseOptions);

    expect(eventBus.emitEvent).toHaveBeenCalledWith(
      'qa:tests-generated',
      expect.objectContaining({
        metadata: expect.objectContaining({
          count: 6,
          passed: 4,
          failed: 2,
          prNumber: 42,
          branchName: 'feature/task-123-login',
        }),
      }),
    );
  });
});

describe('QA Agent integration flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should handle full flow: generate tests, execute, push', async () => {
    runAgent.mockResolvedValue({
      success: true,
      result: {
        testsGenerated: 3,
        testsPassed: 3,
        testsFailed: 0,
        filesCreated: ['src/feature.test.js'],
        filesChanged: [],
        pushed: true,
        failedTests: [],
        summary: 'All 3 QA tests passed: 2 unit, 1 acceptance',
      },
      cost: 0.06,
      duration: 45,
    });

    const result = await runQAAgent(baseOptions);

    // Verify the full flow completed successfully
    expect(result.success).toBe(true);
    expect(result.qa.testsGenerated).toBe(3);
    expect(result.qa.testsPassed).toBe(3);
    expect(result.qa.pushed).toBe(true);
    expect(result.cost).toBe(0.06);
    expect(result.duration).toBe(45);
  });

  it('should handle mixed results with coder faults and test errors', async () => {
    runAgent.mockResolvedValue({
      success: true,
      result: {
        testsGenerated: 8,
        testsPassed: 5,
        testsFailed: 3,
        filesCreated: ['src/feature.test.js', 'src/edge-cases.test.js'],
        filesChanged: [],
        pushed: true,
        failedTests: [
          { name: 'null input', error: 'null ref', type: 'edge-case', failsCoderCode: true },
          { name: 'empty array', error: 'index error', type: 'edge-case', failsCoderCode: true },
          { name: 'bad test setup', error: 'mock error', type: 'unit', failsCoderCode: false },
        ],
        summary: '5/8 passed, 2 coder bugs found, 1 test error',
      },
      cost: 0.08,
      duration: 60,
    });

    const result = await runQAAgent(baseOptions);

    expect(result.success).toBe(true);
    expect(result.qa.failedTests).toHaveLength(3);

    const coderFaults = result.qa.failedTests.filter(t => t.failsCoderCode);
    expect(coderFaults).toHaveLength(2);
  });
});
