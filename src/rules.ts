import { requiresAtomicCommit, ATOMIC_COMMIT_REASON } from './atomic-commit.ts';

export interface DangerousRule {
  /** Git subcommand to match (first positional arg) */
  subcommand: string;
  /** Function that checks remaining args. Return true = blocked. */
  match: (args: string[]) => boolean;
  /** Human-readable reason shown when blocked */
  reason: string;
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
    subcommand: 'stash',
    match: always,
    reason: 'git stash can lose uncommitted work when used by automated agents',
  },
  {
    subcommand: 'reset',
    match: hasFlag('--hard'),
    reason: 'git reset --hard permanently discards uncommitted changes',
  },
  {
    subcommand: 'checkout',
    match: hasFileRestore,
    reason: 'git checkout with file paths discards uncommitted changes',
  },
  {
    subcommand: 'clean',
    match: (args) => args.some((a) => a.startsWith('-') && a.includes('f')),
    reason: 'git clean with -f permanently deletes untracked files',
  },
  {
    subcommand: 'push',
    match: hasFlag('--force', '-f', '--force-with-lease'),
    reason: 'git push --force can overwrite remote history',
  },
  {
    subcommand: 'branch',
    match: hasFlag('-D'),
    reason: 'git branch -D force-deletes a branch without merge check',
  },
  {
    subcommand: 'restore',
    match: always,
    reason:
      'git restore discards working tree or index changes; path-specific restores bypassed the old .-only rule',
  },
  {
    subcommand: 'rebase',
    match: always,
    reason: 'git rebase rewrites commit history',
  },

  // Atomic-commit enforcement (active only when git-atomic-commit is installed)
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
