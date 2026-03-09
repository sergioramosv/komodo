import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { validatePlugin, PLUGIN_POSITIONS } from './plugin-interface.js';
import { PluginLoader } from './plugin-loader.js';

// ── validatePlugin ────────────────────────────────────────────────────────────

describe('validatePlugin', () => {
  const validPlugin = {
    name: 'security-audit',
    role: 'Audits code for security vulnerabilities',
    position: 'before-review',
    execute: async () => ({ success: true, issues: [], suggestions: [] }),
  };

  it('acepta un plugin válido', () => {
    const { valid, errors } = validatePlugin(validPlugin);
    expect(valid).toBe(true);
    expect(errors).toHaveLength(0);
  });

  it('rechaza null', () => {
    const { valid, errors } = validatePlugin(null);
    expect(valid).toBe(false);
    expect(errors[0]).toMatch(/non-null object/);
  });

  it('rechaza un valor no-objeto', () => {
    const { valid, errors } = validatePlugin('not a plugin');
    expect(valid).toBe(false);
    expect(errors[0]).toMatch(/non-null object/);
  });

  it('rechaza name vacío', () => {
    const { valid, errors } = validatePlugin({ ...validPlugin, name: '' });
    expect(valid).toBe(false);
    expect(errors.some(e => e.includes('name'))).toBe(true);
  });

  it('rechaza name no-string', () => {
    const { valid, errors } = validatePlugin({ ...validPlugin, name: 42 });
    expect(valid).toBe(false);
    expect(errors.some(e => e.includes('name'))).toBe(true);
  });

  it('rechaza role vacío', () => {
    const { valid, errors } = validatePlugin({ ...validPlugin, role: '  ' });
    expect(valid).toBe(false);
    expect(errors.some(e => e.includes('role'))).toBe(true);
  });

  it('rechaza position inválida', () => {
    const { valid, errors } = validatePlugin({ ...validPlugin, position: 'invalid' });
    expect(valid).toBe(false);
    expect(errors.some(e => e.includes('position'))).toBe(true);
  });

  it('acepta todas las positions válidas', () => {
    for (const position of PLUGIN_POSITIONS) {
      const { valid } = validatePlugin({ ...validPlugin, position });
      expect(valid).toBe(true);
    }
  });

  it('rechaza execute no-función', () => {
    const { valid, errors } = validatePlugin({ ...validPlugin, execute: 'not-a-fn' });
    expect(valid).toBe(false);
    expect(errors.some(e => e.includes('execute'))).toBe(true);
  });

  it('reporta múltiples errores a la vez', () => {
    const { valid, errors } = validatePlugin({ name: '', role: '', position: 'bad', execute: null });
    expect(valid).toBe(false);
    expect(errors.length).toBeGreaterThanOrEqual(4);
  });
});

// ── PLUGIN_POSITIONS ──────────────────────────────────────────────────────────

describe('PLUGIN_POSITIONS', () => {
  it('contiene before-review, after-review y after-merge', () => {
    expect(PLUGIN_POSITIONS).toContain('before-review');
    expect(PLUGIN_POSITIONS).toContain('after-review');
    expect(PLUGIN_POSITIONS).toContain('after-merge');
  });
});

// ── PluginLoader ──────────────────────────────────────────────────────────────

