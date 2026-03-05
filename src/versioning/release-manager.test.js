import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../config.js', () => ({
  config: {
    autoRelease: true,
    releaseOnSprintComplete: true,
    rootDir: '/fake/komodo',
    versionFile: 'package.json',
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

vi.mock('../events/event-bus.js', () => ({
  eventBus: { emitEvent: vi.fn() },
  EVENT_TYPES: { RELEASE_CREATED: 'release:created' },
}));

vi.mock('../../skills/planning-task-mcp/src/firebase.js', () => ({
  getAll: vi.fn(),
}));

vi.mock('child_process', () => ({
  execFileSync: vi.fn(),
}));

vi.mock('./version-bumper.js', () => ({
  readVersion: vi.fn(),
}));

vi.mock('./release-gate.js', () => ({
  evaluateReleaseGate: vi.fn(),
}));

const { config } = await import('../config.js');
const { eventBus, EVENT_TYPES } = await import('../events/event-bus.js');
const { getAll } = await import('../../skills/planning-task-mcp/src/firebase.js');
const { execFileSync } = await import('child_process');
const { readVersion } = await import('./version-bumper.js');
const { evaluateReleaseGate } = await import('./release-gate.js');
const {
  isSprintComplete,
  generateReleaseNotes,
  createGitHubRelease,
  autoRelease,
} = await import('./release-manager.js');

describe('release-manager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    config.autoRelease = true;
    config.releaseOnSprintComplete = true;
    config.rootDir = '/fake/komodo';
    config.versionFile = 'package.json';
    evaluateReleaseGate.mockResolvedValue({ allowed: true, blockingBugs: [], overridden: false });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── isSprintComplete ───

  describe('isSprintComplete', () => {
    it('returns true when all sprint tasks are done', async () => {
      getAll.mockImplementation((path) => {
        if (path === 'tasks') {
          return [
            { id: 't1', sprintId: 'sp1', projectId: 'proj1', status: 'done' },
            { id: 't2', sprintId: 'sp1', projectId: 'proj1', status: 'done' },
            { id: 't3', sprintId: 'sp1', projectId: 'proj1', status: 'done' },
          ];
        }
        if (path === 'sprints') {
          return [{ id: 'sp1', projectId: 'proj1', name: 'Sprint 1', status: 'active' }];
        }
        return [];
      });

      const result = await isSprintComplete('sp1', 'proj1');
      expect(result.complete).toBe(true);
      expect(result.tasks).toHaveLength(3);
      expect(result.sprint).toBeTruthy();
      expect(result.sprint.name).toBe('Sprint 1');
    });

    it('returns false when some tasks are not done', async () => {
      getAll.mockImplementation((path) => {
        if (path === 'tasks') {
          return [
            { id: 't1', sprintId: 'sp1', projectId: 'proj1', status: 'done' },
            { id: 't2', sprintId: 'sp1', projectId: 'proj1', status: 'in-progress' },
            { id: 't3', sprintId: 'sp1', projectId: 'proj1', status: 'to-do' },
          ];
        }
        if (path === 'sprints') {
          return [{ id: 'sp1', projectId: 'proj1', name: 'Sprint 1' }];
        }
        return [];
      });

      const result = await isSprintComplete('sp1', 'proj1');
      expect(result.complete).toBe(false);
    });

    it('returns false when sprint has no tasks', async () => {
      getAll.mockImplementation((path) => {
        if (path === 'tasks') return [];
        if (path === 'sprints') {
          return [{ id: 'sp1', projectId: 'proj1', name: 'Sprint 1' }];
        }
        return [];
      });

      const result = await isSprintComplete('sp1', 'proj1');
      expect(result.complete).toBe(false);
      expect(result.tasks).toHaveLength(0);
    });

    it('only considers tasks matching sprintId and projectId', async () => {
      getAll.mockImplementation((path) => {
        if (path === 'tasks') {
          return [
            { id: 't1', sprintId: 'sp1', projectId: 'proj1', status: 'done' },
            { id: 't2', sprintId: 'sp2', projectId: 'proj1', status: 'to-do' }, // different sprint
            { id: 't3', sprintId: 'sp1', projectId: 'proj2', status: 'to-do' }, // different project
          ];
        }
        if (path === 'sprints') {
          return [{ id: 'sp1', projectId: 'proj1', name: 'Sprint 1' }];
        }
        return [];
      });

      const result = await isSprintComplete('sp1', 'proj1');
      expect(result.complete).toBe(true);
      expect(result.tasks).toHaveLength(1);
    });
  });

  // ─── generateReleaseNotes ───

  describe('generateReleaseNotes', () => {
    it('generates release notes with categorized tasks', () => {
      const tasks = [
        { title: 'feat: add login', prNumber: 1, devPoints: 3 },
        { title: 'fix: resolve crash', prNumber: 2, devPoints: 1 },
        { title: '[BREAKING] remove old API', prNumber: 3, devPoints: 5 },
        { title: 'chore: update deps', prNumber: 4, devPoints: 1 },
      ];

      const notes = generateReleaseNotes({
        tasks,
        sprint: { id: 'sp1', name: 'Sprint 1' },
        version: '2.0.0',
      });

      expect(notes).toContain('## Summary');
      expect(notes).toContain('v2.0.0');
      expect(notes).toContain('Sprint 1');
      expect(notes).toContain('4 completed tasks');
      expect(notes).toContain('## Features');
      expect(notes).toContain('## Fixes');
      expect(notes).toContain('## Breaking Changes');
      expect(notes).toContain('## Other');
      expect(notes).toContain('feat: add login');
      expect(notes).toContain('fix: resolve crash');
    });

    it('includes executive summary counts', () => {
      const tasks = [
        { title: 'feat: add A', prNumber: 1 },
        { title: 'feat: add B', prNumber: 2 },
        { title: 'fix: C', prNumber: 3 },
      ];

      const notes = generateReleaseNotes({
        tasks,
        sprint: { id: 'sp1', name: 'Sprint 1' },
        version: '1.1.0',
      });

      expect(notes).toContain('2 features');
      expect(notes).toContain('1 fix');
    });

    it('includes dashboard link when provided', () => {
      const notes = generateReleaseNotes({
        tasks: [{ title: 'feat: something' }],
        sprint: { id: 'sp1', name: 'Sprint 1' },
        version: '1.0.0',
        dashboardUrl: 'https://dashboard.example.com/sprint/sp1',
      });

      expect(notes).toContain('## Sprint');
      expect(notes).toContain('https://dashboard.example.com/sprint/sp1');
    });

    it('omits dashboard section when no URL provided', () => {
      const notes = generateReleaseNotes({
        tasks: [{ title: 'feat: something' }],
        sprint: { id: 'sp1', name: 'Sprint 1' },
        version: '1.0.0',
      });

      expect(notes).not.toContain('## Sprint');
    });
  });

  // ─── createGitHubRelease ───

  describe('createGitHubRelease', () => {
    it('calls gh release create with correct args', () => {
      execFileSync.mockReturnValue('https://github.com/org/repo/releases/tag/v1.0.0\n');

      const result = createGitHubRelease({
        repo: 'org/repo',
        tag: 'v1.0.0',
        title: 'v1.0.0 — Sprint 1',
        notes: '## Summary\nRelease notes...',
        cwd: '/my/project',
      });

      expect(execFileSync).toHaveBeenCalledWith(
        'gh',
        [
          'release', 'create', 'v1.0.0',
          '--repo', 'org/repo',
          '--title', 'v1.0.0 — Sprint 1',
          '--notes', '## Summary\nRelease notes...',
        ],
        expect.objectContaining({ cwd: '/my/project' }),
      );

      expect(result.tag).toBe('v1.0.0');
      expect(result.url).toBe('https://github.com/org/repo/releases/tag/v1.0.0');
    });

    it('falls back to constructed URL when gh returns empty', () => {
      execFileSync.mockReturnValue('');

      const result = createGitHubRelease({
        repo: 'org/repo',
        tag: 'v1.0.0',
        title: 'v1.0.0',
        notes: 'notes',
      });

      expect(result.url).toBe('https://github.com/org/repo/releases/tag/v1.0.0');
    });
  });

  // ─── autoRelease ───

  describe('autoRelease', () => {
    it('skips when AUTO_RELEASE=false', async () => {
      config.autoRelease = false;

      const result = await autoRelease({
        sprintId: 'sp1',
        projectId: 'proj1',
        repo: 'org/repo',
      });

      expect(result.skipped).toBe(true);
      expect(result.reason).toBe('AUTO_RELEASE=false');
      expect(getAll).not.toHaveBeenCalled();
    });

    it('skips when RELEASE_ON_SPRINT_COMPLETE=false', async () => {
      config.releaseOnSprintComplete = false;

      const result = await autoRelease({
        sprintId: 'sp1',
        projectId: 'proj1',
        repo: 'org/repo',
      });

      expect(result.skipped).toBe(true);
      expect(result.reason).toBe('RELEASE_ON_SPRINT_COMPLETE=false');
    });

    it('skips when no sprintId', async () => {
      const result = await autoRelease({
        sprintId: null,
        projectId: 'proj1',
        repo: 'org/repo',
      });

      expect(result.skipped).toBe(true);
      expect(result.reason).toBe('no sprintId');
    });

    it('skips when sprint is not complete', async () => {
      getAll.mockImplementation((path) => {
        if (path === 'tasks') {
          return [
            { id: 't1', sprintId: 'sp1', projectId: 'proj1', status: 'done' },
            { id: 't2', sprintId: 'sp1', projectId: 'proj1', status: 'in-progress' },
          ];
        }
        if (path === 'sprints') {
          return [{ id: 'sp1', projectId: 'proj1', name: 'Sprint 1' }];
        }
        return [];
      });

      const result = await autoRelease({
        sprintId: 'sp1',
        projectId: 'proj1',
        repo: 'org/repo',
      });

      expect(result.skipped).toBe(true);
      expect(result.reason).toBe('sprint not complete');
    });

    it('creates release when sprint is complete', async () => {
      getAll.mockImplementation((path) => {
        if (path === 'tasks') {
          return [
            { id: 't1', sprintId: 'sp1', projectId: 'proj1', status: 'done', title: 'feat: add login', prNumber: 1 },
            { id: 't2', sprintId: 'sp1', projectId: 'proj1', status: 'done', title: 'fix: crash', prNumber: 2 },
            { id: 't3', sprintId: 'sp1', projectId: 'proj1', status: 'done', title: 'feat: dashboard', prNumber: 3 },
          ];
        }
        if (path === 'sprints') {
          return [{ id: 'sp1', projectId: 'proj1', name: 'Sprint 1', status: 'active' }];
        }
        return [];
      });

      readVersion.mockReturnValue('1.2.0');
      execFileSync.mockReturnValue('https://github.com/org/repo/releases/tag/v1.2.0');

      const result = await autoRelease({
        sprintId: 'sp1',
        projectId: 'proj1',
        repo: 'org/repo',
        cwd: '/my/project',
      });

      expect(result.skipped).toBe(false);
      expect(result.tag).toBe('v1.2.0');
      expect(result.releaseUrl).toBe('https://github.com/org/repo/releases/tag/v1.2.0');
      expect(result.version).toBe('1.2.0');
      expect(result.sprintName).toBe('Sprint 1');

      // Verify gh release create was called
      expect(execFileSync).toHaveBeenCalledWith(
        'gh',
        expect.arrayContaining(['release', 'create', 'v1.2.0']),
        expect.any(Object),
      );

      // Verify event was emitted
      expect(eventBus.emitEvent).toHaveBeenCalledWith(
        EVENT_TYPES.RELEASE_CREATED,
        expect.objectContaining({
          metadata: expect.objectContaining({
            tag: 'v1.2.0',
            version: '1.2.0',
            sprintId: 'sp1',
            sprintName: 'Sprint 1',
            taskCount: 3,
            repo: 'org/repo',
          }),
        }),
      );
    });

    it('blocks release when there are critical/high bugs', async () => {
      getAll.mockImplementation((path) => {
        if (path === 'tasks') {
          return [
            { id: 't1', sprintId: 'sp1', projectId: 'proj1', status: 'done', title: 'feat: login' },
          ];
        }
        if (path === 'sprints') {
          return [{ id: 'sp1', projectId: 'proj1', name: 'Sprint 1' }];
        }
        return [];
      });

      evaluateReleaseGate.mockResolvedValue({
        allowed: false,
        blockingBugs: [
          { id: 'b1', title: 'Critical crash', severity: 'critical', status: 'open' },
        ],
        overridden: false,
      });

      const result = await autoRelease({
        sprintId: 'sp1',
        projectId: 'proj1',
        repo: 'org/repo',
      });

      expect(result.skipped).toBe(true);
      expect(result.reason).toBe('blocking bugs');
      expect(result.blockingBugs).toHaveLength(1);
      expect(result.blockingBugs[0].severity).toBe('critical');
      expect(execFileSync).not.toHaveBeenCalled();
    });

    it('allows release with RELEASE_IGNORE_BUGS override', async () => {
      getAll.mockImplementation((path) => {
        if (path === 'tasks') {
          return [
            { id: 't1', sprintId: 'sp1', projectId: 'proj1', status: 'done', title: 'feat: login', prNumber: 1 },
          ];
        }
        if (path === 'sprints') {
          return [{ id: 'sp1', projectId: 'proj1', name: 'Sprint 1' }];
        }
        return [];
      });

      evaluateReleaseGate.mockResolvedValue({
        allowed: true,
        blockingBugs: [
          { id: 'b1', title: 'Known issue', severity: 'high', status: 'open' },
        ],
        overridden: true,
      });

      readVersion.mockReturnValue('1.0.0');
      execFileSync.mockReturnValue('https://github.com/org/repo/releases/tag/v1.0.0');

      const result = await autoRelease({
        sprintId: 'sp1',
        projectId: 'proj1',
        repo: 'org/repo',
      });

      expect(result.skipped).toBe(false);
      expect(result.tag).toBe('v1.0.0');
      expect(execFileSync).toHaveBeenCalled();
    });

    it('uses fallback version 0.0.0 when readVersion fails', async () => {
      getAll.mockImplementation((path) => {
        if (path === 'tasks') {
          return [
            { id: 't1', sprintId: 'sp1', projectId: 'proj1', status: 'done', title: 'feat: init' },
          ];
        }
        if (path === 'sprints') {
          return [{ id: 'sp1', projectId: 'proj1', name: 'Sprint 1' }];
        }
        return [];
      });

      readVersion.mockImplementation(() => { throw new Error('no package.json'); });
      execFileSync.mockReturnValue('https://github.com/org/repo/releases/tag/v0.0.0');

      const result = await autoRelease({
        sprintId: 'sp1',
        projectId: 'proj1',
        repo: 'org/repo',
      });

      expect(result.skipped).toBe(false);
      expect(result.tag).toBe('v0.0.0');
    });
  });
});
