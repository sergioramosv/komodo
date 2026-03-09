import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseProjectsEnv, loadProjectConfig, loadProjects } from './project-loader.js';

vi.mock('../../skills/planning-task-mcp/src/firebase.js', () => ({
  getAll: vi.fn(),
  getById: vi.fn(),
}));

vi.mock('../config.js', () => ({
  config: {
    projects: '',
    defaultUserId: 'user-123',
  },
}));

vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { getAll, getById } from '../../skills/planning-task-mcp/src/firebase.js';
import { config } from '../config.js';

const mockProject = {
  id: 'proj-abc',
  name: 'Test Project',
  repositories: [
    { url: 'https://github.com/owner/repo', type: 'fullstack', isDefault: true },
  ],
  codingGuidelines: 'Use TypeScript',
  members: {
    'user-123': { userId: 'user-123', role: 'owner' },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  config.projects = '';
});

// ─── parseProjectsEnv ────────────────────────────────────────────────────────

describe('parseProjectsEnv', () => {
  it('returns empty when PROJECTS not set', () => {
    config.projects = '';
    expect(parseProjectsEnv()).toEqual({ wildcard: false, projectIds: [] });
  });

  it('returns wildcard: true when PROJECTS=*', () => {
    config.projects = '*';
    expect(parseProjectsEnv()).toEqual({ wildcard: true, projectIds: [] });
  });

  it('parses comma-separated project IDs', () => {
    config.projects = 'id1,id2,id3';
    expect(parseProjectsEnv()).toEqual({ wildcard: false, projectIds: ['id1', 'id2', 'id3'] });
  });

  it('trims whitespace from IDs', () => {
    config.projects = ' id1 , id2 ';
    expect(parseProjectsEnv()).toEqual({ wildcard: false, projectIds: ['id1', 'id2'] });
  });

  it('filters out empty tokens', () => {
    config.projects = 'id1,,id2,';
    const { projectIds } = parseProjectsEnv();
    expect(projectIds).toEqual(['id1', 'id2']);
  });
});

// ─── loadProjectConfig ────────────────────────────────────────────────────────

describe('loadProjectConfig', () => {
  it('returns project config for valid project and user', async () => {
    getById.mockResolvedValue(mockProject);

    const result = await loadProjectConfig('proj-abc', 'user-123');

    expect(result).toEqual({
      projectId: 'proj-abc',
      name: 'Test Project',
      repoUrl: 'https://github.com/owner/repo',
      codingGuidelines: 'Use TypeScript',
      repositories: mockProject.repositories,
    });
  });

  it('throws if project not found', async () => {
    getById.mockResolvedValue(null);

    await expect(loadProjectConfig('nonexistent', 'user-123'))
      .rejects.toThrow('Project "nonexistent" not found');
  });

  it('throws if user has no access', async () => {
    getById.mockResolvedValue({ ...mockProject, members: { 'other-user': true } });

    await expect(loadProjectConfig('proj-abc', 'user-123'))
      .rejects.toThrow('User "user-123" has no access to project "proj-abc"');
  });

  it('allows access when member value is boolean true', async () => {
    getById.mockResolvedValue({ ...mockProject, members: { 'user-123': true } });

    const result = await loadProjectConfig('proj-abc', 'user-123');
    expect(result.projectId).toBe('proj-abc');
  });

  it('skips access check when no userId provided', async () => {
    getById.mockResolvedValue(mockProject);

    const result = await loadProjectConfig('proj-abc', '');
    expect(result.projectId).toBe('proj-abc');
  });

  it('uses first repo as default when none marked isDefault', async () => {
    const project = {
      ...mockProject,
      repositories: [
        { url: 'https://github.com/owner/repo1', type: 'back' },
        { url: 'https://github.com/owner/repo2', type: 'front' },
      ],
    };
    getById.mockResolvedValue(project);

    const result = await loadProjectConfig('proj-abc', 'user-123');
    expect(result.repoUrl).toBe('https://github.com/owner/repo1');
  });

  it('returns empty repoUrl when project has no repositories', async () => {
    getById.mockResolvedValue({ ...mockProject, repositories: [] });

    const result = await loadProjectConfig('proj-abc', 'user-123');
    expect(result.repoUrl).toBe('');
  });
});

// ─── loadProjects ─────────────────────────────────────────────────────────────

describe('loadProjects', () => {
  it('returns null when PROJECTS not set', async () => {
    config.projects = '';
    const result = await loadProjects();
    expect(result).toBeNull();
  });

  it('loads all user projects when PROJECTS=*', async () => {
    config.projects = '*';
    getAll.mockResolvedValue([mockProject]);

    const result = await loadProjects('user-123');

    expect(result).toHaveLength(1);
    expect(result[0].projectId).toBe('proj-abc');
  });

  it('loads specific projects when IDs provided', async () => {
    config.projects = 'proj-abc';
    getById.mockResolvedValue(mockProject);

    const result = await loadProjects('user-123');

    expect(result).toHaveLength(1);
    expect(result[0].projectId).toBe('proj-abc');
  });

  it('throws if any project ID is invalid', async () => {
    config.projects = 'proj-abc,nonexistent';
    getById.mockResolvedValueOnce(mockProject).mockResolvedValueOnce(null);

    await expect(loadProjects('user-123'))
      .rejects.toThrow('Invalid projects');
  });

  it('returns empty array when PROJECTS=* and user has no projects', async () => {
    config.projects = '*';
    getAll.mockResolvedValue([]);

    const result = await loadProjects('user-123');
    expect(result).toEqual([]);
  });

  it('filters out non-member projects when PROJECTS=*', async () => {
    config.projects = '*';
    const otherProject = { ...mockProject, id: 'proj-other', members: { 'other-user': true } };
    getAll.mockResolvedValue([mockProject, otherProject]);

    const result = await loadProjects('user-123');

    expect(result).toHaveLength(1);
    expect(result[0].projectId).toBe('proj-abc');
  });
});
