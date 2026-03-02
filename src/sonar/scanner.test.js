import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config.js', () => ({
  config: {
    enableSonar: false,
    sonarToken: '',
    sonarHostUrl: '',
    sonarProjectKey: '',
    rootDir: '/fake/root',
  },
  cliExists: vi.fn(() => false),
}));

vi.mock('../utils/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), success: vi.fn() },
}));

const { config, cliExists } = await import('../config.js');
const { checkSonarConfig } = await import('./scanner.js');

describe('checkSonarConfig', () => {
  beforeEach(() => {
    config.enableSonar = true;
    config.sonarToken = 'tok-123';
    config.sonarHostUrl = 'http://localhost:9000';
    config.sonarProjectKey = 'my-project';
    cliExists.mockReturnValue(true);
  });

  it('returns ready:true when all config is present and CLI exists', () => {
    expect(checkSonarConfig()).toEqual({ ready: true });
  });

  it('returns not ready when ENABLE_SONAR is false', () => {
    config.enableSonar = false;
    const result = checkSonarConfig();
    expect(result.ready).toBe(false);
    expect(result.reason).toContain('ENABLE_SONAR');
  });

  it('returns not ready when SONAR_TOKEN is missing', () => {
    config.sonarToken = '';
    const result = checkSonarConfig();
    expect(result.ready).toBe(false);
    expect(result.reason).toContain('SONAR_TOKEN');
  });

  it('returns not ready when SONAR_HOST_URL is missing', () => {
    config.sonarHostUrl = '';
    const result = checkSonarConfig();
    expect(result.ready).toBe(false);
    expect(result.reason).toContain('SONAR_HOST_URL');
  });

  it('returns not ready when SONAR_PROJECT_KEY is missing', () => {
    config.sonarProjectKey = '';
    const result = checkSonarConfig();
    expect(result.ready).toBe(false);
    expect(result.reason).toContain('SONAR_PROJECT_KEY');
  });

  it('returns not ready when sonar-scanner CLI is not installed', () => {
    cliExists.mockReturnValue(false);
    const result = checkSonarConfig();
    expect(result.ready).toBe(false);
    expect(result.reason).toContain('sonar-scanner');
  });

  it('checks for sonar-scanner specifically via cliExists', () => {
    checkSonarConfig();
    expect(cliExists).toHaveBeenCalledWith('sonar-scanner');
  });
});
