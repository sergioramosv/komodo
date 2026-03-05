import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../config.js', () => ({
  config: {
    autoChangelog: true,
    rootDir: '/fake/komodo',
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

vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn(),
}));

const { config } = await import('../config.js');
const { readFileSync, writeFileSync, existsSync } = await import('fs');
const {
  classifyTask,
  formatTaskEntry,
  generateChangelogEntry,
  updateChangelog,
  autoChangelog,
} = await import('./changelog-generator.js');

describe('changelog-generator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    config.autoChangelog = true;
    config.rootDir = '/fake/komodo';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── classifyTask ───

  describe('classifyTask', () => {
    it('classifies breaking changes', () => {
      expect(classifyTask({ title: '[BREAKING] remove old API' })).toBe('Breaking Changes');
    });

    it('classifies fixes', () => {
      expect(classifyTask({ title: 'fix: resolve crash on login' })).toBe('Fixes');
      expect(classifyTask({ title: 'bug: null pointer' })).toBe('Fixes');
      expect(classifyTask({ title: 'hotfix: production error' })).toBe('Fixes');
    });

    it('classifies features', () => {
      expect(classifyTask({ title: 'feat: add dashboard' })).toBe('Features');
      expect(classifyTask({ title: 'add new notification system' })).toBe('Features');
      expect(classifyTask({ title: 'new: user profile page' })).toBe('Features');
    });

    it('classifies other tasks', () => {
      expect(classifyTask({ title: 'refactor: clean up utils' })).toBe('Other');
      expect(classifyTask({ title: 'chore: update deps' })).toBe('Other');
    });

    it('handles empty or missing title', () => {
      expect(classifyTask({ title: '' })).toBe('Other');
      expect(classifyTask({})).toBe('Other');
    });
  });

  // ─── formatTaskEntry ───

  describe('formatTaskEntry', () => {
    it('formats a basic task entry', () => {
      const result = formatTaskEntry({ title: 'Add login feature' });
      expect(result).toBe('- Add login feature');
    });

    it('includes PR link when prNumber and repoUrl are provided', () => {
      const result = formatTaskEntry({
        title: 'Add login',
        prNumber: 42,
        repoUrl: 'https://github.com/owner/repo',
      });
      expect(result).toBe('- Add login ([#42](https://github.com/owner/repo/pull/42))');
    });

    it('strips .git from repoUrl', () => {
      const result = formatTaskEntry({
        title: 'Add login',
        prNumber: 42,
        repoUrl: 'https://github.com/owner/repo.git',
      });
      expect(result).toContain('https://github.com/owner/repo/pull/42');
    });

    it('shows just PR number when no repoUrl', () => {
      const result = formatTaskEntry({ title: 'Add login', prNumber: 42 });
      expect(result).toBe('- Add login (#42)');
    });

    it('includes devPoints when provided', () => {
      const result = formatTaskEntry({ title: 'Add login', devPoints: 5 });
      expect(result).toBe('- Add login — 5 devPoints');
    });

    it('includes devPoints of 0', () => {
      const result = formatTaskEntry({ title: 'Small fix', devPoints: 0 });
      expect(result).toBe('- Small fix — 0 devPoints');
    });

    it('formats full entry with PR link and devPoints', () => {
      const result = formatTaskEntry({
        title: 'feat: add dashboard',
        prNumber: 10,
        repoUrl: 'https://github.com/org/proj',
        devPoints: 8,
      });
      expect(result).toBe('- feat: add dashboard ([#10](https://github.com/org/proj/pull/10)) — 8 devPoints');
    });
  });

  // ─── generateChangelogEntry ───

  describe('generateChangelogEntry', () => {
    it('generates entry with single task', () => {
      const entry = generateChangelogEntry({
        version: '1.2.0',
        date: '2026-03-05',
        tasks: [{ title: 'feat: add login', prNumber: 1, devPoints: 3 }],
      });

      expect(entry).toContain('## [1.2.0] - 2026-03-05');
      expect(entry).toContain('### Features');
      expect(entry).toContain('- feat: add login (#1) — 3 devPoints');
    });

    it('groups multiple tasks by type', () => {
      const entry = generateChangelogEntry({
        version: '2.0.0',
        date: '2026-03-05',
        tasks: [
          { title: 'feat: add dashboard', prNumber: 10, devPoints: 8 },
          { title: 'fix: resolve crash', prNumber: 11, devPoints: 2 },
          { title: '[BREAKING] remove v1 API', prNumber: 12, devPoints: 5 },
          { title: 'feat: add notifications', prNumber: 13, devPoints: 3 },
          { title: 'chore: update deps', prNumber: 14, devPoints: 1 },
        ],
      });

      expect(entry).toContain('### Breaking Changes');
      expect(entry).toContain('### Features');
      expect(entry).toContain('### Fixes');
      expect(entry).toContain('### Other');

      // Verify order: Breaking Changes > Features > Fixes > Other
      const breakingIdx = entry.indexOf('### Breaking Changes');
      const featuresIdx = entry.indexOf('### Features');
      const fixesIdx = entry.indexOf('### Fixes');
      const otherIdx = entry.indexOf('### Other');
      expect(breakingIdx).toBeLessThan(featuresIdx);
      expect(featuresIdx).toBeLessThan(fixesIdx);
      expect(fixesIdx).toBeLessThan(otherIdx);
    });

    it('omits empty categories', () => {
      const entry = generateChangelogEntry({
        version: '1.0.1',
        date: '2026-01-01',
        tasks: [{ title: 'fix: typo', prNumber: 5, devPoints: 1 }],
      });

      expect(entry).toContain('### Fixes');
      expect(entry).not.toContain('### Features');
      expect(entry).not.toContain('### Breaking Changes');
      expect(entry).not.toContain('### Other');
    });
  });

  // ─── updateChangelog ───

  describe('updateChangelog', () => {
    it('creates CHANGELOG.md when it does not exist', () => {
      existsSync.mockReturnValue(false);

      updateChangelog({
        version: '1.0.0',
        date: '2026-03-05',
        tasks: [{ title: 'feat: initial release', devPoints: 10 }],
        cwd: '/my/project',
      });

      expect(writeFileSync).toHaveBeenCalledOnce();
      const written = writeFileSync.mock.calls[0][1];
      expect(written).toContain('# Changelog');
      expect(written).toContain('## [1.0.0] - 2026-03-05');
      expect(written).toContain('feat: initial release');
    });

    it('inserts new version before existing versions', () => {
      existsSync.mockReturnValue(true);
      readFileSync.mockReturnValue(
        '# Changelog\n\nAll notable changes.\n\n## [1.0.0] - 2026-01-01\n\n### Features\n\n- feat: first\n'
      );

      updateChangelog({
        version: '1.1.0',
        date: '2026-03-05',
        tasks: [{ title: 'feat: second feature', prNumber: 2 }],
        cwd: '/my/project',
      });

      const written = writeFileSync.mock.calls[0][1];
      const v110idx = written.indexOf('## [1.1.0]');
      const v100idx = written.indexOf('## [1.0.0]');
      expect(v110idx).toBeLessThan(v100idx);
    });

    it('appends when no existing versions', () => {
      existsSync.mockReturnValue(true);
      readFileSync.mockReturnValue('# Changelog\n\nAll notable changes.\n\n');

      updateChangelog({
        version: '1.0.0',
        date: '2026-03-05',
        tasks: [{ title: 'feat: first', devPoints: 5 }],
        cwd: '/my/project',
      });

      const written = writeFileSync.mock.calls[0][1];
      expect(written).toContain('## [1.0.0] - 2026-03-05');
    });
  });

  // ─── autoChangelog ───

  describe('autoChangelog', () => {
    it('skips when autoChangelog is disabled', () => {
      config.autoChangelog = false;

      const result = autoChangelog({
        newVersion: '1.0.0',
        task: { title: 'feat: something' },
      });

      expect(result.skipped).toBe(true);
      expect(existsSync).not.toHaveBeenCalled();
    });

    it('generates changelog entry when enabled', () => {
      existsSync.mockReturnValue(false);

      const result = autoChangelog({
        newVersion: '1.1.0',
        task: { title: 'feat: add login', prNumber: 42, devPoints: 5 },
        cwd: '/my/project',
      });

      expect(result.skipped).toBe(false);
      expect(result.changelogPath).toBeTruthy();
      expect(writeFileSync).toHaveBeenCalledOnce();

      const written = writeFileSync.mock.calls[0][1];
      expect(written).toContain('## [1.1.0]');
      expect(written).toContain('feat: add login');
    });
  });

  // ─── Multiple tasks of different types ───

  describe('multiple tasks of different types', () => {
    it('handles mixed features, fixes, breaking changes, and other', () => {
      const tasks = [
        { title: 'feat: add user profiles', prNumber: 20, devPoints: 5, repoUrl: 'https://github.com/org/repo' },
        { title: 'fix: resolve memory leak', prNumber: 21, devPoints: 2, repoUrl: 'https://github.com/org/repo' },
        { title: '[BREAKING] remove deprecated endpoints', prNumber: 22, devPoints: 8, repoUrl: 'https://github.com/org/repo' },
        { title: 'feat: add search', prNumber: 23, devPoints: 3, repoUrl: 'https://github.com/org/repo' },
        { title: 'fix: correct typo in config', prNumber: 24, devPoints: 1 },
        { title: 'chore: update CI pipeline', prNumber: 25, devPoints: 1 },
      ];

      const entry = generateChangelogEntry({
        version: '3.0.0',
        date: '2026-03-05',
        tasks,
      });

      // All categories present
      expect(entry).toContain('### Breaking Changes');
      expect(entry).toContain('### Features');
      expect(entry).toContain('### Fixes');
      expect(entry).toContain('### Other');

      // Each task present
      expect(entry).toContain('add user profiles');
      expect(entry).toContain('resolve memory leak');
      expect(entry).toContain('remove deprecated endpoints');
      expect(entry).toContain('add search');
      expect(entry).toContain('correct typo in config');
      expect(entry).toContain('update CI pipeline');

      // PR links
      expect(entry).toContain('[#20](https://github.com/org/repo/pull/20)');
      expect(entry).toContain('(#24)'); // no repoUrl

      // devPoints
      expect(entry).toContain('5 devPoints');
      expect(entry).toContain('8 devPoints');
    });
  });
});
