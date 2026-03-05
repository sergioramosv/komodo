import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  extractModule,
  extractTaskKeywords,
  calculateAffinity,
  rankWithContextAffinity,
  buildAffinityHint,
} from './context-affinity.js';

// Mock config with default boost
vi.mock('../config.js', () => ({
  config: { contextAffinityBoost: 0.2 },
}));

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe('extractModule', () => {
  it('extracts top-level module from a file path', () => {
    expect(extractModule('src/agents/planner.js')).toBe('src/agents');
  });

  it('handles single-level paths', () => {
    expect(extractModule('README.md')).toBe('README.md');
  });

  it('handles deep paths', () => {
    expect(extractModule('src/smart-ordering/context-affinity.js')).toBe('src/smart-ordering');
  });

  it('normalizes backslashes', () => {
    expect(extractModule('src\\agents\\planner.js')).toBe('src/agents');
  });
});

describe('extractTaskKeywords', () => {
  it('extracts meaningful keywords from title', () => {
    const keywords = extractTaskKeywords({ title: 'Add authentication middleware' });
    expect(keywords.has('add')).toBe(true);
    expect(keywords.has('authentication')).toBe(true);
    expect(keywords.has('middleware')).toBe(true);
  });

  it('filters out stop words', () => {
    const keywords = extractTaskKeywords({ title: 'Add the new login for users' });
    expect(keywords.has('the')).toBe(false);
    expect(keywords.has('for')).toBe(false);
    expect(keywords.has('login')).toBe(true);
  });

  it('includes keywords from userStory', () => {
    const keywords = extractTaskKeywords({
      title: 'Smart ordering',
      userStory: { what: 'reorder tasks by context affinity', why: 'reduce exploration time' },
    });
    expect(keywords.has('reorder')).toBe(true);
    expect(keywords.has('affinity')).toBe(true);
    expect(keywords.has('reduce')).toBe(true);
  });

  it('returns empty set for empty task', () => {
    const keywords = extractTaskKeywords({});
    expect(keywords.size).toBe(0);
  });
});

describe('calculateAffinity', () => {
  it('returns 0 when no previous context', () => {
    const result = calculateAffinity(null, { title: 'Some task' });
    expect(result.score).toBe(0);
    expect(result.sharedModules).toHaveLength(0);
  });

  it('returns 0 when previous context has no files', () => {
    const result = calculateAffinity(
      { filesChanged: [], keywords: new Set() },
      { title: 'Some task' },
    );
    expect(result.score).toBe(0);
  });

  it('detects module overlap when candidate title mentions a module', () => {
    const prev = {
      filesChanged: ['src/agents/planner.js', 'src/agents/coder.js'],
      keywords: new Set(['planner', 'selection']),
    };
    const candidate = { title: 'Improve agents error handling' };

    const result = calculateAffinity(prev, candidate);
    expect(result.score).toBeGreaterThan(0);
    expect(result.sharedModules).toContain('src/agents');
  });

  it('detects keyword overlap between tasks', () => {
    const prev = {
      filesChanged: ['src/foo/bar.js'],
      keywords: new Set(['authentication', 'middleware', 'login']),
    };
    const candidate = {
      title: 'Fix authentication bug',
      userStory: { what: 'Fix login session expiry' },
    };

    const result = calculateAffinity(prev, candidate);
    expect(result.score).toBeGreaterThan(0);
  });

  it('returns 0 for completely unrelated tasks', () => {
    const prev = {
      filesChanged: ['src/payments/stripe.js'],
      keywords: new Set(['payments', 'stripe', 'billing']),
    };
    const candidate = {
      title: 'Add dark mode toggle',
      userStory: { what: 'Theme switching for UI' },
    };

    const result = calculateAffinity(prev, candidate);
    expect(result.score).toBe(0);
  });
});

