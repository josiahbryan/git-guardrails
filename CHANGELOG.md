# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.7.2] - 2026-06-21

### Fixed

- **Installers now replace the wrapper atomically**, fixing a macOS `killed: 9` (exit 137) that made the freshly-installed `git` unrunnable. Overwriting the Mach-O in place (`cp` over the dest, or a cross-filesystem `mv` from `$TMPDIR` in the remote installer) reuses the destination inode, so the kernel keeps validating the new bytes against the previous binary's cached code-signature (cdhash) and AMFI kills every exec until the cache evicts. Both `scripts/install.sh` and `scripts/install-remote.sh` now stage a temp file inside the install directory and rename it onto `git` — a new inode (clean signature check) installed atomically (no half-written `git` on PATH). The wrapper binary itself is unchanged from 1.7.1.

## [1.7.1] - 2026-06-21

### Fixed

- **BLOCKED diagnostics now shell-quote the reconstructed command** (new `src/shell-quote.ts`). Previously the `Command:` line joined argv with bare spaces, so a multi-line `-m "<msg>"` value bled across lines and a trailing `-- <pathspec>` looked glued to the end of the message body — misleading operators (and agents) into thinking the pathspec had been mangled into the commit message. A multi-line message now renders as a single quoted token and the pathspec stands as its own token; the line is copy-paste-able back into a shell.
- **Clarified the git-atomic-commit enforcement message.** It now states that partial / explicit-pathspec commits (the `git commit -- <pathspec>` form) are supported via `git-atomic-commit commit -f <files>` — which commits only those files and preserves any other staged changes — and that `--no-verify` is available. The block itself is intentional: `commit -f` is race-safe and index-isolated, unlike a raw partial commit routed through the shared index.

## [1.7.0] - 2026-06-19

### Added

- **Block new-branch creation in the main worktree.** Three new rules stop agents (and people) from spawning branches on a shared main checkout, which disrupts other agents/sessions using that same working tree:
  - `git branch <newname>` (create form)
  - `git checkout -b` / `-B` / `--orphan`
  - `git switch -c` / `-C` / `--create` / `--orphan`

  The rules are **universal**, not agent-only: an audit of the running agent fleet showed agents are spawned without `GIT_GUARDRAILS_AGENT_MODE` and without an agent-pattern author email, so they are indistinguishable from a human to the wrapper — an `agentOnly` rule would never fire for them. All three are `allowedInLinkedWorktree`, so the intended workflow (`git worktree add ../wt -b feature`) is pushed into worktrees rather than forbidden. A human who genuinely needs a raw branch in the main tree uses `GIT_ALLOW_DANGEROUS=1`. The block message points at `git worktree add` and never mentions the bypass.
- Bundle-aware short-flag detection (`shortFlagChars`): git accepts packed short flags (e.g. `git checkout -qb foo` creates branch `foo`), so the new matchers — and the existing `git branch -D` force-delete rule — now look *inside* a `-xyz` bundle instead of comparing the whole token. Non-create forms (`git branch` list / `-d` / `-m` / `-a` / `-v`, switching to an existing branch, `--set-upstream-to=...`) stay allowed.

### Fixed

- **Test isolation:** `tests/integration.test.ts` ran `git stash` / `git reset --hard` with `GIT_ALLOW_DANGEROUS=1` and `cwd` set to the project checkout, so a full `bun test` could wipe uncommitted changes in the working tree. The destructive bypass tests (and all other integration cases) now run inside a disposable temporary repo created in `beforeAll` and removed in `afterAll`.

## [1.6.1] - 2026-05-21

### Fixed

- Split the agent-mode protected-branch push rule into canonical-allow / bypass-block behavior. Ops-agent runs may now use canonical push forms (`git push`, `git push origin develop`, `git push origin HEAD:develop`, `git push origin develop:develop`, and the same for `main`/`master`/`production`) while still blocking bypass refspecs like `git push origin agent-fix:develop` and protected branch deletes like `git push origin :develop`.

## [1.6.0] - 2026-05-17

### Added

