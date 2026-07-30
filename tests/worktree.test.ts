import { afterEach, describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { execFileSync, execSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkCommand } from '../src/matcher.ts';
import {
  _setInLinkedWorktree,
  _resetWorktreeCache,
  _setCurrentBranchForTest,
  isInLinkedWorktree,
} from '../src/worktree.ts';

// ---------------------------------------------------------------------------
// Unit tests — matcher behavior with worktree detection mocked.
// ---------------------------------------------------------------------------

describe('linked-worktree bypass (unit)', () => {
  afterEach(() => {
    _resetWorktreeCache();
    _setCurrentBranchForTest(null);
  });

  // Rules marked `allowedInLinkedWorktree: true` → should be allowed in a
  // linked worktree, still blocked elsewhere.
  const localScope = [
    { args: ['reset', '--hard'], desc: 'git reset --hard' },
    { args: ['reset', '--hard', 'HEAD~2'], desc: 'git reset --hard HEAD~2' },
    { args: ['checkout', '.'], desc: 'git checkout .' },
    { args: ['checkout', '--', 'file.txt'], desc: 'git checkout -- file.txt' },
    { args: ['clean', '-f'], desc: 'git clean -f' },
    { args: ['clean', '-fdx'], desc: 'git clean -fdx' },
    { args: ['restore', '.'], desc: 'git restore .' },
    { args: ['restore', 'src/index.ts'], desc: 'git restore <file>' },
    { args: ['restore', '--staged', 'file.txt'], desc: 'git restore --staged' },
  ];

  for (const { args, desc } of localScope) {
    test(`ALLOWS in linked worktree: ${desc}`, () => {
      _setInLinkedWorktree(true);
      expect(checkCommand(args).blocked).toBe(false);
    });

    test(`BLOCKS in main worktree: ${desc}`, () => {
      _setInLinkedWorktree(false);
      expect(checkCommand(args).blocked).toBe(true);
    });
  }

  // Rules WITHOUT the flag → still blocked even in a linked worktree, because
  // their destructive scope is the shared repo or remote.
  const sharedScope = [
    { args: ['stash'], desc: 'git stash' },
    { args: ['stash', 'pop'], desc: 'git stash pop' },
    { args: ['push', '--force'], desc: 'git push --force' },
    { args: ['push', '-f'], desc: 'git push -f' },
    { args: ['push', '--force-with-lease'], desc: 'git push --force-with-lease' },
    { args: ['branch', '-D', 'feature'], desc: 'git branch -D feature' },
    { args: ['rebase', 'main'], desc: 'git rebase main' },
  ];

  for (const { args, desc } of sharedScope) {
    test(`STILL BLOCKS in linked worktree: ${desc}`, () => {
      _setInLinkedWorktree(true);
      expect(checkCommand(args).blocked).toBe(true);
    });
  }

  test('non-matching commands still pass through unchanged in linked worktree', () => {
    _setInLinkedWorktree(true);
    expect(checkCommand(['status']).blocked).toBe(false);
    expect(checkCommand(['log']).blocked).toBe(false);
    // `push` with no refspec resolves to the current branch (see the
    // worktree-scoped protected-branch push rule in matcher.test.ts) — pin it
    // to a non-protected name here since this test is about generic
    // passthrough, not push-target protection.
    _setCurrentBranchForTest('feature-branch');
    expect(checkCommand(['push']).blocked).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Real git integration: build an actual linked worktree with real git and
// verify isInLinkedWorktree() returns the right answer from inside it.
//
// This is the load-bearing test — it proves our `--git-dir` vs
// `--git-common-dir` comparison actually matches what real git considers a
// linked worktree.
// ---------------------------------------------------------------------------

describe('linked-worktree detection (real git)', () => {
  let tmpRoot: string;
  let mainRepo: string;
  let linkedWT: string;
  let realGitAvailable = false;

  beforeAll(() => {
    // Skip the whole block if /usr/bin/git isn't there (e.g. Linux without it)
    try {
      execFileSync('/usr/bin/git', ['--version'], { stdio: 'ignore' });
      realGitAvailable = true;
    } catch {
      return;
    }

    tmpRoot = mkdtempSync(join(tmpdir(), 'git-guardrails-wt-'));
    mainRepo = join(tmpRoot, 'main');
    linkedWT = join(tmpRoot, 'linked');

    const run = (cwd: string, cmd: string) => {
      execSync(cmd, { cwd, stdio: 'ignore' });
    };

    // Build a minimal repo with one commit, then a linked worktree on a
    // second branch. We need at least one commit before `worktree add`.
    run(tmpRoot, `/usr/bin/git init -q "${mainRepo}"`);
    run(mainRepo, '/usr/bin/git config user.email test@example.com');
    run(mainRepo, '/usr/bin/git config user.name test');
    run(mainRepo, '/usr/bin/git commit -q --allow-empty -m init');
    run(mainRepo, `/usr/bin/git worktree add -q -b feature "${linkedWT}"`);
  });

  afterAll(() => {
    if (tmpRoot && existsSync(tmpRoot)) {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    _resetWorktreeCache();
  });

  test('returns false in the main worktree', () => {
    if (!realGitAvailable) return;
    const origCwd = process.cwd();
    try {
      process.chdir(mainRepo);
      _resetWorktreeCache();
      expect(isInLinkedWorktree()).toBe(false);
    } finally {
      process.chdir(origCwd);
    }
  });

  test('returns true in a linked worktree', () => {
    if (!realGitAvailable) return;
    const origCwd = process.cwd();
    try {
      process.chdir(linkedWT);
      _resetWorktreeCache();
      expect(isInLinkedWorktree()).toBe(true);
    } finally {
      process.chdir(origCwd);
    }
  });

  test('returns false when not inside any git repo', () => {
    if (!realGitAvailable) return;
    const origCwd = process.cwd();
    try {
      process.chdir(tmpdir());
      _resetWorktreeCache();
      // No repo here — rev-parse fails — we conservatively return false.
      expect(isInLinkedWorktree()).toBe(false);
    } finally {
      process.chdir(origCwd);
    }
  });
});

// ---------------------------------------------------------------------------
// End-to-end: run the actual wrapper binary inside a real linked worktree and
// verify `reset --hard` is allowed there while `push --force` still blocks.
// ---------------------------------------------------------------------------

const ROOT = join(import.meta.dir, '..');
const ENTRY = join(ROOT, 'src/index.ts');

describe('linked-worktree bypass (integration)', () => {
  let tmpRoot: string;
  let mainRepo: string;
  let linkedWT: string;
  let realGitAvailable = false;

  beforeAll(() => {
    try {
      execFileSync('/usr/bin/git', ['--version'], { stdio: 'ignore' });
      realGitAvailable = true;
    } catch {
      return;
    }

    tmpRoot = mkdtempSync(join(tmpdir(), 'git-guardrails-wt-int-'));
    mainRepo = join(tmpRoot, 'main');
    linkedWT = join(tmpRoot, 'linked');

    const run = (cwd: string, cmd: string) => {
      execSync(cmd, { cwd, stdio: 'ignore' });
    };

    run(tmpRoot, `/usr/bin/git init -q "${mainRepo}"`);
    run(mainRepo, '/usr/bin/git config user.email test@example.com');
    run(mainRepo, '/usr/bin/git config user.name test');
    run(mainRepo, '/usr/bin/git commit -q --allow-empty -m init');
    run(mainRepo, `/usr/bin/git worktree add -q -b feature "${linkedWT}"`);
  });

  afterAll(() => {
    if (tmpRoot && existsSync(tmpRoot)) {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  function runWrapper(cwd: string, args: string): {
    stderr: string;
    exitCode: number;
  } {
    try {
      execSync(`bun run ${ENTRY} ${args}`, {
        cwd,
        encoding: 'utf-8',
        env: { ...process.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return { stderr: '', exitCode: 0 };
    } catch (err: unknown) {
      const e = err as { stderr?: string; status?: number };
      return { stderr: e.stderr ?? '', exitCode: e.status ?? 1 };
    }
  }

  test('git reset --hard is ALLOWED inside a linked worktree', () => {
    if (!realGitAvailable) return;
    const r = runWrapper(linkedWT, 'reset --hard HEAD');
    // Must not be blocked by guardrails — it may still fail for other
    // reasons, but never with the guardrails banner.
    expect(r.stderr).not.toContain('[git-guardrails] BLOCKED');
  });

  test('git reset --hard is BLOCKED inside the main worktree', () => {
    if (!realGitAvailable) return;
    const r = runWrapper(mainRepo, 'reset --hard HEAD');
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toContain('[git-guardrails] BLOCKED');
  });

  test('git push --force is STILL BLOCKED inside a linked worktree', () => {
    if (!realGitAvailable) return;
    const r = runWrapper(linkedWT, 'push --force');
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toContain('[git-guardrails] BLOCKED');
  });

  test('git rebase is STILL BLOCKED inside a linked worktree', () => {
    if (!realGitAvailable) return;
    const r = runWrapper(linkedWT, 'rebase main');
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toContain('[git-guardrails] BLOCKED');
  });

  test('git stash is STILL BLOCKED inside a linked worktree', () => {
    if (!realGitAvailable) return;
    const r = runWrapper(linkedWT, 'stash');
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toContain('[git-guardrails] BLOCKED');
  });
});
