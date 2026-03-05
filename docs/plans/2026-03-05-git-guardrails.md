# Git Guardrails Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace `/usr/bin/git` with a compiled Bun binary that blocks dangerous git subcommands (stash, reset --hard, checkout ., clean -f, etc.) for all callers — especially AI agents — while passing safe commands through to the real git binary.

**Architecture:** A single TypeScript entry point parses `process.argv`, checks the git subcommand + flags against a blocklist, and either exits with an error or `exec`s the real git binary (moved to `/usr/bin/git-core-bin`). An env var `GIT_ALLOW_DANGEROUS=1` bypasses the block silently (never hinted at in output). Compiled with `bun build --compile` to a native binary for sub-millisecond overhead.

**Tech Stack:** TypeScript, Bun (runtime + compiler), no dependencies

---

## Project Layout

```
~/devel/git-guardrails/
├── src/
│   ├── index.ts          # Entry point: argv parsing + exec
│   ├── rules.ts          # Blocklist definitions
│   └── matcher.ts        # Command matching logic
├── tests/
│   ├── matcher.test.ts   # Unit tests for matching logic
│   └── integration.test.ts # End-to-end wrapper tests
├── scripts/
│   └── install.sh        # sudo mv + copy binary
├── docs/plans/
│   └── 2026-03-05-git-guardrails.md  # This file
├── package.json
├── tsconfig.json
└── README.md
```

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`

**Step 1: Initialize package.json**

```json
{
  "name": "git-guardrails",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "build": "bun build --compile --outfile dist/git src/index.ts",
    "test": "bun test",
    "install-guardrails": "sudo bash scripts/install.sh"
  }
}
```

**Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "types": ["bun-types"]
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

**Step 3: Install bun-types**

Run: `cd ~/devel/git-guardrails && bun add -d bun-types`

**Step 4: Commit**

```bash
git init
git add package.json tsconfig.json bun.lockb
git commit -m "chore: scaffold git-guardrails project"
```

---

### Task 2: Define Blocklist Rules

**Files:**
- Create: `src/rules.ts`

**Step 1: Write the failing test**

Create `tests/rules.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test';
import { DANGEROUS_RULES } from '../src/rules.ts';

