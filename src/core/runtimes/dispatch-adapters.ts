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
import { probeClaudeAvailability } from '../claude/index.js';
import { probeCodexAvailability } from '../codex/index.js';
import type { DispatchAdapter, DispatchRuntime } from '../runtime-adapters.js';

export const DISPATCH_ADAPTERS = {
  claude: {
    id: 'claude',
    bridge: 'claude-print',
    cliLabel: 'Claude Code',
    installHint: 'Claude Code CLI',
    defaultBinary: 'claude',
    binaryEnvVar: 'RASEN_CLAUDE_BIN',
    spawn: 'rasen-owned',
    /**
     * A child inherits the spawning harness's fingerprints, and the Codex
     * ones outrank `CLAUDECODE` by design. `RASEN_AGENT_RUNTIME` is Rasen's
     * own override and outranks all of them, so a bridged Claude worker
     * reports Claude whatever host started it (design D7).
     */
    childEnv: { RASEN_AGENT_RUNTIME: 'claude' },
    probeAvailability: () => probeClaudeAvailability(),
  },
  codex: {
    id: 'codex',
    bridge: 'codex-exec',
    cliLabel: 'codex',
    installHint: 'Codex CLI',
    defaultBinary: 'codex',
    /**
     * No `binaryEnvVar` and no `childEnv`: `codex/invocation.ts` returns argv
     * and the orchestration playbook owns the process, so Rasen never
     * resolves the binary and has no spawn to inject an environment into.
     * Declaring either would be a contract nothing honors — the asymmetry is
     * recorded rather than papered over (design D7).
     */
    spawn: 'playbook-owned',
    probeAvailability: () => probeCodexAvailability(),
  },
} satisfies { [Id in DispatchRuntime]: DispatchAdapter<Id> };

/**
 * The environment for a worker Rasen spawns itself: what this process
 * inherited, with the TARGET runtime's own identity merged over it.
 *
 * Every rasen-owned spawn goes through here rather than reaching into an
 * adapter at the spawn site. A child inherits the SPAWNING harness's
 * fingerprints — a Codex host's outrank `CLAUDECODE` — so without the merge a
 * bridged worker reports its parent's runtime as its own to every Rasen
 * command it runs (design D7). A `playbook-owned` target has no spawn Rasen
 * controls, so it contributes nothing and the inherited environment passes
 * through unchanged.
 */
export function bridgeChildEnv(
  target: DispatchRuntime,
  inherited: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const adapter = DISPATCH_ADAPTERS[target];
  return adapter.spawn === 'rasen-owned'
    ? { ...inherited, ...adapter.childEnv }
    : { ...inherited };
}
