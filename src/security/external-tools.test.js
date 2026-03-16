import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock('../utils/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), success: vi.fn() },
}));

// Mock child_process execFile and util promisify together
vi.mock('child_process', () => ({
  execFile: vi.fn(),
}));

// We intercept execFileAsync by mocking 'util' promisify to return a controlled fn
const mockExecFileAsync = vi.fn();

vi.mock('util', () => ({
  promisify: vi.fn(() => mockExecFileAsync),
}));

// fs module used inside runGitleaks for reading the report file
vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return { ...actual, readFileSync: vi.fn() };
});

const { readFileSync } = await import('fs');
const { runNpmAudit, runGitleaks, runSemgrep, runAllExternalTools } = await import('./external-tools.js');

// ── helpers ────────────────────────────────────────────────────────────────────

function makeNpmAuditOutput(vulnerabilities = {}) {
  return JSON.stringify({ vulnerabilities });
}

function makeSemgrepOutput(results = []) {
  return JSON.stringify({ results });
}

// ── isCommandAvailable (via tool availability) ─────────────────────────────────

describe('isCommandAvailable — async (via runNpmAudit availability check)', () => {
  beforeEach(() => {
    mockExecFileAsync.mockReset();
  });

  it('returns available:true when command resolves', async () => {
    // First call: isCommandAvailable('npm') → resolves
    // Second call: npm audit → resolves with empty audit
    mockExecFileAsync
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
      .mockResolvedValueOnce({ stdout: makeNpmAuditOutput(), stderr: '' });

    const result = await runNpmAudit({ cwd: '/fake' });

    expect(result.available).toBe(true);
  });

  it('returns available:false when command rejects (not installed)', async () => {
    mockExecFileAsync.mockRejectedValueOnce(new Error('command not found'));

    const result = await runNpmAudit({ cwd: '/fake' });

    expect(result.available).toBe(false);
    expect(result.findings).toHaveLength(0);
  });

  it('does not block: isCommandAvailable is async (no execSync)', async () => {
    // The function must return a Promise — ensure it's truly async
    mockExecFileAsync.mockRejectedValueOnce(new Error('not found'));

    const promise = runNpmAudit({ cwd: '/fake' });

    expect(promise).toBeInstanceOf(Promise);
    await promise;
  });
});

// ── runNpmAudit ────────────────────────────────────────────────────────────────

describe('runNpmAudit', () => {
  beforeEach(() => {
    mockExecFileAsync.mockReset();
  });

  it('returns available:false and empty findings when npm is not installed', async () => {
    mockExecFileAsync.mockRejectedValueOnce(new Error('npm: command not found'));

    const result = await runNpmAudit();

    expect(result).toEqual({ tool: 'npm-audit', available: false, findings: [] });
  });

  it('returns findings with correct severity mapping', async () => {
    const vulnerabilities = {
      lodash: {
        severity: 'high',
        via: [{ title: 'Prototype Pollution', url: 'https://nvd.nist.gov/vuln/detail/CVE-2021-23337' }],
        fixAvailable: true,
      },
      chalk: {
        severity: 'moderate',
        via: [],
        fixAvailable: false,
      },
    };

    // isCommandAvailable resolves → npm is available
    mockExecFileAsync
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
      .mockResolvedValueOnce({ stdout: makeNpmAuditOutput(vulnerabilities), stderr: '' });

    const result = await runNpmAudit({ cwd: '/project' });

    expect(result.available).toBe(true);
    expect(result.tool).toBe('npm-audit');
    expect(result.findings).toHaveLength(2);

    const lodashFinding = result.findings.find(f => f.package === 'lodash');
    expect(lodashFinding.severity).toBe('HIGH');
    expect(lodashFinding.fixAvailable).toBe(true);
    expect(lodashFinding.description).toContain('Prototype Pollution');

    const chalkFinding = result.findings.find(f => f.package === 'chalk');
    expect(chalkFinding.severity).toBe('MEDIUM');
    expect(chalkFinding.fixAvailable).toBe(false);
  });

  it('parses stdout when npm audit exits with non-zero (vulnerabilities found)', async () => {
    const vulnerabilities = {
      express: { severity: 'critical', via: [], fixAvailable: false },
    };
    const err = new Error('npm audit found vulnerabilities');
    err.stdout = makeNpmAuditOutput(vulnerabilities);

    mockExecFileAsync
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
      .mockRejectedValueOnce(err);

    const result = await runNpmAudit({ cwd: '/project' });

    expect(result.available).toBe(true);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].severity).toBe('CRITICAL');
    expect(result.findings[0].package).toBe('express');
  });

  it('returns error when npm audit fails without parseable output', async () => {
    const err = new Error('network error');
    // no err.stdout

    mockExecFileAsync
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
      .mockRejectedValueOnce(err);

    const result = await runNpmAudit({ cwd: '/project' });

    expect(result.available).toBe(true);
    expect(result.findings).toHaveLength(0);
    expect(result.error).toBe('network error');
  });

  it('maps severity variants correctly', async () => {
    const vulnerabilities = {
      a: { severity: 'critical', via: [], fixAvailable: false },
      b: { severity: 'low', via: [], fixAvailable: false },
      c: { severity: 'info', via: [], fixAvailable: false },
      d: { severity: 'unknown', via: [], fixAvailable: false },
    };

    mockExecFileAsync
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
      .mockResolvedValueOnce({ stdout: makeNpmAuditOutput(vulnerabilities), stderr: '' });

    const result = await runNpmAudit();

    const bySeverity = Object.fromEntries(result.findings.map(f => [f.package, f.severity]));
    expect(bySeverity.a).toBe('CRITICAL');
    expect(bySeverity.b).toBe('LOW');
    expect(bySeverity.c).toBe('INFO');
    expect(bySeverity.d).toBe('LOW'); // default
  });

  it('returns empty findings when there are no vulnerabilities', async () => {
    mockExecFileAsync
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
      .mockResolvedValueOnce({ stdout: makeNpmAuditOutput({}), stderr: '' });

    const result = await runNpmAudit();

    expect(result.findings).toHaveLength(0);
    expect(result.available).toBe(true);
  });
});

