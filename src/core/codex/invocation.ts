/**
 * `codex exec` invocation builder.
 *
 * Assembles a correct-by-construction non-interactive Codex dispatch as
 * structured data — this module never spawns a process; it returns argv plus
 * a stdin directive and a rendered shell string, and the caller (the
 * orchestration playbook today, possibly a runner later) owns process
 * lifecycle. Every invariant baked in here was live-verified against
 * codex-cli {@link CODEX_CLI_VERSION_PREMISE} in `docs/codex-parity/`:
 *
 *  - stdin must be closed or `codex exec` blocks forever awaiting EOF (E01);
 *  - `ultra` reasoning effort auto-delegates to sub-agents and would break the
 *    flat leaf-worker invariant, so it is clamped to `xhigh` (E11);
 *  - the native hierarchical multi-agent system is suppressible only at the
 *    prompt level, so every leaf dispatch gets an appended no-delegation
 *    guard (E11);
 *  - a `model_providers` override is a config-driven injection point, never a
 *    hardcoded default (E01 documents it as a machine-specific auth quirk,
 *    not a design surface);
 *  - `resume` (lifecycle design D1) is an additive option on this SAME
 *    builder, not a second one — `codex exec resume <threadId>` re-enters an
 *    existing thread from any process/cwd with full prior context (E02),
 *    composing with every other flag EXCEPT `-s`/`--sandbox`, which `codex
 *    exec resume` does not accept at all (live-verified dev-machine smoke
 *    test, lifecycle task 6.2 — sandbox mode is fixed at thread creation, not
 *    a per-resume override; the builder omits `-s` on resume dispatches).
 *    There is no `--last` form: "the most recent thread" is a race under
 *    parallel dispatch, so resume always requires an explicit thread id.
 */
import { CODEX_CLI_VERSION_PREMISE } from './codex-home.js';
import { inlineCommandTemplate, type TemplateInliner } from './template-inline.js';

export type CodexSandboxMode = 'read-only' | 'workspace-write';

/**
 * Reasoning effort accepted from a caller/pipeline config. `ultra` is only
 * ever valid for a non-leaf (delegating) dispatch, which this builder does
 * not support (design D3) — it is always clamped to `xhigh` here.
 */
export type CodexReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra';

/**
 * A config-driven Codex model-provider override. Present only when a caller
 * needs to route around the built-in provider (e.g. this dev machine's
 * reverse-proxy auth quirk documented in `docs/codex-parity/experiments/E01`).
 * The builder never fabricates one — absence means "let Codex use its own
 * configured provider".
 */
export interface ModelProviderOverride {
  /** Provider name, e.g. "proxy". Selected via `-c model_provider="<name>"`. */
  name: string;
  baseUrl: string;
  wireApi?: string;
  envKey?: string;
}

export interface CodexTemplateOptions {
  /** Raw source of a rasen-generated command `.md` file (frontmatter + body). */
  source: string;
  /** Argument string substituted for `$ARGUMENTS` in the template body. */
  args: string;
  /** Defaults to {@link inlineCommandTemplate}. */
  inliner?: TemplateInliner;
}

/**
 * Resume an existing thread instead of starting a fresh one (lifecycle design
 * D1). Explicit thread id only — there is no `--last` form, because "the most
 * recent thread" is ambiguous under parallel dispatch; the LEAD always holds
 * explicit thread ids in run-state.
 */
export interface CodexResumeOptions {
  threadId: string;
}

export interface BuildCodexExecInvocationOptions {
  /** Task prompt for the leaf worker (appended after any inlined template). */
  prompt: string;
  /** Path `codex exec -o` writes the final agent message to. */
  outputLastMessagePath: string;
  sandbox: CodexSandboxMode;
  model: string;
  effort: CodexReasoningEffort;
  /** Optional client-side template to inline ahead of `prompt` (design D6). */
  template?: CodexTemplateOptions;
  /** Optional provider override; emits no provider flags when absent (design D5). */
  providerOverride?: ModelProviderOverride;
  /** Optional `--output-schema <file>` path for a structured-return contract. */
  outputSchemaPath?: string;
  /**
   * When present, builds `codex exec resume <threadId> …` instead of a fresh
   * dispatch — every other invariant (stdin, guard, effort clamp, schema/
   * provider composition) is unchanged (lifecycle design D1). No second
   * builder: this is the same function, additively extended.
   */
  resume?: CodexResumeOptions;
}

