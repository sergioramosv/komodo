import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks ──

const { mockCliExists, mockExecSync, mockExistsSync, mockConfig, mockLogger } = vi.hoisted(() => {
  return {
    mockCliExists: vi.fn(),
    mockExecSync: vi.fn(),
    mockExistsSync: vi.fn(),
    mockConfig: {
      cliPlanner: 'claude',
      cliCoder: 'claude',
      cliReviewer: 'codex',
      googleCredentials: '/path/to/creds.json',
      firebaseDatabaseUrl: 'https://db.firebaseio.com',
      defaultUserId: 'user123',
      githubToken: 'ghp_token',
      enableSonar: false,
      sonarToken: '',
      sonarHostUrl: '',
      sonarProjectKey: '',
      enableTelegram: false,
      telegramBotToken: '',
      telegramChatId: '',
    },
    mockLogger: {
      info: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      logStep: vi.fn(),
      taskHeader: vi.fn(),
    },
  };
});

vi.mock('../config.js', () => ({
  config: mockConfig,
  cliExists: mockCliExists,
}));

vi.mock('child_process', () => ({
  execSync: mockExecSync,
}));

vi.mock('fs', () => ({
  existsSync: mockExistsSync,
}));

vi.mock('../utils/logger.js', () => ({
  logger: mockLogger,
}));

const {
  STATUS,
  checkAgentClis,
  checkGitHubCli,
  checkRepoAccess,
  checkFirebase,
  checkGitHubToken,
  checkSonar,
  checkTelegram,
  runDiagnostics,
  printDiagnostics,
  doctor,
} = await import('./doctor.js');

// ── Tests ──

beforeEach(() => {
  vi.clearAllMocks();
  // Reset config to defaults
  Object.assign(mockConfig, {
    cliPlanner: 'claude',
    cliCoder: 'claude',
    cliReviewer: 'codex',
    googleCredentials: '/path/to/creds.json',
    firebaseDatabaseUrl: 'https://db.firebaseio.com',
    defaultUserId: 'user123',
    githubToken: 'ghp_token',
    enableSonar: false,
    sonarToken: '',
    sonarHostUrl: '',
    sonarProjectKey: '',
    enableTelegram: false,
    telegramBotToken: '',
    telegramChatId: '',
  });
});

describe('checkAgentClis', () => {
  it('returns OK for installed CLIs', () => {
    mockCliExists.mockReturnValue(true);
    const results = checkAgentClis();
    // claude + codex = 2 unique CLIs
    expect(results).toHaveLength(2);
    expect(results.every(r => r.status === STATUS.OK)).toBe(true);
  });

  it('returns FAIL for missing CLI', () => {
    mockCliExists.mockImplementation((cmd) => cmd === 'claude');
    const results = checkAgentClis();
    const codexResult = results.find(r => r.name.includes('codex'));
    expect(codexResult.status).toBe(STATUS.FAIL);
  });

  it('deduplicates CLIs used by multiple roles', () => {
    mockConfig.cliCoder = 'claude';
    mockConfig.cliPlanner = 'claude';
    mockConfig.cliReviewer = 'claude';
    mockCliExists.mockReturnValue(true);
    const results = checkAgentClis();
    expect(results).toHaveLength(1);
    expect(results[0].name).toContain('Planner');
    expect(results[0].name).toContain('Coder');
    expect(results[0].name).toContain('Reviewer');
  });
});

describe('checkGitHubCli', () => {
  it('returns OK when gh is installed and authenticated', () => {
    mockCliExists.mockReturnValue(true);
    mockExecSync.mockReturnValue('logged in');
    const results = checkGitHubCli();
    expect(results).toHaveLength(2);
    expect(results[0].status).toBe(STATUS.OK);
    expect(results[1].status).toBe(STATUS.OK);
  });

  it('returns FAIL when gh is not installed', () => {
    mockCliExists.mockReturnValue(false);
    const results = checkGitHubCli();
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe(STATUS.FAIL);
  });

  it('returns FAIL when gh is not authenticated', () => {
    mockCliExists.mockReturnValue(true);
    mockExecSync.mockImplementation(() => { throw new Error('not logged in'); });
    const results = checkGitHubCli();
    expect(results[1].status).toBe(STATUS.FAIL);
    expect(results[1].message).toContain('gh auth login');
  });
});

describe('checkRepoAccess', () => {
  it('returns OK when repo is accessible', () => {
    mockExecSync.mockReturnValue('{"name":"komodo"}');
    const result = checkRepoAccess();
    expect(result.status).toBe(STATUS.OK);
  });

  it('returns WARN when repo is not accessible', () => {
    mockExecSync.mockImplementation(() => { throw new Error('not a repo'); });
    const result = checkRepoAccess();
    expect(result.status).toBe(STATUS.WARN);
  });
});

