import { requiresAtomicCommit, ATOMIC_COMMIT_REASON } from './atomic-commit.ts';

export interface DangerousRule {
  /** Git subcommand to match (first positional arg) */
  subcommand: string;
  /** Function that checks remaining args. Return true = blocked. */
  match: (args: string[]) => boolean;
  /** Human-readable reason shown when blocked */
  reason: string;
  /**
   * If true, this rule is bypassed when the process is running inside a
   * linked git worktree (see src/worktree.ts). Set this only for operations
   * whose destructive scope is strictly local to the current working tree —
   * e.g. `reset --hard`, `checkout .`, `restore`, `clean -f`. Do NOT set this
   * for operations whose scope is the shared repo or remote (force-push,
   * branch -D, rebase, stash), because being in a linked worktree does not
   * make those any less destructive.
   */
  allowedInLinkedWorktree?: boolean;
}

/** Always match — any invocation of this subcommand is dangerous */
const always = (_args: string[]): boolean => true;

/** Match if any arg matches one of the given patterns */
const hasFlag = (...flags: string[]) => (args: string[]): boolean =>
  args.some((a) => flags.includes(a));

/** Match if args contain "--" or "." indicating file restore */
const hasFileRestore = (args: string[]): boolean =>
  args.includes('.') || args.includes('--');

export const DANGEROUS_RULES: DangerousRule[] = [
  {
    // Stash stack lives in the shared common-dir (.git/stash), so stashes
    // created in a linked worktree affect the whole repo. Not worktree-local.
    subcommand: 'stash',
    match: always,
    reason: 'git stash can lose uncommitted work when used by automated agents',
  },
  {
    // `reset --hard` only touches the current worktree's HEAD and files.
    // Safe to allow inside a linked (throwaway) worktree.
    subcommand: 'reset',
    match: hasFlag('--hard'),
    reason: 'git reset --hard permanently discards uncommitted changes',
    allowedInLinkedWorktree: true,
  },
  {
    // Path-form checkout only discards files in the current worktree.
    subcommand: 'checkout',
    match: hasFileRestore,
    reason: 'git checkout with file paths discards uncommitted changes',
    allowedInLinkedWorktree: true,
  },
  {
    // `clean -f` only deletes untracked files under the current worktree.
    subcommand: 'clean',
    match: (args) => args.some((a) => a.startsWith('-') && a.includes('f')),
    reason: 'git clean with -f permanently deletes untracked files',
    allowedInLinkedWorktree: true,
  },
  {
    // Force-push affects the remote; same blast radius from any worktree.
    subcommand: 'push',
    match: hasFlag('--force', '-f', '--force-with-lease'),
    reason: 'git push --force can overwrite remote history',
  },
  {
    // Branches live in shared refs; deleting them is repo-wide, not local.
    subcommand: 'branch',
    match: hasFlag('-D'),
    reason: 'git branch -D force-deletes a branch without merge check',
  },
  {
    // `restore` only affects the current worktree's files / index.
    subcommand: 'restore',
    match: always,
    reason:
      'git restore discards working tree or index changes; path-specific restores bypassed the old .-only rule',
    allowedInLinkedWorktree: true,
  },
  {
    // Rebase rewrites the branch's history, which is shared across worktrees
    // and with anyone who has pulled the branch. Not worktree-local.
    subcommand: 'rebase',
    match: always,
    reason: 'git rebase rewrites commit history',
  },

  // Atomic-commit enforcement (active only when git-atomic-commit is installed).
  // This is a workflow guardrail, not a destructive-op guardrail, so the
  // worktree bypass intentionally does not apply here.
  {
    subcommand: 'add',
    match: requiresAtomicCommit,
    reason: ATOMIC_COMMIT_REASON,
  },
  {
    subcommand: 'commit',
    match: requiresAtomicCommit,
    reason: ATOMIC_COMMIT_REASON,
  },
];
