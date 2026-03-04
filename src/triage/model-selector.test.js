import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../config.js', () => ({
  config: {
    // Default: no overrides
    modelMap_claude_PLANNER: '',
    modelMap_claude_CODER: '',
    modelMap_claude_REVIEWER: '',
    modelMap_codex_PLANNER: '',
    modelMap_codex_CODER: '',
    modelMap_codex_REVIEWER: '',
    modelMap_gemini_PLANNER: '',
    modelMap_gemini_CODER: '',
    modelMap_gemini_REVIEWER: '',
    forceModel_PLANNER: '',
    forceModel_CODER: '',
    forceModel_REVIEWER: '',
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
  eventBus: {
    emitEvent: vi.fn().mockReturnValue({}),
  },
  EVENT_TYPES: {
    MODEL_SELECTED: 'triage:model-selected',
  },
}));

import { selectModel } from './model-selector.js';
import { config } from '../config.js';
import { eventBus } from '../events/event-bus.js';
import { logger } from '../utils/logger.js';

describe('model-selector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset config to defaults
    config.modelMap_claude_PLANNER = '';
    config.modelMap_claude_CODER = '';
    config.modelMap_claude_REVIEWER = '';
    config.modelMap_codex_PLANNER = '';
    config.modelMap_codex_CODER = '';
    config.modelMap_codex_REVIEWER = '';
    config.modelMap_gemini_PLANNER = '';
    config.modelMap_gemini_CODER = '';
    config.modelMap_gemini_REVIEWER = '';
    config.forceModel_PLANNER = '';
    config.forceModel_CODER = '';
    config.forceModel_REVIEWER = '';
  });

  // ── Default model map (no overrides) ──────────────────

  describe('default model map', () => {
    it('selects sonnet for claude PLANNER on trivial task', () => {
      const model = selectModel('claude', 'PLANNER', 'trivial');
      expect(model).toBe('sonnet');
    });

    it('selects sonnet for claude PLANNER on standard task', () => {
      const model = selectModel('claude', 'PLANNER', 'standard');
      expect(model).toBe('sonnet');
    });

    it('selects opus for claude PLANNER on complex task', () => {
      const model = selectModel('claude', 'PLANNER', 'complex');
      expect(model).toBe('opus');
    });

    it('selects sonnet for claude CODER on trivial task', () => {
      const model = selectModel('claude', 'CODER', 'trivial');
      expect(model).toBe('sonnet');
    });

    it('selects opus for claude CODER on complex task', () => {
      const model = selectModel('claude', 'CODER', 'complex');
      expect(model).toBe('opus');
    });

    it('selects haiku for claude REVIEWER on trivial task', () => {
      const model = selectModel('claude', 'REVIEWER', 'trivial');
      expect(model).toBe('haiku');
    });

    it('selects sonnet for claude REVIEWER on complex task', () => {
      const model = selectModel('claude', 'REVIEWER', 'complex');
      expect(model).toBe('sonnet');
    });
  });

  describe('codex default map', () => {
    it('selects codex-mini for codex CODER on trivial', () => {
      const model = selectModel('codex', 'CODER', 'trivial');
      expect(model).toBe('codex-mini');
    });

    it('selects o4-mini for codex CODER on standard', () => {
      const model = selectModel('codex', 'CODER', 'standard');
      expect(model).toBe('o4-mini');
    });

    it('selects o3 for codex CODER on complex', () => {
      const model = selectModel('codex', 'CODER', 'complex');
      expect(model).toBe('o3');
    });
  });

  describe('gemini default map', () => {
    it('selects gemini-2.0-flash for gemini PLANNER on trivial', () => {
      const model = selectModel('gemini', 'PLANNER', 'trivial');
      expect(model).toBe('gemini-2.0-flash');
    });

    it('selects gemini-2.5-pro for gemini CODER on complex', () => {
      const model = selectModel('gemini', 'CODER', 'complex');
      expect(model).toBe('gemini-2.5-pro');
    });
  });

  // ── .env model map overrides ──────────────────────────

  describe('.env model map overrides', () => {
    it('uses .env MODEL_MAP_CLAUDE_CODER when set', () => {
      config.modelMap_claude_CODER = 'haiku,sonnet,opus';

      const trivial = selectModel('claude', 'CODER', 'trivial');
      const standard = selectModel('claude', 'CODER', 'standard');
      const complex = selectModel('claude', 'CODER', 'complex');

      expect(trivial).toBe('haiku');
      expect(standard).toBe('sonnet');
      expect(complex).toBe('opus');
    });

    it('ignores malformed .env map (wrong number of parts)', () => {
      config.modelMap_claude_CODER = 'haiku,sonnet'; // only 2 parts

      const model = selectModel('claude', 'CODER', 'trivial');
      // Falls back to default
      expect(model).toBe('sonnet');
    });

    it('ignores empty .env map', () => {
      config.modelMap_claude_CODER = '';

      const model = selectModel('claude', 'CODER', 'complex');
      expect(model).toBe('opus');
    });
  });

  // ── Force override per role ───────────────────────────

  describe('force override per role', () => {
    it('FORCE_MODEL_CODER overrides complexity-based selection', () => {
      config.forceModel_CODER = 'opus';

      const trivial = selectModel('claude', 'CODER', 'trivial');
      const standard = selectModel('claude', 'CODER', 'standard');
      const complex = selectModel('claude', 'CODER', 'complex');

      expect(trivial).toBe('opus');
      expect(standard).toBe('opus');
      expect(complex).toBe('opus');
    });

    it('FORCE_MODEL_REVIEWER overrides complexity-based selection', () => {
      config.forceModel_REVIEWER = 'sonnet';

      const model = selectModel('claude', 'REVIEWER', 'trivial');
      expect(model).toBe('sonnet'); // not haiku
    });

    it('FORCE_MODEL_PLANNER overrides for any CLI', () => {
      config.forceModel_PLANNER = 'custom-model';

      expect(selectModel('claude', 'PLANNER', 'trivial')).toBe('custom-model');
      expect(selectModel('codex', 'PLANNER', 'complex')).toBe('custom-model');
      expect(selectModel('gemini', 'PLANNER', 'standard')).toBe('custom-model');
    });
  });

  // ── Task-level override (highest priority) ────────────

  describe('task-level override', () => {
    it('task override has highest priority over force override', () => {
      config.forceModel_CODER = 'opus';

      const model = selectModel('claude', 'CODER', 'trivial', 'custom-task-model');
      expect(model).toBe('custom-task-model');
    });

    it('task override has highest priority over .env map', () => {
      config.modelMap_claude_CODER = 'haiku,sonnet,opus';

      const model = selectModel('claude', 'CODER', 'complex', 'my-override');
      expect(model).toBe('my-override');
    });

    it('undefined task override does not activate', () => {
      const model = selectModel('claude', 'CODER', 'trivial', undefined);
      expect(model).toBe('sonnet'); // default
    });
  });

  // ── Unknown CLI / role ────────────────────────────────

  describe('unknown CLI or role', () => {
    it('returns null for unknown CLI without overrides', () => {
      const model = selectModel('unknown-cli', 'CODER', 'trivial');
      expect(model).toBeNull();
    });

    it('returns null for unknown role without overrides', () => {
      const model = selectModel('claude', 'UNKNOWN_ROLE', 'trivial');
      expect(model).toBeNull();
    });

    it('force override works even for unknown CLI', () => {
      config.forceModel_CODER = 'forced-model';

      const model = selectModel('unknown-cli', 'CODER', 'trivial');
      expect(model).toBe('forced-model');
    });
  });

  // ── Case insensitivity ────────────────────────────────

  describe('case insensitivity', () => {
    it('handles uppercase CLI name', () => {
      const model = selectModel('CLAUDE', 'CODER', 'trivial');
      expect(model).toBe('sonnet');
    });

    it('handles mixed case complexity level', () => {
      const model = selectModel('claude', 'CODER', 'Complex');
      expect(model).toBe('opus');
    });

    it('handles lowercase role name', () => {
      const model = selectModel('claude', 'coder', 'trivial');
      // force lookup uses uppercase role
      expect(model).toBe('sonnet');
    });
  });

  // ── Event emission ────────────────────────────────────

  describe('event emission', () => {
    it('emits MODEL_SELECTED event with correct metadata', () => {
      const model = selectModel('claude', 'CODER', 'complex');

      expect(eventBus.emitEvent).toHaveBeenCalledWith('triage:model-selected', {
        metadata: {
          cliType: 'claude',
          agentRole: 'CODER',
          complexityLevel: 'complex',
          model: 'opus',
          source: 'complexity-map',
        },
      });
    });

    it('reports source as task-override when using task override', () => {
      selectModel('claude', 'CODER', 'trivial', 'my-model');

      expect(eventBus.emitEvent).toHaveBeenCalledWith('triage:model-selected', {
        metadata: expect.objectContaining({
          model: 'my-model',
          source: 'task-override',
        }),
      });
    });

    it('reports source as force-override when using FORCE_MODEL', () => {
      config.forceModel_CODER = 'opus';

      selectModel('claude', 'CODER', 'trivial');

      expect(eventBus.emitEvent).toHaveBeenCalledWith('triage:model-selected', {
        metadata: expect.objectContaining({
          model: 'opus',
          source: 'force-override',
        }),
      });
    });

    it('emits event even when model is null', () => {
      selectModel('unknown-cli', 'UNKNOWN', 'trivial');

      expect(eventBus.emitEvent).toHaveBeenCalledWith('triage:model-selected', {
        metadata: expect.objectContaining({
          model: null,
          source: 'default',
        }),
      });
    });
  });

  // ── Logging ───────────────────────────────────────────

  describe('logging', () => {
    it('logs model selection when model is found', () => {
      selectModel('claude', 'CODER', 'complex');

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('opus'),
        'TRIAGE',
      );
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('complexity-map'),
        'TRIAGE',
      );
    });

    it('does not log when no model is selected', () => {
      selectModel('unknown-cli', 'UNKNOWN', 'trivial');

      expect(logger.info).not.toHaveBeenCalled();
    });
  });
});