describe('PluginLoader', () => {
  let loader;

  const makePlugin = (overrides = {}) => ({
    name: 'test-plugin',
    role: 'Test plugin',
    position: 'before-review',
    execute: vi.fn().mockResolvedValue({
      success: true,
      issues: [],
      suggestions: [],
    }),
    ...overrides,
  });

  beforeEach(() => {
    loader = new PluginLoader();
  });

  // ── getPluginsForPosition ──────────────────────────────────────────────────

  describe('getPluginsForPosition', () => {
    it('devuelve plugins de la position solicitada', () => {
      loader._plugins = [
        makePlugin({ name: 'a', position: 'before-review' }),
        makePlugin({ name: 'b', position: 'after-review' }),
        makePlugin({ name: 'c', position: 'before-review' }),
      ];

      const results = loader.getPluginsForPosition('before-review');
      expect(results).toHaveLength(2);
      expect(results.map(p => p.name)).toEqual(['a', 'c']);
    });

    it('devuelve array vacío si no hay plugins para la position', () => {
      loader._plugins = [makePlugin({ position: 'after-merge' })];
      expect(loader.getPluginsForPosition('before-review')).toHaveLength(0);
    });

    it('devuelve array vacío cuando no hay plugins cargados', () => {
      expect(loader.getPluginsForPosition('after-review')).toHaveLength(0);
    });
  });

  // ── executePlugins ─────────────────────────────────────────────────────────

  describe('executePlugins', () => {
    it('ejecuta todos los plugins de la position', async () => {
      const pluginA = makePlugin({ name: 'a', position: 'after-review' });
      const pluginB = makePlugin({ name: 'b', position: 'after-review' });
      loader._plugins = [pluginA, pluginB];

      const context = { task: { id: 't1', title: 'Test' } };
      const results = await loader.executePlugins('after-review', context);

      expect(results).toHaveLength(2);
      expect(pluginA.execute).toHaveBeenCalledWith(context);
      expect(pluginB.execute).toHaveBeenCalledWith(context);
    });

    it('retorna array vacío si no hay plugins para la position', async () => {
      const results = await loader.executePlugins('after-merge', {});
      expect(results).toEqual([]);
    });

    it('captura errores de plugins individuales sin abortar', async () => {
      const badPlugin = makePlugin({
        name: 'bad',
        position: 'before-review',
        execute: vi.fn().mockRejectedValue(new Error('plugin exploded')),
      });
      const goodPlugin = makePlugin({ name: 'good', position: 'before-review' });
      loader._plugins = [badPlugin, goodPlugin];

      const results = await loader.executePlugins('before-review', {});

      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(false);
      expect(results[0].issues[0]).toMatch(/plugin exploded/);
      expect(results[1].success).toBe(true);
    });

    it('incluye los issues del resultado en el retorno', async () => {
      const plugin = makePlugin({
        execute: vi.fn().mockResolvedValue({
          success: true,
          issues: ['Missing type annotation on line 5'],
          suggestions: ['Consider using const'],
        }),
      });
      loader._plugins = [plugin];

      const [result] = await loader.executePlugins('before-review', {});
      expect(result.issues).toEqual(['Missing type annotation on line 5']);
      expect(result.suggestions).toEqual(['Consider using const']);
    });
  });

  // ── plugins getter ─────────────────────────────────────────────────────────

  describe('plugins getter', () => {
    it('devuelve copia del array de plugins', () => {
      loader._plugins = [makePlugin()];
      const copy = loader.plugins;
      copy.push(makePlugin({ name: 'intruder' }));
      expect(loader._plugins).toHaveLength(1);
    });
  });

  // ── load (idempotente) ─────────────────────────────────────────────────────

  describe('load idempotencia', () => {
    it('no carga dos veces si se llama múltiples veces', async () => {
      // loader con directorio inexistente — load no hace nada
      loader._loaded = false;
      await loader.load(); // primera llamada — setea _loaded=true
      loader._plugins.push(makePlugin({ name: 'manually-added' }));
      await loader.load(); // segunda llamada — debe ignorarse
      expect(loader._plugins).toHaveLength(1); // no se limpia en segunda llamada
    });
  });

  // ── _loadPlugin ────────────────────────────────────────────────────────────

  describe('_loadPlugin', () => {
    let tmpDir;

    beforeEach(() => {
      tmpDir = join(tmpdir(), `komodo-plugin-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      mkdirSync(tmpDir, { recursive: true });
    });

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    const validPluginEsm = (name, position = 'before-review') => `
      export default {
        name: '${name}',
        role: 'Test plugin role',
        position: '${position}',
        execute: async () => ({ success: true, issues: [], suggestions: [] }),
      };
    `;

    it('usa index.js cuando existe (candidato preferente sobre <name>.js)', async () => {
      const pluginDir = join(tmpDir, 'my-plugin');
      mkdirSync(pluginDir);
      writeFileSync(join(pluginDir, 'index.js'), validPluginEsm('my-plugin'));
      // También crea <name>.js para verificar que index.js tiene prioridad
      writeFileSync(join(tmpDir, 'my-plugin.js'), validPluginEsm('my-plugin-flat'));

      await loader._loadPlugin(tmpDir, 'my-plugin');

      expect(loader._plugins).toHaveLength(1);
      expect(loader._plugins[0].name).toBe('my-plugin');
    });

    it('usa <name>.js cuando no existe index.js', async () => {
      writeFileSync(join(tmpDir, 'flat-plugin.js'), validPluginEsm('flat-plugin', 'after-review'));

      await loader._loadPlugin(tmpDir, 'flat-plugin');

      expect(loader._plugins).toHaveLength(1);
      expect(loader._plugins[0].name).toBe('flat-plugin');
      expect(loader._plugins[0].position).toBe('after-review');
    });

    it('usa module directamente cuando module.default es undefined (named exports)', async () => {
      writeFileSync(join(tmpDir, 'named-plugin.js'), `
        export const name = 'named-plugin';
        export const role = 'Test role';
        export const position = 'after-merge';
        export const execute = async () => ({ success: true, issues: [], suggestions: [] });
      `);

      await loader._loadPlugin(tmpDir, 'named-plugin');

      expect(loader._plugins).toHaveLength(1);
      expect(loader._plugins[0].name).toBe('named-plugin');
    });

    it('no carga ningún plugin si no existe ningún candidato', async () => {
      await loader._loadPlugin(tmpDir, 'nonexistent-plugin');

      expect(loader._plugins).toHaveLength(0);
    });

    it('no carga el plugin si falla la validación (plugin inválido)', async () => {
      writeFileSync(join(tmpDir, 'invalid-plugin.js'), `
        export default {
          name: 'invalid',
          // missing: role, position, execute
        };
      `);

      await loader._loadPlugin(tmpDir, 'invalid-plugin');

      expect(loader._plugins).toHaveLength(0);
    });

    it('captura error de import() sin crashear', async () => {
      writeFileSync(join(tmpDir, 'broken-plugin.js'), `
        throw new Error('module initialization failed');
      `);

      await expect(loader._loadPlugin(tmpDir, 'broken-plugin')).resolves.toBeUndefined();
      expect(loader._plugins).toHaveLength(0);
    });

    it('carga varios plugins independientes en el mismo directorio', async () => {
      writeFileSync(join(tmpDir, 'plugin-a.js'), validPluginEsm('plugin-a', 'before-review'));
      writeFileSync(join(tmpDir, 'plugin-b.js'), validPluginEsm('plugin-b', 'after-review'));

      await loader._loadPlugin(tmpDir, 'plugin-a');
      await loader._loadPlugin(tmpDir, 'plugin-b');

      expect(loader._plugins).toHaveLength(2);
      expect(loader._plugins.map(p => p.name)).toEqual(['plugin-a', 'plugin-b']);
    });
  });
});
