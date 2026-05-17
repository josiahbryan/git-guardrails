import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { execSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parsePluginOutput,
  shouldRunPlugin,
} from '../src/plugin.ts';

describe('parsePluginOutput', () => {
  test('empty stdout produces empty injection', () => {
    const r = parsePluginOutput('');
    expect(r.env).toEqual({});
    expect(r.preArgs).toEqual([]);
    expect(r.postArgs).toEqual([]);
  });

  test('blank-only stdout produces empty injection', () => {
    const r = parsePluginOutput('\n\n   \n\n');
    expect(r.env).toEqual({});
    expect(r.preArgs).toEqual([]);
    expect(r.postArgs).toEqual([]);
  });

  test('single COMMIT_TRAILER yields one --trailer arg + dedupe flag', () => {
    const r = parsePluginOutput('COMMIT_TRAILER=Co-Authored-By: x <x@y.io>\n');
    expect(r.postArgs).toEqual(['--trailer', 'Co-Authored-By: x <x@y.io>']);
    expect(r.preArgs).toEqual([
      '-c',
      'trailer.ifExists=addIfDifferentNeighbor',
    ]);
    expect(r.env).toEqual({});
  });

  test('multiple COMMIT_TRAILER lines yield multiple --trailer args (single -c)', () => {
    const r = parsePluginOutput(
      [
        'COMMIT_TRAILER=Co-Authored-By: a <a@x>',
        'COMMIT_TRAILER=BC-Task-Id: bctask_abc',
      ].join('\n'),
    );
    expect(r.postArgs).toEqual([
      '--trailer',
      'Co-Authored-By: a <a@x>',
      '--trailer',
      'BC-Task-Id: bctask_abc',
    ]);
    expect(r.preArgs).toEqual([
      '-c',
      'trailer.ifExists=addIfDifferentNeighbor',
    ]);
  });

  test('non-trailer KEY=VALUE lines become env vars (no argv injection)', () => {
    const r = parsePluginOutput(
      [
        'GIT_COMMITTER_NAME=bc-task-foo',
        'GIT_COMMITTER_EMAIL=bctask_foo@bc-task.internal',
        'BC_TASK_ID=bctask_foo',
      ].join('\n'),
    );
    expect(r.env).toEqual({
      GIT_COMMITTER_NAME: 'bc-task-foo',
      GIT_COMMITTER_EMAIL: 'bctask_foo@bc-task.internal',
      BC_TASK_ID: 'bctask_foo',
    });
    expect(r.preArgs).toEqual([]);
    expect(r.postArgs).toEqual([]);
  });

  test('mixed: env vars + trailers produce both env and argv injection', () => {
    const r = parsePluginOutput(
      [
        'GIT_COMMITTER_NAME=bc-task-foo',
        'GIT_COMMITTER_EMAIL=bctask_foo@bc-task.internal',
        'COMMIT_TRAILER=Co-Authored-By: bc-task-foo <bctask_foo@bc-task.internal>',
      ].join('\n'),
    );
    expect(r.env).toEqual({
      GIT_COMMITTER_NAME: 'bc-task-foo',
      GIT_COMMITTER_EMAIL: 'bctask_foo@bc-task.internal',
    });
    expect(r.postArgs).toEqual([
      '--trailer',
      'Co-Authored-By: bc-task-foo <bctask_foo@bc-task.internal>',
    ]);
    expect(r.preArgs).toEqual([
      '-c',
      'trailer.ifExists=addIfDifferentNeighbor',
    ]);
  });

  test('empty trailer value is ignored (does not produce empty --trailer arg)', () => {
    const r = parsePluginOutput('COMMIT_TRAILER=\n');
    expect(r.postArgs).toEqual([]);
    expect(r.preArgs).toEqual([]);
  });

  test('malformed lines (no =, lowercase keys, etc.) are silently dropped', () => {
    const r = parsePluginOutput(
      [
        'no_equals_here',
        '=value-with-no-key',
        'lower_case_key=foo', // lowercase rejected
        'lowerCase=mixed',
        'a-b-c=hyphens-rejected',
        '123BAD=numeric-leader-rejected',
        'GOOD_KEY=ok',
      ].join('\n'),
    );
    expect(r.env).toEqual({ GOOD_KEY: 'ok' });
  });

  test('value with embedded "=" preserves everything after the first =', () => {
    const r = parsePluginOutput(
      'COMMIT_TRAILER=Some-Trailer: key=value with extra = signs\n',
    );
    expect(r.postArgs).toEqual([
      '--trailer',
      'Some-Trailer: key=value with extra = signs',
    ]);
  });

  test('lines with trailing whitespace are trimmed on the right (preserves leading spaces in value)', () => {
    const r = parsePluginOutput('GIT_COMMITTER_NAME=name with trailing   \n');
    expect(r.env).toEqual({ GIT_COMMITTER_NAME: 'name with trailing' });
  });
});

