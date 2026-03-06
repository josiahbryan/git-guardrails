import { execFileSync } from 'node:child_process';
import { checkCommand } from './matcher.ts';

/** Path to the real git binary (untouched at its original location) */
const REAL_GIT = '/usr/bin/git';

function main(): void {
  const gitArgs = process.argv.slice(2);

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
    if (err && typeof err === 'object' && 'status' in err) {
      process.exit((err as { status: number }).status ?? 1);
    }
    process.exit(1);
  }
}

main();
