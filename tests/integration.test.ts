import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { execFileSync, execSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const ENTRY = join(ROOT, 'src/index.ts');

/** Real git, never the PATH-shadowed wrapper — used only for test fixture setup. */
const REAL_GIT = '/usr/bin/git';

/**
 * A throwaway git repo used as the cwd for every wrapper invocation below.
 *
 * Critical: some tests exercise the GIT_ALLOW_DANGEROUS bypass, which lets
 * `git stash` / `git reset --hard` run for real. If those ran in this repo's
 * own checkout (the old behaviour, cwd: ROOT) they would destroy any
 * uncommitted work in the working tree every time the suite ran. They must
 * operate on a disposable repo instead.
 */
let TMP = '';

beforeAll(() => {
  TMP = mkdtempSync(join(tmpdir(), 'git-guardrails-it-'));
  const git = (...args: string[]) =>
    execFileSync(REAL_GIT, args, { cwd: TMP, stdio: 'ignore' });
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  writeFileSync(join(TMP, 'README.md'), '# fixture\n');
  git('add', 'README.md');
  git('commit', '-q', '-m', 'init');
});

afterAll(() => {
  if (TMP) rmSync(TMP, { recursive: true, force: true });
});

/** Run the wrapper via bun (not compiled, for testability), in the temp repo. */
function runGit(args: string, opts: { env?: Record<string, string> } = {}): {
  stdout: string;
  stderr: string;
  exitCode: number;
} {
  try {
    const stdout = execSync(`bun run ${ENTRY} ${args}`, {
      cwd: TMP,
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

  test('git restore is blocked (any path)', () => {
    const r = runGit('restore README.md');
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toContain('[git-guardrails] BLOCKED');
  });

  test('git checkout -b is blocked (new branch in main worktree)', () => {
    const r = runGit('checkout -b feature-xyz');
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toContain('[git-guardrails] BLOCKED');
  });

  test('compiled dist/git blocks git restore', () => {
    const binary = join(ROOT, 'dist', 'git');
    if (!existsSync(binary)) {
      return;
    }
    let stderr = '';
    let status: number | undefined;
    try {
      execFileSync(binary, ['restore', 'README.md'], {
        cwd: TMP,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err: unknown) {
      const e = err as { stderr?: string; status?: number };
      stderr = e.stderr ?? '';
      status = e.status;
    }
    expect(status).toBe(128);
    expect(stderr).toContain('[git-guardrails] BLOCKED');
  });

  test('compiled dist/git passes git version through', () => {
    const binary = join(ROOT, 'dist', 'git');
    if (!existsSync(binary)) {
      return;
    }
    const out = execFileSync(binary, ['version'], {
      cwd: TMP,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    expect(String(out)).toMatch(/git version/i);
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
  // These actually execute git stash / reset --hard, so they MUST run in the
  // disposable temp repo (TMP), never the project checkout.
  test('git stash allowed with env bypass', () => {
    const r = runGit('stash', { env: { GIT_ALLOW_DANGEROUS: '1' } });
    expect(r.stderr).not.toContain('[git-guardrails] BLOCKED');
  });

  test('git reset --hard allowed with env bypass', () => {
    const r = runGit('reset --hard', { env: { GIT_ALLOW_DANGEROUS: '1' } });
    expect(r.stderr).not.toContain('[git-guardrails] BLOCKED');
  });
});