describe('rankWithContextAffinity', () => {
  const makeTask = (id, bizPoints, devPoints, title = `Task ${id}`) => ({
    id,
    title,
    bizPoints,
    devPoints,
    userStory: {},
  });

  it('returns tasks with base priority when no previous context', () => {
    const tasks = [makeTask('a', 5, 3), makeTask('b', 8, 2)];
    const ranked = rankWithContextAffinity(tasks, null);

    expect(ranked).toHaveLength(2);
    expect(ranked[0].effectivePriority).toBe(8); // 5+3
    expect(ranked[1].effectivePriority).toBe(10); // 8+2
    expect(ranked[0].boosted).toBe(false);
  });

  it('boosts tasks that share context with previous task', () => {
    const tasks = [
      makeTask('related', 5, 3, 'Improve agents logging'),
      makeTask('unrelated', 5, 3, 'Add dark mode'),
    ];
    const previousContext = {
      filesChanged: ['src/agents/planner.js'],
      keywords: new Set(['agents', 'planner']),
    };

    const ranked = rankWithContextAffinity(tasks, previousContext);

    const related = ranked.find(r => r.task.id === 'related');
    const unrelated = ranked.find(r => r.task.id === 'unrelated');

    expect(related.effectivePriority).toBeGreaterThan(unrelated.effectivePriority);
    expect(related.boosted).toBe(true);
    expect(unrelated.boosted).toBe(false);
  });

  it('does not let context affinity override strong priority differences', () => {
    const tasks = [
      makeTask('low-pri-related', 2, 1, 'Fix agents bug'),     // basePriority = 3
      makeTask('high-pri-unrelated', 10, 5, 'Add payments'),    // basePriority = 15
    ];
    const previousContext = {
      filesChanged: ['src/agents/planner.js', 'src/agents/coder.js'],
      keywords: new Set(['agents', 'planner', 'coder']),
    };

    const ranked = rankWithContextAffinity(tasks, previousContext);

    const lowPri = ranked.find(r => r.task.id === 'low-pri-related');
    const highPri = ranked.find(r => r.task.id === 'high-pri-unrelated');

    // Even with max boost (0.2), low-pri (3 * 1.2 = 3.6) should not exceed high-pri (15)
    expect(highPri.effectivePriority).toBeGreaterThan(lowPri.effectivePriority);
  });

  it('prefers related task when priorities are similar', () => {
    const tasks = [
      makeTask('related', 5, 3, 'Refactor agents tests'),     // basePriority = 8
      makeTask('unrelated', 5, 3, 'Add dark mode toggle'),    // basePriority = 8
    ];
    const previousContext = {
      filesChanged: ['src/agents/planner.js'],
      keywords: new Set(['agents', 'refactor', 'tests']),
    };

    const ranked = rankWithContextAffinity(tasks, previousContext);

    const related = ranked.find(r => r.task.id === 'related');
    const unrelated = ranked.find(r => r.task.id === 'unrelated');

    expect(related.effectivePriority).toBeGreaterThan(unrelated.effectivePriority);
  });

  it('returns base priority when boost is 0', async () => {
    // Override config for this test
    const { config } = await import('../config.js');
    const originalBoost = config.contextAffinityBoost;
    config.contextAffinityBoost = 0;

    const tasks = [makeTask('a', 5, 3, 'Fix agents bug')];
    const previousContext = {
      filesChanged: ['src/agents/planner.js'],
      keywords: new Set(['agents']),
    };

    const ranked = rankWithContextAffinity(tasks, previousContext);
    expect(ranked[0].effectivePriority).toBe(8);
    expect(ranked[0].boosted).toBe(false);

    config.contextAffinityBoost = originalBoost;
  });
});

describe('buildAffinityHint', () => {
  it('returns empty string when no tasks are boosted', () => {
    const ranked = [
      { task: { id: 'a', title: 'Task A' }, effectivePriority: 5, affinityScore: 0, boosted: false },
    ];
    expect(buildAffinityHint(ranked)).toBe('');
  });

  it('builds hint string for boosted tasks', () => {
    const ranked = [
      { task: { id: 'a', title: 'Related Task' }, effectivePriority: 6, affinityScore: 0.5, boosted: true },
      { task: { id: 'b', title: 'Unrelated' }, effectivePriority: 5, affinityScore: 0, boosted: false },
    ];

    const hint = buildAffinityHint(ranked);
    expect(hint).toContain('CONTEXT AFFINITY');
    expect(hint).toContain('Related Task');
    expect(hint).toContain('50%');
    expect(hint).not.toContain('Unrelated');
  });
});
