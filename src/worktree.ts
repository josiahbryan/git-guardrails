/**
 * Linked git worktree detection.
 *
 * A "linked worktree" is one created via `git worktree add`. Git stores its
 * per-worktree state under `<common-dir>/worktrees/<name>`, so inside a linked
 * worktree `rev-parse --git-dir` points at that subdirectory while
 * `rev-parse --git-common-dir` still points at the main `.git`. In the main
 * worktree the two are always equal. That inequality is the canonical signal
 * git itself uses internally and is what we rely on here.
 *
 * Why we care: operations that are scoped to the current working tree
 * (`reset --hard`, `checkout .`, `restore`, `clean -f`) only destroy work in
 * that one worktree, so users who deliberately run agents in throwaway
 * worktrees can opt into letting those through. Operations whose scope is the
 * shared repo or remote (`push --force`, `branch -D`, `rebase`, `stash`)
 * remain blocked — being in a linked worktree does not make them safer.
 */

import { execFileSync } from 'node:child_process';

/**
 * Always call the real git binary here, never the wrapper, to avoid recursion.
 * Matches REAL_GIT in src/index.ts.
 */
const REAL_GIT = '/usr/bin/git';

/** Cached result of linked-worktree detection (null = not yet checked). */
let _inLinkedWorktree: boolean | null = null;

/**
 * Returns true iff the current working directory is inside a linked git
 * worktree (as opposed to the main worktree or not inside a git repo at all).
 *
 * Result is cached for the process lifetime — we only ever run one git
 * command per guardrail process, so a single check is sufficient.
 *
 * Any failure (not in a repo, git binary missing, permission error, etc.) is
 * conservatively treated as "not in a linked worktree" so guardrails stay on.
 */
export function isInLinkedWorktree(): boolean {
  if (_inLinkedWorktree !== null) return _inLinkedWorktree;
  _inLinkedWorktree = detectLinkedWorktree();
  return _inLinkedWorktree;
}

function detectLinkedWorktree(): boolean {
  try {
    // Ask git for both paths in one invocation. Output is two lines:
    //   <git-dir>
    //   <git-common-dir>
    // In the main worktree these are equal; in a linked worktree they differ.
    const out = execFileSync(
      REAL_GIT,
      ['rev-parse', '--git-dir', '--git-common-dir'],
      {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }
    );
    const lines = out.trim().split('\n');
    const gitDir = lines[0];
    const commonDir = lines[1];
    if (!gitDir || !commonDir) return false;
    return gitDir !== commonDir;
  } catch {
    return false;
  }
}

/** Force the cached detection result (for testing). */
export function _setInLinkedWorktree(value: boolean): void {
  _inLinkedWorktree = value;
}

/** Clear the cached detection result so next call re-probes (for testing). */
export function _resetWorktreeCache(): void {
  _inLinkedWorktree = null;
}
