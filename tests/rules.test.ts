import { describe, expect, test } from 'bun:test';
import { DANGEROUS_RULES } from '../src/rules.ts';

describe('DANGEROUS_RULES', () => {
  test('exports an array of rules', () => {
    expect(Array.isArray(DANGEROUS_RULES)).toBe(true);
    expect(DANGEROUS_RULES.length).toBeGreaterThan(0);
  });

  test('each rule has subcommand, pattern, and reason', () => {
    for (const rule of DANGEROUS_RULES) {
      expect(rule.subcommand).toBeDefined();
      expect(rule.reason).toBeDefined();
      expect(rule.match).toBeDefined();
    }
  });
});