describe('checkFirebase', () => {
  it('returns all OK when configured correctly', () => {
    mockExistsSync.mockReturnValue(true);
    const results = checkFirebase();
    expect(results).toHaveLength(3);
    expect(results.every(r => r.status === STATUS.OK)).toBe(true);
  });

  it('returns FAIL when credentials file is missing', () => {
    mockExistsSync.mockReturnValue(false);
    const results = checkFirebase();
    expect(results[0].status).toBe(STATUS.FAIL);
    expect(results[0].message).toContain('archivo no encontrado');
  });

  it('returns FAIL when GOOGLE_APPLICATION_CREDENTIALS is empty', () => {
    mockConfig.googleCredentials = '';
    const results = checkFirebase();
    expect(results[0].status).toBe(STATUS.FAIL);
  });

  it('returns FAIL when FIREBASE_DATABASE_URL is empty', () => {
    mockConfig.firebaseDatabaseUrl = '';
    mockExistsSync.mockReturnValue(true);
    const results = checkFirebase();
    expect(results[1].status).toBe(STATUS.FAIL);
  });

  it('returns FAIL when DEFAULT_USER_ID is empty', () => {
    mockConfig.defaultUserId = '';
    mockExistsSync.mockReturnValue(true);
    const results = checkFirebase();
    expect(results[2].status).toBe(STATUS.FAIL);
  });
});

describe('checkGitHubToken', () => {
  it('returns OK when token is set', () => {
    const result = checkGitHubToken();
    expect(result.status).toBe(STATUS.OK);
  });

  it('returns WARN when token is empty', () => {
    mockConfig.githubToken = '';
    const result = checkGitHubToken();
    expect(result.status).toBe(STATUS.WARN);
  });
});

describe('checkSonar', () => {
  it('returns WARN when SonarQube is disabled', () => {
    const results = checkSonar();
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe(STATUS.WARN);
  });

  it('returns FAIL for missing Sonar config when enabled', () => {
    mockConfig.enableSonar = true;
    const results = checkSonar();
    expect(results).toHaveLength(3);
    expect(results.every(r => r.status === STATUS.FAIL)).toBe(true);
  });

  it('returns OK for complete Sonar config when enabled', () => {
    mockConfig.enableSonar = true;
    mockConfig.sonarToken = 'squ_token';
    mockConfig.sonarHostUrl = 'https://sonar.example.com';
    mockConfig.sonarProjectKey = 'my-project';
    const results = checkSonar();
    expect(results.every(r => r.status === STATUS.OK)).toBe(true);
  });
});

describe('checkTelegram', () => {
  it('returns WARN when Telegram is disabled', () => {
    const results = checkTelegram();
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe(STATUS.WARN);
  });

  it('returns FAIL for missing Telegram config when enabled', () => {
    mockConfig.enableTelegram = true;
    const results = checkTelegram();
    expect(results).toHaveLength(2);
    expect(results.every(r => r.status === STATUS.FAIL)).toBe(true);
  });

  it('returns OK for complete Telegram config when enabled', () => {
    mockConfig.enableTelegram = true;
    mockConfig.telegramBotToken = 'bot123:token';
    mockConfig.telegramChatId = '-100123456';
    const results = checkTelegram();
    expect(results.every(r => r.status === STATUS.OK)).toBe(true);
  });
});

describe('runDiagnostics', () => {
  it('aggregates all checks and detects fails', () => {
    mockCliExists.mockReturnValue(true);
    mockExecSync.mockReturnValue('ok');
    mockExistsSync.mockReturnValue(true);
    mockConfig.googleCredentials = '';

    const { results, hasFails, hasWarns } = runDiagnostics();
    expect(results.length).toBeGreaterThan(0);
    expect(hasFails).toBe(true);
  });

  it('reports no fails when everything is configured', () => {
    mockCliExists.mockReturnValue(true);
    mockExecSync.mockReturnValue('ok');
    mockExistsSync.mockReturnValue(true);

    const { hasFails } = runDiagnostics();
    expect(hasFails).toBe(false);
  });
});

describe('printDiagnostics', () => {
  it('prints results using logger', () => {
    const diagnostics = {
      results: [
        { name: 'Test OK', status: STATUS.OK, message: 'ok' },
        { name: 'Test WARN', status: STATUS.WARN, message: 'warn' },
        { name: 'Test FAIL', status: STATUS.FAIL, message: 'fail' },
      ],
      hasFails: true,
      hasWarns: true,
    };

    printDiagnostics(diagnostics);
    expect(mockLogger.taskHeader).toHaveBeenCalledWith('Komodo Self-Diagnostic');
    expect(mockLogger.success).toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalled();
    expect(mockLogger.error).toHaveBeenCalled();
  });
});

describe('doctor', () => {
  it('returns true when no FAILs', () => {
    mockCliExists.mockReturnValue(true);
    mockExecSync.mockReturnValue('ok');
    mockExistsSync.mockReturnValue(true);

    const canStart = doctor();
    expect(canStart).toBe(true);
  });

  it('returns false when there are FAILs', () => {
    mockCliExists.mockReturnValue(false);
    mockExecSync.mockImplementation(() => { throw new Error(); });
    mockExistsSync.mockReturnValue(false);
    mockConfig.googleCredentials = '';
    mockConfig.firebaseDatabaseUrl = '';
    mockConfig.defaultUserId = '';

    const canStart = doctor();
    expect(canStart).toBe(false);
  });
});
