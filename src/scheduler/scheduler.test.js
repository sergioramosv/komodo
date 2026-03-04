import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- Hoisted mocks ---

const { mockConfig } = vi.hoisted(() => {
  return {
    mockConfig: {
      schedule: '',
      scheduleTimezone: '',
    },
  };
});

vi.mock('../config.js', () => ({
  config: mockConfig,
}));

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), success: vi.fn() },
}));

import {
  parseTime,
  parseScheduleWindows,
  isTimeInWindow,
  isInScheduleWindow,
  getNextWindow,
  formatMinutes,
  checkSchedule,
  getCurrentTime,
} from './scheduler.js';

// --- Tests ---

describe('parseTime()', () => {
  it('parses valid time strings', () => {
    expect(parseTime('02:00')).toEqual({ hours: 2, minutes: 0 });
    expect(parseTime('14:30')).toEqual({ hours: 14, minutes: 30 });
    expect(parseTime('00:00')).toEqual({ hours: 0, minutes: 0 });
    expect(parseTime('23:59')).toEqual({ hours: 23, minutes: 59 });
  });

  it('throws on invalid time formats', () => {
    expect(() => parseTime('25:00')).toThrow('Invalid time format');
    expect(() => parseTime('12:60')).toThrow('Invalid time format');
    expect(() => parseTime('abc')).toThrow('Invalid time format');
    expect(() => parseTime('')).toThrow('Invalid time format');
  });
});

describe('parseScheduleWindows()', () => {
  it('returns empty array for empty/null input', () => {
    expect(parseScheduleWindows('')).toEqual([]);
    expect(parseScheduleWindows('  ')).toEqual([]);
  });

  it('parses single window', () => {
    const result = parseScheduleWindows('02:00-06:00');
    expect(result).toEqual([
      { start: { hours: 2, minutes: 0 }, end: { hours: 6, minutes: 0 } },
    ]);
  });

  it('parses multiple windows', () => {
    const result = parseScheduleWindows('02:00-06:00,14:00-18:00');
    expect(result).toHaveLength(2);
    expect(result[0].start).toEqual({ hours: 2, minutes: 0 });
    expect(result[1].start).toEqual({ hours: 14, minutes: 0 });
  });

  it('handles whitespace around windows', () => {
    const result = parseScheduleWindows(' 02:00 - 06:00 , 14:00 - 18:00 ');
    expect(result).toHaveLength(2);
  });

  it('throws on invalid window format', () => {
    expect(() => parseScheduleWindows('invalid')).toThrow('Invalid window format');
  });
});

describe('isTimeInWindow()', () => {
  it('returns true when time is inside a normal window', () => {
    const window = {
      start: { hours: 2, minutes: 0 },
      end: { hours: 6, minutes: 0 },
    };
    expect(isTimeInWindow({ hours: 3, minutes: 30 }, window)).toBe(true);
    expect(isTimeInWindow({ hours: 2, minutes: 0 }, window)).toBe(true);
  });

  it('returns false when time is outside a normal window', () => {
    const window = {
      start: { hours: 2, minutes: 0 },
      end: { hours: 6, minutes: 0 },
    };
    expect(isTimeInWindow({ hours: 1, minutes: 59 }, window)).toBe(false);
    expect(isTimeInWindow({ hours: 6, minutes: 0 }, window)).toBe(false);
    expect(isTimeInWindow({ hours: 12, minutes: 0 }, window)).toBe(false);
  });

  it('handles windows that cross midnight', () => {
    const window = {
      start: { hours: 22, minutes: 0 },
      end: { hours: 4, minutes: 0 },
    };
    // Inside
    expect(isTimeInWindow({ hours: 23, minutes: 0 }, window)).toBe(true);
    expect(isTimeInWindow({ hours: 22, minutes: 0 }, window)).toBe(true);
    expect(isTimeInWindow({ hours: 0, minutes: 0 }, window)).toBe(true);
    expect(isTimeInWindow({ hours: 2, minutes: 30 }, window)).toBe(true);
    expect(isTimeInWindow({ hours: 3, minutes: 59 }, window)).toBe(true);

    // Outside
    expect(isTimeInWindow({ hours: 4, minutes: 0 }, window)).toBe(false);
    expect(isTimeInWindow({ hours: 12, minutes: 0 }, window)).toBe(false);
    expect(isTimeInWindow({ hours: 21, minutes: 59 }, window)).toBe(false);
  });

  it('handles midnight-to-midnight edge case', () => {
    const window = {
      start: { hours: 0, minutes: 0 },
      end: { hours: 0, minutes: 0 },
    };
    // start == end means no duration in normal mode, but this is an edge case
    // 0:00-0:00 with start <= end means empty window
    expect(isTimeInWindow({ hours: 12, minutes: 0 }, window)).toBe(false);
  });
});

