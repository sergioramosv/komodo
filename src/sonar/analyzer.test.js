import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../config.js', () => ({
  config: {
    enableSonar: true,
    sonarToken: 'tok-123',
    sonarHostUrl: 'http://localhost:9000',
    sonarProjectKey: 'my-project',
    rootDir: '/fake/root',
  },
  cliExists: vi.fn(() => true),
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
    SONAR_ANALYSIS_START: 'sonar:analysis:start',
    SONAR_ANALYSIS_COMPLETE: 'sonar:analysis:complete',
    SONAR_ANALYSIS_ERROR: 'sonar:analysis:error',
  },
}));

vi.mock('./scanner.js', () => ({
  checkSonarConfig: vi.fn(() => ({ ready: true })),
  runSonarScan: vi.fn(() => Promise.resolve({ success: true, skipped: false, output: 'ok' })),
}));

const { config } = await import('../config.js');
const { eventBus } = await import('../events/event-bus.js');
const { checkSonarConfig, runSonarScan } = await import('./scanner.js');
const { analyzeSonar } = await import('./analyzer.js');

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('analyzeSonar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkSonarConfig.mockReturnValue({ ready: true });
    runSonarScan.mockResolvedValue({ success: true, skipped: false, output: 'ok' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns empty report when SonarQube is not configured', async () => {
    checkSonarConfig.mockReturnValue({ ready: false, reason: 'ENABLE_SONAR no está habilitado' });

    const report = await analyzeSonar();

    expect(report.success).toBe(false);
    expect(report.skipped).toBe(true);
    expect(report.reason).toContain('ENABLE_SONAR');
    expect(report.qualityGate).toBeNull();
    expect(report.issues.total).toBe(0);
    expect(report.metrics.bugs).toBe(0);
  });

  it('does not emit start event when config is not ready', async () => {
    checkSonarConfig.mockReturnValue({ ready: false, reason: 'disabled' });

    await analyzeSonar();

    expect(eventBus.emitEvent).not.toHaveBeenCalledWith(
      'sonar:analysis:start',
      expect.anything(),
    );
  });

  it('emits start event when analysis begins', async () => {
    // Make fetch fail to avoid full flow
    mockFetch.mockRejectedValue(new Error('network error'));

    await analyzeSonar({ branch: 'feature/test' });

    expect(eventBus.emitEvent).toHaveBeenCalledWith(
      'sonar:analysis:start',
      expect.objectContaining({
        metadata: { branch: 'feature/test', projectKey: 'my-project' },
      }),
    );
  });

  it('returns empty report when sonar-scanner fails', async () => {
    runSonarScan.mockResolvedValue({ success: false, skipped: false, reason: 'scanner crashed' });

    const report = await analyzeSonar();

    expect(report.success).toBe(false);
    expect(report.skipped).toBe(true);
    expect(report.reason).toBe('scanner crashed');
    expect(eventBus.emitEvent).toHaveBeenCalledWith(
      'sonar:analysis:error',
      expect.objectContaining({
        metadata: expect.objectContaining({ reason: 'scanner crashed' }),
      }),
    );
  });

  it('completes full analysis with quality gate, issues and metrics', async () => {
    // Mock CE activity (no pending tasks — analysis done)
    mockFetch.mockImplementation((url) => {
      const urlStr = url.toString();

      if (urlStr.includes('/api/ce/activity')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ tasks: [] }),
        });
      }

      if (urlStr.includes('/api/qualitygates/project_status')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ projectStatus: { status: 'OK' } }),
        });
      }

      if (urlStr.includes('/api/issues/search')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            total: 5,
            facets: [{
              property: 'severities',
              values: [
                { val: 'BLOCKER', count: 0 },
                { val: 'CRITICAL', count: 1 },
                { val: 'MAJOR', count: 2 },
                { val: 'MINOR', count: 1 },
                { val: 'INFO', count: 1 },
              ],
            }],
          }),
        });
      }

      if (urlStr.includes('/api/measures/component')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            component: {
              measures: [
                { metric: 'bugs', value: '3' },
                { metric: 'vulnerabilities', value: '1' },
                { metric: 'code_smells', value: '12' },
                { metric: 'duplicated_lines_density', value: '2.5' },
                { metric: 'coverage', value: '78.3' },
              ],
            },
          }),
        });
      }

      return Promise.reject(new Error(`Unexpected URL: ${urlStr}`));
    });

    const report = await analyzeSonar({ branch: 'feature/test' });

    expect(report.success).toBe(true);
    expect(report.skipped).toBeFalsy();
    expect(report.qualityGate).toBe('OK');
    expect(report.issues).toEqual({
      BLOCKER: 0, CRITICAL: 1, MAJOR: 2, MINOR: 1, INFO: 1, total: 5,
    });
    expect(report.metrics).toEqual({
      bugs: 3, vulnerabilities: 1, code_smells: 12, duplicated_lines_density: 2.5, coverage: 78.3,
    });

    expect(eventBus.emitEvent).toHaveBeenCalledWith(
      'sonar:analysis:complete',
      expect.objectContaining({
        metadata: { report },
      }),
    );
  });

  it('emits error event when an exception occurs during analysis', async () => {
    mockFetch.mockRejectedValue(new Error('connection refused'));

    const report = await analyzeSonar();

    expect(report.success).toBe(false);
    expect(report.skipped).toBe(true);
    expect(report.reason).toBe('connection refused');
    expect(eventBus.emitEvent).toHaveBeenCalledWith(
      'sonar:analysis:error',
      expect.objectContaining({
        metadata: expect.objectContaining({ reason: 'connection refused' }),
      }),
    );
  });

  it('returns empty report structure with correct shape', async () => {
    checkSonarConfig.mockReturnValue({ ready: false, reason: 'disabled' });

    const report = await analyzeSonar();

    expect(report).toEqual({
      success: false,
      skipped: true,
      reason: 'disabled',
      qualityGate: null,
      issues: { BLOCKER: 0, CRITICAL: 0, MAJOR: 0, MINOR: 0, INFO: 0, total: 0 },
      metrics: { bugs: 0, vulnerabilities: 0, code_smells: 0, duplicated_lines_density: 0, coverage: 0 },
    });
  });
});
