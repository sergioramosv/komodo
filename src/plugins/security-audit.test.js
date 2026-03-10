/**
 * E2E integration tests for the security-audit plugin.
 *
 * Tests cover:
 * 1. The plugin itself (pattern detection, file scanning)
 * 2. Full integration: load → execute → issues injected into review (via PluginLoader)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { PluginLoader } from './plugin-loader.js';
import { buildPluginIssuesSection } from '../agents/reviewer.js';
import securityAuditPlugin from '../../plugins/security-audit/index.js';

// ── Helper ─────────────────────────────────────────────────────────────────────

function makeTmpDir() {
  const dir = join(tmpdir(), `komodo-sec-audit-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ── Unit: security-audit plugin ────────────────────────────────────────────────

describe('security-audit plugin — metadata', () => {
  it('tiene name, role, position y execute correctos', () => {
    expect(securityAuditPlugin.name).toBe('security-audit');
    expect(typeof securityAuditPlugin.role).toBe('string');
    expect(securityAuditPlugin.role.length).toBeGreaterThan(0);
    expect(securityAuditPlugin.position).toBe('before-review');
    expect(typeof securityAuditPlugin.execute).toBe('function');
  });
});

describe('security-audit plugin — detección de patrones', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  async function runPlugin(files) {
    return securityAuditPlugin.execute({
      task: { id: 't1', title: 'Test task' },
      repoPath: tmpDir,
      changedFiles: files,
    });
  }

  it('retorna success:true y sin issues en archivo limpio', async () => {
    writeFileSync(join(tmpDir, 'clean.js'), `
      const greeting = 'hello world';
      function add(a, b) { return a + b; }
      export { add };
    `);

    const result = await runPlugin(['clean.js']);

    expect(result.success).toBe(true);
    expect(result.issues).toHaveLength(0);
    expect(result.data.scannedFiles).toContain('clean.js');
  });

  it('detecta contraseña hardcoded', async () => {
    writeFileSync(join(tmpDir, 'config.js'), `
      const dbConfig = {
        password: 'supersecret123',
        host: 'localhost',
      };
    `);

    const result = await runPlugin(['config.js']);

    expect(result.success).toBe(true);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues.some(i => /hardcoded secret/i.test(i))).toBe(true);
    expect(result.issues.some(i => i.includes('config.js'))).toBe(true);
  });

  it('detecta token hardcoded', async () => {
    writeFileSync(join(tmpDir, 'auth.js'), `
      const apiKey = 'sk-1234567890abcdef';
    `);

    const result = await runPlugin(['auth.js']);

    expect(result.issues.some(i => /hardcoded secret/i.test(i))).toBe(true);
  });

  it('detecta eval()', async () => {
    writeFileSync(join(tmpDir, 'dynamic.js'), `
      function runCode(input) {
        return eval(input);
      }
    `);

    const result = await runPlugin(['dynamic.js']);

    expect(result.issues.some(i => /eval\(\)/i.test(i))).toBe(true);
    expect(result.issues.some(i => i.includes('dynamic.js'))).toBe(true);
  });

  it('detecta exec() dinámico con interpolación', async () => {
    writeFileSync(join(tmpDir, 'runner.js'), `
      import { exec } from 'child_process';
      const cmd = userInput;
      exec(\`ls \${cmd}\`, (err, out) => console.log(out));
    `);

    const result = await runPlugin(['runner.js']);

    expect(result.issues.some(i => /exec\(\)/i.test(i))).toBe(true);
  });

  it('detecta TODO con referencia a password', async () => {
    writeFileSync(join(tmpDir, 'setup.js'), `
      // TODO: replace hardcoded password before deploy
      const pass = 'temporary';
    `);

    const result = await runPlugin(['setup.js']);

    expect(result.issues.some(i => /TODO/i.test(i))).toBe(true);
  });

  it('omite archivos no-escaneables (imágenes, binarios)', async () => {
    writeFileSync(join(tmpDir, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const result = await runPlugin(['logo.png']);

    expect(result.issues).toHaveLength(0);
    expect(result.data.scannedFiles).not.toContain('logo.png');
  });

  it('omite archivos que no existen en repoPath', async () => {
    const result = await runPlugin(['nonexistent-file.js']);

    expect(result.success).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('escanea múltiples archivos y acumula issues', async () => {
    writeFileSync(join(tmpDir, 'a.js'), `const secret = 'abc123def456';`);
    writeFileSync(join(tmpDir, 'b.js'), `const apiKey = 'zyx987654321';`);
    writeFileSync(join(tmpDir, 'c.js'), `const ok = 42;`);

    const result = await runPlugin(['a.js', 'b.js', 'c.js']);

    expect(result.issues.length).toBeGreaterThanOrEqual(2);
    expect(result.data.scannedFiles).toHaveLength(3);
  });

  it('incluye patternsChecked en data', async () => {
    const result = await runPlugin([]);

    expect(Array.isArray(result.data.patternsChecked)).toBe(true);
    expect(result.data.patternsChecked).toContain('hardcoded-secret');
    expect(result.data.patternsChecked).toContain('eval-usage');
    expect(result.data.patternsChecked).toContain('exec-usage');
    expect(result.data.patternsChecked).toContain('todo-password');
  });

  it('agrega sugerencia si no hay archivos escaneables', async () => {
    const result = await runPlugin([]);

    expect(result.suggestions.length).toBeGreaterThan(0);
  });

  it('detecta secretos en archivos YAML', async () => {
    writeFileSync(join(tmpDir, 'config.yml'), `
database:
  password: "super_secret_db_pass"
  host: localhost
`);

    const result = await runPlugin(['config.yml']);

    expect(result.success).toBe(true);
    expect(result.issues.some(i => /hardcoded secret/i.test(i))).toBe(true);
    expect(result.data.scannedFiles).toContain('config.yml');
  });

  it('detecta patrones inseguros en archivos Python', async () => {
    writeFileSync(join(tmpDir, 'app.py'), `
import os
api_key = "sk-live-1234567890abcdef"
user_input = input()
result = eval(user_input)
`);

    const result = await runPlugin(['app.py']);

    expect(result.success).toBe(true);
    expect(result.issues.some(i => /hardcoded secret/i.test(i))).toBe(true);
    expect(result.issues.some(i => /eval\(\)/i.test(i))).toBe(true);
    expect(result.data.scannedFiles).toContain('app.py');
  });

  it('detecta múltiples tipos de issues en un solo archivo', async () => {
    writeFileSync(join(tmpDir, 'dangerous.js'), `
      const token = 'ghp_abc123def456ghi789';
      const result = eval(userInput);
      // TODO: remove hardcoded password before release
    `);

    const result = await runPlugin(['dangerous.js']);

    expect(result.success).toBe(true);
    // Should detect all three: hardcoded secret, eval, and TODO password
    expect(result.issues.some(i => /hardcoded secret/i.test(i))).toBe(true);
    expect(result.issues.some(i => /eval\(\)/i.test(i))).toBe(true);
    expect(result.issues.some(i => /TODO/i.test(i))).toBe(true);
    expect(result.issues.length).toBeGreaterThanOrEqual(3);
  });
});

// ── E2E: integración PluginLoader → security-audit → issues en review ──────────

describe('E2E: carga → ejecución → resultado inyectado en review', () => {
  let tmpDir;
  let loader;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    loader = new PluginLoader();
    // Inject plugin directly (bypasses file I/O; tests the execution pipeline)
    loader._plugins = [securityAuditPlugin];
    loader._loaded = true;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('executePlugins retorna PluginResult con las issues detectadas', async () => {
    writeFileSync(join(tmpDir, 'server.js'), `
      const password = 'hardcoded_pass_123';
      eval(userInput);
    `);

    const results = await loader.executePlugins('before-review', {
      task: { id: 'task-1', title: 'Add server' },
      repoPath: tmpDir,
      changedFiles: ['server.js'],
    });

    expect(results).toHaveLength(1);
    const [result] = results;
    expect(result.success).toBe(true);
    // Both hardcoded secret and eval detected
    expect(result.issues.length).toBeGreaterThanOrEqual(2);
    expect(result.issues.some(i => /hardcoded secret/i.test(i))).toBe(true);
    expect(result.issues.some(i => /eval/i.test(i))).toBe(true);
  });

  it('las issues del plugin se aplanan correctamente para el reviewer', async () => {
    writeFileSync(join(tmpDir, 'db.js'), `const token = 'my-super-secret-token-xyz';`);

    const pluginResults = await loader.executePlugins('before-review', {
      task: { id: 'task-2', title: 'DB setup' },
      repoPath: tmpDir,
      changedFiles: ['db.js'],
    });

    // Simulate what task-runner.js does: flatMap issues for the reviewer
    const pluginIssues = pluginResults.flatMap(r => r.issues || []);

    expect(pluginIssues.length).toBeGreaterThan(0);
    expect(pluginIssues.every(i => typeof i === 'string')).toBe(true);
    expect(pluginIssues.some(i => i.includes('db.js'))).toBe(true);
  });

  it('no bloquea el pipeline si el plugin falla internamente', async () => {
    const brokenPlugin = {
      name: 'broken-mock',
      role: 'Always throws',
      position: 'before-review',
      execute: vi.fn().mockRejectedValue(new Error('plugin crashed')),
    };

    loader._plugins = [brokenPlugin, securityAuditPlugin];

    const results = await loader.executePlugins('before-review', {
      task: { id: 'task-3', title: 'Test' },
      repoPath: tmpDir,
      changedFiles: [],
    });

    expect(results).toHaveLength(2);
    expect(results[0].success).toBe(false);
    expect(results[0].issues[0]).toMatch(/plugin crashed/);
    // security-audit still ran
    expect(results[1].success).toBe(true);
  });

  it('pasa previousPluginOutputs del plugin anterior al security-audit', async () => {
    const executeSpy = vi.spyOn(securityAuditPlugin, 'execute');

    const firstPlugin = {
      name: 'first-mock',
      role: 'Mock first plugin',
      position: 'before-review',
      execute: vi.fn().mockResolvedValue({
        success: true,
        issues: ['mock-issue-from-first'],
        suggestions: [],
        data: { source: 'first' },
      }),
    };

    loader._plugins = [firstPlugin, securityAuditPlugin];

    await loader.executePlugins('before-review', {
      task: { id: 'task-4', title: 'Chain test' },
      repoPath: tmpDir,
      changedFiles: [],
    });

    expect(executeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        previousPluginOutputs: expect.arrayContaining([
          expect.objectContaining({ issues: ['mock-issue-from-first'] }),
        ]),
      }),
    );

    executeSpy.mockRestore();
  });

  it('no ejecuta el plugin en posiciones distintas (after-review)', async () => {
    const results = await loader.executePlugins('after-review', {
      task: { id: 'task-5', title: 'After review test' },
      repoPath: tmpDir,
      changedFiles: [],
    });

    // security-audit is before-review only, so after-review returns empty
    expect(results).toHaveLength(0);
  });
});

// ── E2E: carga desde disco vía PluginLoader._loadPlugin ───────────────────────

describe('E2E: carga del plugin desde el sistema de archivos', () => {
  let loader;
  let pluginsDir;

  beforeEach(() => {
    pluginsDir = makeTmpDir();
    loader = new PluginLoader();
  });

  afterEach(() => {
    rmSync(pluginsDir, { recursive: true, force: true });
  });

  it('carga un plugin mock válido desde disco y lo ejecuta', async () => {
    const pluginDir = join(pluginsDir, 'mock-scanner');
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(join(pluginDir, 'index.js'), `
      export default {
        name: 'mock-scanner',
        role: 'Mock security scanner for E2E test',
        position: 'before-review',
        execute: async (ctx) => ({
          success: true,
          issues: ctx.changedFiles?.length ? ['mock-issue-detected'] : [],
          suggestions: [],
          data: { filesScanned: ctx.changedFiles?.length ?? 0 },
        }),
      };
    `);

    await loader._loadPlugin(pluginsDir, 'mock-scanner');

    expect(loader._plugins).toHaveLength(1);
    expect(loader._plugins[0].name).toBe('mock-scanner');

    const results = await loader.executePlugins('before-review', {
      task: { id: 't-e2e', title: 'E2E' },
      changedFiles: ['src/foo.js', 'src/bar.js'],
    });

    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(true);
    expect(results[0].issues).toContain('mock-issue-detected');
    expect(results[0].data.filesScanned).toBe(2);
  });

  it('el flujo completo: carga → ejecución → issues planos para reviewer', async () => {
    const pluginDir = join(pluginsDir, 'inline-audit');
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(join(pluginDir, 'index.js'), `
      export default {
        name: 'inline-audit',
        role: 'Inline audit plugin',
        position: 'before-review',
        execute: async () => ({
          success: true,
          issues: ['CRITICAL: eval() found in utils.js', 'WARNING: TODO password in config.js'],
          suggestions: ['Replace eval with JSON.parse where applicable'],
          data: {},
        }),
      };
    `);

    await loader._loadPlugin(pluginsDir, 'inline-audit');
    const pluginResults = await loader.executePlugins('before-review', {
      task: { id: 't-flow', title: 'Full flow test' },
    });

    // Replicate task-runner.js behaviour
    const pluginIssues = pluginResults.flatMap(r => r.issues || []);

    expect(pluginIssues).toHaveLength(2);
    expect(pluginIssues[0]).toMatch(/eval/);
    expect(pluginIssues[1]).toMatch(/TODO password/);
  });
});

// ── E2E: flujo completo con mock plugin → buildPluginIssuesSection ────────────

describe('E2E: mock plugin → carga → ejecución → inyección en reviewer prompt', () => {
  let tmpDir;
  let loader;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    loader = new PluginLoader();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('issues del mock plugin se formatean en markdown para el reviewer', async () => {
    const mockPlugin = {
      name: 'mock-audit',
      role: 'Mock audit plugin for E2E',
      position: 'before-review',
      execute: vi.fn().mockResolvedValue({
        success: true,
        issues: ['Hardcoded secret in db.js', 'eval() usage in utils.js'],
        suggestions: ['Use environment variables'],
        data: {},
      }),
    };

    loader._plugins = [mockPlugin];
    loader._loaded = true;

    // Step 1: Execute plugins (like task-runner does)
    const pluginResults = await loader.executePlugins('before-review', {
      task: { id: 'task-e2e', title: 'E2E flow' },
      changedFiles: ['db.js', 'utils.js'],
    });

    // Step 2: Flatten issues (like task-runner does)
    const pluginIssues = pluginResults.flatMap(r => r.issues || []);

    // Step 3: Build reviewer prompt section (like reviewer.js does)
    const section = buildPluginIssuesSection(pluginIssues);

    // Verify: issues appear as mandatory items in the reviewer prompt
    expect(section).toContain('Plugin Analysis Issues (MANDATORY');
    expect(section).toContain('- Hardcoded secret in db.js');
    expect(section).toContain('- eval() usage in utils.js');
    expect(section).toContain('MUST include these issues');
    expect(section).toContain('REQUEST_CHANGES');
  });

  it('buildPluginIssuesSection retorna cadena vacía si no hay issues', () => {
    expect(buildPluginIssuesSection([])).toBe('');
    expect(buildPluginIssuesSection(null)).toBe('');
    expect(buildPluginIssuesSection(undefined)).toBe('');
  });

  it('flujo completo: security-audit real → flatMap → buildPluginIssuesSection', async () => {
    // Create files with real security issues
    writeFileSync(join(tmpDir, 'app.js'), `
      const password = 'admin1234';
      function dangerous(input) { return eval(input); }
      // TODO: fix credential leak
    `);

    loader._plugins = [securityAuditPlugin];
    loader._loaded = true;

    // Step 1: Execute (like task-runner)
    const pluginResults = await loader.executePlugins('before-review', {
      task: { id: 'task-real', title: 'Real security scan' },
      repoPath: tmpDir,
      changedFiles: ['app.js'],
    });

    // Step 2: Flatten (like task-runner)
    const pluginIssues = pluginResults.flatMap(r => r.issues || []);

    // Step 3: Build prompt section (like reviewer.js)
    const section = buildPluginIssuesSection(pluginIssues);

    // Verify full chain: each detected issue appears in the reviewer prompt
    expect(pluginIssues.length).toBeGreaterThanOrEqual(2);
    expect(section).toContain('MANDATORY');
    expect(section).toContain('app.js');
    // Each issue is a bullet point in the prompt
    for (const issue of pluginIssues) {
      expect(section).toContain(`- ${issue}`);
    }
  });

  it('múltiples plugins: issues de todos se combinan en una sola sección', async () => {
    const pluginA = {
      name: 'audit-a',
      role: 'First audit',
      position: 'before-review',
      execute: vi.fn().mockResolvedValue({
        success: true,
        issues: ['Issue from plugin A'],
        suggestions: [],
      }),
    };
    const pluginB = {
      name: 'audit-b',
      role: 'Second audit',
      position: 'before-review',
      execute: vi.fn().mockResolvedValue({
        success: true,
        issues: ['Issue from plugin B', 'Another issue from B'],
        suggestions: [],
      }),
    };

    loader._plugins = [pluginA, pluginB];
    loader._loaded = true;

    const pluginResults = await loader.executePlugins('before-review', {
      task: { id: 'task-multi', title: 'Multi plugin' },
    });

    const pluginIssues = pluginResults.flatMap(r => r.issues || []);
    const section = buildPluginIssuesSection(pluginIssues);

    expect(pluginIssues).toHaveLength(3);
    expect(section).toContain('- Issue from plugin A');
    expect(section).toContain('- Issue from plugin B');
    expect(section).toContain('- Another issue from B');
  });

  it('plugin que falla no impide que otros issues lleguen al reviewer', async () => {
    const brokenPlugin = {
      name: 'broken',
      role: 'Always fails',
      position: 'before-review',
      execute: vi.fn().mockRejectedValue(new Error('boom')),
    };
    const goodPlugin = {
      name: 'good-audit',
      role: 'Working audit',
      position: 'before-review',
      execute: vi.fn().mockResolvedValue({
        success: true,
        issues: ['Real issue found'],
        suggestions: [],
      }),
    };

    loader._plugins = [brokenPlugin, goodPlugin];
    loader._loaded = true;

    const pluginResults = await loader.executePlugins('before-review', {
      task: { id: 'task-mixed', title: 'Mixed plugins' },
    });

    const pluginIssues = pluginResults.flatMap(r => r.issues || []);
    const section = buildPluginIssuesSection(pluginIssues);

    // Both the error message from broken plugin and the real issue appear
    expect(pluginIssues).toHaveLength(2);
    expect(section).toContain('- boom');
    expect(section).toContain('- Real issue found');
  });
});
