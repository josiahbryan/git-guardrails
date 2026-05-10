/**
 * Agent-mode detection.
 *
 * Some guardrail rules are appropriate for autonomous agents (cron-spawned
 * ops-agent, scheduled bots, etc.) but would be over-restrictive for
 * interactive humans. For example, blocking `git push origin develop`
 * universally would break a developer's normal workflow, but blocking it
 * for an unattended agent that just claimed authorship of every commit
 * for the last week is exactly what we want.
 *
 * An invocation is in "agent mode" when EITHER:
 *
 *   1. The process explicitly opts in via `GIT_GUARDRAILS_AGENT_MODE=1`.
 *      This is the recommended signal — the spawning script (e.g.
 *      `ops-agent/run.ts` in the rubber CI repo) sets it deliberately,
 *      and humans never set it accidentally.
 *
 *   2. The git author/committer email matches a known agent-identity
 *      pattern (currently `^ops-agent@`). This is a fallback for
 *      hand-rolled scripts that set the GIT_AUTHOR_* / GIT_COMMITTER_*
 *      env vars (the recommended way to scope identity per-process)
 *      but forgot to also set the explicit mode flag. It's intentionally
 *      narrow — only emails starting with `ops-agent@` qualify.
 *
 * Humans driving git interactively (whose terminal env contains neither
 * `GIT_GUARDRAILS_AGENT_MODE` nor agent-pattern emails) are unaffected
 * by agent-only rules.
 */

const AGENT_EMAIL_PATTERNS: RegExp[] = [/^ops-agent@/];

/**
 * Returns true iff this git invocation is happening in an autonomous-
 * agent context. See module-level doc for the criteria.
 *
 * Cheap: just reads env vars; no subprocesses, no fs.
 */
export function isAgentRun(): boolean {
  if (process.env['GIT_GUARDRAILS_AGENT_MODE'] === '1') return true;

  const author = process.env['GIT_AUTHOR_EMAIL'] ?? '';
  const committer = process.env['GIT_COMMITTER_EMAIL'] ?? '';
  for (const pattern of AGENT_EMAIL_PATTERNS) {
    if (pattern.test(author) || pattern.test(committer)) return true;
  }

  return false;
}
