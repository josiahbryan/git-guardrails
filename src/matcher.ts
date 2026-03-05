import { DANGEROUS_RULES } from './rules.ts';

export interface CheckResult {
  blocked: boolean;
  reason?: string;
}

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
