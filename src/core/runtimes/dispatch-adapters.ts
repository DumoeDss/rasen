/**
 * The shipped dispatch adapters, one per dispatch-capable runtime.
 *
 * A sibling of `session-stores.ts`; see that module's header for why the four
 * implementation registries are separate modules and why every adapter member
 * is an arrow rather than a bare function reference.
 *
 * Every user-facing fact about a bridge lives on the adapter of the runtime
 * that bridge reaches, so a diagnostic about one bridge can never name
 * another bridge's tool or run another bridge's availability check
 * (design D6).
 */
import {
  runtimeIdentityEnv,
  type DispatchAdapter,
  type DispatchRuntime,
} from '../runtime-adapters.js';
import { probeClaudeAvailability } from '../claude/index.js';
import { probeCodexAvailability } from '../codex/index.js';

export const DISPATCH_ADAPTERS = {
  claude: {
    id: 'claude',
    bridge: 'claude-print',
    cliLabel: 'Claude Code',
    installHint: 'Claude Code CLI',
    defaultBinary: 'claude',
    binaryEnvVar: 'RASEN_CLAUDE_BIN',
    spawn: 'rasen-owned',
    childEnv: runtimeIdentityEnv('claude'),
    probeAvailability: () => probeClaudeAvailability(),
  },
  codex: {
    id: 'codex',
    bridge: 'codex-exec',
    cliLabel: 'codex',
    installHint: 'Codex CLI',
    defaultBinary: 'codex',
    /**
     * No `binaryEnvVar`: `codex/invocation.ts` returns argv and the
     * orchestration playbook owns the process, so Rasen never resolves the
     * binary. `childEnv` is declared all the same — Rasen cannot APPLY it
     * here, but the invocation surfaces it (`CodexExecInvocation.env`) so the
     * playbook does, and a Codex worker beneath a bridged Claude worker
     * overwrites the inherited `claude` identity instead of adopting it
     * (design D7).
     */
    spawn: 'playbook-owned',
    childEnv: runtimeIdentityEnv('codex'),
    probeAvailability: () => probeCodexAvailability(),
  },
} satisfies { [Id in DispatchRuntime]: DispatchAdapter<Id> };

/**
 * The environment for a worker Rasen spawns itself: what this process
 * inherited, with the TARGET runtime's own identity merged over it.
 *
 * Every rasen-owned spawn goes through here rather than reaching into an
 * adapter at the spawn site. The merge is UNCONDITIONAL and keyed on the
 * target, because the identity is an environment variable and therefore
 * inherited by the whole descendant tree: a target that contributed nothing
 * would let an ancestor's identity stand, and a Codex worker started beneath a
 * bridged Claude worker would report `claude` while carrying Codex's own
 * fingerprints (design D7).
 *
 * A `playbook-owned` target has no spawn Rasen controls, so this is not the
 * site that applies its identity — `CodexExecInvocation.env` is. Merging here
 * anyway keeps the answer the same whichever site builds the environment.
 */
export function bridgeChildEnv(
  target: DispatchRuntime,
  inherited: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  return { ...inherited, ...DISPATCH_ADAPTERS[target].childEnv };
}