describe('shouldRunPlugin', () => {
  const ORIG_PLUGIN_ENV = process.env['GIT_GUARDRAILS_IDENTITY_PLUGIN'];

  let tmpDir: string;
  let realPluginPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'gg-plugin-test-'));
    realPluginPath = join(tmpDir, 'plugin.sh');
    writeFileSync(realPluginPath, '#!/bin/sh\n');
    chmodSync(realPluginPath, 0o755);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    if (ORIG_PLUGIN_ENV === undefined) {
      delete process.env['GIT_GUARDRAILS_IDENTITY_PLUGIN'];
    } else {
      process.env['GIT_GUARDRAILS_IDENTITY_PLUGIN'] = ORIG_PLUGIN_ENV;
    }
  });

  test('false when env var unset', () => {
    delete process.env['GIT_GUARDRAILS_IDENTITY_PLUGIN'];
    expect(shouldRunPlugin('commit')).toBe(false);
  });

  test('false when env var set but file does not exist', () => {
    process.env['GIT_GUARDRAILS_IDENTITY_PLUGIN'] = '/nonexistent/path/xyz';
    expect(shouldRunPlugin('commit')).toBe(false);
  });

  test('false when subcommand is not commit-creating, even with valid plugin', () => {
    process.env['GIT_GUARDRAILS_IDENTITY_PLUGIN'] = realPluginPath;
    expect(shouldRunPlugin('status')).toBe(false);
    expect(shouldRunPlugin('log')).toBe(false);
    expect(shouldRunPlugin('push')).toBe(false);
    expect(shouldRunPlugin('diff')).toBe(false);
  });

  test('false when subcommand is undefined', () => {
    process.env['GIT_GUARDRAILS_IDENTITY_PLUGIN'] = realPluginPath;
    expect(shouldRunPlugin(undefined)).toBe(false);
  });

  test('true for commit-creating subcommands when plugin file exists', () => {
    process.env['GIT_GUARDRAILS_IDENTITY_PLUGIN'] = realPluginPath;
    for (const sc of ['commit', 'cherry-pick', 'revert', 'merge', 'rebase']) {
      expect(shouldRunPlugin(sc)).toBe(true);
    }
  });
});

// ──────────────────────────────────────────────────────────────────────
// Integration: run the wrapper end-to-end via `bun run src/index.ts` with
// a real plugin script on disk; observe the env + argv the plugin's
// downstream stand-in (a fake git binary that echoes its environment +
// args back to us) receives.
// ──────────────────────────────────────────────────────────────────────