// ── runGitleaks ────────────────────────────────────────────────────────────────

describe('runGitleaks', () => {
  beforeEach(() => {
    mockExecFileAsync.mockReset();
    readFileSync.mockReset();
  });

  it('returns available:false when gitleaks is not installed', async () => {
    mockExecFileAsync.mockRejectedValueOnce(new Error('gitleaks: not found'));

    const result = await runGitleaks();

    expect(result).toEqual({ tool: 'gitleaks', available: false, findings: [] });
  });

  it('returns empty findings when no leaks are detected (no report file)', async () => {
    mockExecFileAsync
      .mockResolvedValueOnce({ stdout: '', stderr: '' }) // isCommandAvailable
      .mockResolvedValueOnce({}); // gitleaks detect

    readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });

    const result = await runGitleaks({ cwd: '/project' });

    expect(result.available).toBe(true);
    expect(result.findings).toHaveLength(0);
  });

  it('parses gitleaks report and maps findings', async () => {
    const report = [
      {
        Description: 'AWS Access Key',
        RuleID: 'aws-access-key',
        File: 'src/config.js',
        StartLine: 10,
        Severity: 'high',
        Match: 'AKIAIOSFODNN7EXAMPLE',
      },
    ];

    mockExecFileAsync
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
      .mockResolvedValueOnce({});

    readFileSync.mockReturnValue(JSON.stringify(report));

    const result = await runGitleaks({ cwd: '/project' });

    expect(result.available).toBe(true);
    expect(result.findings).toHaveLength(1);

    const finding = result.findings[0];
    expect(finding.severity).toBe('HIGH');
    expect(finding.file).toBe('src/config.js');
    expect(finding.line).toBe(10);
    expect(finding.ruleId).toBe('aws-access-key');
    expect(finding.tool).toBe('gitleaks');
    // match should be redacted
    expect(finding.match).not.toContain('AKIAIOSFODNN7EXAMPLE');
  });

  it('maps gitleaks severity variants correctly', async () => {
    const report = [
      { Severity: 'critical', File: 'a.js', StartLine: 1, Match: 'x' },
      { Severity: 'warning', File: 'b.js', StartLine: 2, Match: 'y' },
      { Severity: 'error', File: 'c.js', StartLine: 3, Match: 'z' },
      { Severity: 'info', File: 'd.js', StartLine: 4, Match: 'w' },
      { Severity: 'unknown', File: 'e.js', StartLine: 5, Match: 'v' },
    ];

    mockExecFileAsync
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
      .mockResolvedValueOnce({});

    readFileSync.mockReturnValue(JSON.stringify(report));

    const result = await runGitleaks();

    const severities = result.findings.map(f => f.severity);
    expect(severities[0]).toBe('CRITICAL');
    expect(severities[1]).toBe('MEDIUM');  // warning → MEDIUM
    expect(severities[2]).toBe('HIGH');    // error → HIGH
    expect(severities[3]).toBe('INFO');
    expect(severities[4]).toBe('HIGH');    // default
  });

  it('returns error when gitleaks fails unexpectedly', async () => {
    mockExecFileAsync
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
      .mockRejectedValueOnce(new Error('gitleaks crashed'));

    const result = await runGitleaks({ cwd: '/project' });

    expect(result.available).toBe(true);
    expect(result.findings).toHaveLength(0);
    expect(result.error).toBe('gitleaks crashed');
  });
});

