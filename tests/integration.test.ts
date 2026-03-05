import { describe, expect, test } from 'bun:test';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const ENTRY = join(ROOT, 'src/index.ts');

/** Run the wrapper via bun (not compiled, for testability) */
function runGit(args: string, opts: { env?: Record<string, string> } = {}): {
  stdout: string;
  stderr: string;
  exitCode: number;
} {
  try {
    const stdout = execSync(`bun run ${ENTRY} ${args}`, {
      cwd: ROOT,
      encoding: 'utf-8',
      env: { ...process.env, ...opts.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? '',
      exitCode: e.status ?? 1,
    };
  }
}

describe('integration: blocked commands', () => {
  test('git stash is blocked', () => {
    const r = runGit('stash');
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toContain('[git-guardrails] BLOCKED');
  });

  test('git reset --hard is blocked', () => {
    const r = runGit('reset --hard');
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toContain('[git-guardrails] BLOCKED');
  });

  test('git push --force is blocked', () => {
    const r = runGit('push --force');
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toContain('[git-guardrails] BLOCKED');
  });

  test('git checkout . is blocked', () => {
    const r = runGit('checkout .');
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toContain('[git-guardrails] BLOCKED');
  });

  test('git rebase main is blocked', () => {
    const r = runGit('rebase main');
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toContain('[git-guardrails] BLOCKED');
  });
});

describe('integration: allowed commands', () => {
  test('git status passes through (no BLOCKED message)', () => {
    const r = runGit('status');
    expect(r.stderr).not.toContain('[git-guardrails] BLOCKED');
  });

  test('git log passes through (no BLOCKED message)', () => {
    const r = runGit('log --oneline -1');
    expect(r.stderr).not.toContain('[git-guardrails] BLOCKED');
  });
});

describe('integration: GIT_ALLOW_DANGEROUS bypass', () => {
  test('git stash allowed with env bypass', () => {
    const r = runGit('stash', { env: { GIT_ALLOW_DANGEROUS: '1' } });
    expect(r.stderr).not.toContain('[git-guardrails] BLOCKED');
  });

  test('git reset --hard allowed with env bypass', () => {
    const r = runGit('reset --hard', { env: { GIT_ALLOW_DANGEROUS: '1' } });
    expect(r.stderr).not.toContain('[git-guardrails] BLOCKED');
  });
});