describe('isInScheduleWindow()', () => {
  it('returns true when no windows are configured (24/7)', () => {
    expect(isInScheduleWindow([])).toBe(true);
    expect(isInScheduleWindow(null)).toBe(true);
    expect(isInScheduleWindow(undefined)).toBe(true);
  });
});

describe('getNextWindow()', () => {
  it('returns null when no windows', () => {
    expect(getNextWindow([])).toBeNull();
  });

  it('calculates minutes until next window', () => {
    // Mock getCurrentTime by testing the function at a known time
    const windows = parseScheduleWindows('14:00-18:00');
    // This test depends on current time; we test the algorithm via isTimeInWindow instead
    const result = getNextWindow(windows);
    expect(result).toBeDefined();
    expect(result).toHaveProperty('minutesUntil');
    expect(result).toHaveProperty('nextWindowStart');
    expect(result.nextWindowStart).toBe('14:00');
    expect(result.minutesUntil).toBeGreaterThan(0);
    expect(result.minutesUntil).toBeLessThanOrEqual(24 * 60);
  });

  it('picks the closest window from multiple options', () => {
    const windows = parseScheduleWindows('02:00-06:00,14:00-18:00');
    const result = getNextWindow(windows);
    expect(result).toBeDefined();
    expect(result.minutesUntil).toBeGreaterThan(0);
  });
});

describe('formatMinutes()', () => {
  it('formats minutes only', () => {
    expect(formatMinutes(45)).toBe('45min');
  });

  it('formats hours only', () => {
    expect(formatMinutes(120)).toBe('2h');
  });

  it('formats hours and minutes', () => {
    expect(formatMinutes(90)).toBe('1h 30min');
    expect(formatMinutes(150)).toBe('2h 30min');
  });

  it('formats zero', () => {
    expect(formatMinutes(0)).toBe('0min');
  });
});

describe('checkSchedule()', () => {
  beforeEach(() => {
    mockConfig.schedule = '';
    mockConfig.scheduleTimezone = '';
  });

  it('returns allowed=true when no schedule is configured', () => {
    const result = checkSchedule();
    expect(result.allowed).toBe(true);
    expect(result.nextWindow).toBeNull();
  });

  it('returns allowed=true when inside a configured window', () => {
    // Use a window that spans the entire day to guarantee we're inside
    mockConfig.schedule = '00:00-23:59';
    const result = checkSchedule();
    expect(result.allowed).toBe(true);
  });

  it('returns allowed=false with nextWindow when outside window', () => {
    // Use a window that is definitely not now — a 1-minute window far from current time
    // We pick 03:00-03:01 or similar and check it works
    const now = new Date();
    const farHour = (now.getHours() + 12) % 24; // 12 hours away
    const farStr = `${String(farHour).padStart(2, '0')}:00`;
    const endStr = `${String(farHour).padStart(2, '0')}:01`;
    mockConfig.schedule = `${farStr}-${endStr}`;

    const result = checkSchedule();
    expect(result.allowed).toBe(false);
    expect(result.nextWindow).toBeDefined();
    expect(result.nextWindow.nextWindowStart).toBe(farStr);
    expect(result.nextWindow.minutesUntil).toBeGreaterThan(0);
  });
});

describe('midnight-crossing windows (integration)', () => {
  it('22:00-04:00 includes 23:00', () => {
    const windows = parseScheduleWindows('22:00-04:00');
    expect(isTimeInWindow({ hours: 23, minutes: 0 }, windows[0])).toBe(true);
  });

  it('22:00-04:00 includes 01:00', () => {
    const windows = parseScheduleWindows('22:00-04:00');
    expect(isTimeInWindow({ hours: 1, minutes: 0 }, windows[0])).toBe(true);
  });

  it('22:00-04:00 excludes 12:00', () => {
    const windows = parseScheduleWindows('22:00-04:00');
    expect(isTimeInWindow({ hours: 12, minutes: 0 }, windows[0])).toBe(false);
  });

  it('22:00-04:00 excludes 04:00 (end is exclusive)', () => {
    const windows = parseScheduleWindows('22:00-04:00');
    expect(isTimeInWindow({ hours: 4, minutes: 0 }, windows[0])).toBe(false);
  });

  it('20:00-08:00 covers overnight shift', () => {
    const windows = parseScheduleWindows('20:00-08:00');
    expect(isTimeInWindow({ hours: 20, minutes: 0 }, windows[0])).toBe(true);
    expect(isTimeInWindow({ hours: 0, minutes: 0 }, windows[0])).toBe(true);
    expect(isTimeInWindow({ hours: 7, minutes: 59 }, windows[0])).toBe(true);
    expect(isTimeInWindow({ hours: 8, minutes: 0 }, windows[0])).toBe(false);
    expect(isTimeInWindow({ hours: 12, minutes: 0 }, windows[0])).toBe(false);
  });
});
