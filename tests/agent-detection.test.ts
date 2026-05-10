import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { isAgentRun } from '../src/agent-detection.ts';

describe('isAgentRun', () => {
  // Save/restore env so tests don't leak into each other or into the
  // outer test runner's environment.
  const ENV_KEYS = [
    'GIT_GUARDRAILS_AGENT_MODE',
    'GIT_AUTHOR_EMAIL',
    'GIT_COMMITTER_EMAIL',
  ];
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      const v = saved[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  test('false by default (no env vars set)', () => {
    expect(isAgentRun()).toBe(false);
  });

  test('true when GIT_GUARDRAILS_AGENT_MODE=1', () => {
    process.env['GIT_GUARDRAILS_AGENT_MODE'] = '1';
    expect(isAgentRun()).toBe(true);
  });

  test('false when GIT_GUARDRAILS_AGENT_MODE is any other value', () => {
    process.env['GIT_GUARDRAILS_AGENT_MODE'] = '0';
    expect(isAgentRun()).toBe(false);
    process.env['GIT_GUARDRAILS_AGENT_MODE'] = 'true';
    expect(isAgentRun()).toBe(false);
    process.env['GIT_GUARDRAILS_AGENT_MODE'] = '';
    expect(isAgentRun()).toBe(false);
  });

  test('true when GIT_AUTHOR_EMAIL matches ops-agent@ pattern', () => {
    process.env['GIT_AUTHOR_EMAIL'] = 'ops-agent@rubber.ci';
    expect(isAgentRun()).toBe(true);
  });

  test('true when GIT_COMMITTER_EMAIL matches ops-agent@ pattern', () => {
    process.env['GIT_COMMITTER_EMAIL'] = 'ops-agent@rubber.ci';
    expect(isAgentRun()).toBe(true);
  });

  test('true when only one of author/committer is the agent', () => {
    process.env['GIT_AUTHOR_EMAIL'] = 'human@example.com';
    process.env['GIT_COMMITTER_EMAIL'] = 'ops-agent@example.com';
    expect(isAgentRun()).toBe(true);
  });

  test('false for human emails that do not match agent patterns', () => {
    process.env['GIT_AUTHOR_EMAIL'] = 'josiahbryan@gmail.com';
    process.env['GIT_COMMITTER_EMAIL'] = 'josiahbryan@gmail.com';
    expect(isAgentRun()).toBe(false);
  });

  test('false for emails that contain "ops-agent" but do not start with it', () => {
    process.env['GIT_AUTHOR_EMAIL'] = 'not-ops-agent@example.com';
    expect(isAgentRun()).toBe(false);
    process.env['GIT_AUTHOR_EMAIL'] = 'human-ops-agent@example.com';
    expect(isAgentRun()).toBe(false);
  });
});
