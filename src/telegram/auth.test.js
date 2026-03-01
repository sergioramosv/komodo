import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config.js', () => ({
  config: { telegramAllowedUsers: [] },
}));

vi.mock('../utils/logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const { config } = await import('../config.js');
const { isAuthorized, withAuth } = await import('./auth.js');

describe('isAuthorized', () => {
  beforeEach(() => {
    config.telegramAllowedUsers = [];
  });

  it('returns false when whitelist is empty', () => {
    expect(isAuthorized(12345)).toBe(false);
  });

  it('returns true for an authorized userId', () => {
    config.telegramAllowedUsers = ['12345'];
    expect(isAuthorized(12345)).toBe(true);
  });

  it('returns false for an unauthorized userId', () => {
    config.telegramAllowedUsers = ['12345'];
    expect(isAuthorized(99999)).toBe(false);
  });

  it('handles number userId by converting to string', () => {
    config.telegramAllowedUsers = ['67890'];
    expect(isAuthorized(67890)).toBe(true);
    expect(isAuthorized('67890')).toBe(true);
  });
});

describe('withAuth', () => {
  beforeEach(() => {
    config.telegramAllowedUsers = ['100'];
  });

  it('calls handler when user is authorized', () => {
    const handler = vi.fn();
    const wrapped = withAuth(handler);
    const msg = { from: { id: 100, username: 'test' } };

    wrapped(msg);
    expect(handler).toHaveBeenCalledWith(msg, undefined);
  });

  it('does not call handler when user is unauthorized', () => {
    const handler = vi.fn();
    const wrapped = withAuth(handler);
    const msg = { from: { id: 999, username: 'hacker' } };

    wrapped(msg);
    expect(handler).not.toHaveBeenCalled();
  });
});
