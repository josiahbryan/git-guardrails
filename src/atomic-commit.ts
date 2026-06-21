/**
 * git-atomic-commit enforcement: when the `git-atomic-commit` binary is on
 * PATH, plain `git add` / `git commit` should be blocked so all staging and
 * committing goes through the atomic tool. git-atomic-commit bypasses this
 * guardrail by setting GIT_ATOMIC_COMMIT=1 before invoking real git.
 */

/** Cached result of git-atomic-commit detection (null = not yet checked) */
let _atomicCommitInstalled: boolean | null = null;

/** Check if git-atomic-commit binary is on PATH (result cached after first call) */
export function isAtomicCommitInstalled(): boolean {
  if (_atomicCommitInstalled === null) {
    _atomicCommitInstalled = !!Bun.which('git-atomic-commit');
  }
  return _atomicCommitInstalled;
}

/** Force the cached detection result (for testing) */
export function _setAtomicCommitInstalled(value: boolean): void {
  _atomicCommitInstalled = value;
}

/** Clear the cached detection result so next call re-probes PATH (for testing) */
export function _resetAtomicCommitCache(): void {
  _atomicCommitInstalled = null;
}

/**
 * Match `git add` / `git commit` only when git-atomic-commit is installed
 * AND the current invocation is NOT coming from git-atomic-commit itself.
 */
export const requiresAtomicCommit = (_args: string[]): boolean =>
  isAtomicCommitInstalled() && process.env['GIT_ATOMIC_COMMIT'] !== '1';

export const ATOMIC_COMMIT_REASON =
  'git-atomic-commit is installed — use `git-atomic-commit commit -f <files> -m <msg>` ' +
  'for race-safe staging + commit (add `--no-verify` to skip hooks). ' +
  'This is also the supported way to do a partial / explicit-pathspec commit ' +
  '(the `git commit -- <pathspec>` form): it commits only <files> and preserves ' +
  'any other staged changes, so a concurrent session\'s staging is left intact.';