// ── runSemgrep ─────────────────────────────────────────────────────────────────

describe('runSemgrep', () => {
  beforeEach(() => {
    mockExecFileAsync.mockReset();
  });

  it('returns available:false when semgrep is not installed', async () => {
    mockExecFileAsync.mockRejectedValueOnce(new Error('semgrep: not found'));

    const result = await runSemgrep();

    expect(result).toEqual({ tool: 'semgrep', available: false, findings: [] });
  });

  it('returns findings when semgrep runs successfully', async () => {
    const results = [
      {
        check_id: 'owasp.sqli',
        path: 'src/db.js',
        start: { line: 42 },
        extra: {
          severity: 'ERROR',
          message: 'Potential SQL injection',
          metadata: { 'owasp-category': 'A03:2021 - Injection' },
        },
      },
    ];

    mockExecFileAsync
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
      .mockResolvedValueOnce({ stdout: makeSemgrepOutput(results), stderr: '' });

    const result = await runSemgrep({ cwd: '/project' });

    expect(result.available).toBe(true);
    expect(result.findings).toHaveLength(1);

    const finding = result.findings[0];
    expect(finding.severity).toBe('HIGH');  // ERROR → HIGH
    expect(finding.file).toBe('src/db.js');
    expect(finding.line).toBe(42);
    expect(finding.ruleId).toBe('owasp.sqli');
    expect(finding.category).toBe('A03:2021 - Injection');
    expect(finding.description).toContain('Potential SQL injection');
    expect(finding.tool).toBe('semgrep');
  });

  it('parses stdout when semgrep exits non-zero (findings present)', async () => {
    const results = [
      {
        check_id: 'owasp.xss',
        path: 'src/render.js',
        start: { line: 7 },
        extra: { severity: 'WARNING', message: 'XSS risk', metadata: {} },
      },
    ];
    const err = new Error('semgrep exited with code 1');
    err.stdout = makeSemgrepOutput(results);

    mockExecFileAsync
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
      .mockRejectedValueOnce(err);

    const result = await runSemgrep({ cwd: '/project' });

    expect(result.available).toBe(true);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].severity).toBe('MEDIUM'); // WARNING → MEDIUM
  });

  it('returns error when semgrep fails without parseable output', async () => {
    const err = new Error('semgrep internal error');

    mockExecFileAsync
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
      .mockRejectedValueOnce(err);

    const result = await runSemgrep({ cwd: '/project' });

    expect(result.available).toBe(true);
    expect(result.findings).toHaveLength(0);
    expect(result.error).toBe('semgrep internal error');
  });

  it('maps semgrep severity variants correctly', async () => {
    const results = [
      { check_id: 'r1', path: 'a.js', start: { line: 1 }, extra: { severity: 'ERROR', message: '', metadata: {} } },
      { check_id: 'r2', path: 'b.js', start: { line: 1 }, extra: { severity: 'WARNING', message: '', metadata: {} } },
      { check_id: 'r3', path: 'c.js', start: { line: 1 }, extra: { severity: 'INFO', message: '', metadata: {} } },
      { check_id: 'r4', path: 'd.js', start: { line: 1 }, extra: { severity: 'UNKNOWN', message: '', metadata: {} } },
    ];

    mockExecFileAsync
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
      .mockResolvedValueOnce({ stdout: makeSemgrepOutput(results), stderr: '' });

    const result = await runSemgrep();

    const severities = result.findings.map(f => f.severity);
    expect(severities[0]).toBe('HIGH');
    expect(severities[1]).toBe('MEDIUM');
    expect(severities[2]).toBe('LOW');
    expect(severities[3]).toBe('MEDIUM'); // default
  });

  it('returns empty findings when no results', async () => {
    mockExecFileAsync
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
      .mockResolvedValueOnce({ stdout: makeSemgrepOutput([]), stderr: '' });

    const result = await runSemgrep();

    expect(result.findings).toHaveLength(0);
    expect(result.available).toBe(true);
  });
});