describe('DANGEROUS_RULES', () => {
  test('exports an array of rules', () => {
    expect(Array.isArray(DANGEROUS_RULES)).toBe(true);
    expect(DANGEROUS_RULES.length).toBeGreaterThan(0);
  });

  test('each rule has subcommand, pattern, and reason', () => {
    for (const rule of DANGEROUS_RULES) {
      expect(rule.subcommand).toBeDefined();
      expect(rule.reason).toBeDefined();
      expect(rule.match).toBeDefined();
    }
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd ~/devel/git-guardrails && bun test tests/rules.test.ts`
Expected: FAIL — cannot resolve `../src/rules.ts`

**Step 3: Write rules.ts**

```typescript
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
  // git stash (any variant)
  {
    subcommand: 'stash',
    match: always,
    reason: 'git stash can lose uncommitted work when used by automated agents',
  },

  // git reset --hard
  {
    subcommand: 'reset',
    match: hasFlag('--hard'),
    reason: 'git reset --hard permanently discards uncommitted changes',
  },

  // git checkout . / git checkout -- <files> (but NOT branch switching)
  {
    subcommand: 'checkout',
    match: hasFileRestore,
    reason: 'git checkout with file paths discards uncommitted changes',
  },

  // git clean -f / -fd / -fx etc
  {
    subcommand: 'clean',
    match: hasFlag('-f', '-fd', '-fx', '-fxd', '-xfd', '-df', '-xf'),
    reason: 'git clean -f permanently deletes untracked files',
  },

  // git push --force / --force-with-lease
  {
    subcommand: 'push',
    match: hasFlag('--force', '-f', '--force-with-lease'),
    reason: 'git push --force can overwrite remote history',
  },

  // git branch -D (force delete)
  {
    subcommand: 'branch',
    match: hasFlag('-D'),
    reason: 'git branch -D force-deletes a branch without merge check',
  },

  // git restore . / git restore --staged .
  {
    subcommand: 'restore',
    match: (args) => args.includes('.'),
    reason: 'git restore . discards all uncommitted changes',
  },

  // git rebase (all variants)
  {
    subcommand: 'rebase',
    match: always,
    reason: 'git rebase rewrites commit history',
  },
];
```

**Step 4: Run test to verify it passes**

Run: `cd ~/devel/git-guardrails && bun test tests/rules.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/rules.ts tests/rules.test.ts
git commit -m "feat: define dangerous git command blocklist rules"
```

---

### Task 3: Command Matcher Logic

**Files:**
- Create: `src/matcher.ts`
- Create: `tests/matcher.test.ts`

**Step 1: Write the failing test**

Create `tests/matcher.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test';
import { checkCommand } from '../src/matcher.ts';

describe('checkCommand', () => {
  // Should BLOCK these
  const blocked = [
    { args: ['stash'], desc: 'git stash' },
    { args: ['stash', 'pop'], desc: 'git stash pop' },
    { args: ['stash', 'drop'], desc: 'git stash drop' },
    { args: ['reset', '--hard'], desc: 'git reset --hard' },
    { args: ['reset', '--hard', 'HEAD~1'], desc: 'git reset --hard HEAD~1' },
    { args: ['checkout', '.'], desc: 'git checkout .' },
    { args: ['checkout', '--', 'file.txt'], desc: 'git checkout -- file.txt' },
    { args: ['clean', '-f'], desc: 'git clean -f' },
    { args: ['clean', '-fd'], desc: 'git clean -fd' },
    { args: ['push', '--force'], desc: 'git push --force' },
    { args: ['push', '-f'], desc: 'git push -f' },
    { args: ['push', '--force-with-lease'], desc: 'git push --force-with-lease' },
    { args: ['push', 'origin', 'main', '--force'], desc: 'git push origin main --force' },
    { args: ['branch', '-D', 'feature'], desc: 'git branch -D feature' },
    { args: ['restore', '.'], desc: 'git restore .' },
    { args: ['rebase', 'main'], desc: 'git rebase main' },
    { args: ['rebase', '--onto', 'main'], desc: 'git rebase --onto main' },
  ];

  for (const { args, desc } of blocked) {
    test(`BLOCKS: ${desc}`, () => {
      const result = checkCommand(args);
      expect(result.blocked).toBe(true);
      expect(result.reason).toBeTruthy();
    });
  }

  // Should ALLOW these
  const allowed = [
    { args: ['status'], desc: 'git status' },
    { args: ['add', 'file.txt'], desc: 'git add file.txt' },
    { args: ['commit', '-m', 'msg'], desc: 'git commit -m msg' },
    { args: ['push'], desc: 'git push (no force)' },
    { args: ['push', 'origin', 'main'], desc: 'git push origin main' },
    { args: ['pull'], desc: 'git pull' },
    { args: ['log', '--oneline'], desc: 'git log' },
    { args: ['diff'], desc: 'git diff' },
    { args: ['branch', 'feature'], desc: 'git branch feature (create)' },
    { args: ['branch', '-d', 'feature'], desc: 'git branch -d (safe delete)' },
    { args: ['checkout', 'main'], desc: 'git checkout main (branch switch)' },
    { args: ['checkout', '-b', 'feature'], desc: 'git checkout -b feature' },
    { args: ['reset', 'HEAD~1'], desc: 'git reset (soft, no --hard)' },
    { args: ['merge', 'feature'], desc: 'git merge feature' },
    { args: ['fetch'], desc: 'git fetch' },
    { args: ['remote', '-v'], desc: 'git remote -v' },
    { args: ['tag', 'v1.0'], desc: 'git tag v1.0' },
    { args: ['restore', '--staged', 'file.txt'], desc: 'git restore --staged file.txt' },
  ];

  for (const { args, desc } of allowed) {
    test(`ALLOWS: ${desc}`, () => {
      const result = checkCommand(args);
      expect(result.blocked).toBe(false);
    });
  }
});
```

**Step 2: Run test to verify it fails**

Run: `cd ~/devel/git-guardrails && bun test tests/matcher.test.ts`
Expected: FAIL — cannot resolve `../src/matcher.ts`

**Step 3: Write matcher.ts**

```typescript
import { DANGEROUS_RULES } from './rules.ts';

export interface CheckResult {
  blocked: boolean;
  reason?: string;
}

/**
 * Check if a git command (args after "git") should be blocked.
 * @param args - The arguments after "git", e.g. ["stash", "pop"]
 */
export function checkCommand(args: string[]): CheckResult {
  if (args.length === 0) {
    return { blocked: false };
  }

  const subcommand = args[0];
  const restArgs = args.slice(1);

  for (const rule of DANGEROUS_RULES) {
    if (rule.subcommand === subcommand && rule.match(restArgs)) {
      return { blocked: true, reason: rule.reason };
    }
  }

  return { blocked: false };
}
```

**Step 4: Run test to verify it passes**

Run: `cd ~/devel/git-guardrails && bun test tests/matcher.test.ts`
Expected: PASS (all blocked commands blocked, all allowed commands allowed)

**Step 5: Commit**

```bash
git add src/matcher.ts tests/matcher.test.ts
git commit -m "feat: command matcher logic with comprehensive tests"
```

---

### Task 4: Entry Point (index.ts)

**Files:**
- Create: `src/index.ts`

**Step 1: Write index.ts**

```typescript
import { execFileSync } from 'node:child_process';
import { checkCommand } from './matcher.ts';

/** Path to the real git binary after install */
const REAL_GIT = '/usr/bin/git-core-bin';

function main(): void {
  // argv: [bun/binary, script, ...git-args]
  // When compiled: [binary, ...git-args]
  // Bun compiled binaries: process.argv[0] is the binary, rest are args
  const gitArgs = process.argv.slice(1);

  // Check for env bypass (never hint at this in output)
  const allowDangerous = process.env['GIT_ALLOW_DANGEROUS'] === '1';

  if (!allowDangerous) {
    const result = checkCommand(gitArgs);
    if (result.blocked) {
      process.stderr.write(
        `\x1b[31m[git-guardrails] BLOCKED:\x1b[0m ${result.reason}\n` +
        `\x1b[31m[git-guardrails]\x1b[0m Command: git ${gitArgs.join(' ')}\n`
      );
      process.exit(128);
    }
  }

  // Pass through to real git
  try {
    execFileSync(REAL_GIT, gitArgs, {
      stdio: 'inherit',
      env: process.env,
    });
  } catch (err: unknown) {
    // execFileSync throws on non-zero exit — propagate the exit code
    if (err && typeof err === 'object' && 'status' in err) {
      process.exit((err as { status: number }).status ?? 1);
    }
    process.exit(1);
  }
}

main();
```

**Step 2: Build it**

Run: `cd ~/devel/git-guardrails && mkdir -p dist && bun build --compile --outfile dist/git src/index.ts`
Expected: `dist/git` binary created

**Step 3: Smoke-test the binary (safe command)**

Run: `cd ~/devel/git-guardrails && ./dist/git --version`
Expected: FAIL with error about `/usr/bin/git-core-bin` not found (we haven't installed yet — that's correct)

**Step 4: Smoke-test the binary (blocked command, with mock)**

We'll test blocking logic properly in integration tests. For now verify the matcher is wired up:

Run: `cd ~/devel/git-guardrails && ./dist/git stash`
Expected: `[git-guardrails] BLOCKED: git stash can lose uncommitted work...` and exit 128

**Step 5: Commit**

```bash
git add src/index.ts
git commit -m "feat: entry point with exec passthrough and block logic"
```

---

### Task 5: Install Script

**Files:**
- Create: `scripts/install.sh`

**Step 1: Write install.sh**

```bash
#!/usr/bin/env bash
set -euo pipefail

REAL_GIT="/usr/bin/git-core-bin"
WRAPPER_DEST="/usr/bin/git"
DIST_BINARY="$(cd "$(dirname "$0")/.." && pwd)/dist/git"

# Safety checks
if [[ $EUID -ne 0 ]]; then
  echo "Error: This script must be run with sudo"
  exit 1
fi

if [[ ! -f "$DIST_BINARY" ]]; then
  echo "Error: Compiled binary not found at $DIST_BINARY"
  echo "Run 'bun run build' first."
  exit 1
fi

# If real git hasn't been moved yet, move it
if [[ ! -f "$REAL_GIT" ]]; then
  if [[ ! -f "$WRAPPER_DEST" ]]; then
    echo "Error: No git binary found at $WRAPPER_DEST"
    exit 1
  fi
  echo "Moving original git to $REAL_GIT..."
  mv "$WRAPPER_DEST" "$REAL_GIT"
  chmod 755 "$REAL_GIT"
else
  echo "Real git already at $REAL_GIT, skipping move."
fi

# Copy compiled wrapper into place
echo "Installing git-guardrails wrapper to $WRAPPER_DEST..."
cp "$DIST_BINARY" "$WRAPPER_DEST"
chmod 755 "$WRAPPER_DEST"

echo ""
echo "Done! git-guardrails installed."
echo "  Real git:    $REAL_GIT"
echo "  Wrapper:     $WRAPPER_DEST"
echo ""
echo "Test: git status       (should work)"
echo "Test: git stash        (should be blocked)"
```

**Step 2: Write uninstall.sh**

Create `scripts/uninstall.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

REAL_GIT="/usr/bin/git-core-bin"
WRAPPER_DEST="/usr/bin/git"

if [[ $EUID -ne 0 ]]; then
  echo "Error: This script must be run with sudo"
  exit 1
fi

if [[ ! -f "$REAL_GIT" ]]; then
  echo "Error: Real git not found at $REAL_GIT — nothing to uninstall"
  exit 1
fi

echo "Restoring original git..."
mv "$REAL_GIT" "$WRAPPER_DEST"
chmod 755 "$WRAPPER_DEST"

echo "Done! Original git restored at $WRAPPER_DEST"
```

**Step 3: Commit**

```bash
git add scripts/install.sh scripts/uninstall.sh
git commit -m "feat: install and uninstall scripts"
```

---

### Task 6: Integration Tests

**Files:**
- Create: `tests/integration.test.ts`

**Step 1: Write integration test**

These tests verify the compiled binary end-to-end by pointing `REAL_GIT` at the actual system git. Since we can't easily change the hardcoded path in the compiled binary, these tests exercise the matcher + index logic via `bun run`:

```typescript
import { describe, expect, test } from 'bun:test';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const ENTRY = join(ROOT, 'src/index.ts');

/** Run the wrapper via bun (not compiled, for testability) */
function runGit(args: string, opts: { env?: Record<string, string> } = {}): {
  stdout: string;
  stderr: string;
  exitCode: number;
} {
  try {
    const stdout = execSync(`bun run ${ENTRY} ${args}`, {
      cwd: ROOT,
      encoding: 'utf-8',
      env: { ...process.env, ...opts.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? '',
      exitCode: e.status ?? 1,
    };
  }
}

describe('integration: blocked commands', () => {
  test('git stash is blocked', () => {
    const r = runGit('stash');
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toContain('[git-guardrails] BLOCKED');
  });

  test('git reset --hard is blocked', () => {
    const r = runGit('reset --hard');
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toContain('[git-guardrails] BLOCKED');
  });

  test('git push --force is blocked', () => {
    const r = runGit('push --force');
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toContain('[git-guardrails] BLOCKED');
  });
});

describe('integration: allowed commands', () => {
  test('git status passes through', () => {
    const r = runGit('status');
    // Will fail because /usr/bin/git-core-bin doesn't exist yet,
    // but should NOT contain "BLOCKED"
    expect(r.stderr).not.toContain('[git-guardrails] BLOCKED');
  });

  test('git log passes through', () => {
    const r = runGit('log --oneline -1');
    expect(r.stderr).not.toContain('[git-guardrails] BLOCKED');
  });
});

describe('integration: GIT_ALLOW_DANGEROUS bypass', () => {
  test('git stash allowed with env bypass', () => {
    const r = runGit('stash', { env: { GIT_ALLOW_DANGEROUS: '1' } });
    // Should NOT be blocked (will fail on missing git-core-bin, that's fine)
    expect(r.stderr).not.toContain('[git-guardrails] BLOCKED');
  });
});
```

**Step 2: Run tests**

Run: `cd ~/devel/git-guardrails && bun test tests/integration.test.ts`
Expected: Blocked tests PASS. Allowed tests should not contain "BLOCKED" (they may fail on exec, but that's expected pre-install).

**Step 3: Commit**

```bash
git add tests/integration.test.ts
git commit -m "test: integration tests for blocked and allowed commands"
```

---

### Task 7: Build, Install, and Verify

**Step 1: Build the binary**

Run: `cd ~/devel/git-guardrails && bun run build`
Expected: `dist/git` binary created

**Step 2: Run all tests one final time**

Run: `cd ~/devel/git-guardrails && bun test`
Expected: All tests pass

**Step 3: Install (requires sudo)**

Run: `cd ~/devel/git-guardrails && sudo bash scripts/install.sh`
Expected:
```
Moving original git to /usr/bin/git-core-bin...
Installing git-guardrails wrapper to /usr/bin/git...
Done! git-guardrails installed.
```

**Step 4: Verify safe commands work**

Run: `git status`
Expected: Normal git status output

Run: `git log --oneline -3`
Expected: Normal git log output

**Step 5: Verify blocked commands are blocked**

Run: `git stash`
Expected: `[git-guardrails] BLOCKED: git stash can lose uncommitted work...`

Run: `git reset --hard`
Expected: `[git-guardrails] BLOCKED: git reset --hard permanently discards...`

Run: `git push --force`
Expected: `[git-guardrails] BLOCKED: git push --force can overwrite...`

**Step 6: Verify bypass works**

Run: `GIT_ALLOW_DANGEROUS=1 git stash`
Expected: Normal git stash behavior (or "No local changes to save")

**Step 7: Commit**

```bash
git add dist/git
git commit -m "build: compiled git-guardrails binary"
```

---

### Task 8: Edge Cases and Hardening

**Files:**
- Modify: `src/rules.ts`
- Modify: `tests/matcher.test.ts`

**Step 1: Add tests for edge cases**

Add to `tests/matcher.test.ts`:

```typescript
describe('edge cases', () => {
  test('BLOCKS: git clean with combined flags -fdx', () => {
    const result = checkCommand(['clean', '-fdx']);
    expect(result.blocked).toBe(true);
  });

  test('ALLOWS: git checkout with no args (shows branch info)', () => {
    const result = checkCommand(['checkout']);
    expect(result.blocked).toBe(false);
  });

  test('ALLOWS: git stash with GIT_ALLOW_DANGEROUS (tested at index level)', () => {
    // This is tested in integration tests
    expect(true).toBe(true);
  });

  test('ALLOWS: empty args (bare git)', () => {
    const result = checkCommand([]);
    expect(result.blocked).toBe(false);
  });

  test('BLOCKS: flags before subcommand args (git push origin -f)', () => {
    const result = checkCommand(['push', 'origin', '-f']);
    expect(result.blocked).toBe(true);
  });

  test('ALLOWS: git restore specific file (not .)', () => {
    const result = checkCommand(['restore', 'src/index.ts']);
    expect(result.blocked).toBe(false);
  });
});
```

**Step 2: Update rules.ts if any new patterns needed**

Add to `DANGEROUS_RULES` array in `src/rules.ts`:

```typescript
  // git clean with combined flags
  {
    subcommand: 'clean',
    match: (args) => args.some((a) => a.startsWith('-') && a.includes('f')),
    reason: 'git clean with -f permanently deletes untracked files',
  },
```

And remove the individual `-fdx` etc entries from the `hasFlag` version, replacing with the regex-style match.

**Step 3: Run tests**

Run: `cd ~/devel/git-guardrails && bun test`
Expected: All pass

**Step 4: Rebuild and reinstall**

Run: `cd ~/devel/git-guardrails && bun run build && sudo bash scripts/install.sh`

**Step 5: Commit**

```bash
git add src/rules.ts tests/matcher.test.ts
git commit -m "feat: harden edge cases for clean flags and empty args"
```
