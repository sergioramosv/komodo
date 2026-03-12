import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../config.js', () => ({
  config: { modelCoder: 'claude-sonnet-4-6' },
}));

import { agentTimeoutStrategy } from './agent-timeout.js';

describe('agentTimeoutStrategy.detect', () => {
  it('detects idle timeout', () => {
    expect(agentTimeoutStrategy.detect({ errorMessage: 'Idle timeout: agent silent for 120s' })).toBe(true);
  });

  it('detects total timeout', () => {
    expect(agentTimeoutStrategy.detect({ errorMessage: 'Total timeout: exceeded 600s' })).toBe(true);
  });

  it('returns false for non-timeout errors', () => {
    expect(agentTimeoutStrategy.detect({ errorMessage: 'syntax error' })).toBe(false);
  });

  it('returns false for empty input', () => {
    expect(agentTimeoutStrategy.detect({ errorMessage: '' })).toBe(false);
    expect(agentTimeoutStrategy.detect({ errorMessage: null })).toBe(false);
  });
});

describe('agentTimeoutStrategy.diagnose', () => {
  it('returns faster model fallback for sonnet', () => {
    const result = agentTimeoutStrategy.diagnose({
      errorMessage: 'Idle timeout:',
      agentName: 'CODER',
      model: 'claude-sonnet-4-6',
    });
    expect(result.fasterModel).toBe('claude-haiku-4-5-20251001');
    expect(result.agentName).toBe('CODER');
    expect(result.reducedMaxTurns).toBe(10);
  });

  it('uses default fallback for unknown model', () => {
    const result = agentTimeoutStrategy.diagnose({
      errorMessage: 'Idle timeout:',
      model: 'gpt-4o',
    });
    expect(result.fasterModel).toBe('claude-haiku-4-5-20251001');
  });

  it('defaults agentName to UNKNOWN', () => {
    const result = agentTimeoutStrategy.diagnose({ errorMessage: 'Idle timeout:' });
    expect(result.agentName).toBe('UNKNOWN');
  });
});

describe('agentTimeoutStrategy.heal', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retries with faster model and returns healed=true on success', async () => {
    const action = vi.fn().mockResolvedValue('done');
    const result = await agentTimeoutStrategy.heal({
      errorMessage: 'Idle timeout:',
      agentName: 'CODER',
      action,
    });
    expect(result.healed).toBe(true);
    expect(result.fasterModel).toBe('claude-haiku-4-5-20251001');
    expect(action).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-haiku-4-5-20251001', maxTurns: 10 }),
    );
  });

  it('returns healed=false when retry also fails', async () => {
    const action = vi.fn().mockRejectedValue(new Error('timeout again'));
    const result = await agentTimeoutStrategy.heal({
      errorMessage: 'Idle timeout:',
      action,
    });
    expect(result.healed).toBe(false);
  });

  it('returns healed=false when no action provided', async () => {
    const result = await agentTimeoutStrategy.heal({ errorMessage: 'Idle timeout:' });
    expect(result.healed).toBe(false);
    expect(result.reason).toBe('no-action-provided');
  });
});
