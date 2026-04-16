# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/josiahbryan/git-guardrails/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/josiahbryan/git-guardrails/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/josiahbryan/git-guardrails/compare/v1.0.0...v1.1.0
