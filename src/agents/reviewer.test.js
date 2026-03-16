import { describe, it, expect } from 'vitest';
import { normalizeVerdict, buildPluginIssuesSection } from './reviewer.js';

describe('normalizeVerdict', () => {
  it('returns APPROVED when score >= 8 and no critical/major issues', () => {
    expect(normalizeVerdict('APPROVED', 9, [])).toBe('APPROVED');
  });

  it('returns APPROVED for score exactly 8', () => {
    expect(normalizeVerdict('APPROVED', 8, [])).toBe('APPROVED');
  });

  it('returns REQUEST_CHANGES when score < 8', () => {
    expect(normalizeVerdict('APPROVED', 7, [])).toBe('REQUEST_CHANGES');
  });

  it('returns REQUEST_CHANGES when there is a critical issue', () => {
    expect(normalizeVerdict('APPROVED', 9, [{ severity: 'critical' }])).toBe('REQUEST_CHANGES');
  });

  it('returns REQUEST_CHANGES when there is a major issue', () => {
    expect(normalizeVerdict('APPROVED', 9, [{ severity: 'major' }])).toBe('REQUEST_CHANGES');
  });

  it('returns REQUEST_CHANGES when verdict is not APPROVED', () => {
    expect(normalizeVerdict('REQUEST_CHANGES', 9, [])).toBe('REQUEST_CHANGES');
  });

  it('handles null score by returning REQUEST_CHANGES', () => {
    // null < 8 is TRUE in JS (null coerces to 0), but explicit null guard ensures consistent behavior
    expect(normalizeVerdict('APPROVED', null, [])).toBe('REQUEST_CHANGES');
  });

  it('handles undefined score by returning REQUEST_CHANGES', () => {
    // undefined < 8 is FALSE in JS (NaN comparison) — explicit == null guard catches this case
    expect(normalizeVerdict('APPROVED', undefined, [])).toBe('REQUEST_CHANGES');
  });

  it('normalizes lowercase "approved" to APPROVED', () => {
    expect(normalizeVerdict('approved', 9, [])).toBe('APPROVED');
  });

  it('forces REQUEST_CHANGES when sonarReport quality gate is not OK', () => {
    const sonarReport = { success: true, qualityGate: 'ERROR' };
    expect(normalizeVerdict('APPROVED', 10, [], sonarReport)).toBe('REQUEST_CHANGES');
  });

  it('forces REQUEST_CHANGES when coverageReport is below threshold', () => {
    const coverageReport = { success: true, belowThreshold: true };
    expect(normalizeVerdict('APPROVED', 10, [], undefined, coverageReport)).toBe('REQUEST_CHANGES');
  });

  it('does not force REQUEST_CHANGES when sonarReport quality gate is OK', () => {
    const sonarReport = { success: true, qualityGate: 'OK' };
    expect(normalizeVerdict('APPROVED', 9, [], sonarReport)).toBe('APPROVED');
  });
});

describe('buildPluginIssuesSection', () => {
  it('returns empty string when issues is empty', () => {
    expect(buildPluginIssuesSection([])).toBe('');
  });

  it('returns empty string when issues is null', () => {
    expect(buildPluginIssuesSection(null)).toBe('');
  });

  it('includes issue string in output', () => {
    const issues = ['[critical] SQL Injection: User input not sanitized'];
    const result = buildPluginIssuesSection(issues);
    expect(result).toContain('SQL Injection');
  });

  it('includes severity string in output', () => {
    const issues = ['[major] XSS: Missing escaping'];
    const result = buildPluginIssuesSection(issues);
    expect(result).toContain('major');
  });

  it('handles multiple issues', () => {
    const issues = ['[critical] Issue A: Desc A', '[minor] Issue B: Desc B'];
    const result = buildPluginIssuesSection(issues);
    expect(result).toContain('Issue A');
    expect(result).toContain('Issue B');
  });
});
