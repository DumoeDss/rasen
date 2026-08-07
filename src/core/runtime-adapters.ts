/**
 * Shipped runtime adapters: the operations each one implements, the contracts
 * those implementations satisfy, and the derivations built on top of them.
 *
 * This module is a LEAF by design (design D1). It is imported by
 * `config-keys.ts`, `config-schema.ts`, `project-config.ts`,
 * `pipeline-registry/types.ts`, and `management-api/*`, so it declares
 * contracts and data only and never imports anything that executes. The
 * implementations that satisfy these contracts are registered in the four
 * sibling modules under `src/core/runtimes/` (`session-stores`,
 * `context-readers`, `audit-readers`, `dispatch-adapters`), which are free to
 * import `fs`, `child_process`, and the Zed SQLite reader.
 *
 * This registry deliberately does not reuse the installation-oriented
 * `AI_TOOLS` registry. Installing a tool and having a context probe, token
 * auditor, or pipeline dispatcher for it are separate contracts.
 */
import type { AgentContextResult } from './agent-context.js';
import type { RunAuditOptions, RunAuditResult } from './token-audit/audit.js';

export const RUNTIME_CAPABILITIES = [
  'canProbeContext',
  'canAudit',
  'canDispatch',
] as const;

export type RuntimeCapability = (typeof RUNTIME_CAPABILITIES)[number];

export type RuntimeAdapterCapabilities = Readonly<Record<RuntimeCapability, boolean>>;

export type RuntimeAdapterDefinition = RuntimeAdapterCapabilities;

export const RUNTIME_ADAPTERS = {
  claude: {
    canProbeContext: true,
    canAudit: true,
    canDispatch: true,
  },
  codex: {
    canProbeContext: true,
    canAudit: true,
    canDispatch: true,
  },
  zed: {
    canProbeContext: false,
    canAudit: true,
    canDispatch: false,
  },
  omp: {
    canProbeContext: true,
    canAudit: false,
    canDispatch: false,
  },
} as const satisfies Readonly<Record<string, RuntimeAdapterDefinition>>;

Object.values(RUNTIME_ADAPTERS).forEach(Object.freeze);
Object.freeze(RUNTIME_ADAPTERS);

export type RuntimeAdapterId = keyof typeof RUNTIME_ADAPTERS;

export type RuntimeForCapability<C extends RuntimeCapability> = {
  [R in RuntimeAdapterId]: (typeof RUNTIME_ADAPTERS)[R][C] extends true ? R : never;
}[RuntimeAdapterId];

export type ProbeRuntime = RuntimeForCapability<'canProbeContext'>;
export type AuditRuntime = RuntimeForCapability<'canAudit'>;
export type DispatchRuntime = RuntimeForCapability<'canDispatch'>;

/**
 * The harness a session runs in. Any registered adapter can be a host:
 * naming the harness is independent of Rasen being able to probe, audit, or
 * dispatch workers to it.
 */
export type HostRuntime = RuntimeAdapterId | 'unknown';
export type HostRuntimeSource =
  | 'env-override'
  | 'cli-option'
  | 'codex-thread-id'
  | 'codex-sandbox'
  | 'omp-code'
  | 'claude-code'
  | 'unknown';

export interface DetectedHostRuntime {
  runtime: HostRuntime;
  source: HostRuntimeSource;
}

export type DispatchMode =
  | 'native'
  | 'exec-bridge'
  | 'unsupported'
  | 'legacy-fallback';

export type DispatchBridge = 'codex-exec' | 'claude-print';

export interface DispatchRoute {
  host: HostRuntime;
  target: DispatchRuntime;
  mode: DispatchMode;
  bridge?: DispatchBridge;
}

/**
 * The bridge a dispatch-capable host runs to reach each target runtime.
 *
 * Leaf data, not an implementation: `resolveDispatchRoute` must stay
 * importable by schema consumers, so the mechanism's NAME lives here while
 * the mechanism's behavior (label, install advice, binary, availability
 * probe) lives on the target's {@link DispatchAdapter}. The adapter's own
 * `bridge` field is typed against this table, so the two cannot disagree.
 */
export const DISPATCH_BRIDGES = {
  claude: 'claude-print',
  codex: 'codex-exec',
} as const satisfies Readonly<Record<DispatchRuntime, DispatchBridge>>;

