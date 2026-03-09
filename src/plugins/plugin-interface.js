/**
 * Plugin Interface — defines the standard contract for Komodo plugins.
 *
 * A plugin is a JavaScript module that exports a default object conforming
 * to the Plugin interface below. Plugins are loaded from PLUGINS_DIR and
 * executed at specific positions in the task lifecycle.
 *
 * @module plugin-interface
 */

/**
 * @typedef {'before-review'|'after-review'|'after-merge'} PluginPosition
 * When the plugin executes relative to the review cycle:
 * - before-review: runs after Coder finishes, before Reviewer starts
 * - after-review:  runs after Reviewer approves, before merging
 * - after-merge:   runs after the PR is merged
 */

/**
 * @typedef {Object} PluginContext
 * @property {Object}         task                   - The current task object
 * @property {string}         task.id                - Task ID
 * @property {string}         task.title             - Task title
 * @property {string}         [task.body]            - Task description
 * @property {string}         [prNumber]             - Pull request number (if a PR exists)
 * @property {string}         [branchName]           - Feature branch name
 * @property {string}         [repoPath]             - Absolute path to the local repository
 * @property {string}         [repo]                 - Repository in owner/repo format
 * @property {string[]}       [changedFiles]         - Files changed in the PR
 * @property {PluginResult[]} [previousPluginOutputs] - Results from plugins that ran earlier at this position
 */

/**
 * @typedef {Object} PluginResult
 * @property {boolean}  success     - Whether the plugin completed without fatal error
 * @property {string[]} issues      - Issues found (can block the pipeline if critical)
 * @property {string[]} suggestions - Non-blocking improvement suggestions
 * @property {Object}   [data]      - Additional plugin-specific data for downstream use
 */

/**
 * @typedef {Object} Plugin
 * @property {string}         name     - Unique plugin identifier (e.g. "security-audit")
 * @property {string}         role     - Human-readable description of what the plugin does
 * @property {PluginPosition} position - Lifecycle hook where the plugin runs
 * @property {(context: PluginContext) => Promise<PluginResult>} execute - Main plugin function
 */

/** Valid plugin position values. */
export const PLUGIN_POSITIONS = /** @type {const} */ ([
  'before-review',
  'after-review',
  'after-merge',
]);

/**
 * Validates that an object conforms to the Plugin interface.
 *
 * @param {unknown} plugin - Object to validate
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validatePlugin(plugin) {
  const errors = [];

  if (!plugin || typeof plugin !== 'object') {
    return { valid: false, errors: ['Plugin must be a non-null object'] };
  }

  if (typeof plugin.name !== 'string' || !plugin.name.trim()) {
    errors.push('plugin.name must be a non-empty string');
  }

  if (typeof plugin.role !== 'string' || !plugin.role.trim()) {
    errors.push('plugin.role must be a non-empty string');
  }

  if (!PLUGIN_POSITIONS.includes(plugin.position)) {
    errors.push(
      `plugin.position must be one of: ${PLUGIN_POSITIONS.join(', ')} (got: ${plugin.position})`
    );
  }

  if (typeof plugin.execute !== 'function') {
    errors.push('plugin.execute must be a function');
  }

  return { valid: errors.length === 0, errors };
}
