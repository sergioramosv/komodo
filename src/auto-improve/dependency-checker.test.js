import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Hoisted mocks ---

const { mockConfig } = vi.hoisted(() => ({
  mockConfig: {
    depCheckEnabled: true,
    depCheckIntervalHours: 24,
    defaultUserId: 'user-1',
    defaultUserName: 'Test User',
  },
}));

vi.mock('../config.js', () => ({ config: mockConfig }));

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
  EVENT_TYPES: { DEP_CHECK_COMPLETED: 'dep-check:completed' },
}));

vi.mock('../../skills/planning-task-mcp/src/firebase.js', () => ({
  getAll: vi.fn(),
  create: vi.fn(),
}));

vi.mock('child_process', () => ({
  execFileSync: vi.fn(),
}));

import {
  runNpmAudit,
  runNpmOutdated,
  deduplicationKey,
  runDependencyCheck,
} from './dependency-checker.js';

import { execFileSync } from 'child_process';
import { getAll, create } from '../../skills/planning-task-mcp/src/firebase.js';
import { eventBus } from '../events/event-bus.js';

beforeEach(() => {
  vi.clearAllMocks();
  mockConfig.depCheckEnabled = true;
  mockConfig.defaultUserId = 'user-1';
  mockConfig.defaultUserName = 'Test User';
});

// --- runNpmAudit ---

describe('runNpmAudit', () => {
  it('parses npm audit JSON output with vulnerabilities', () => {
    const auditOutput = JSON.stringify({
      vulnerabilities: {
        lodash: {
          severity: 'critical',
          range: '<=4.17.20',
          fixAvailable: { name: 'lodash', version: '4.17.21' },
          via: [{ title: 'Prototype Pollution' }],
        },
        'node-fetch': {
          severity: 'high',
          range: '<2.6.7',
          fixAvailable: true,
          via: ['node-fetch vulnerability'],
        },
      },
    });

    execFileSync.mockReturnValue(auditOutput);

    const result = runNpmAudit('/repo');

    expect(result.vulnerabilities).toHaveLength(2);
    expect(result.vulnerabilities[0]).toEqual({
      name: 'lodash',
      severity: 'critical',
      currentVersion: '<=4.17.20',
      fixAvailable: 'lodash@4.17.21',
      via: 'Prototype Pollution',
    });
    expect(result.vulnerabilities[1]).toEqual({
      name: 'node-fetch',
      severity: 'high',
      currentVersion: '<2.6.7',
      fixAvailable: 'yes',
      via: 'node-fetch vulnerability',
    });
  });

  it('handles npm audit exit code 1 (vulnerabilities found) via err.stdout', () => {
    const auditOutput = JSON.stringify({
      vulnerabilities: {
        axios: { severity: 'moderate', range: '<0.21.1', fixAvailable: false, via: ['SSRF'] },
      },
    });

    const err = new Error('npm audit failed');
    err.stdout = auditOutput;
    execFileSync.mockImplementation(() => { throw err; });

    const result = runNpmAudit('/repo');

    expect(result.vulnerabilities).toHaveLength(1);
    expect(result.vulnerabilities[0].name).toBe('axios');
    expect(result.vulnerabilities[0].fixAvailable).toBe('no');
  });

  it('returns empty when npm audit completely fails', () => {
    execFileSync.mockImplementation(() => { throw new Error('npm not found'); });

    const result = runNpmAudit('/repo');
    expect(result.vulnerabilities).toEqual([]);
  });

  it('returns empty when audit output has no vulnerabilities', () => {
    execFileSync.mockReturnValue(JSON.stringify({ vulnerabilities: {} }));

    const result = runNpmAudit('/repo');
    expect(result.vulnerabilities).toEqual([]);
  });
});

// --- runNpmOutdated ---