type DispatchRouteKey = `${DispatchRuntime}->${DispatchRuntime}`;

/**
 * Host/target pairs the derivation would otherwise serve but that are known
 * not to work.
 *
 * Empty on arrival — every shipped pair is genuinely supported. It exists so
 * an unsupported pair is a stated exception rather than a hole in a table,
 * which is why {@link DispatchMode} keeps its `'unsupported'` member
 * (design D5).
 */
const ROUTE_EXCEPTIONS: Readonly<Partial<Record<DispatchRouteKey, 'unsupported'>>> = {};

/**
 * The runtime a session target resolves to when no registered
 * {@link SessionStore} claims it.
 *
 * A stated decision, not the trailing branch of a sniff chain: an unclaimed
 * target is read by the Claude reader, whose own read produces an actionable
 * error rather than silently misrouting. Changing this value changes what
 * every unrecognized target resolves to (design D4).
 */
export const SNIFF_FALLBACK_RUNTIME = 'claude' satisfies RuntimeAdapterId;

/**
 * A target presented to session-store recognition: its path plus its first
 * non-empty line.
 *
 * The line is read once for the whole recognition pass rather than once per
 * store, and lazily — a store that recognizes by path alone (Zed's database
 * extension, Codex's rollout filename) never pays a read (design D3).
 */
export interface SessionTarget {
  readonly path: string;
  /** `undefined` when the target is unreadable, binary, or has no non-empty line. */
  readonly firstLine: string | undefined;
}

export interface LocateLatestOptions {
  /** Working directory whose live session is wanted. */
  cwd: string;
  /** Override for the store's root directory. */
  dir?: string;
  /** Home directory used to derive a default root. */
  homeDir?: string;
}

/**
 * Where a runtime keeps its sessions on the user's machine.
 *
 * Every registered runtime has one, whatever Rasen can do with it: recognizing
 * which harness owns a target is a registry concern independent of probe,
 * audit, and dispatch capability. Claude, Codex, and Oh My Pi each have ONE
 * store read by up to two readers; Zed's store is a SQLite database with no
 * transcript file at all (design D3).
 */
export interface SessionStore<Id extends RuntimeAdapterId = RuntimeAdapterId> {
  readonly id: Id;
  /** Whether this runtime wrote the target. */
  recognizes(target: SessionTarget): boolean;
  /**
   * Newest live session for a working directory. Absent when locating is not
   * implemented for this runtime, in which case `--latest` is unavailable for
   * it and callers must name a target explicitly.
   */
  locateLatest?(options: LocateLatestOptions): string;
}

/** Reads context-window occupancy out of one runtime's session. */
export interface ContextReader<Id extends ProbeRuntime = ProbeRuntime> {
  readonly id: Id;
  read(target: string, options?: { limit?: number }): AgentContextResult;
}

/** Analyses one runtime's session into a token-spend report. */
export interface AuditReader<Id extends AuditRuntime = AuditRuntime> {
  readonly id: Id;
  run(target: string, options: RunAuditOptions): Promise<RunAuditResult>;
}

/**
 * Every user-facing fact about the bridge that reaches a runtime (design D6).
 * A diagnostic about one bridge is built from that bridge's own adapter, so
 * it can never name another bridge's tool or check another bridge's binary.
 */
interface DispatchAdapterFacts<Id extends DispatchRuntime> {
  readonly id: Id;
  /** The mechanism another dispatch-capable host runs to reach this runtime. */
  readonly bridge: (typeof DISPATCH_BRIDGES)[Id];
  /** The tool the bridge runs, as a user reads it in a diagnostic. */
  readonly cliLabel: string;
  /** What to install when {@link DispatchAdapter.probeAvailability} is false. */
  readonly installHint: string;
  /** Default executable name looked up on PATH. */
  readonly defaultBinary: string;
  /**
   * Environment override Rasen honors when it resolves this runtime's binary
   * itself. Absent when Rasen never resolves the binary — a playbook-owned
   * spawn resolves its own.
   */
  readonly binaryEnvVar?: string;
  /** Whether this runtime's own tool is present on this machine. */
  probeAvailability(): boolean;
  /**
   * The identity a worker on this runtime MUST run with (design D7).
   *
   * REQUIRED on every adapter, not only the ones Rasen spawns itself. A
   * process inherits its whole ancestry's environment, so an identity injected
   * for one target stays set in every descendant: without a target of its own
   * to overwrite it, a Codex worker started beneath a bridged Claude worker
   * would report `claude` while holding Codex's fingerprints. Requiring it on
   * both arms is the enforcement — {@link RuntimeIdentityEnv} pins the value
   * to this adapter's own id, so a missing or wrong identity fails the build.
   */
  readonly childEnv: RuntimeIdentityEnv<Id>;
  /** Who applies {@link DispatchAdapterFacts.childEnv} — see {@link DispatchSpawnOwnership}. */
  readonly spawn: DispatchSpawnOwnership;
}

