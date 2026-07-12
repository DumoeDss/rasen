import { describe, expect, it } from 'vitest';
import {
  buildCodexExecInvocation,
  CODEX_FLAT_HIERARCHY_GUARD,
  formatShellInvocation,
  type TemplateInliner,
} from '../../../src/core/codex/invocation.js';

describe('buildCodexExecInvocation', () => {
  it('assembles the full flag set for a fully-specified leaf dispatch', () => {
    const invocation = buildCodexExecInvocation({
      prompt: 'Do the task.',
      outputLastMessagePath: '/tmp/last.txt',
      sandbox: 'workspace-write',
      model: 'gpt-5.6-sol',
      effort: 'high',
    });

    expect(invocation.command).toBe('codex');
    expect(invocation.stdin).toBe('ignore');
    expect(invocation.args[0]).toBe('exec');
    expect(invocation.args).toContain('--json');
    expect(invocation.args).toEqual(
      expect.arrayContaining([
        '-o',
        '/tmp/last.txt',
        '-s',
        'workspace-write',
        '-m',
        'gpt-5.6-sol',
        '-c',
        'model_reasoning_effort="high"',
      ])
    );
    // Prompt is the final positional argument.
    expect(invocation.args[invocation.args.length - 1]).toBe(invocation.prompt);
    expect(invocation.prompt).toContain('Do the task.');
    expect(invocation.warnings).toEqual([]);
  });

  it('includes --output-schema when a schema path is supplied', () => {
    const invocation = buildCodexExecInvocation({
      prompt: 'Task',
      outputLastMessagePath: '/tmp/last.txt',
      sandbox: 'read-only',
      model: 'gpt-5.6-sol',
      effort: 'low',
      outputSchemaPath: '/tmp/schema.json',
    });
    expect(invocation.args).toEqual(
      expect.arrayContaining(['--output-schema', '/tmp/schema.json'])
    );
  });

  it('clamps ultra effort to xhigh and records a warning', () => {
    const invocation = buildCodexExecInvocation({
      prompt: 'Task',
      outputLastMessagePath: '/tmp/last.txt',
      sandbox: 'read-only',
      model: 'gpt-5.6-sol',
      effort: 'ultra',
    });
    expect(invocation.args).toEqual(expect.arrayContaining(['-c', 'model_reasoning_effort="xhigh"']));
    expect(invocation.warnings).toHaveLength(1);
    expect(invocation.warnings[0]).toMatch(/ultra/i);
    expect(invocation.warnings[0]).toMatch(/xhigh/i);
  });

  it.each(['low', 'medium', 'high', 'xhigh', 'max'] as const)(
    'passes effort "%s" through unchanged with no warning',
    (effort) => {
      const invocation = buildCodexExecInvocation({
        prompt: 'Task',
        outputLastMessagePath: '/tmp/last.txt',
        sandbox: 'read-only',
        model: 'gpt-5.6-sol',
        effort,
      });
      expect(invocation.args).toEqual(
        expect.arrayContaining(['-c', `model_reasoning_effort="${effort}"`])
      );
      expect(invocation.warnings).toEqual([]);
    }
  );

  it('always appends the flat-hierarchy guard as the final paragraph', () => {
    const invocation = buildCodexExecInvocation({
      prompt: 'Task prompt.',
      outputLastMessagePath: '/tmp/last.txt',
      sandbox: 'read-only',
      model: 'm',
      effort: 'low',
    });
    expect(invocation.prompt.endsWith(CODEX_FLAT_HIERARCHY_GUARD)).toBe(true);
    expect(CODEX_FLAT_HIERARCHY_GUARD).toMatch(/spawn_agent/);
    expect(CODEX_FLAT_HIERARCHY_GUARD).toMatch(/followup_task/);
    expect(CODEX_FLAT_HIERARCHY_GUARD).toMatch(/send_message/);
    expect(CODEX_FLAT_HIERARCHY_GUARD).toMatch(/wait_agent/);
  });

  it('emits no provider flags when no override is supplied', () => {
    const invocation = buildCodexExecInvocation({
      prompt: 'Task',
      outputLastMessagePath: '/tmp/last.txt',
      sandbox: 'read-only',
      model: 'm',
      effort: 'low',
    });
    expect(invocation.args.join(' ')).not.toMatch(/model_provider/);
  });

  it('emits model_providers.* and model_provider flags when an override is supplied', () => {
    const invocation = buildCodexExecInvocation({
      prompt: 'Task',
      outputLastMessagePath: '/tmp/last.txt',
      sandbox: 'read-only',
      model: 'm',
      effort: 'low',
      providerOverride: {
        name: 'proxy',
        baseUrl: 'https://example.com/v1',
        wireApi: 'responses',
        envKey: 'OPENAI_API_KEY',
      },
    });
    expect(invocation.args).toEqual(
      expect.arrayContaining([
        '-c',
        'model_providers.proxy.name="proxy"',
        '-c',
        'model_providers.proxy.base_url="https://example.com/v1"',
        '-c',
        'model_providers.proxy.wire_api="responses"',
        '-c',
        'model_providers.proxy.env_key="OPENAI_API_KEY"',
        '-c',
        'model_provider="proxy"',
      ])
    );
  });

  it('omits optional wireApi/envKey flags when not provided on the override', () => {
    const invocation = buildCodexExecInvocation({
      prompt: 'Task',
      outputLastMessagePath: '/tmp/last.txt',
      sandbox: 'read-only',
      model: 'm',
      effort: 'low',
      providerOverride: { name: 'proxy', baseUrl: 'https://example.com/v1' },
    });
    expect(invocation.args.join(' ')).not.toMatch(/wire_api/);
    expect(invocation.args.join(' ')).not.toMatch(/env_key/);
  });

  it('prepends an inlined template body before the task prompt and guard', () => {
    const invocation = buildCodexExecInvocation({
      prompt: 'Task prompt.',
      outputLastMessagePath: '/tmp/last.txt',
      sandbox: 'read-only',
      model: 'm',
      effort: 'low',
      template: { source: '---\ndescription: d\n---\nInlined body $ARGUMENTS.', args: 'X' },
    });
    const bodyIdx = invocation.prompt.indexOf('Inlined body X.');
    const taskIdx = invocation.prompt.indexOf('Task prompt.');
    const guardIdx = invocation.prompt.indexOf(CODEX_FLAT_HIERARCHY_GUARD);
    expect(bodyIdx).toBeGreaterThanOrEqual(0);
    expect(bodyIdx).toBeLessThan(taskIdx);
    expect(taskIdx).toBeLessThan(guardIdx);
  });

  it('uses a custom inliner when supplied through the builder', () => {
    const customInliner: TemplateInliner = {
      inline: (source, args) => `CUSTOM[${source}|${args}]`,
    };
    const invocation = buildCodexExecInvocation({
      prompt: 'Task prompt.',
      outputLastMessagePath: '/tmp/last.txt',
      sandbox: 'read-only',
      model: 'm',
      effort: 'low',
      template: { source: 'src', args: 'a', inliner: customInliner },
    });
    expect(invocation.prompt).toContain('CUSTOM[src|a]');
  });
});

