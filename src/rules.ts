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

const PROTECTED_BRANCHES = ['develop', 'main', 'master', 'production'];

function isProtectedBranch(branch: string): boolean {
  return PROTECTED_BRANCHES.includes(branch);
}

function isProtectedBranchBypassRefspec(arg: string): boolean {
  // Push options can contain arbitrary values, so only positional refspec-like
  // args participate in this check. The force/no-verify rules handle flags.
  if (arg.startsWith('-')) return false;

  const separatorIndex = arg.indexOf(':');
  if (separatorIndex === -1) return false;

  const source = arg.slice(0, separatorIndex);
  const destination = arg.slice(separatorIndex + 1);
  if (!isProtectedBranch(destination)) return false;

  // A blank source deletes the remote branch. That is a protected-branch bypass,
  // while HEAD:branch and branch:branch are canonical push shapes.
  if (source === '') return true;
  if (source === 'HEAD') return false;
  if (source === destination) return false;

  return true;
}

/**
 * Short-flag characters packed into a single-dash bundle: '-qb' -> 'qb',
 * '-D' -> 'D'. Empty for long flags (`--x`), the bare '-' (stdin / previous
 * branch), and non-flag args. Git accepts bundled short flags (e.g.
 * `checkout -qb foo` creates branch foo), so membership tests must look INSIDE
 * the bundle rather than compare the whole token.
 */
function shortFlagChars(arg: string): string {
  if (arg.length < 2 || arg[0] !== '-' || arg[1] === '-') return '';
  return arg.slice(1).split('=')[0];
}

// Long `git branch` flags meaning the command is NOT creating a fresh branch
// (delete / rename / copy / list / inspect / upstream modes).
const BRANCH_NON_CREATE_LONG = new Set([
  '--delete', '--move', '--copy', '--list', '--all', '--remotes',
  '--show-current', '--edit-description', '--set-upstream-to', '--unset-upstream',
  '--contains', '--no-contains', '--merged', '--no-merged', '--points-at',
  '--sort', '--format', '--color', '--column', '--no-column', '--verbose',
]);
// Short `git branch` flags (bundleable) meaning NOT a create: delete, rename
// (move), copy, list, all, remotes, set-upstream, verbose. Notably absent:
// -t (--track) and -f (--force), which DO create a branch.
const BRANCH_NON_CREATE_SHORT = 'dDmMcClaruv';

/**
 * True if `git branch <args>` is creating a new branch (vs list/delete/rename).
 *
 * Polarity note: `git branch` defaults to CREATE when given a name, so this uses
 * a denylist of non-create flags (fail-closed: an unknown flag + a positional is
 * treated as a create and blocked). checkoutCreatesBranch/switchCreatesBranch use
 * the opposite allowlist because checkout/switch default to navigate, not create.
 */
function branchCreatesBranch(args: string[]): boolean {
  for (const a of args) {
    if (a.startsWith('--')) {
      // Strip '=value' so `--set-upstream-to=origin/main feature` is recognized
      // as a non-create (it retargets an existing branch's upstream).
      const key = a.split('=')[0];
      if (BRANCH_NON_CREATE_LONG.has(key)) return false;
    } else {
      for (const c of shortFlagChars(a)) {
        if (BRANCH_NON_CREATE_SHORT.includes(c)) return false;
      }
    }
  }
  // A fresh branch creation needs a positional name (a non-flag arg). Pure
  // list/inspect forms (`git branch`, `git branch -v`) have no positional, so
  // they are allowed here even when their flags aren't all enumerated above.
  return args.some((a) => !a.startsWith('-'));
}

/** True if `git checkout <args>` creates a branch (`-b`/`-B`, bundled, or --orphan). */
function checkoutCreatesBranch(args: string[]): boolean {
  return args.some((a) => {
    if (a === '--orphan') return true;
    const s = shortFlagChars(a);
    return s.includes('b') || s.includes('B');
  });
}

/** True if `git switch <args>` creates a branch (`-c`/`-C`, bundled, --create, --orphan). */
function switchCreatesBranch(args: string[]): boolean {
  return args.some((a) => {
    if (a === '--create' || a === '--orphan') return true;
    const s = shortFlagChars(a);
    return s.includes('c') || s.includes('C');
  });
}

const NEW_BRANCH_REASON =
  'Creating a branch in the main worktree disrupts other agents sharing it. ' +
  'Use a linked worktree instead: `git worktree add ../<name> -b <branch>`. ' +
  '(Branch creation is allowed inside linked worktrees.)';

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
    // Catch bundled short flags too (e.g. `-Dv`) so the create rule below
    // doesn't claim the command with a misleading "creating a branch" message.
    subcommand: 'branch',
    match: (args) => args.some((a) => shortFlagChars(a).includes('D')),
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

  // ── New-branch creation in the main worktree (universal) ────────
  // Blocked for EVERYONE, not just agents: agents spawned via the grid look
  // identical to a human in their env (no GIT_GUARDRAILS_AGENT_MODE, no
  // agent-pattern author email — confirmed by audit), so an agentOnly rule
  // would never fire for them. Bypassed inside linked worktrees — the point
  // is to push branch work into worktrees, not forbid it. A human who really
  // needs a raw branch in the main tree uses GIT_ALLOW_DANGEROUS=1.
  {
    subcommand: 'branch',
    match: branchCreatesBranch,
    reason: NEW_BRANCH_REASON,
    allowedInLinkedWorktree: true,
  },
  {
    // -B/--orphan (and -C below) also reset/orphan an EXISTING branch; we treat
    // that as "creation" too — it still mutates the shared main worktree.
    subcommand: 'checkout',
    match: checkoutCreatesBranch,
    reason: NEW_BRANCH_REASON,
    allowedInLinkedWorktree: true,
  },
  {
    subcommand: 'switch',
    match: switchCreatesBranch,
    reason: NEW_BRANCH_REASON,
    allowedInLinkedWorktree: true,
  },

  // ── Agent-only rules ────────────────────────────────────────────
  {
    subcommand: 'push',
    match: (args) => args.some(isProtectedBranchBypassRefspec),
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
