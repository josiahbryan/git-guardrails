# git-guardrails

A compiled git wrapper that blocks dangerous git commands from being executed — particularly by AI coding agents (Claude Code, Cursor, Copilot, etc.) that tend to run destructive operations like `git stash`, `git reset --hard`, and `git checkout .` without asking.


## Quickstart

### Option A: One-liner install (pre-built binary, no dependencies)

```bash
curl -fsSL https://raw.githubusercontent.com/josiahbryan/git-guardrails/main/scripts/install-remote.sh | bash
```

This auto-detects your OS and architecture, downloads the correct binary from GitHub Releases, and installs it. No Bun, Node, or build tools needed.

### Option B: Build from source

```bash
# Requires Bun (https://bun.sh)
git clone https://github.com/josiahbryan/git-guardrails.git
cd git-guardrails
bun install && bun run build && bash scripts/install.sh
```

### Verify

```bash
git status          # works normally
git stash           # BLOCKED
```

That's it. Every `git` call on your system now goes through the guardrails.

## Why This Exists

AI coding agents run as subprocesses with full shell access. They frequently:

- Run `git stash` and forget to pop, losing uncommitted work
- Run `git checkout .` or `git restore .` to "clean up", discarding your changes
- Run `git reset --hard` to resolve merge conflicts, destroying work in progress
- Force-push to remote branches, overwriting shared history
- Run `git rebase` without understanding the implications
- Run `git clean -f` to remove untracked files they don't recognize

These operations are often irreversible. The agent doesn't ask permission — it just does it. This project prevents that by intercepting every `git` call system-wide.

## How It Works

A Bun-compiled TypeScript binary is placed at `/opt/homebrew/bin/git`, which comes before `/usr/bin/git` in the macOS PATH. Every `git` invocation hits the wrapper first:

1. The wrapper parses the git subcommand and flags
2. It checks against a blocklist of dangerous command patterns
3. **If blocked:** prints a red error to stderr and exits with code 128
4. **If allowed:** transparently execs the real `/usr/bin/git` with the original arguments

The real git binary at `/usr/bin/git` is never moved or modified. The wrapper simply shadows it via PATH ordering.

```
┌───────────────────┐     ┌─────────────────────────┐     ┌──────────────┐
│  Any git caller   │────>│  /opt/homebrew/bin/git  │────>│ /usr/bin/git │
│  (agent, shell,   │     │  (guardrails wrapper)   │     │ (real git)   │
│   IDE, CI, etc.)  │     │                         │     │              │
└───────────────────┘     │  blocked? -> exit 128   │     └──────────────┘
                          │  allowed? -> exec real  │
                          └─────────────────────────┘
```

### Why PATH Shadowing Instead of Moving the Binary

macOS System Integrity Protection (SIP) prevents modifying `/usr/bin/` — you cannot move, rename, or replace `/usr/bin/git`. PATH shadowing is the standard workaround: place the wrapper in a directory that appears earlier in `$PATH` (like `/opt/homebrew/bin/`), so it gets resolved first.

### Why a Compiled Binary

The wrapper is compiled with `bun build --compile` into a native Mach-O binary. This means:

- **Near-zero overhead** — no runtime startup cost, no interpreter to load
- **No dependencies** — the binary is fully self-contained
- **Works everywhere** — no need for Bun, Node, or any runtime to be installed

## Blocked Commands

| Command | Reason |
|---------|--------|
| `git stash` (all variants) | Can lose uncommitted work when agents forget to pop |
| `git reset --hard` | Permanently discards uncommitted changes |
| `git checkout .` / `git checkout -- <file>` | Discards uncommitted changes to files |
| `git clean -f` (any flag containing `-f`) | Permanently deletes untracked files |
| `git push --force` / `-f` / `--force-with-lease` | Can overwrite remote history |
| `git branch -D` | Force-deletes a branch without merge check |
| `git restore` (all variants) | Discards working tree and/or index changes; path-specific restores bypassed a `.`-only rule |
| `git rebase` (all variants) | Rewrites commit history |

### What's NOT Blocked

Normal everyday git operations pass through transparently:

- `git status`, `git log`, `git diff`
- `git add`, `git commit`, `git push` (without `--force`)
- `git pull`, `git fetch`, `git merge`
- `git checkout <branch>`, `git checkout -b <branch>` (branch switching)
- `git branch <name>`, `git branch -d <name>` (safe delete)
- `git reset HEAD~1` (soft reset, without `--hard`)
- `git reset HEAD -- <file>` (unstage paths without using `git restore`)
- `git tag`, `git remote`, `git config`