describe('runNpmOutdated', () => {
  it('returns only major version updates', () => {
    const outdatedOutput = JSON.stringify({
      express: { current: '4.18.2', latest: '5.0.0', type: 'dependencies' },
      lodash: { current: '4.17.21', latest: '4.17.22', type: 'dependencies' }, // minor, skip
      typescript: { current: '4.9.5', latest: '5.3.0', type: 'devDependencies' },
    });

    execFileSync.mockReturnValue(outdatedOutput);

    const result = runNpmOutdated('/repo');

    expect(result.outdated).toHaveLength(2);
    expect(result.outdated[0]).toEqual({
      name: 'express',
      current: '4.18.2',
      latest: '5.0.0',
      type: 'dependencies',
    });
    expect(result.outdated[1]).toEqual({
      name: 'typescript',
      current: '4.9.5',
      latest: '5.3.0',
      type: 'devDependencies',
    });
  });

  it('handles npm outdated exit code 1 via err.stdout', () => {
    const outdatedOutput = JSON.stringify({
      react: { current: '17.0.2', latest: '18.2.0', type: 'dependencies' },
    });

    const err = new Error('npm outdated failed');
    err.stdout = outdatedOutput;
    execFileSync.mockImplementation(() => { throw err; });

    const result = runNpmOutdated('/repo');

    expect(result.outdated).toHaveLength(1);
    expect(result.outdated[0].name).toBe('react');
  });

  it('returns empty when npm outdated completely fails', () => {
    execFileSync.mockImplementation(() => { throw new Error('npm not found'); });

    const result = runNpmOutdated('/repo');
    expect(result.outdated).toEqual([]);
  });

  it('returns empty when no outdated packages', () => {
    execFileSync.mockReturnValue('{}');

    const result = runNpmOutdated('/repo');
    expect(result.outdated).toEqual([]);
  });
});

// --- deduplicationKey ---

describe('deduplicationKey', () => {
  it('creates lowercase key with type', () => {
    expect(deduplicationKey('Lodash', 'vulnerability')).toBe('dep-check::lodash::vulnerability');
    expect(deduplicationKey('Express', 'major-update')).toBe('dep-check::express::major-update');
  });
});

// --- runDependencyCheck (integration) ---

