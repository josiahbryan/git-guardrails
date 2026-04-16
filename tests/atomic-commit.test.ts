import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { checkCommand } from '../src/matcher.ts';
import {
  _resetAtomicCommitCache,
  _setAtomicCommitInstalled,
} from '../src/atomic-commit.ts';

// ---------------------------------------------------------------------------
// Unit tests — direct on checkCommand()
// ---------------------------------------------------------------------------

describe('atomic commit enforcement (unit)', () => {
  const origEnv = process.env['GIT_ATOMIC_COMMIT'];

  afterEach(() => {
    _resetAtomicCommitCache();
    if (origEnv === undefined) {
      delete process.env['GIT_ATOMIC_COMMIT'];
    } else {
      process.env['GIT_ATOMIC_COMMIT'] = origEnv;
    }
  });

  test('BLOCKS: git add when git-atomic-commit is installed', () => {
    _setAtomicCommitInstalled(true);
    delete process.env['GIT_ATOMIC_COMMIT'];
    const result = checkCommand(['add', 'file.txt']);
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain('git-atomic-commit');
  });

  test('BLOCKS: git add -A when git-atomic-commit is installed', () => {
    _setAtomicCommitInstalled(true);
    delete process.env['GIT_ATOMIC_COMMIT'];
    expect(checkCommand(['add', '-A']).blocked).toBe(true);
  });

  test('BLOCKS: git commit when git-atomic-commit is installed', () => {
    _setAtomicCommitInstalled(true);
    delete process.env['GIT_ATOMIC_COMMIT'];
    const result = checkCommand(['commit', '-m', 'msg']);
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain('git-atomic-commit');
  });

  test('BLOCKS: git commit --amend when git-atomic-commit is installed', () => {
    _setAtomicCommitInstalled(true);
    delete process.env['GIT_ATOMIC_COMMIT'];
    expect(checkCommand(['commit', '--amend']).blocked).toBe(true);
  });

  test('ALLOWS: git add when GIT_ATOMIC_COMMIT=1', () => {
    _setAtomicCommitInstalled(true);
    process.env['GIT_ATOMIC_COMMIT'] = '1';
    expect(checkCommand(['add', 'file.txt']).blocked).toBe(false);
  });

  test('ALLOWS: git commit when GIT_ATOMIC_COMMIT=1', () => {
    _setAtomicCommitInstalled(true);
    process.env['GIT_ATOMIC_COMMIT'] = '1';
    expect(checkCommand(['commit', '-m', 'msg']).blocked).toBe(false);
  });

  test('ALLOWS: git add when git-atomic-commit not installed', () => {
    _setAtomicCommitInstalled(false);
    delete process.env['GIT_ATOMIC_COMMIT'];
    expect(checkCommand(['add', 'file.txt']).blocked).toBe(false);
  });

  test('ALLOWS: git commit when git-atomic-commit not installed', () => {
    _setAtomicCommitInstalled(false);
    delete process.env['GIT_ATOMIC_COMMIT'];
    expect(checkCommand(['commit', '-m', 'msg']).blocked).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Integration tests — spawn the wrapper in a subprocess
// ---------------------------------------------------------------------------

const ROOT = join(import.meta.dir, '..');
const ENTRY = join(ROOT, 'src/index.ts');

/** Build a clean env that strips GIT_ATOMIC_COMMIT unless explicitly set */
function cleanEnv(overrides: Record<string, string> = {}): Record<string, string> {
  const base = { ...process.env } as Record<string, string>;
  delete base['GIT_ATOMIC_COMMIT'];
  return { ...base, ...overrides };
}

function runGit(args: string, envOverride: Record<string, string> = {}): {
  stderr: string;
  exitCode: number;
} {
  try {
    execSync(`bun run ${ENTRY} ${args}`, {
      cwd: ROOT,
      encoding: 'utf-8',
      env: cleanEnv(envOverride),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { stderr: '', exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stderr?: string; status?: number };
    return { stderr: e.stderr ?? '', exitCode: e.status ?? 1 };
  }
}

describe('atomic commit enforcement (integration)', () => {
  let atomicInstalled = false;
  try {
    execSync('which git-atomic-commit', { stdio: 'pipe' });
    atomicInstalled = true;
  } catch {
    /* not installed on this machine */
  }

  // Belt & suspenders: ensure no leak from earlier unit tests in this run
  beforeEach(() => {
    delete process.env['GIT_ATOMIC_COMMIT'];
  });

  if (atomicInstalled) {
    test('git add is blocked when git-atomic-commit is installed', () => {
      const r = runGit('add --dry-run .');
      expect(r.exitCode).not.toBe(0);
      expect(r.stderr).toContain('[git-guardrails] BLOCKED');
      expect(r.stderr).toContain('git-atomic-commit');
    });

    test('git commit is blocked when git-atomic-commit is installed', () => {
      const r = runGit('commit --dry-run -m "test"');
      expect(r.exitCode).not.toBe(0);
      expect(r.stderr).toContain('[git-guardrails] BLOCKED');
    });

    test('git add allowed with GIT_ATOMIC_COMMIT=1 bypass', () => {
      const r = runGit('add --dry-run .', { GIT_ATOMIC_COMMIT: '1' });
      expect(r.stderr).not.toContain('[git-guardrails] BLOCKED');
    });

    test('git commit allowed with GIT_ATOMIC_COMMIT=1 bypass', () => {
      const r = runGit('commit --dry-run -m "test"', { GIT_ATOMIC_COMMIT: '1' });
      expect(r.stderr).not.toContain('[git-guardrails] BLOCKED');
    });

    test('git add allowed with GIT_ALLOW_DANGEROUS=1 bypass', () => {
      const r = runGit('add --dry-run .', { GIT_ALLOW_DANGEROUS: '1' });
      expect(r.stderr).not.toContain('[git-guardrails] BLOCKED');
    });
  } else {
    test('git add allowed when git-atomic-commit not installed', () => {
      const r = runGit('add --dry-run .');
      expect(r.stderr).not.toContain('[git-guardrails] BLOCKED');
    });

    test('git commit allowed when git-atomic-commit not installed', () => {
      const r = runGit('commit --dry-run -m "test"');
      expect(r.stderr).not.toContain('[git-guardrails] BLOCKED');
    });
  }
});
