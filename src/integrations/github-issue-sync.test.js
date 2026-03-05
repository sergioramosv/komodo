import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractUserStory, extractAcceptanceCriteria } from './github-issue-sync.js';

describe('extractUserStory', () => {
  it('extracts Spanish user story pattern', () => {
    const body = 'Como usuario admin\nQuiero poder eliminar cuentas\nPara mantener el sistema limpio';
    const result = extractUserStory('Delete accounts', body);

    expect(result.who).toBe('usuario admin');
    expect(result.what).toBe('poder eliminar cuentas');
    expect(result.why).toBe('mantener el sistema limpio');
  });

  it('extracts English user story pattern', () => {
    const body = 'As a developer, I want to run tests in CI, So that I can catch regressions early';
    const result = extractUserStory('CI tests', body);

    expect(result.who).toBe('developer');
    expect(result.what).toBe('to run tests in CI');
    expect(result.why).toBe('I can catch regressions early');
  });

  it('falls back to title when no pattern is found', () => {
    const result = extractUserStory('Fix login bug', 'The login page crashes on submit');

    expect(result.who).toBe('a user of the application');
    expect(result.what).toBe('Fix login bug');
    expect(result.why).toBe('The login page crashes on submit');
  });

  it('handles empty body gracefully', () => {
    const result = extractUserStory('Add dark mode', '');

    expect(result.who).toBe('a user of the application');
    expect(result.what).toBe('Add dark mode');
    expect(result.why).toBe('improve the application');
  });

  it('handles undefined body gracefully', () => {
    const result = extractUserStory('Add dark mode');

    expect(result.who).toBe('a user of the application');
    expect(result.what).toBe('Add dark mode');
  });
});

describe('extractAcceptanceCriteria', () => {
  it('extracts criteria from checkbox list', () => {
    const body = `## Acceptance Criteria
- [ ] User can log in with email
- [ ] User can log in with Google
- [x] Password reset works`;

    const criteria = extractAcceptanceCriteria(body);

    expect(criteria).toHaveLength(3);
    expect(criteria[0]).toBe('User can log in with email');
    expect(criteria[1]).toBe('User can log in with Google');
    expect(criteria[2]).toBe('Password reset works');
  });

  it('extracts criteria from numbered list', () => {
    const body = `## Requirements
1. Support dark mode
2. Persist preference
3. Toggle in settings`;

    const criteria = extractAcceptanceCriteria(body);

    expect(criteria).toHaveLength(3);
    expect(criteria[0]).toBe('Support dark mode');
    expect(criteria[1]).toBe('Persist preference');
    expect(criteria[2]).toBe('Toggle in settings');
  });

  it('returns fallback when no lists found', () => {
    const criteria = extractAcceptanceCriteria('Just some plain text');

    expect(criteria).toHaveLength(1);
    expect(criteria[0]).toBe('Feature implemented as described in the issue');
  });

  it('handles empty body', () => {
    const criteria = extractAcceptanceCriteria('');

    expect(criteria).toHaveLength(1);
  });

  it('prefers checkboxes over numbered lists when both present', () => {
    const body = `- [ ] Checkbox item
1. Numbered item`;

    const criteria = extractAcceptanceCriteria(body);

    expect(criteria).toHaveLength(1);
    expect(criteria[0]).toBe('Checkbox item');
  });
});

describe('pollOnce', () => {
  it('module exports pollOnce function', async () => {
    const mod = await import('./github-issue-sync.js');
    expect(typeof mod.pollOnce).toBe('function');
  });

  it('module exports startPolling function', async () => {
    const mod = await import('./github-issue-sync.js');
    expect(typeof mod.startPolling).toBe('function');
  });

  it('module exports syncIssue function', async () => {
    const mod = await import('./github-issue-sync.js');
    expect(typeof mod.syncIssue).toBe('function');
  });
});
