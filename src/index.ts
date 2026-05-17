import { execFileSync } from 'node:child_process';
import { checkCommand } from './matcher.ts';
import { runPlugin, shouldRunPlugin } from './plugin.ts';

/** Path to the real git binary (untouched at its original location) */
const REAL_GIT = '/usr/bin/git';

/**
 * Arguments to pass to the real git binary (subcommand and rest).
 *
 * - bun run src/index.ts <args> -> argv [bun, script.ts, ...git] -> drop first two.
 * - Bun --compile -> argv often [wrapper, /$bunfs/root/git, ...git] -> drop first two.
 * - Any other [prog, subcommand, ...] -> drop prog only.
 */
function gitArgvFromProcessArgv(argv: string[]): string[] {
  const a1 = argv[1];
  if (a1 && (a1.endsWith('.ts') || a1.endsWith('.js'))) {
    return argv.slice(2);
  }
  if (a1?.includes('bunfs')) {
    return argv.slice(2);
  }
  return argv.slice(1);
}

function main(): void {
  const gitArgs = gitArgvFromProcessArgv(process.argv);

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

  // Identity-injection plugin (no-op when not configured). Runs AFTER the
  // block check so the plugin can't escalate permissions. Only fires for
  // commit-creating subcommands; everything else pays zero plugin cost.
  // See src/plugin.ts for the full contract.
  const subcommand = gitArgs[0];
  let finalArgs = gitArgs;
  let finalEnv: NodeJS.ProcessEnv = process.env;
  if (shouldRunPlugin(subcommand)) {
    const injection = runPlugin(subcommand!);
    if (
      injection.preArgs.length > 0 ||
      injection.postArgs.length > 0 ||
      Object.keys(injection.env).length > 0
    ) {
      finalArgs = [
        ...injection.preArgs,
        subcommand!,
        ...gitArgs.slice(1),
        ...injection.postArgs,
      ];
      finalEnv = { ...process.env, ...injection.env };
    }
  }

  // Pass through to real git
  try {
    execFileSync(REAL_GIT, finalArgs, {
      stdio: 'inherit',
      env: finalEnv,
    });
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'status' in err) {
      process.exit((err as { status: number }).status ?? 1);
    }
    process.exit(1);
  }
}

main();