- **Identity-injection plugin contract** (new `src/plugin.ts`). When `GIT_GUARDRAILS_IDENTITY_PLUGIN` is set to the path of an executable script, the wrapper invokes that script BEFORE exec'ing real git for any commit-creating subcommand (`commit` / `cherry-pick` / `revert` / `merge` / `rebase`). The plugin emits `KEY=VALUE` lines on stdout. `COMMIT_TRAILER=<value>` lines are translated into `--trailer "<value>"` args injected into the git argv (with `-c trailer.ifExists=addIfDifferentNeighbor` prepended once so rebase replays don't accumulate duplicates). Every other `KEY=VALUE` line is exported into the env passed to the real-git exec (so plugins can override `GIT_COMMITTER_NAME`/`GIT_COMMITTER_EMAIL`/`GIT_AUTHOR_*`/anything else). The plugin contract is intentionally narrow — stdin-less, no positional args, gets the subcommand via `GIT_GUARDRAILS_SUBCOMMAND` in env. Wrapper imposes a 3-second timeout; plugin failures (non-zero exit, timeout) log a one-line stderr warning and the wrapper proceeds with no injection so a broken plugin can never break git.
- **Plugin-only check** in `src/plugin.ts:shouldRunPlugin` — the plugin is gated on both (a) the env var being set to a path that exists AND (b) the subcommand being one that creates commits. Non-commit verbs (`status`, `log`, `diff`, `fetch`, `push`, …) pay zero plugin overhead.
- **Tests** (`tests/plugin.test.ts`) — 19 cases covering `parsePluginOutput` (empty input, single + multiple `COMMIT_TRAILER`s, env vars only, mixed, malformed lines, embedded `=` in value, whitespace handling), `shouldRunPlugin` (env unset / file missing / non-commit subcommand / undefined / each commit verb), and end-to-end integration (plugin-not-configured pass-through, non-zero exit produces stderr warning, non-commit subcommand never invokes plugin, plugin sees `GIT_GUARDRAILS_SUBCOMMAND` in env).

### Why

The rubber monorepo runs many concurrent Claude/Cursor/Codex sessions, each potentially under a different bc-task. The existing `agent-hooks.ts` already tracks per-session active task IDs in `~/.claude/agent-tasks-state/`. We want commits to carry that linkage so post-hoc commit archaeology can resolve back to the originating session and task, without git-guardrails itself knowing the word "bc-task" exists. The plugin contract is the seam: bc-task ships its own plugin (TTY → session file → active task → emit committer-overrides + a `Co-Authored-By` trailer); git-guardrails consumes the generic `COMMIT_TRAILER=` / `KEY=VALUE` output. Same seam works for any future provenance tooling.

## [1.5.0] - 2026-05-09

### Added

- **Process-bound agent-mode detection** (new `src/agent-detection.ts`). A process is considered to be in "agent mode" when either `GIT_GUARDRAILS_AGENT_MODE=1` is set, or `GIT_AUTHOR_EMAIL` / `GIT_COMMITTER_EMAIL` matches a known agent-identity pattern (currently `^ops-agent@`). Used to gate restrictions that are appropriate for autonomous agents but would over-restrict humans.
- **`agentOnly?` flag on `DangerousRule`** (in `src/rules.ts`) and corresponding check in `src/matcher.ts`. Rules marked `agentOnly: true` apply ONLY when the agent-mode signal is present; humans driving the wrapper interactively are unaffected. Gate is checked AFTER the structural rule match so the cheap env lookup only happens for matched commands.
- **`git checkout --ours/--theirs <path>` is blocked** (universal). Picks one side of a merge conflict, silently discarding the other. No agent should auto-resolve conflicts; humans rarely need this either (most resolutions go via `mergetool` or manual edit).
- **`git merge -X ours/theirs` and `--strategy=ours/theirs` are blocked** (universal). Catches all spellings: `-X ours`, `-Xours`, `--strategy-option=ours`, `--strategy-option ours`, `--strategy=ours`, `-s ours`, `-sours`. Same rationale — silently discards one side of every conflict.
- **`git config user.name`/`user.email` is blocked at default scope** (universal). Writes to the repo (or shared-worktree) config file and silently re-attributes every subsequent commit by every user/process in the entire repo to the new identity. The 2026-05-04 incident in the rubber repo (an ops-agent ran `git config user.email "ops-agent@rubber.ci"` from a worktree, which writes to the SHARED `.git/config` of the main checkout) is the canonical example. Use `GIT_AUTHOR_NAME`/`GIT_AUTHOR_EMAIL`/`GIT_COMMITTER_NAME`/`GIT_COMMITTER_EMAIL` env vars instead — they apply only to the current process tree. `--global` and `--system` writes are explicitly ALLOWED (no worktree-pollution problem); `--unset` / `--unset-all` are always ALLOWED (cleanup, never creates pollution).
- **`git push <refspec>:develop` (and `:main`/`:master`/`:production`) is blocked in agent mode**. Catches `git push origin develop`, `git push origin HEAD:develop`, `git push origin agent-fix:develop`, `git push origin :develop` (delete remote). Closes the bypass-protection pattern where an ops-agent token with admin scope produces "Bypassed rule violations for refs/heads/develop" pushes. Humans pushing develop interactively are unaffected because they're not in agent mode.
- **`git push --no-verify` is blocked in agent mode**. Skips the pre-push hook safety net. Humans sometimes do this legitimately for checkpoint commits; agents must not — the hook chain is part of the only review layer that runs for unattended runs.

### Why

Two separate failure modes from the rubber repo's ops-agent that both trace to "rules in a prompt are not enforcement":

