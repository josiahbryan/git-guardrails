/**
 * Generic pre-commit identity-injection plugin.
 *
 * Some workflows want every commit (from any agent, in any session) to be
 * tagged with extra provenance — committer-identity overrides, message
 * trailers, etc. — without the wrapper itself knowing what that provenance
 * means. This module is the wrapper's hand-off to that plugin.
 *
 * When `GIT_GUARDRAILS_IDENTITY_PLUGIN` is set to the path of an executable
 * script, the wrapper invokes that script BEFORE exec'ing real git for any
 * commit-creating subcommand (commit / cherry-pick / revert / rebase /
 * merge). The plugin emits `KEY=VALUE` lines on stdout; the wrapper applies
 * them to the exec call:
 *
 *   COMMIT_TRAILER=Co-Authored-By: foo <foo@bar.internal>
 *     → wrapper appends `--trailer "Co-Authored-By: foo <foo@bar.internal>"`
 *       to the git argv. Multiple `COMMIT_TRAILER=` lines produce multiple
 *       `--trailer` args.
 *
 *   GIT_COMMITTER_NAME=foo
 *   GIT_COMMITTER_EMAIL=foo@bar.internal
 *   GIT_AUTHOR_NAME=foo
 *   GIT_AUTHOR_EMAIL=foo@bar.internal
 *   <ANY_OTHER_UPPERCASE_KEY>=value
 *     → exported into the env passed to the real-git exec call.
 *
 * The plugin contract is intentionally narrow: stdin-less, no positional
 * args, only env-based context. The subcommand the wrapper is about to run
 * is exposed via `GIT_GUARDRAILS_SUBCOMMAND` so the plugin can choose to
 * emit different things for `commit` vs `merge` vs `rebase`.
 *
 * Plugin output that doesn't parse as KEY=VALUE (malformed lines, blank
 * lines, etc.) is silently ignored. A non-zero exit from the plugin logs a
 * one-line warning to stderr and the wrapper proceeds with no injection —
 * a broken plugin must never break git.
 *
 * When trailers are injected the wrapper also prepends
 * `-c trailer.ifExists=addIfDifferentNeighbor` so rebase replays don't
 * accumulate duplicate trailer lines on each replay.
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const PLUGIN_ENV_VAR = 'GIT_GUARDRAILS_IDENTITY_PLUGIN';
const PLUGIN_TIMEOUT_MS = 3000;

/**
 * Subcommands that create commits. The plugin only runs on these to avoid
 * spawning a subprocess on every `git status` / `git log` / `git diff`.
 *
 * `commit`         — direct commit object creation.
 * `cherry-pick`    — creates new commits replaying others.
 * `revert`         — creates new commits negating others.
 * `merge`          — may create a merge commit.
 * `rebase`         — replays commits, each gets a new committer + may
 *                    accept new trailers.
 *
 * Other subcommands (status, log, diff, fetch, push, ...) do not create
 * commits and pay zero plugin overhead.
 */
const COMMIT_CREATING_SUBCOMMANDS = new Set([
  'commit',
  'cherry-pick',
  'revert',
  'merge',
  'rebase',
]);

export interface PluginInjection {
  /** Env vars to merge into the exec env. */
  env: Record<string, string>;
  /**
   * Args to insert BEFORE the subcommand (top-level git flags, e.g.
   * `-c trailer.ifExists=addIfDifferentNeighbor`).
   */
  preArgs: string[];
  /**
   * Args to append AFTER the subcommand's existing args (subcommand-level
   * flags, e.g. `--trailer "..."`).
   */
  postArgs: string[];
}

/** Empty injection — used when plugin isn't configured, fails, or emits nothing. */
export const EMPTY_INJECTION: PluginInjection = Object.freeze({
  env: {},
  preArgs: [],
  postArgs: [],
}) as PluginInjection;

/**
 * Should the plugin be invoked for this subcommand?
 *
 * True iff: env var is set, points to an existing file, AND the subcommand
 * is one that creates commits. Cheap (just env lookup + one fs.existsSync).
 */
export function shouldRunPlugin(subcommand: string | undefined): boolean {
  if (!subcommand) return false;
  if (!COMMIT_CREATING_SUBCOMMANDS.has(subcommand)) return false;
  const pluginPath = process.env[PLUGIN_ENV_VAR];
  if (!pluginPath) return false;
  return existsSync(pluginPath);
}

/**
 * Parse plugin stdout into a PluginInjection. Pure function — exported for
 * unit testing.
 *
 * Lines must match `^[A-Z_][A-Z0-9_]*=.*$`. Everything else (including
 * comments, malformed lines, blank lines) is silently dropped.
 *
 * `COMMIT_TRAILER` is the one special key: it produces `--trailer <value>`
 * postArgs. Every other valid line is exported as an env var.
 *
 * If any trailer is emitted, `-c trailer.ifExists=addIfDifferentNeighbor`
 * is prepended so rebase replays dedupe identical trailers via git's own
 * mechanism (no state-tracking needed in the wrapper).
 */
export function parsePluginOutput(stdout: string): PluginInjection {
  const env: Record<string, string> = {};
  const trailers: string[] = [];

  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.trimEnd();
    if (line === '') continue;
    const eqIdx = line.indexOf('=');
    if (eqIdx <= 0) continue;
    const key = line.slice(0, eqIdx);
    const value = line.slice(eqIdx + 1);
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) continue;

    if (key === 'COMMIT_TRAILER') {
      if (value !== '') trailers.push(value);
    } else {
      env[key] = value;
    }
  }

  const preArgs: string[] = [];
  const postArgs: string[] = [];
  if (trailers.length > 0) {
    preArgs.push('-c', 'trailer.ifExists=addIfDifferentNeighbor');
    for (const t of trailers) {
      postArgs.push('--trailer', t);
    }
  }

  return { env, preArgs, postArgs };
}

/**
 * Invoke the plugin and return its injection. Errors (timeout, non-zero
 * exit, unreadable executable) log a one-line stderr warning and return
 * an empty injection — the wrapper proceeds with the unmodified exec.
 *
 * Plugin contract:
 * - Invoked with no positional args, no stdin.
 * - Receives `GIT_GUARDRAILS_SUBCOMMAND` in env (the verb about to run).
 * - Must complete in PLUGIN_TIMEOUT_MS or be killed.
 * - Stdout is read; stderr is forwarded to the parent's stderr so the
 *   user can see plugin warnings if needed.
 */
export function runPlugin(subcommand: string): PluginInjection {
  const pluginPath = process.env[PLUGIN_ENV_VAR];
  if (!pluginPath) return EMPTY_INJECTION;

  let stdout = '';
  try {
    stdout = execFileSync(pluginPath, [], {
      env: {
        ...process.env,
        GIT_GUARDRAILS_SUBCOMMAND: subcommand,
      },
      timeout: PLUGIN_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'inherit'],
      encoding: 'utf-8',
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `[git-guardrails] identity plugin failed (${pluginPath}): ${msg}\n`,
    );
    return EMPTY_INJECTION;
  }

  return parsePluginOutput(stdout);
}