describe('formatShellInvocation', () => {
  const base = () =>
    buildCodexExecInvocation({
      prompt: 'Task prompt.',
      outputLastMessagePath: '/tmp/last.txt',
      sandbox: 'read-only',
      model: 'm',
      effort: 'low',
    });

  it('renders a POSIX shell command ending in < /dev/null', () => {
    const rendered = formatShellInvocation(base());
    expect(rendered.endsWith('< /dev/null')).toBe(true);
    expect(rendered.startsWith("'codex' 'exec'")).toBe(true);
  });

  it('renders a Windows cmd command ending in < NUL', () => {
    const rendered = formatShellInvocation(base(), { shell: 'windows' });
    expect(rendered.endsWith('< NUL')).toBe(true);
    expect(rendered).toContain('"codex" "exec"');
  });

  it('warns when rendering a Windows command from a newline-containing prompt (cmd.exe cannot quote newlines)', () => {
    // A real assembled prompt always contains newlines (task prompt + guard
    // joined with blank lines), so `base()` itself already triggers this.
    const invocation = base();
    expect(invocation.warnings).toEqual([]);
    formatShellInvocation(invocation, { shell: 'windows' });
    expect(invocation.warnings).toHaveLength(1);
    expect(invocation.warnings[0]).toMatch(/newline/i);
    expect(invocation.warnings[0]).toMatch(/windows|cmd/i);
  });

  it('does not warn when rendering POSIX from the same newline-containing prompt', () => {
    const invocation = base();
    formatShellInvocation(invocation);
    expect(invocation.warnings).toEqual([]);
  });

  it('does not warn on Windows rendering when no argument contains a newline', () => {
    // The builder always appends the flat guard with blank-line separators, so
    // this asserts directly against a hand-built single-line invocation rather
    // than one from buildCodexExecInvocation.
    const singleLine = {
      command: 'codex' as const,
      args: ['exec', '--json', '-o', '/tmp/last.txt', 'no newline here'],
      stdin: 'ignore' as const,
      prompt: 'no newline here',
      warnings: [] as string[],
    };
    formatShellInvocation(singleLine, { shell: 'windows' });
    expect(singleLine.warnings).toEqual([]);
  });

  it('escapes single quotes in the prompt for POSIX shell (torture case)', () => {
    const invocation = buildCodexExecInvocation({
      prompt: "It's a test.",
      outputLastMessagePath: '/tmp/last.txt',
      sandbox: 'read-only',
      model: 'm',
      effort: 'low',
    });
    const rendered = formatShellInvocation(invocation);
    expect(rendered).toContain("'\\''");
  });

  it('handles newlines, dollar signs, and backticks in the prompt without breaking quoting', () => {
    const invocation = buildCodexExecInvocation({
      prompt: 'Line1\nLine2 $HOME `whoami`',
      outputLastMessagePath: '/tmp/last.txt',
      sandbox: 'read-only',
      model: 'm',
      effort: 'low',
    });
    const rendered = formatShellInvocation(invocation);
    // The whole prompt is wrapped in a single-quoted argument, so $ and ` are inert.
    expect(rendered).toContain("Line1\nLine2 $HOME `whoami`");
    expect(rendered.endsWith('< /dev/null')).toBe(true);
  });
});
