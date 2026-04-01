import { describe, expect, it } from 'vitest';
import {
  comparePriority,
  getPriorityRank,
  normalizePriority,
} from '../../../shared/src/code_health';

describe('code health shared priority utilities', () => {
  it('normalizes known priorities and falls back for unknown values', () => {
    expect(normalizePriority('CRITICAL')).toBe('critical');
    expect(normalizePriority('high')).toBe('high');
    expect(normalizePriority('unexpected')).toBe('medium');
    expect(normalizePriority(undefined)).toBe('medium');
  });

  it('maps priorities to deterministic numeric ranks', () => {
    expect(getPriorityRank('critical')).toBe(0);
    expect(getPriorityRank('high')).toBe(1);
    expect(getPriorityRank('medium')).toBe(2);
    expect(getPriorityRank('low')).toBe(3);
    expect(getPriorityRank('unknown')).toBe(2);
  });

  it('compares priorities for ascending risk sort order', () => {
    expect(comparePriority('critical', 'low')).toBeLessThan(0);
    expect(comparePriority('low', 'critical')).toBeGreaterThan(0);
    expect(comparePriority('medium', 'medium')).toBe(0);
    expect(comparePriority(undefined, 'unexpected')).toBe(0);
  });
});
