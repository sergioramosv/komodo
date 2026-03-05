import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../config.js', () => ({
  config: {
    autoVersion: true,
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
}));

vi.mock('child_process', () => ({
  execFileSync: vi.fn(),
}));

const { config } = await import('../config.js');
const { readFileSync, writeFileSync } = await import('fs');
const { execFileSync } = await import('child_process');
const {
  determineBumpType,
  bumpVersion,
  readVersion,
  writeVersion,
  commitAndPushVersion,
  autoVersionBump,
} = await import('./version-bumper.js');

describe('version-bumper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    config.autoVersion = true;
    config.rootDir = '/fake/komodo';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── determineBumpType ───

  describe('determineBumpType', () => {
    it('returns manual override when versionBump is set', () => {
      expect(determineBumpType({ title: 'feat: add login', versionBump: 'major' })).toBe('major');
      expect(determineBumpType({ title: 'fix: typo', versionBump: 'minor' })).toBe('minor');
      expect(determineBumpType({ title: 'breaking change', versionBump: 'patch' })).toBe('patch');
    });

    it('ignores invalid versionBump values', () => {
      expect(determineBumpType({ title: 'fix: typo', versionBump: 'invalid' })).toBe('patch');
    });

    it('detects major from title keywords', () => {
      expect(determineBumpType({ title: '[BREAKING] remove old API' })).toBe('major');
      expect(determineBumpType({ title: 'major refactor of auth system' })).toBe('major');
    });

    it('detects patch from fix/bug/hotfix keywords', () => {
      expect(determineBumpType({ title: 'fix: resolve login crash' })).toBe('patch');
      expect(determineBumpType({ title: 'bug: null pointer in parser' })).toBe('patch');
      expect(determineBumpType({ title: 'hotfix: production error' })).toBe('patch');
      expect(determineBumpType({ title: '[patch] small correction' })).toBe('patch');
    });

    it('defaults to minor for features and other tasks', () => {
      expect(determineBumpType({ title: 'feat: add dashboard' })).toBe('minor');
      expect(determineBumpType({ title: 'add new notification system' })).toBe('minor');
      expect(determineBumpType({ title: 'refactor: clean up utils' })).toBe('minor');
    });

    it('handles empty or missing title', () => {
      expect(determineBumpType({ title: '' })).toBe('minor');
      expect(determineBumpType({})).toBe('minor');
    });
  });

  // ─── bumpVersion ───

  describe('bumpVersion', () => {
    it('bumps major version', () => {
      expect(bumpVersion('1.2.3', 'major')).toBe('2.0.0');
    });

    it('bumps minor version', () => {
      expect(bumpVersion('1.2.3', 'minor')).toBe('1.3.0');
    });

    it('bumps patch version', () => {
      expect(bumpVersion('1.2.3', 'patch')).toBe('1.2.4');
    });

    it('handles 0.x.x versions', () => {
      expect(bumpVersion('0.1.0', 'patch')).toBe('0.1.1');
      expect(bumpVersion('0.1.0', 'minor')).toBe('0.2.0');
      expect(bumpVersion('0.1.0', 'major')).toBe('1.0.0');
    });

    it('throws on invalid semver', () => {
      expect(() => bumpVersion('not-a-version', 'patch')).toThrow('Invalid semver');
      expect(() => bumpVersion('1.2', 'patch')).toThrow('Invalid semver');
    });

    it('throws on unknown bump type', () => {
      expect(() => bumpVersion('1.0.0', 'unknown')).toThrow('Unknown bump type');
    });
  });

  // ─── readVersion ───

  describe('readVersion', () => {
    it('reads version from package.json', () => {
      readFileSync.mockReturnValue(JSON.stringify({ name: 'test', version: '2.5.1' }));

      const version = readVersion('/my/project');

      expect(version).toBe('2.5.1');
    });

    it('throws if no version field', () => {
      readFileSync.mockReturnValue(JSON.stringify({ name: 'test' }));

      expect(() => readVersion('/my/project')).toThrow('No "version" field');
    });
  });

  // ─── writeVersion ───

  describe('writeVersion', () => {
    it('writes updated version to file', () => {
      readFileSync.mockReturnValue(JSON.stringify({ name: 'test', version: '1.0.0' }));

      writeVersion('1.1.0', '/my/project');

      expect(writeFileSync).toHaveBeenCalledOnce();
      const written = JSON.parse(writeFileSync.mock.calls[0][1]);
      expect(written.version).toBe('1.1.0');
      expect(written.name).toBe('test');
    });
  });

  // ─── commitAndPushVersion ───

  describe('commitAndPushVersion', () => {
    it('stages, commits, and pushes', () => {
      commitAndPushVersion('1.2.0', '/my/project');

      expect(execFileSync).toHaveBeenCalledTimes(3);

      const calls = execFileSync.mock.calls;
      expect(calls[0][1]).toEqual(['add', 'package.json']);
      expect(calls[1][1]).toEqual(['commit', '-m', 'chore: bump version to 1.2.0']);
      expect(calls[2][1]).toEqual(['push', 'origin', 'main']);
    });
  });

  // ─── autoVersionBump ───

  describe('autoVersionBump', () => {
    it('skips when autoVersion is disabled', () => {
      config.autoVersion = false;

      const result = autoVersionBump({ task: { title: 'feat: something' } });

      expect(result.skipped).toBe(true);
      expect(readFileSync).not.toHaveBeenCalled();
    });

    it('performs full bump flow for a feature task', () => {
      readFileSync.mockReturnValue(JSON.stringify({ name: 'komodo', version: '1.0.0' }));

      const result = autoVersionBump({ task: { title: 'feat: add login' } });

      expect(result.skipped).toBe(false);
      expect(result.oldVersion).toBe('1.0.0');
      expect(result.newVersion).toBe('1.1.0');
      expect(result.bumpType).toBe('minor');
      expect(writeFileSync).toHaveBeenCalled();
      expect(execFileSync).toHaveBeenCalledTimes(3);
    });

    it('performs patch bump for a fix task', () => {
      readFileSync.mockReturnValue(JSON.stringify({ name: 'komodo', version: '2.3.1' }));

      const result = autoVersionBump({ task: { title: 'fix: resolve crash' } });

      expect(result.skipped).toBe(false);
      expect(result.newVersion).toBe('2.3.2');
      expect(result.bumpType).toBe('patch');
    });

    it('respects manual versionBump override', () => {
      readFileSync.mockReturnValue(JSON.stringify({ name: 'komodo', version: '1.0.0' }));

      const result = autoVersionBump({
        task: { title: 'fix: small thing', versionBump: 'major' },
      });

      expect(result.newVersion).toBe('2.0.0');
      expect(result.bumpType).toBe('major');
    });

    it('uses custom versionFile', () => {
      readFileSync.mockReturnValue(JSON.stringify({ version: '0.5.0' }));

      const result = autoVersionBump({
        task: { title: 'feat: new feature' },
        versionFile: 'version.json',
      });

      expect(result.newVersion).toBe('0.6.0');
      const addCall = execFileSync.mock.calls[0];
      expect(addCall[1]).toEqual(['add', 'version.json']);
    });
  });
});
