import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockBot, mockCollectWeeklyMetrics } = vi.hoisted(() => ({
  mockBot: { sendMessage: vi.fn().mockResolvedValue({}) },
  mockCollectWeeklyMetrics: vi.fn(),
}));

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
}));

vi.mock('../config.js', () => ({
  config: {
    defaultProjectId: 'proj-1',
    telegramChatId: '12345',
  },
}));

vi.mock('./bot.js', () => ({
  getBot: () => mockBot,
}));

vi.mock('../metrics/weekly-metrics.js', () => ({
  collectWeeklyMetrics: mockCollectWeeklyMetrics,
}));

vi.mock('./formatter.js', () => ({
  formatWeeklyDigest: vi.fn(() => 'formatted digest'),
}));

import { sendWeeklyDigest } from './digest.js';

beforeEach(() => {
  vi.clearAllMocks();
  mockCollectWeeklyMetrics.mockResolvedValue({
    projectId: 'proj-1',
    tasksCompleted: 3,
    prsMerged: 2,
    bugsFound: 1,
    bugsResolved: 0,
    totalCost: 1.5,
    velocity: { currentWeekDevPoints: 10, previousWeekDevPoints: 8, trend: 'up', changePercent: 25 },
    topTasks: [],
    criticalBugsOpen: [],
  });
});

describe('sendWeeklyDigest', () => {
  it('collects metrics and sends formatted message', async () => {
    const result = await sendWeeklyDigest();
    expect(mockCollectWeeklyMetrics).toHaveBeenCalledWith('proj-1', { referenceDate: undefined });
    expect(mockBot.sendMessage).toHaveBeenCalledWith('12345', 'formatted digest', { parse_mode: 'MarkdownV2' });
    expect(result.success).toBe(true);
  });

  it('uses custom chatId when provided', async () => {
    await sendWeeklyDigest({ chatId: '99999' });
    expect(mockBot.sendMessage).toHaveBeenCalledWith('99999', 'formatted digest', { parse_mode: 'MarkdownV2' });
  });

  it('returns error when collectWeeklyMetrics fails', async () => {
    mockCollectWeeklyMetrics.mockRejectedValue(new Error('Firebase down'));
    const result = await sendWeeklyDigest();
    expect(result.success).toBe(false);
    expect(result.error).toBe('Firebase down');
  });

  it('returns error when sendMessage fails', async () => {
    mockBot.sendMessage.mockRejectedValue(new Error('Telegram API error'));
    const result = await sendWeeklyDigest();
    expect(result.success).toBe(false);
    expect(result.error).toBe('Telegram API error');
  });
});