## Installation

### Pre-built binary (recommended)

No build tools required. The install script auto-detects your platform:

```bash
curl -fsSL https://raw.githubusercontent.com/josiahbryan/git-guardrails/main/scripts/install-remote.sh | bash
```

**Supported platforms:**

| Platform | Architecture |
|----------|-------------|
| macOS | Apple Silicon (M1/M2/M3/M4) |
| macOS | Intel x86_64 |
| Linux | x86_64 |
| Linux | ARM64 / aarch64 |

**Where it installs:**
- macOS with Homebrew: `/opt/homebrew/bin/git` (Apple Silicon) or `/usr/local/bin/git` (Intel)
- Linux: `/usr/local/bin/git` (may prompt for sudo)

The install directory must appear before `/usr/bin` in your `$PATH` so the wrapper shadows the real git.

### Build from source

Requires [Bun](https://bun.sh/) v1.0+:

```bash
git clone https://github.com/josiahbryan/git-guardrails.git
cd git-guardrails
bun install
bun run build
bash scripts/install.sh
```

### Verify

```bash
# Confirm the wrapper is active
which git
# Expected: /opt/homebrew/bin/git (or /usr/local/bin/git)

# Safe commands work normally
git status
git log --oneline -5

# Dangerous commands are blocked
git stash          # BLOCKED
git reset --hard   # BLOCKED
git checkout .     # BLOCKED
git push --force   # BLOCKED
git clean -f       # BLOCKED
git restore .      # BLOCKED
```

### Uninstall

```bash
# If installed from source:
bash scripts/uninstall.sh

# If installed via curl:
rm /opt/homebrew/bin/git    # macOS Apple Silicon
rm /usr/local/bin/git       # macOS Intel or Linux
```

### Updating

```bash
# Pre-built: just re-run the install script
curl -fsSL https://raw.githubusercontent.com/josiahbryan/git-guardrails/main/scripts/install-remote.sh | bash

# From source:
cd git-guardrails && git pull && bun run build && bash scripts/install.sh
```

## Development

```bash
# Run all tests (57 unit + integration)
bun test

# Project structure
src/
├── index.ts      # Entry point: argv parsing, block check, exec passthrough
├── rules.ts      # Blocklist rule definitions (DangerousRule[])
└── matcher.ts    # Command matching logic (checkCommand)

tests/
├── rules.test.ts       # Unit tests for rule structure
├── matcher.test.ts      # Unit tests for all blocked/allowed commands
└── integration.test.ts  # End-to-end tests via bun subprocess
```

### Adding a New Rule

Add an entry to the `DANGEROUS_RULES` array in `src/rules.ts`:

```typescript
{
  subcommand: 'worktree',
  match: hasFlag('remove'),
  reason: 'git worktree remove can delete work in progress',
},
```

Helper matchers available:
- `always` — block all invocations of the subcommand
- `hasFlag('--flag', '-f')` — block if any listed flag is present
- Custom `(args: string[]) => boolean` — arbitrary logic

## Override Bypass

If you genuinely need to run a blocked command (e.g., you know what you're doing and accept the risk), set the `GIT_ALLOW_DANGEROUS` environment variable:

```bash
GIT_ALLOW_DANGEROUS=1 git stash
GIT_ALLOW_DANGEROUS=1 git reset --hard HEAD~3
GIT_ALLOW_DANGEROUS=1 git push --force
```

This bypasses all guardrails and passes the command directly to the real git. The existence of this env var is intentionally **not mentioned in any error output** — agents will never discover it on their own.

## Design Decisions

### Why block universally, not just for agents?

Agents don't identify themselves. There's no reliable way to detect "this git call came from an AI agent" vs "this came from the user's terminal." PATH-level interception treats all callers equally, which is the only approach that can't be circumvented by an agent spawning a subprocess.

### Why exit code 128?

Git uses exit code 128 for fatal errors. This signals to the caller that the command categorically failed (not a transient error), discouraging retry loops.

### Why not a git hook?

Git hooks (pre-commit, pre-push, etc.) only fire for specific git operations and can be bypassed with `--no-verify`. A PATH-level wrapper intercepts *every* git invocation with no bypass mechanism visible to callers.

## License

MIT
