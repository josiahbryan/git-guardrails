import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { _resetAtomicCommitCache, _setAtomicCommitInstalled } from '../src/atomic-commit.ts';
import { checkCommand } from '../src/matcher.ts';

beforeAll(() => { _setAtomicCommitInstalled(false); });
afterAll(() => { _resetAtomicCommitCache(); });

describe('checkCommand', () => {
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
    {
      args: ['restore', 'src/index.ts'],
      desc: 'git restore <file> (path bypass of old .-only rule)',
    },
    {
      args: ['restore', '--staged', 'file.txt'],
      desc: 'git restore --staged (entire subcommand blocked)',
    },
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
  ];

  for (const { args, desc } of allowed) {
    test(`ALLOWS: ${desc}`, () => {
      const result = checkCommand(args);
      expect(result.blocked).toBe(false);
    });
  }
});

describe('edge cases', () => {
  test('BLOCKS: git clean with combined flags -fdx', () => {
    const result = checkCommand(['clean', '-fdx']);
    expect(result.blocked).toBe(true);
  });

  test('BLOCKS: git clean -xf (f not first)', () => {
    const result = checkCommand(['clean', '-xf']);
    expect(result.blocked).toBe(true);
  });

  test('ALLOWS: git clean -n (dry run, no -f)', () => {
    const result = checkCommand(['clean', '-n']);
    expect(result.blocked).toBe(false);
  });

  test('ALLOWS: git checkout with no args', () => {
    const result = checkCommand(['checkout']);
    expect(result.blocked).toBe(false);
  });

  test('ALLOWS: empty args (bare git)', () => {
    const result = checkCommand([]);
    expect(result.blocked).toBe(false);
  });

  test('BLOCKS: flags after positional args (git push origin -f)', () => {
    const result = checkCommand(['push', 'origin', '-f']);
    expect(result.blocked).toBe(true);
  });

  test('BLOCKS: git restore --staged .', () => {
    const result = checkCommand(['restore', '--staged', '.']);
    expect(result.blocked).toBe(true);
  });
});

describe('checkout --ours/--theirs', () => {
  for (const args of [['checkout','--ours','a.ts'],['checkout','--theirs','a.ts'],['checkout','-q','--ours','a.ts']]) {
    test(`BLOCKS: ${args.join(' ')}`, () => {
      const r = checkCommand(args);
      expect(r.blocked).toBe(true);
      expect(r.reason).toContain('--ours');
    });
  }
  test('ALLOWS: git checkout main', () => { expect(checkCommand(['checkout','main']).blocked).toBe(false); });
});

describe('merge -X ours/theirs and --strategy=ours', () => {
  for (const args of [['merge','-X','ours','f'],['merge','-X','theirs','f'],['merge','-Xours','f'],['merge','--strategy-option=ours','f'],['merge','--strategy-option','ours','f'],['merge','--strategy=ours','f'],['merge','-s','ours','f'],['merge','-sours','f']]) {
    test(`BLOCKS: ${args.join(' ')}`, () => {
      const r = checkCommand(args);
      expect(r.blocked).toBe(true);
      expect(r.reason).toContain('side');
    });
  }
  test('ALLOWS: git merge feature', () => { expect(checkCommand(['merge','feature']).blocked).toBe(false); });
  test('ALLOWS: git merge -X patience feature', () => { expect(checkCommand(['merge','-X','patience','feature']).blocked).toBe(false); });
  test('ALLOWS: git merge --strategy=recursive feature', () => { expect(checkCommand(['merge','--strategy=recursive','feature']).blocked).toBe(false); });
});

describe('git config user.* pollution guard', () => {
  test('BLOCKS: git config user.name "Foo"', () => {
    const r = checkCommand(['config', 'user.name', 'Foo']);
    expect(r.blocked).toBe(true);
    expect(r.reason).toContain('GIT_AUTHOR_NAME');
  });
  test('BLOCKS: git config user.email foo@bar', () => { expect(checkCommand(['config','user.email','foo@bar']).blocked).toBe(true); });
  test('BLOCKS: git config --local user.name "Foo"', () => { expect(checkCommand(['config','--local','user.name','Foo']).blocked).toBe(true); });
  test('ALLOWS: git config --global user.name "Foo"', () => { expect(checkCommand(['config','--global','user.name','Foo']).blocked).toBe(false); });
  test('ALLOWS: git config --system user.name "Foo"', () => { expect(checkCommand(['config','--system','user.name','Foo']).blocked).toBe(false); });
  test('ALLOWS: git config --unset user.name', () => { expect(checkCommand(['config','--unset','user.name']).blocked).toBe(false); });
  test('ALLOWS: git config core.editor vim', () => { expect(checkCommand(['config','core.editor','vim']).blocked).toBe(false); });
  test('ALLOWS: git config --list', () => { expect(checkCommand(['config','--list']).blocked).toBe(false); });
});

describe('agent-only rules', () => {
  const ENV_KEYS = ['GIT_GUARDRAILS_AGENT_MODE','GIT_AUTHOR_EMAIL','GIT_COMMITTER_EMAIL'];
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => { for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; } });
  afterEach(() => { for (const k of ENV_KEYS) { const v = saved[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
  describe('push to protected branches', () => {
    const cases = [['push','origin','develop'],['push','origin','HEAD:develop'],['push','origin','agent-fix:develop'],['push','origin',':develop'],['push','origin','main'],['push','origin','HEAD:main'],['push','origin','master'],['push','origin','HEAD:production']];
    for (const args of cases) {
      test(`BLOCKS in agent mode: ${args.join(' ')}`, () => {
        process.env['GIT_GUARDRAILS_AGENT_MODE'] = '1';
        const r = checkCommand(args);
        expect(r.blocked).toBe(true);
        expect(r.reason).toContain('protected branches');
      });
      test(`ALLOWS for humans: ${args.join(' ')}`, () => {
        expect(checkCommand(args).blocked).toBe(false);
      });
    }
    test('ALLOWS in agent mode: feature-branch', () => { process.env['GIT_GUARDRAILS_AGENT_MODE']='1'; expect(checkCommand(['push','origin','feature-branch']).blocked).toBe(false); });
    test('ALLOWS in agent mode: HEAD:agent-fix-foo', () => { process.env['GIT_GUARDRAILS_AGENT_MODE']='1'; expect(checkCommand(['push','origin','HEAD:agent-fix-foo']).blocked).toBe(false); });
    test("doesn't false-match developement / feature/develop-stuff", () => {
      process.env['GIT_GUARDRAILS_AGENT_MODE'] = '1';
      expect(checkCommand(['push','origin','developement']).blocked).toBe(false);
      expect(checkCommand(['push','origin','feature/develop-stuff']).blocked).toBe(false);
    });
    test('agent mode triggers via GIT_AUTHOR_EMAIL', () => {
      process.env['GIT_AUTHOR_EMAIL'] = 'ops-agent@rubber.ci';
      expect(checkCommand(['push','origin','develop']).blocked).toBe(true);
    });
  });
  describe('push --no-verify', () => {
    test('BLOCKS in agent mode', () => {
      process.env['GIT_GUARDRAILS_AGENT_MODE'] = '1';
      const r = checkCommand(['push','--no-verify','origin','feature']);
      expect(r.blocked).toBe(true);
      expect(r.reason).toContain('--no-verify');
    });
    test('ALLOWS for humans', () => { expect(checkCommand(['push','--no-verify','origin','feature']).blocked).toBe(false); });
  });
});