/**
 * The environment variable that tells a Rasen process what runtime it is.
 *
 * Rasen's own override, outranking every fingerprint in
 * {@link detectHostRuntime}. Named here so the key has one spelling across the
 * declaration, the merge, and the rendered playbook-owned invocation.
 */
export const RUNTIME_IDENTITY_ENV_VAR = 'RASEN_AGENT_RUNTIME';

/**
 * An environment carrying one runtime's identity.
 *
 * The key is required and its VALUE is pinned to the declaring runtime, so an
 * adapter that declares another runtime's identity fails the build rather
 * than mislabelling every worker it starts.
 */
export type RuntimeIdentityEnv<Id extends RuntimeAdapterId> = Readonly<
  Record<string, string>
> & { readonly [RUNTIME_IDENTITY_ENV_VAR]: Id };

/** The identity environment for one runtime — the only place the pair is built. */
export function runtimeIdentityEnv<Id extends RuntimeAdapterId>(id: Id): RuntimeIdentityEnv<Id> {
  return { [RUNTIME_IDENTITY_ENV_VAR]: id };
}

/**
 * Who applies {@link DispatchAdapter.childEnv} to the worker process.
 *
 * `rasen-owned` — Rasen builds the child's environment itself, so
 * `bridgeChildEnv` merges the identity at the spawn site.
 *
 * `playbook-owned` — `codex/invocation.ts` returns argv and the orchestration
 * playbook owns the process, so Rasen cannot apply the identity; the
 * invocation SURFACES it (`CodexExecInvocation.env`) and the playbook passes
 * it on the command it runs.
 */
export type DispatchSpawnOwnership = 'rasen-owned' | 'playbook-owned';

/** How Rasen runs a worker on one runtime. */
export type DispatchAdapter<Id extends DispatchRuntime = DispatchRuntime> =
  DispatchAdapterFacts<Id>;

interface HostFingerprint {
  /** Environment variable whose non-empty presence identifies the host. */
  readonly envVar: string;
  readonly runtime: RuntimeAdapterId;
  readonly source: HostRuntimeSource;
}

/**
 * Host fingerprints in resolution order — first non-empty match wins
 * (design D10).
 *
 * Precedence is fingerprint specificity under process nesting, not
 * popularity. Codex fingerprints precede every other host because a
 * `codex exec` child inherits its parent harness's variables while being a
 * genuine Codex process. `OMPCODE` precedes `CLAUDECODE` for the same
 * reason inverted: Oh My Pi sets `CLAUDECODE` itself, so trusting the
 * Claude fingerprint first would report every Oh My Pi session as Claude.
 *
 * Both Codex entries precede `OMPCODE`, not just the first: a sandboxed
 * `codex exec` child of Oh My Pi carries `CODEX_SANDBOX` without
 * `CODEX_THREAD_ID`, and inserting `OMPCODE` between the two would report it
 * as its parent.
 */
const HOST_FINGERPRINTS: readonly HostFingerprint[] = [
  { envVar: 'CODEX_THREAD_ID', runtime: 'codex', source: 'codex-thread-id' },
  { envVar: 'CODEX_SANDBOX', runtime: 'codex', source: 'codex-sandbox' },
  { envVar: 'OMPCODE', runtime: 'omp', source: 'omp-code' },
  { envVar: 'CLAUDECODE', runtime: 'claude', source: 'claude-code' },
];

