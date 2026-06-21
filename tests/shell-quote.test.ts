import { describe, expect, test } from 'bun:test';
import { formatGitCommand, shellQuote } from '../src/shell-quote.ts';

describe('shellQuote', () => {
  test('leaves safe tokens unquoted', () => {
    expect(shellQuote('status')).toBe('status');
    expect(shellQuote('--no-verify')).toBe('--no-verify');
    expect(shellQuote('managed-apps/business-coach/CLAUDE.md')).toBe(
      'managed-apps/business-coach/CLAUDE.md',
    );
    expect(shellQuote('HEAD~1')).toBe('HEAD~1');
    expect(shellQuote('user.email')).toBe('user.email');
  });

  test('quotes tokens containing spaces', () => {
    expect(shellQuote('hello world')).toBe("'hello world'");
  });

  test('quotes a multi-line message as a single token', () => {
    const msg = 'REPRO test subject\n\nCo-Authored-By: Test <test@example.com>';
    expect(shellQuote(msg)).toBe(`'${msg}'`);
  });

  test('escapes embedded single quotes', () => {
    expect(shellQuote("it's")).toBe("'it'\\''s'");
  });

  test('quotes the empty string', () => {
    expect(shellQuote('')).toBe("''");
  });

  test('quotes shell metacharacters', () => {
    expect(shellQuote('a;b')).toBe("'a;b'");
    expect(shellQuote('$(x)')).toBe("'$(x)'");
    expect(shellQuote('a b|c')).toBe("'a b|c'");
  });
});

describe('formatGitCommand', () => {
  test('reconstructs a plain command', () => {
    expect(formatGitCommand(['status'])).toBe('git status');
  });

  test('keeps -m message and -- pathspec as distinct, unambiguous tokens', () => {
    // This is the bug-report repro: a multi-line message followed by an
    // explicit pathspec must not visually merge.
    const out = formatGitCommand([
      'commit',
      '--no-verify',
      '-m',
      'REPRO test subject\n\nCo-Authored-By: Test <test@example.com>',
      '--',
      'managed-apps/business-coach/CLAUDE.md',
    ]);
    // The message is one quoted token; the pathspec is clearly separate.
    expect(out).toContain(
      "-m 'REPRO test subject\n\nCo-Authored-By: Test <test@example.com>' -- managed-apps/business-coach/CLAUDE.md",
    );
    // And the whole thing is a valid `git ...` reconstruction.
    expect(out.startsWith('git commit --no-verify ')).toBe(true);
  });
});
