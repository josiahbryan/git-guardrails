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
  /** If true, applies only when the process is in agent mode (see agent-detection.ts). */
  agentOnly?: boolean;
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
  // ── Merge-conflict-side-pick rules (universal) ──────────────────
  {
    subcommand: 'checkout',
    match: (args) => args.includes('--ours') || args.includes('--theirs'),
    reason: 'git checkout --ours/--theirs picks one side of a merge conflict, silently discarding the other. Surface the conflict and resolve manually.',
  },
  {
    subcommand: 'merge',
    match: (args) => {
      const sides = new Set(['ours', 'theirs']);
      for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === undefined) continue;
        if (a === '-X' || a === '--strategy-option') {
          const next = args[i + 1];
          if (next && sides.has(next)) return true;
        }
        if (a.startsWith('-X') && a.length > 2 && sides.has(a.slice(2))) return true;
        if (a.startsWith('--strategy-option=') && sides.has(a.slice('--strategy-option='.length))) return true;
        if (a === '-s' || a === '--strategy') {
          const next = args[i + 1];
          if (next && sides.has(next)) return true;
        }
        if (a.startsWith('-s') && a.length > 2 && sides.has(a.slice(2))) return true;
        if (a.startsWith('--strategy=') && sides.has(a.slice('--strategy='.length))) return true;
      }
      return false;
    },
    reason: 'git merge with -X ours/theirs (or --strategy=ours/theirs) silently picks one side for every conflict. Surface conflicts and resolve manually.',
  },

  // ── Identity-pollution rule (universal) ─────────────────────────
  {
    subcommand: 'config',
    match: (args) => {
      if (args.includes('--unset') || args.includes('--unset-all')) return false;
      if (args.includes('--global') || args.includes('--system')) return false;
      return args.some((a) => a === 'user.name' || a === 'user.email');
    },
    reason: 'Setting user.name/user.email via `git config` writes to the repo (or shared) config and pollutes other users committing in the same repo. Use GIT_AUTHOR_NAME/GIT_AUTHOR_EMAIL/GIT_COMMITTER_NAME/GIT_COMMITTER_EMAIL env vars instead. (--global and --system are allowed; --unset is always allowed.)',
  },

  // ── Agent-only rules ────────────────────────────────────────────
  {
    subcommand: 'push',
    match: (args) => {
      const protectedTargets = ['develop', 'main', 'master', 'production'];
      for (const a of args) {
        if (protectedTargets.includes(a)) return true;
        for (const t of protectedTargets) {
          if (a === `:${t}` || a.endsWith(`:${t}`)) return true;
        }
      }
      return false;
    },
    reason: 'Ops-agent runs must not push directly to protected branches (develop / main / master / production). Open a PR instead.',
    agentOnly: true,
  },
  {
    subcommand: 'push',
    match: (args) => args.includes('--no-verify'),
    reason: 'Ops-agent runs must not push with --no-verify. The pre-push hook chain is part of the only review layer that runs for unattended commits.',
    agentOnly: true,
  },
];
