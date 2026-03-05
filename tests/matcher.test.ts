import { describe, expect, test } from 'bun:test';
import { checkCommand } from '../src/matcher.ts';

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
    { args: ['restore', '--staged', 'file.txt'], desc: 'git restore --staged file.txt' },
  ];

  for (const { args, desc } of allowed) {
    test(`ALLOWS: ${desc}`, () => {
      const result = checkCommand(args);
      expect(result.blocked).toBe(false);
    });
  }
});