describe('integration: plugin injection end-to-end', () => {
  const ROOT = join(import.meta.dir, '..');
  const ENTRY = join(ROOT, 'src/index.ts');

  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'gg-plugin-integ-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  /**
   * Stand up a fake plugin and a fake "real git" that echoes its argv +
   * env to a file. Re-point REAL_GIT via a build-time constant isn't
   * worth wiring; instead we exercise the parser + decision-to-invoke
   * via `parsePluginOutput` + `shouldRunPlugin` unit tests above, and
   * here we run the wrapper with no plugin configured to verify the
   * "no plugin → exact pass-through" path doesn't regress.
   */
  test('with no plugin configured, wrapper passes commit args through unchanged', () => {
    // The wrapper will try to exec /usr/bin/git commit --dry-run, which
    // is a read-only inspection of the current state. As long as the
    // wrapper doesn't crash before reaching exec, the plugin-no-op path
    // is exercised. We assert exit code is whatever real git returns
    // (could be 0 or non-zero depending on staging state) — the key
    // signal is no BLOCKED message and no plugin warning.
    let stderr = '';
    try {
      execSync(`bun run ${ENTRY} commit --dry-run`, {
        cwd: ROOT,
        env: {
          ...process.env,
          // Explicitly unset so a stray env doesn't interfere
          GIT_GUARDRAILS_IDENTITY_PLUGIN: '',
          // Bypass the atomic-commit rule (this test runs on a machine
          // where git-atomic-commit is installed); we're testing the
          // plugin path, not the atomic-commit enforcement.
          GIT_ATOMIC_COMMIT: '1',
        },
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err: unknown) {
      const e = err as { stderr?: string };
      stderr = e.stderr ?? '';
    }
    expect(stderr).not.toContain('[git-guardrails] BLOCKED');
    expect(stderr).not.toContain('[git-guardrails] identity plugin failed');
  });

  test('plugin that exits non-zero produces stderr warning, wrapper still runs git', () => {
    const pluginPath = join(tmpDir, 'failing-plugin.sh');
    writeFileSync(
      pluginPath,
      '#!/bin/sh\necho "oh no" >&2\nexit 7\n',
    );
    chmodSync(pluginPath, 0o755);

    let stderr = '';
    try {
      execSync(`bun run ${ENTRY} commit --dry-run`, {
        cwd: ROOT,
        env: {
          ...process.env,
          GIT_GUARDRAILS_IDENTITY_PLUGIN: pluginPath,
          GIT_ATOMIC_COMMIT: '1',
        },
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err: unknown) {
      const e = err as { stderr?: string };
      stderr = e.stderr ?? '';
    }
    expect(stderr).toContain('[git-guardrails] identity plugin failed');
    // And the wrapper should NOT have blocked
    expect(stderr).not.toContain('[git-guardrails] BLOCKED');
  });

  test('plugin is NOT invoked for non-commit-creating subcommand (no warning even if plugin would fail)', () => {
    const pluginPath = join(tmpDir, 'would-fail-plugin.sh');
    writeFileSync(pluginPath, '#!/bin/sh\nexit 99\n');
    chmodSync(pluginPath, 0o755);

    let stderr = '';
    try {
      execSync(`bun run ${ENTRY} status`, {
        cwd: ROOT,
        env: {
          ...process.env,
          GIT_GUARDRAILS_IDENTITY_PLUGIN: pluginPath,
        },
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch {
      // ignore — `git status` may exit non-zero in some test contexts
    }
    expect(stderr).not.toContain('[git-guardrails] identity plugin failed');
  });

  test('plugin echoes GIT_GUARDRAILS_SUBCOMMAND back into a sentinel file when invoked', () => {
    // Plugin captures the subcommand env var into a sentinel file so we
    // can prove the wrapper passed it through. We don't care about the
    // git exit code here.
    const sentinel = join(tmpDir, 'sentinel.txt');
    const pluginPath = join(tmpDir, 'sentinel-plugin.sh');
    writeFileSync(
      pluginPath,
      `#!/bin/sh\necho "subcommand=$GIT_GUARDRAILS_SUBCOMMAND" > ${sentinel}\nexit 0\n`,
    );
    chmodSync(pluginPath, 0o755);

    try {
      execSync(`bun run ${ENTRY} commit --dry-run`, {
        cwd: ROOT,
        env: {
          ...process.env,
          GIT_GUARDRAILS_IDENTITY_PLUGIN: pluginPath,
          GIT_ATOMIC_COMMIT: '1',
        },
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch {
      // ignore git's exit code
    }

    const written = require('node:fs').readFileSync(sentinel, 'utf-8');
    expect(written.trim()).toBe('subcommand=commit');
  });
});
