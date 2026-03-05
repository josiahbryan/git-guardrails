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
    match: hasFlag('-f', '-fd', '-fx', '-fxd', '-xfd', '-df', '-xf'),
    reason: 'git clean -f permanently deletes untracked files',
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
    match: (args) => args.includes('.'),
    reason: 'git restore . discards all uncommitted changes',
  },
  {
    subcommand: 'rebase',
    match: always,
    reason: 'git rebase rewrites commit history',
  },
];
