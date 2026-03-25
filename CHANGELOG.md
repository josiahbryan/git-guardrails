# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/josiahbryan/git-guardrails/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/josiahbryan/git-guardrails/compare/v1.0.0...v1.1.0