1. The 2026-05-06 incident where an ops-agent merged `origin/develop` into a worktree, resolved every conflict via `git checkout --ours`/programmatic `git show :2:<file>` workarounds, and pushed the merge commit to develop with `--no-verify` (producing GitHub's `Bypassed rule violations for refs/heads/develop` on output). Erased a user commit from origin/develop.
2. The 2026-05-04 incident where an ops-agent ran `git config user.email ops-agent@rubber.ci` from a worktree, which (because worktrees share `.git/config` with the main checkout) silently overwrote the user's repo-local identity for the entire rubber repo and all its worktrees. From that point until 2026-05-09, every commit by every user/process was attributed to "Ops Agent."

Rules 7, 8, and 12 in the rubber `ci-ops` SKILL.md document these as forbidden; this release moves the enforcement from prompt to wrapper.

### Test injection

The agent-mode detection is testable via the standard `GIT_GUARDRAILS_AGENT_MODE` env var. Tests for the new rules live in `tests/matcher.test.ts` (universal rules) and `tests/agent-detection.test.ts` (detection helper). The `_setAtomicCommitInstalled(false)` mock is now used in the matcher test setup so the matcher tests don't false-fail when git-atomic-commit happens to be on PATH.


## [1.3.0] - 2026-04-20

### Added

- **Linked-worktree bypass** — destructive operations whose scope is strictly local to the current working tree (`git reset --hard`, `git checkout .` / `git checkout -- <path>`, `git restore`, `git clean -f`) are now automatically allowed when the wrapper is invoked from inside a linked git worktree (anything created via `git worktree add`). The main worktree still has all guardrails on. This makes throwaway agent sandboxes (best-of-N, experimental branches) ergonomic without loosening protection of the primary checkout.
- Operations whose destructive scope is the shared repo or remote (`git stash`, `git push --force`, `git branch -D`, `git rebase`) remain blocked even inside a linked worktree, because being in a linked worktree does not make those any less destructive.
- `src/worktree.ts` with the detection logic (`git rev-parse --git-dir --git-common-dir` comparison, cached per process) and a new optional `allowedInLinkedWorktree` flag on `DangerousRule` in `src/rules.ts`. Detection is only consulted after a rule has already matched, so non-blocked commands pay zero extra cost.
- `tests/worktree.test.ts` covering unit-level matcher behavior, real-git detection inside an actual `git worktree add`-created worktree, and end-to-end runs of the wrapper itself from inside a linked worktree.
- README section documenting the bypass and a new "Bypassed in linked worktree?" column on the blocked-commands table.

## [1.2.0] - 2026-04-16

### Added

- **Atomic-commit enforcement** — when [`git-atomic-commit`](https://github.com/josiahbryan/git-atomic-commit) is detected on `PATH`, raw `git add` and `git commit` are blocked so all staging + committing goes through the atomic tool. This closes the staging-area race condition where multiple agents working in the same repo can accidentally include each other's files in a commit. The enforcement is fully opt-in: if `git-atomic-commit` is not installed, behavior is unchanged.
- `GIT_ATOMIC_COMMIT=1` env var — set by `git-atomic-commit` itself before it calls real git, so its internal `add`/`commit` calls pass through. Intentionally not documented in any error output (same pattern as `GIT_ALLOW_DANGEROUS`) so agents won't discover and use it to bypass the atomic tool.
- `src/atomic-commit.ts` with the detection logic (`Bun.which('git-atomic-commit')`, cached) and two new `DANGEROUS_RULES` entries wired into `src/rules.ts`.
- README section recommending the pairing and linking to the `git-atomic-commit` one-liner installer.
- `CLAUDE.md` with project architecture, commands, and key design decisions for Claude Code.

## [1.1.0] - 2026-03-24

### Security

- Block **all** `git restore` subcommands. The previous rule only matched when `.` appeared in arguments, so `git restore <path>` could still discard working tree changes (including when run by automated tools).

### Fixed

- **Compiled wrapper argv:** `bun build --compile` can inject a virtual `/$bunfs/...` segment in `process.argv`. The wrapper now strips that segment (and keeps correct handling for `bun run src/index.ts …`) so passthrough commands like `git version` work and block checks see the real subcommand.

### Changed

- **BREAKING:** `git restore --staged` and other `git restore` forms are no longer exempt. To unstage without `git restore`, use `git reset HEAD -- <path>`. To run any blocked command intentionally, use `GIT_ALLOW_DANGEROUS=1` (see README).

### Added

- Integration tests for compiled `dist/git`: `git restore` blocked, `git version` passthrough.
- This changelog.

[Unreleased]: https://github.com/josiahbryan/git-guardrails/compare/v1.3.0...HEAD
[1.3.0]: https://github.com/josiahbryan/git-guardrails/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/josiahbryan/git-guardrails/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/josiahbryan/git-guardrails/compare/v1.0.0...v1.1.0