export interface CodexExecInvocation {
  command: 'codex';
  /** Full argv after `command`, in emission order (`exec`, flags, prompt last). */
  args: string[];
  /** Directs the caller to close stdin on spawn — `codex exec` hangs otherwise (E01). */
  stdin: 'ignore';
  /** The fully assembled prompt (inlined template + task prompt + flat guard). */
  prompt: string;
  /** Non-fatal notices, e.g. an effort clamp. Empty array when none apply. */
  warnings: string[];
}

/**
 * Named, trackable (per the repo's "if we generate it, track it by name"
 * rule) flat-hierarchy guard appended as the final paragraph of every leaf
 * dispatch prompt. codex-cli {@link CODEX_CLI_VERSION_PREMISE} enables a
 * hierarchical multi-agent system by default; prompt-level suppression is the
 * only verified control (no `-c` hard-disable exists — E11). This carries the
 * same "a model can still disobey" trust model as a Claude Task-tool worker
 * today; there is no stronger guarantee available at this CLI version.
 */
export const CODEX_FLAT_HIERARCHY_GUARD =
  'You are a leaf worker. Do not use spawn_agent, followup_task, send_message, wait_agent, or any sub-agent delegation tool under any circumstances. Do all work yourself in this session.';

/** TOML string-value quoting for `-c key="value"` overrides (double-quote + backslash escape). */
function tomlQuote(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Clamp a requested reasoning effort for leaf dispatch. `ultra` auto-delegates
 * (E11) and would violate the flat-hierarchy invariant this module enforces,
 * so it is silently clamped to `xhigh` with a warning recorded on the
 * invocation rather than treated as an error — effort is advisory tuning, not
 * correctness input (design D3). Every other value passes through unchanged.
 *
 * Exported so `identity.ts` can apply the identical clamp when a caller
 * records an effort value that didn't actually go through the builder —
 * keeping run-state records honest about what a leaf dispatch can ever run.
 */
export function clampLeafEffort(effort: CodexReasoningEffort): {
  effort: Exclude<CodexReasoningEffort, 'ultra'>;
  warning?: string;
} {
  if (effort === 'ultra') {
    return {
      effort: 'xhigh',
      warning:
        'Reasoning effort "ultra" auto-delegates to sub-agents and is not valid for a leaf dispatch; clamped to "xhigh".',
    };
  }
  return { effort };
}

/**
 * Build a `codex exec` invocation for a leaf worker. Returns data only — the
 * caller spawns the process (with stdin closed, per `stdin: 'ignore'`) or
 * renders it to a shell string via {@link formatShellInvocation}.
 */
export function buildCodexExecInvocation(
  options: BuildCodexExecInvocationOptions
): CodexExecInvocation {
  const warnings: string[] = [];
  const { effort, warning } = clampLeafEffort(options.effort);
  if (warning) warnings.push(warning);

  const templateBody = options.template
    ? (options.template.inliner ?? { inline: inlineCommandTemplate }).inline(
        options.template.source,
        options.template.args
      )
    : undefined;

  const prompt = [templateBody, options.prompt, CODEX_FLAT_HIERARCHY_GUARD]
    .filter((part): part is string => Boolean(part && part.length > 0))
    .join('\n\n');

  const args: string[] = ['exec'];
  if (options.resume) {
    args.push('resume', options.resume.threadId);
  }
  args.push('--json');

  if (options.outputSchemaPath) {
    args.push('--output-schema', options.outputSchemaPath);
  }

  args.push('-o', options.outputLastMessagePath);
  // `codex exec resume` does not accept `-s`/`--sandbox` at all — live-verified
  // (dev-machine smoke test, task 6.2): `codex exec resume --help` omits it,
  // and a real invocation carrying `-s` fails fast with "unexpected argument
  // '-s' found" before any dispatch happens. Sandbox mode is fixed at thread
  // creation and is not a per-resume-call override; a fresh dispatch still
  // gets `-s` (the original design/spec claim that resume composes with the
  // same `-o`/`-s`/`-m` set as fresh dispatch was wrong and is corrected here
  // and in the spec). `sandbox` stays a required option even under resume (a
  // resume call still needs SOME value to satisfy the type, since callers
  // build both forms through the same options object) but its value is
  // discarded here — silently would leave a caller with no way to tell its
  // sandbox request was ignored, so a warning is recorded on the same
  // `warnings` channel the effort clamp already uses.
  if (options.resume) {
    warnings.push(
      `Sandbox mode "${options.sandbox}" was requested but ignored: codex exec resume does not accept -s/--sandbox; the thread runs under its creation-time sandbox.`
    );
  } else {
    args.push('-s', options.sandbox);
  }
  args.push('-m', options.model);
  args.push('-c', `model_reasoning_effort=${tomlQuote(effort)}`);

  const override = options.providerOverride;
  if (override) {
    args.push('-c', `model_providers.${override.name}.name=${tomlQuote(override.name)}`);
    args.push('-c', `model_providers.${override.name}.base_url=${tomlQuote(override.baseUrl)}`);
    if (override.wireApi) {
      args.push('-c', `model_providers.${override.name}.wire_api=${tomlQuote(override.wireApi)}`);
    }
    if (override.envKey) {
      args.push('-c', `model_providers.${override.name}.env_key=${tomlQuote(override.envKey)}`);
    }
    args.push('-c', `model_provider=${tomlQuote(override.name)}`);
  }

  args.push(prompt);

  return {
    command: 'codex',
    args,
    stdin: 'ignore',
    prompt,
    warnings,
  };
}

export interface FormatShellInvocationOptions {
  /**
   * `posix` (default) renders single-quoted args ending in `< /dev/null`.
   * `windows` renders a `cmd`-quoted form ending in `< NUL` — cmd has no
   * general-purpose strong-quoting mechanism, so the windows form only
   * escapes `"` and does not attempt to neutralize `%`, `^`, or `&`; prefer
   * the argv (`command`/`args`/`stdin`) form for programmatic Windows spawns.
   */
  shell?: 'posix' | 'windows';
}

/** POSIX single-quote escaping: close, escaped literal quote, reopen. */
function posixQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/** Minimal cmd.exe double-quote escaping (see {@link FormatShellInvocationOptions}). */
function windowsQuote(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * Render a {@link CodexExecInvocation} as a shell command string, including
 * the stdin-closing redirect the invocation directs the caller to apply.
 *
 * cmd.exe has no way to embed a literal newline inside a quoted argument, so
 * a `windows`-rendered command built from a real dispatch prompt (which
 * virtually always contains newlines — inlined template + task prompt + the
 * flat guard, joined with blank lines) is broken. Rather than fail silently,
 * this pushes a warning onto `invocation.warnings` (mutating the passed-in
 * invocation, same object the caller already holds) when that happens, and
 * still renders best-effort — prefer the argv (`command`/`args`/`stdin`) form
 * for a real Windows spawn.
 */
export function formatShellInvocation(
  invocation: CodexExecInvocation,
  options: FormatShellInvocationOptions = {}
): string {
  const shell = options.shell ?? 'posix';
  const quote = shell === 'windows' ? windowsQuote : posixQuote;
  const redirect = shell === 'windows' ? '< NUL' : '< /dev/null';
  if (shell === 'windows' && invocation.args.some((arg) => arg.includes('\n'))) {
    invocation.warnings.push(
      'Rendered a Windows shell command from an argument containing a newline; cmd.exe cannot quote newlines, so this command will not run correctly. Use the argv (command/args/stdin) form instead.'
    );
  }
  const parts = [invocation.command, ...invocation.args].map(quote);
  return `${parts.join(' ')} ${redirect}`;
}
