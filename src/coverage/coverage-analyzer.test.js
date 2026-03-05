import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../config.js', () => ({
  config: {
    coverageCheck: true,
    coverageCmd: 'auto',
    minCoverageDelta: -2,
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
  EVENT_TYPES: {
    COVERAGE_CHECK_START: 'coverage:check:start',
    COVERAGE_CHECK_COMPLETE: 'coverage:check:complete',
    COVERAGE_CHECK_ERROR: 'coverage:check:error',
    COVERAGE_BASELINE_UPDATED: 'coverage:baseline:updated',
  },
}));

vi.mock('child_process', () => ({
  execFileSync: vi.fn(),
}));

vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => '{}'),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

const { config } = await import('../config.js');
const { eventBus } = await import('../events/event-bus.js');
const { execFileSync } = await import('child_process');
const { existsSync, readFileSync, writeFileSync, mkdirSync } = await import('fs');
const {
  detectCoverageCommand,
  resolveCoverageCommand,
  runCoverage,
  parseCoverageFromOutput,
  readBaseline,
  writeBaseline,
  analyzeCoverage,
  updateBaselineAfterMerge,
  buildCoverageSection,
} = await import('./coverage-analyzer.js');

describe('coverage-analyzer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    config.coverageCheck = true;
    config.coverageCmd = 'auto';
    config.minCoverageDelta = -2;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── detectCoverageCommand ──

  describe('detectCoverageCommand', () => {
    it('detects test:coverage script from package.json', () => {
      existsSync.mockImplementation((p) => p.endsWith('package.json'));
      readFileSync.mockReturnValue(JSON.stringify({
        scripts: { 'test:coverage': 'vitest run --coverage' },
      }));

      expect(detectCoverageCommand('/project')).toBe('npm run test:coverage');
    });

    it('detects vitest from devDependencies', () => {
      existsSync.mockImplementation((p) => p.endsWith('package.json'));
      readFileSync.mockReturnValue(JSON.stringify({
        devDependencies: { vitest: '^1.0.0' },
      }));

      expect(detectCoverageCommand('/project')).toBe('npx vitest run --coverage');
    });

    it('detects jest from devDependencies', () => {
      existsSync.mockImplementation((p) => p.endsWith('package.json'));
      readFileSync.mockReturnValue(JSON.stringify({
        devDependencies: { jest: '^29.0.0' },
      }));

      expect(detectCoverageCommand('/project')).toBe('npx jest --coverage');
    });

    it('detects c8 from devDependencies', () => {
      existsSync.mockImplementation((p) => p.endsWith('package.json'));
      readFileSync.mockReturnValue(JSON.stringify({
        devDependencies: { c8: '^8.0.0' },
      }));

      expect(detectCoverageCommand('/project')).toBe('npm test -- --coverage');
    });

    it('returns null when no coverage tool found', () => {
      existsSync.mockReturnValue(false);

      expect(detectCoverageCommand('/project')).toBeNull();
    });
  });

  // ── resolveCoverageCommand ──

  describe('resolveCoverageCommand', () => {
    it('returns explicit command when configured', () => {
      config.coverageCmd = 'npx vitest --coverage';

      expect(resolveCoverageCommand('/project')).toBe('npx vitest --coverage');
    });

    it('auto-detects when set to auto', () => {
      config.coverageCmd = 'auto';
      existsSync.mockImplementation((p) => p.endsWith('package.json'));
      readFileSync.mockReturnValue(JSON.stringify({
        devDependencies: { vitest: '^1.0.0' },
      }));

      expect(resolveCoverageCommand('/project')).toBe('npx vitest run --coverage');
    });
  });

  // ── parseCoverageFromOutput ──

  describe('parseCoverageFromOutput', () => {
    it('parses istanbul/vitest table format', () => {
      const output = `
----------|---------|----------|---------|---------|
File      | % Stmts | % Branch | % Funcs | % Lines |
----------|---------|----------|---------|---------|
All files |   82.5  |   70.3   |   90.1  |   82.5  |
----------|---------|----------|---------|---------|`;

      expect(parseCoverageFromOutput(output)).toBe(82.5);
    });

    it('parses c8/nyc summary format', () => {
      const output = `
Statements   : 75.2% ( 188/250 )
Branches     : 60.0% ( 30/50 )
Functions    : 85.7% ( 12/14 )
Lines        : 75.2% ( 188/250 )`;

      expect(parseCoverageFromOutput(output)).toBe(75.2);
    });

    it('parses generic coverage percentage', () => {
      const output = 'Total coverage: 91.3%';
      expect(parseCoverageFromOutput(output)).toBe(91.3);
    });

    it('returns null for empty output', () => {
      expect(parseCoverageFromOutput('')).toBeNull();
      expect(parseCoverageFromOutput(null)).toBeNull();
    });

    it('returns null for unparseable output', () => {
      expect(parseCoverageFromOutput('no coverage info here')).toBeNull();
    });
  });

  // ── runCoverage ──

  describe('runCoverage', () => {
    it('returns coverage when command succeeds', () => {
      execFileSync.mockReturnValue('All files |   80.5  |   70  |   90  |   80  |');

      const result = runCoverage('npx vitest run --coverage', '/project');

      expect(result.success).toBe(true);
      expect(result.coverage).toBe(80.5);
    });

    it('parses coverage even when command fails (non-zero exit)', () => {
      const err = new Error('tests failed');
      err.stdout = 'All files |   60.2  |   50  |   70  |   60  |';
      err.stderr = '';
      execFileSync.mockImplementation(() => { throw err; });

      const result = runCoverage('npx vitest run --coverage', '/project');

      expect(result.success).toBe(true);
      expect(result.coverage).toBe(60.2);
    });

    it('returns failure when coverage cannot be parsed', () => {
      execFileSync.mockReturnValue('no coverage data');

      const result = runCoverage('npx vitest run --coverage', '/project');

      expect(result.success).toBe(false);
      expect(result.coverage).toBeNull();
    });
  });

  // ── readBaseline / writeBaseline ──

  describe('readBaseline', () => {
    it('returns null when file does not exist', () => {
      existsSync.mockReturnValue(false);

      expect(readBaseline('/project')).toBeNull();
    });

    it('returns baseline data when file exists', () => {
      existsSync.mockReturnValue(true);
      readFileSync.mockReturnValue(JSON.stringify({
        coverage: 80.5,
        timestamp: '2026-01-01T00:00:00.000Z',
        commitSha: 'abc123',
      }));

      const result = readBaseline('/project');

      expect(result.coverage).toBe(80.5);
      expect(result.commitSha).toBe('abc123');
    });

    it('returns null for invalid JSON', () => {
      existsSync.mockReturnValue(true);
      readFileSync.mockReturnValue('not json');

      expect(readBaseline('/project')).toBeNull();
    });

    it('returns null when coverage field is missing', () => {
      existsSync.mockReturnValue(true);
      readFileSync.mockReturnValue(JSON.stringify({ timestamp: '2026-01-01' }));

      expect(readBaseline('/project')).toBeNull();
    });
  });

  describe('writeBaseline', () => {
    it('creates .komodo directory and writes baseline', () => {
      existsSync.mockReturnValue(false);

      writeBaseline('/project', 85.3, 'sha456');

      expect(mkdirSync).toHaveBeenCalled();
      expect(writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('coverage-baseline.json'),
        expect.stringContaining('"coverage": 85.3'),
        'utf-8',
      );
    });
  });

  // ── analyzeCoverage ──

  describe('analyzeCoverage', () => {
    it('skips when COVERAGE_CHECK is disabled', () => {
      config.coverageCheck = false;

      const report = analyzeCoverage({ cwd: '/project' });

      expect(report.skipped).toBe(true);
      expect(report.reason).toContain('disabled');
    });

    it('skips when no cwd provided', () => {
      const report = analyzeCoverage({});

      expect(report.skipped).toBe(true);
    });

    it('skips when no coverage command detected', () => {
      config.coverageCmd = 'auto';
      existsSync.mockReturnValue(false);

      const report = analyzeCoverage({ cwd: '/project' });

      expect(report.skipped).toBe(true);
      expect(report.reason).toContain('No coverage command');
    });

    it('reports coverage with no baseline (first run)', () => {
      config.coverageCmd = 'npx vitest run --coverage';
      execFileSync.mockReturnValue('All files |   80.0  |   70  |   90  |   80  |');
      existsSync.mockReturnValue(false); // no baseline file

      const report = analyzeCoverage({ cwd: '/project' });

      expect(report.success).toBe(true);
      expect(report.coverage).toBe(80);
      expect(report.baselineCoverage).toBeNull();
      expect(report.delta).toBeNull();
      expect(report.belowThreshold).toBe(false);
      expect(eventBus.emitEvent).toHaveBeenCalledWith(
        'coverage:check:complete',
        expect.objectContaining({
          metadata: expect.objectContaining({ coverage: 80, delta: null }),
        }),
      );
    });

    it('reports positive delta when coverage improves', () => {
      config.coverageCmd = 'npx vitest run --coverage';
      execFileSync.mockReturnValue('All files |   85.0  |   70  |   90  |   85  |');

      // Baseline file exists
      existsSync.mockImplementation((p) => p.includes('coverage-baseline'));
      readFileSync.mockReturnValue(JSON.stringify({ coverage: 80, timestamp: '', commitSha: '' }));

      const report = analyzeCoverage({ cwd: '/project' });

      expect(report.success).toBe(true);
      expect(report.coverage).toBe(85);
      expect(report.baselineCoverage).toBe(80);
      expect(report.delta).toBe(5);
      expect(report.belowThreshold).toBe(false);
    });

    it('flags belowThreshold when coverage drops beyond limit', () => {
      config.coverageCmd = 'npx vitest run --coverage';
      config.minCoverageDelta = -2;
      execFileSync.mockReturnValue('All files |   75.0  |   70  |   90  |   75  |');

      existsSync.mockImplementation((p) => p.includes('coverage-baseline'));
      readFileSync.mockReturnValue(JSON.stringify({ coverage: 80, timestamp: '', commitSha: '' }));

      const report = analyzeCoverage({ cwd: '/project' });

      expect(report.success).toBe(true);
      expect(report.coverage).toBe(75);
      expect(report.delta).toBe(-5);
      expect(report.belowThreshold).toBe(true);
    });

    it('does not flag when delta is within threshold', () => {
      config.coverageCmd = 'npx vitest run --coverage';
      config.minCoverageDelta = -2;
      execFileSync.mockReturnValue('All files |   79.0  |   70  |   90  |   79  |');

      existsSync.mockImplementation((p) => p.includes('coverage-baseline'));
      readFileSync.mockReturnValue(JSON.stringify({ coverage: 80, timestamp: '', commitSha: '' }));

      const report = analyzeCoverage({ cwd: '/project' });

      expect(report.delta).toBe(-1);
      expect(report.belowThreshold).toBe(false);
    });

    it('returns error report when coverage parse fails', () => {
      config.coverageCmd = 'npx vitest run --coverage';
      execFileSync.mockReturnValue('no coverage data');

      const report = analyzeCoverage({ cwd: '/project' });

      expect(report.success).toBe(false);
      expect(report.skipped).toBe(false);
      expect(eventBus.emitEvent).toHaveBeenCalledWith(
        'coverage:check:error',
        expect.anything(),
      );
    });
  });

  // ── updateBaselineAfterMerge ──

  describe('updateBaselineAfterMerge', () => {
    it('updates baseline when coverage is available', () => {
      config.coverageCmd = 'npx vitest run --coverage';
      execFileSync.mockReturnValue('All files |   85.0  |   70  |   90  |   85  |');
      existsSync.mockReturnValue(false); // .komodo dir doesn't exist

      updateBaselineAfterMerge({ cwd: '/project', commitSha: 'merge-sha' });

      expect(writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('coverage-baseline.json'),
        expect.stringContaining('"coverage": 85'),
        'utf-8',
      );
      expect(eventBus.emitEvent).toHaveBeenCalledWith(
        'coverage:baseline:updated',
        expect.objectContaining({
          metadata: expect.objectContaining({ coverage: 85, commitSha: 'merge-sha' }),
        }),
      );
    });

    it('skips when COVERAGE_CHECK is disabled', () => {
      config.coverageCheck = false;

      updateBaselineAfterMerge({ cwd: '/project' });

      expect(execFileSync).not.toHaveBeenCalled();
      expect(writeFileSync).not.toHaveBeenCalled();
    });

    it('skips when no cwd provided', () => {
      updateBaselineAfterMerge({});

      expect(execFileSync).not.toHaveBeenCalled();
    });

    it('skips when no coverage command detected', () => {
      config.coverageCmd = 'auto';
      existsSync.mockReturnValue(false);

      updateBaselineAfterMerge({ cwd: '/project' });

      expect(writeFileSync).not.toHaveBeenCalled();
    });
  });

  // ── buildCoverageSection ──

  describe('buildCoverageSection', () => {
    it('returns empty string for skipped report', () => {
      expect(buildCoverageSection({ skipped: true, success: true })).toBe('');
    });

    it('returns empty string for null report', () => {
      expect(buildCoverageSection(null)).toBe('');
    });

    it('includes coverage drop warning when belowThreshold', () => {
      const section = buildCoverageSection({
        success: true,
        skipped: false,
        coverage: 75,
        baselineCoverage: 80,
        delta: -5,
        belowThreshold: true,
      });

      expect(section).toContain('COVERAGE DROP DETECTED');
      expect(section).toContain('major');
      expect(section).toContain('75%');
      expect(section).toContain('80%');
    });

    it('includes improvement note when coverage goes up', () => {
      const section = buildCoverageSection({
        success: true,
        skipped: false,
        coverage: 85,
        baselineCoverage: 80,
        delta: 5,
        belowThreshold: false,
      });

      expect(section).toContain('COVERAGE IMPROVED');
      expect(section).toContain('positive');
    });

    it('shows first run message when no baseline', () => {
      const section = buildCoverageSection({
        success: true,
        skipped: false,
        coverage: 80,
        baselineCoverage: null,
        delta: null,
        belowThreshold: false,
      });

      expect(section).toContain('first coverage run');
      expect(section).toContain('80%');
    });

    it('shows stable message when delta is 0', () => {
      const section = buildCoverageSection({
        success: true,
        skipped: false,
        coverage: 80,
        baselineCoverage: 80,
        delta: 0,
        belowThreshold: false,
      });

      expect(section).toContain('COVERAGE STABLE');
    });
  });
});
