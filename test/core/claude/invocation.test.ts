import { describe, expect, it } from 'vitest';

import {
  buildClaudePrintInvocation,
  CLAUDE_FLAT_HIERARCHY_GUARD,
  CLAUDE_LEAF_DENIED_TOOLS,
} from '../../../src/core/claude/index.js';

describe('buildClaudePrintInvocation', () => {
  it('composes inlined template, skill, task, contract, handoff, and flat guard', () => {
    const invocation = buildClaudePrintInvocation({
      prompt: 'task prompt',
      contract: 'leaf',
      sandbox: 'workspace-write',
      model: 'sonnet',
      effort: 'high',
      template: {
        source: '---\ndescription: fixture\n---\nTemplate $ARGUMENTS',
        args: 'ARGS',
      },
      skillContent: 'SKILL BODY',
      handoffContract: 'HANDOFF RULES',
    });
    expect(invocation.prompt).toContain('Template ARGS');
    expect(invocation.prompt).toContain('SKILL BODY');
    expect(invocation.prompt).toContain('task prompt');
    expect(invocation.prompt).toContain('HANDOFF RULES');
    expect(invocation.prompt).toContain(CLAUDE_FLAT_HIERARCHY_GUARD);
    expect(invocation.args).toContain(CLAUDE_LEAF_DENIED_TOOLS.join(','));
    expect(invocation.args).not.toContain(invocation.prompt);
  });

  it('maps read-only and workspace-write permission modes', () => {
    const readOnly = buildClaudePrintInvocation({
      prompt: 'read',
      contract: 'leaf',
      sandbox: 'read-only',
    });
    const write = buildClaudePrintInvocation({
      prompt: 'write',
      contract: 'leaf',
      sandbox: 'workspace-write',
    });
    expect(readOnly.args.slice(readOnly.args.indexOf('--permission-mode'), -1)).toContain('plan');
    expect(write.args).toContain('acceptEdits');
  });

  it('uses exact resume identity and preserves metacharacter-bearing values', () => {
    const invocation = buildClaudePrintInvocation({
      prompt: 'line 1\n中文 & |',
      contract: 'evaluate',
      sandbox: 'read-only',
      model: 'model with spaces & literal',
      effort: 'xhigh',
      resumeSessionId: 'session-id-exact',
    });
    expect(invocation.args.slice(-2)).toEqual(['--resume', 'session-id-exact']);
    expect(invocation.args).not.toContain('--continue');
    expect(invocation.args).toContain('model with spaces & literal');
    expect(invocation.args.join(' ')).not.toContain('line 1');
    expect(invocation.stdin).toContain('line 1\n中文 & |');
  });

  it('rejects empty prompt/model/session identity', () => {
    expect(() =>
      buildClaudePrintInvocation({
        prompt: ' ',
        contract: 'leaf',
        sandbox: 'read-only',
      })
    ).toThrow(/prompt/);
    expect(() =>
      buildClaudePrintInvocation({
        prompt: 'x',
        contract: 'leaf',
        sandbox: 'read-only',
        model: '',
      })
    ).toThrow(/model/);
    expect(() =>
      buildClaudePrintInvocation({
        prompt: 'x',
        contract: 'leaf',
        sandbox: 'read-only',
        resumeSessionId: '',
      })
    ).toThrow(/session/);
    expect(() =>
      buildClaudePrintInvocation({
        prompt: 'x',
        contract: 'leaf',
        sandbox: 'read-only',
        effort: 'ultra' as 'max',
      })
    ).toThrow(/Unsupported Claude effort/);
  });
});
