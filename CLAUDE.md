# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

git-guardrails is a compiled Bun/TypeScript binary that shadows `/usr/bin/git` via PATH priority. It intercepts every git invocation system-wide, blocks dangerous commands (especially from AI coding agents), and transparently passes safe commands through to the real git at `/usr/bin/git`.

## Commands

```bash
bun test              # Run all tests (Bun's built-in test runner)
bun build --compile --outfile dist/git src/index.ts  # Build native binary
bun run install-guardrails   # Build + install to /opt/homebrew/bin/git
bun run release              # Cross-compile for 4 targets + create GitHub release
```

During development, run the wrapper without compiling:
```bash
bun run src/index.ts status   # Test a safe command
bun run src/index.ts stash    # Test a blocked command
```

## Architecture

Three source files, no external dependencies:

- **`src/rules.ts`** — `DANGEROUS_RULES` array of `DangerousRule` objects. Each rule has a `subcommand` string, a `match(args)` predicate, and a `reason` string. To add a new blocked command, add an entry here.
- **`src/matcher.ts`** — `checkCommand(args)` iterates rules, returns `{ blocked, reason }`.
- **`src/index.ts`** — Entry point. Parses argv (handles bun-run vs compiled-binary differences), checks `GIT_ALLOW_DANGEROUS` env var, calls `checkCommand`, either blocks with exit 128 or `execFileSync`s the real git.

## Key Design Decisions

- **Exit code 128** signals fatal git error to discourage agent retries.
- **`GIT_ALLOW_DANGEROUS=1`** bypasses all checks. Intentionally never mentioned in error output so agents don't discover and use it.
- **`gitArgvFromProcessArgv()`** handles three execution contexts: `bun run src/index.ts`, compiled binary (Bun `/$bunfs/` path), and direct invocation.
- **`git restore` is blocked entirely** (not just `restore .`), because path-specific restores were bypassing the previous narrow rule.

## Tests

Tests live in `tests/` using `bun:test`:

- **`rules.test.ts`** — Validates rule structure.
- **`matcher.test.ts`** — Unit tests for blocked/allowed/edge-case commands (~44 cases).
- **`integration.test.ts`** — Subprocess tests running actual `bun run src/index.ts` and the compiled `dist/git` binary, including `GIT_ALLOW_DANGEROUS` bypass.

Integration tests depend on the compiled binary existing at `dist/git` — run `bun run build` first if those tests fail.