// ── runAllExternalTools ────────────────────────────────────────────────────────

describe('runAllExternalTools', () => {
  beforeEach(() => {
    mockExecFileAsync.mockReset();
    readFileSync.mockReset();
  });

  it('consolidates findings from all three tools', async () => {
    // Promise.all runs all three isCommandAvailable checks concurrently first,
    // then all three tool-runner calls. Order: npm-ver, gitleaks-ver, semgrep-ver,
    // npm-audit, gitleaks-detect, semgrep-scan.
    mockExecFileAsync
      .mockResolvedValueOnce({ stdout: '', stderr: '' }) // npm isCommandAvailable
      .mockResolvedValueOnce({ stdout: '', stderr: '' }) // gitleaks isCommandAvailable
      .mockResolvedValueOnce({ stdout: '', stderr: '' }) // semgrep isCommandAvailable
      .mockResolvedValueOnce({
        stdout: makeNpmAuditOutput({ lodash: { severity: 'high', via: [], fixAvailable: false } }),
        stderr: '',
      }) // npm audit → 1 finding
      .mockResolvedValueOnce({}) // gitleaks detect → report read from readFileSync
      .mockResolvedValueOnce({
        stdout: makeSemgrepOutput([{
          check_id: 'r1', path: 'x.js', start: { line: 1 },
          extra: { severity: 'ERROR', message: 'issue', metadata: {} },
        }]),
        stderr: '',
      }); // semgrep → 1 finding

    readFileSync.mockReturnValue(JSON.stringify([{
      Severity: 'high', File: 'secret.js', StartLine: 5, Match: 'abc', RuleID: 'aws-key',
    }]));

    const result = await runAllExternalTools({ cwd: '/project' });

    expect(result.findings).toHaveLength(3);
    expect(result.toolResults.npmAudit.available).toBe(true);
    expect(result.toolResults.gitleaks.available).toBe(true);
    expect(result.toolResults.semgrep.available).toBe(true);
  });

  it('returns empty findings when no tools are available', async () => {
    mockExecFileAsync
      .mockRejectedValueOnce(new Error('npm not found'))
      .mockRejectedValueOnce(new Error('gitleaks not found'))
      .mockRejectedValueOnce(new Error('semgrep not found'));

    const result = await runAllExternalTools({ cwd: '/project' });

    expect(result.findings).toHaveLength(0);
    expect(result.toolResults.npmAudit.available).toBe(false);
    expect(result.toolResults.gitleaks.available).toBe(false);
    expect(result.toolResults.semgrep.available).toBe(false);
  });

  it('runs all three tools concurrently (Promise.all)', async () => {
    // All tools unavailable — minimal mock setup to verify they all run
    mockExecFileAsync
      .mockRejectedValue(new Error('not found'));

    const result = await runAllExternalTools();

    expect(result).toHaveProperty('findings');
    expect(result).toHaveProperty('toolResults');
    expect(result.toolResults).toHaveProperty('npmAudit');
    expect(result.toolResults).toHaveProperty('gitleaks');
    expect(result.toolResults).toHaveProperty('semgrep');
  });

  it('partial availability: only npm available yields correct toolResults', async () => {
    // Concurrent order: all three isCommandAvailable first, then tool runs
    mockExecFileAsync
      .mockResolvedValueOnce({ stdout: '', stderr: '' })      // npm isCommandAvailable → available
      .mockRejectedValueOnce(new Error('gitleaks not found')) // gitleaks isCommandAvailable → unavailable
      .mockRejectedValueOnce(new Error('semgrep not found'))  // semgrep isCommandAvailable → unavailable
      .mockResolvedValueOnce({ stdout: makeNpmAuditOutput({}), stderr: '' }); // npm audit

    const result = await runAllExternalTools({ cwd: '/project' });

    expect(result.toolResults.npmAudit.available).toBe(true);
    expect(result.toolResults.gitleaks.available).toBe(false);
    expect(result.toolResults.semgrep.available).toBe(false);
    expect(result.findings).toHaveLength(0);
  });
});
