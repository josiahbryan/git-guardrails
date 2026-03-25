import { describe, expect, test } from 'bun:test';
import { execFileSync, execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
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

  test('git restore is blocked (any path)', () => {
    const r = runGit('restore README.md');
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
        cwd: ROOT,
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
      cwd: ROOT,
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
  test('git stash allowed with env bypass', () => {
    const r = runGit('stash', { env: { GIT_ALLOW_DANGEROUS: '1' } });
    expect(r.stderr).not.toContain('[git-guardrails] BLOCKED');
  });

  test('git reset --hard allowed with env bypass', () => {
    const r = runGit('reset --hard', { env: { GIT_ALLOW_DANGEROUS: '1' } });
    expect(r.stderr).not.toContain('[git-guardrails] BLOCKED');
  });
});