function hasText(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * Detect the tool host running the LEAD.
 *
 * {@link RUNTIME_IDENTITY_ENV_VAR} is Rasen's own override and outranks every
 * fingerprint: it is how a worker is told what it is
 * ({@link DispatchAdapterFacts.childEnv}) rather than inferring it from an
 * environment it inherited. Fingerprint precedence is documented on
 * {@link HOST_FINGERPRINTS}.
 */
export function detectHostRuntime(
  env: NodeJS.ProcessEnv = process.env
): DetectedHostRuntime {
  const explicit = env[RUNTIME_IDENTITY_ENV_VAR]?.trim().toLowerCase();
  if (explicit !== undefined && Object.hasOwn(RUNTIME_ADAPTERS, explicit)) {
    return { runtime: explicit as RuntimeAdapterId, source: 'env-override' };
  }
  for (const fingerprint of HOST_FINGERPRINTS) {
    if (hasText(env[fingerprint.envVar])) {
      return { runtime: fingerprint.runtime, source: fingerprint.source };
    }
  }
  return { runtime: 'unknown', source: 'unknown' };
}

/**
 * Resolve the concrete dispatch mechanism implemented for a host/target pair,
 * derived from the shipped adapters rather than an enumerated matrix
 * (design D5):
 *
 * - a host with no dispatch adapter — unidentified or recognized — resolves
 *   to the observable legacy compatibility route rather than a fabricated one;
 * - a declared {@link ROUTE_EXCEPTIONS} pair is refused outright;
 * - a host targeting itself runs natively;
 * - otherwise the target's own bridge carries the dispatch.
 */
export function resolveDispatchRoute(
  host: HostRuntime,
  target: DispatchRuntime
): DispatchRoute {
  if (!hasRuntimeCapability(host, 'canDispatch')) {
    return { host, target, mode: 'legacy-fallback' };
  }
  if (ROUTE_EXCEPTIONS[`${host}->${target}`]) {
    return { host, target, mode: 'unsupported' };
  }
  if (host === target) return { host, target, mode: 'native' };
  return { host, target, mode: 'exec-bridge', bridge: DISPATCH_BRIDGES[target] };
}

/**
 * Capability-derived runtime values in registry declaration order. The
 * non-empty tuple type lets schema consumers pass these values directly to
 * enum constructors without recreating or casting local literal lists.
 */
export type RuntimeCapabilityValues<C extends RuntimeCapability> = readonly [
  RuntimeForCapability<C>,
  ...RuntimeForCapability<C>[],
];

function runtimesFor<C extends RuntimeCapability>(
  capability: C
): RuntimeCapabilityValues<C> {
  const values = (Object.keys(RUNTIME_ADAPTERS) as RuntimeAdapterId[]).filter(
    (runtime): runtime is RuntimeForCapability<C> =>
      RUNTIME_ADAPTERS[runtime][capability] === true
  );
  if (values.length === 0) {
    throw new Error(`Runtime capability "${capability}" must have at least one adapter.`);
  }
  return Object.freeze(values) as unknown as RuntimeCapabilityValues<C>;
}

export const PROBE_RUNTIMES = runtimesFor('canProbeContext');
export const AUDIT_RUNTIMES = runtimesFor('canAudit');
export const DISPATCH_RUNTIMES = runtimesFor('canDispatch');

/** Every registered runtime id, in registry declaration order. */
export const RUNTIME_ADAPTER_IDS = Object.freeze(
  Object.keys(RUNTIME_ADAPTERS) as RuntimeAdapterId[]
) as readonly RuntimeAdapterId[];

/** Return whether an unknown value names an adapter implementing `capability`. */
export function hasRuntimeCapability<C extends RuntimeCapability>(
  value: unknown,
  capability: C
): value is RuntimeForCapability<C> {
  return (
    typeof value === 'string' &&
    Object.hasOwn(RUNTIME_ADAPTERS, value) &&
    RUNTIME_ADAPTERS[value as RuntimeAdapterId][capability] === true
  );
}

/** Return whether an unknown value names any registered runtime adapter. */
export function isRuntimeAdapterId(value: unknown): value is RuntimeAdapterId {
  return typeof value === 'string' && Object.hasOwn(RUNTIME_ADAPTERS, value);
}
