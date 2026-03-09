import { existsSync, readdirSync } from 'fs';
import { resolve, join } from 'path';
import { pathToFileURL } from 'url';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { validatePlugin } from './plugin-interface.js';

/**
 * Loads and manages Komodo plugins from the configured plugins directory.
 *
 * Plugins are loaded once at startup and cached. Only plugins listed in
 * ENABLED_PLUGINS are loaded; others are ignored.
 */
export class PluginLoader {
  constructor() {
    /** @type {import('./plugin-interface.js').Plugin[]} */
    this._plugins = [];
    this._loaded = false;
  }

  /**
   * Loads all enabled plugins from PLUGINS_DIR.
   * Safe to call multiple times — only loads once.
   */
  async load() {
    if (this._loaded) return;
    this._loaded = true;

    const pluginsDir = config.pluginsDir;
    const enabledNames = config.enabledPlugins;

    if (enabledNames.length === 0) {
      logger.info('No plugins enabled (ENABLED_PLUGINS is empty)', 'PLUGINS');
      return;
    }

    if (!existsSync(pluginsDir)) {
      logger.warn(`Plugins directory not found: ${pluginsDir}`, 'PLUGINS');
      return;
    }

    for (const name of enabledNames) {
      await this._loadPlugin(pluginsDir, name);
    }

    logger.info(`Loaded ${this._plugins.length}/${enabledNames.length} plugin(s)`, 'PLUGINS');
  }

  /**
   * @param {string} pluginsDir
   * @param {string} name
   */
  async _loadPlugin(pluginsDir, name) {
    // Resolve plugin file: prefer index.js, then <name>.js
    const candidates = [
      join(pluginsDir, name, 'index.js'),
      join(pluginsDir, `${name}.js`),
    ];

    const pluginPath = candidates.find(p => existsSync(p));

    if (!pluginPath) {
      logger.warn(`Plugin "${name}" not found in ${pluginsDir}`, 'PLUGINS');
      return;
    }

    try {
      const module = await import(pathToFileURL(pluginPath).href);
      const plugin = module.default ?? module;

      const { valid, errors } = validatePlugin(plugin);
      if (!valid) {
        logger.warn(`Plugin "${name}" failed validation: ${errors.join('; ')}`, 'PLUGINS');
        return;
      }

      this._plugins.push(plugin);
      logger.info(`Plugin "${plugin.name}" loaded (${plugin.position})`, 'PLUGINS');
    } catch (err) {
      logger.warn(`Failed to load plugin "${name}": ${err.message}`, 'PLUGINS');
    }
  }

  /**
   * Returns plugins registered for a specific lifecycle position.
   *
   * @param {import('./plugin-interface.js').PluginPosition} position
   * @returns {import('./plugin-interface.js').Plugin[]}
   */
  getPluginsForPosition(position) {
    return this._plugins.filter(p => p.position === position);
  }

  /**
   * Executes all plugins for a given position.
   * Errors inside individual plugins are caught so they never abort the pipeline.
   *
   * @param {import('./plugin-interface.js').PluginPosition} position
   * @param {import('./plugin-interface.js').PluginContext} context
   * @returns {Promise<import('./plugin-interface.js').PluginResult[]>}
   */
  async executePlugins(position, context) {
    const plugins = this.getPluginsForPosition(position);
    if (plugins.length === 0) return [];

    const results = [];

    for (const plugin of plugins) {
      try {
        logger.info(`Running plugin "${plugin.name}"...`, 'PLUGINS');
        const result = await plugin.execute(context);
        results.push(result);

        if (result.issues?.length) {
          logger.warn(`Plugin "${plugin.name}" issues: ${result.issues.join(', ')}`, 'PLUGINS');
        }
      } catch (err) {
        logger.warn(`Plugin "${plugin.name}" threw an error: ${err.message}`, 'PLUGINS');
        results.push({ success: false, issues: [err.message], suggestions: [], data: {} });
      }
    }

    return results;
  }

  /** All loaded plugins. */
  get plugins() {
    return [...this._plugins];
  }
}

/** Singleton plugin loader. */
export const pluginLoader = new PluginLoader();
