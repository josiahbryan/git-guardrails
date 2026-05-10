import { isAgentRun } from './agent-detection.ts';
import { DANGEROUS_RULES } from './rules.ts';
import { isInLinkedWorktree } from './worktree.ts';

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
      if (rule.agentOnly && !isAgentRun()) {
        continue;
      }
      // Linked-worktree bypass: only consult worktree detection after a rule
      // has already matched, so non-blocked commands pay zero cost (no git
      // subprocess spawned). See src/worktree.ts for the detection logic.
      if (rule.allowedInLinkedWorktree && isInLinkedWorktree()) {
        return { blocked: false };
      }
      return { blocked: true, reason: rule.reason };
    }
  }

  return { blocked: false };
}