describe('runDependencyCheck', () => {
  it('returns early when disabled', async () => {
    mockConfig.depCheckEnabled = false;

    const result = await runDependencyCheck({ projectId: 'proj-1', cwd: '/repo' });

    expect(result).toEqual({
      vulnerabilities: 0,
      tasksCreated: 0,
      tasksSkipped: 0,
      proposalsCreated: 0,
      proposalsSkipped: 0,
    });
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it('creates tasks for vulnerabilities and proposals for major updates', async () => {
    // npm audit returns vulnerabilities
    const auditOutput = JSON.stringify({
      vulnerabilities: {
        lodash: {
          severity: 'critical',
          range: '<=4.17.20',
          fixAvailable: { name: 'lodash', version: '4.17.21' },
          via: [{ title: 'Prototype Pollution' }],
        },
      },
    });

    // npm outdated returns major updates
    const outdatedOutput = JSON.stringify({
      express: { current: '4.18.2', latest: '5.0.0', type: 'dependencies' },
    });

    execFileSync
      .mockReturnValueOnce(auditOutput)   // npm audit
      .mockReturnValueOnce(outdatedOutput); // npm outdated

    getAll.mockResolvedValue([]); // no existing tasks/proposals
    create
      .mockResolvedValueOnce('task-vuln-1')    // vulnerability task
      .mockResolvedValueOnce('prop-update-1'); // update proposal

    const result = await runDependencyCheck({ projectId: 'proj-1', cwd: '/repo' });

    expect(result.vulnerabilities).toBe(1);
    expect(result.tasksCreated).toBe(1);
    expect(result.proposalsCreated).toBe(1);

    // Verify vulnerability task
    expect(create).toHaveBeenCalledWith('tasks', expect.objectContaining({
      projectId: 'proj-1',
      title: '[Dep Security] Fix critical vulnerability in lodash',
      bizPoints: 13, // critical -> 13
      devPoints: 5,
      status: 'to-do',
      source: 'dep-check',
      depName: 'lodash',
      depSeverity: 'critical',
      depType: 'vulnerability',
    }));

    // Verify update proposal
    expect(create).toHaveBeenCalledWith('proposals', expect.objectContaining({
      projectId: 'proj-1',
      category: 'major-update',
      source: 'dep-check',
      depName: 'express',
      depCurrentVersion: '4.18.2',
      depTargetVersion: '5.0.0',
      status: 'pending',
    }));

    // Verify event emitted
    expect(eventBus.emitEvent).toHaveBeenCalledWith('dep-check:completed', expect.objectContaining({
      metadata: expect.objectContaining({
        vulnerabilities: 1,
        tasksCreated: 1,
        proposalsCreated: 1,
      }),
    }));
  });

  it('deduplicates against existing tasks and proposals', async () => {
    const auditOutput = JSON.stringify({
      vulnerabilities: {
        lodash: { severity: 'critical', range: '<=4.17.20', fixAvailable: true, via: [] },
      },
    });

    const outdatedOutput = JSON.stringify({
      express: { current: '4.18.2', latest: '5.0.0', type: 'dependencies' },
    });

    execFileSync
      .mockReturnValueOnce(auditOutput)
      .mockReturnValueOnce(outdatedOutput);

    // Existing task for lodash vulnerability and proposal for express update
    getAll
      .mockResolvedValueOnce([
        { source: 'dep-check', depName: 'lodash', depType: 'vulnerability' },
      ])
      .mockResolvedValueOnce([
        { source: 'dep-check', depName: 'express', depType: 'major-update' },
      ]);

    const result = await runDependencyCheck({ projectId: 'proj-1', cwd: '/repo' });

    expect(result.tasksCreated).toBe(0);
    expect(result.tasksSkipped).toBe(1);
    expect(result.proposalsCreated).toBe(0);
    expect(result.proposalsSkipped).toBe(1);
    expect(create).not.toHaveBeenCalled();
  });

  it('maps severity to correct bizPoints', async () => {
    const severities = ['critical', 'high', 'moderate', 'low'];
    const expectedBiz = [13, 8, 5, 2];
    const expectedDev = [5, 3, 2, 1];

    for (let i = 0; i < severities.length; i++) {
      vi.clearAllMocks();

      const auditOutput = JSON.stringify({
        vulnerabilities: {
          pkg: { severity: severities[i], range: '1.0.0', fixAvailable: true, via: [] },
        },
      });

      execFileSync
        .mockReturnValueOnce(auditOutput)
        .mockReturnValueOnce('{}'); // no outdated

      getAll.mockResolvedValue([]);
      create.mockResolvedValue(`task-${i}`);

      await runDependencyCheck({ projectId: 'proj-1', cwd: '/repo' });

      expect(create).toHaveBeenCalledWith('tasks', expect.objectContaining({
        bizPoints: expectedBiz[i],
        devPoints: expectedDev[i],
        depSeverity: severities[i],
      }));
    }
  });

  it('handles Firebase errors gracefully', async () => {
    execFileSync
      .mockReturnValueOnce(JSON.stringify({ vulnerabilities: {} }))
      .mockReturnValueOnce('{}');

    getAll.mockRejectedValue(new Error('Firebase down'));

    const result = await runDependencyCheck({ projectId: 'proj-1', cwd: '/repo' });

    // Should complete without throwing
    expect(result.tasksCreated).toBe(0);
    expect(result.proposalsCreated).toBe(0);
  });

  it('handles create errors without stopping other items', async () => {
    const auditOutput = JSON.stringify({
      vulnerabilities: {
        pkg1: { severity: 'high', range: '1.0.0', fixAvailable: true, via: [] },
        pkg2: { severity: 'low', range: '2.0.0', fixAvailable: true, via: [] },
      },
    });

    execFileSync
      .mockReturnValueOnce(auditOutput)
      .mockReturnValueOnce('{}');

    getAll.mockResolvedValue([]);
    create
      .mockRejectedValueOnce(new Error('Create failed'))
      .mockResolvedValueOnce('task-2');

    const result = await runDependencyCheck({ projectId: 'proj-1', cwd: '/repo' });

    expect(result.tasksCreated).toBe(1);
  });
});
