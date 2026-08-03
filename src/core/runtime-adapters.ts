/**
 * Shipped runtime adapters and the operations each one actually implements.
 *
 * This registry deliberately does not reuse the installation-oriented
 * `AI_TOOLS` registry. Installing a tool and having a context probe, token
 * auditor, or pipeline dispatcher for it are separate contracts.
 */
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

export type HostRuntime = DispatchRuntime | 'unknown';
export type HostRuntimeSource =
  | 'env-override'
  | 'cli-option'
  | 'codex-thread-id'
  | 'codex-sandbox'
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

type KnownHostRuntime = Exclude<HostRuntime, 'unknown'>;

const KNOWN_DISPATCH_ROUTES = {
  claude: {
    claude: { mode: 'native' },
    codex: { mode: 'exec-bridge', bridge: 'codex-exec' },
  },
  codex: {
    claude: { mode: 'exec-bridge', bridge: 'claude-print' },
    codex: { mode: 'native' },
  },
} as const satisfies Readonly<
  Record<
    KnownHostRuntime,
    Readonly<Record<DispatchRuntime, Pick<DispatchRoute, 'mode' | 'bridge'>>>
  >
>;

function hasText(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * Detect the tool host running the LEAD. Codex fingerprints precede Claude
 * because nested Codex sessions can inherit Claude environment variables.
 */
export function detectHostRuntime(
  env: NodeJS.ProcessEnv = process.env
): DetectedHostRuntime {
  const explicit = env.RASEN_AGENT_RUNTIME?.trim().toLowerCase();
  if (explicit === 'claude' || explicit === 'codex') {
    return { runtime: explicit, source: 'env-override' };
  }
  if (hasText(env.CODEX_THREAD_ID)) {
    return { runtime: 'codex', source: 'codex-thread-id' };
  }
  if (hasText(env.CODEX_SANDBOX)) {
    return { runtime: 'codex', source: 'codex-sandbox' };
  }
  if (hasText(env.CLAUDECODE)) {
    return { runtime: 'claude', source: 'claude-code' };
  }
  return { runtime: 'unknown', source: 'unknown' };
}

/** Resolve the concrete dispatch mechanism implemented for a host/target pair. */
export function resolveDispatchRoute(
  host: HostRuntime,
  target: DispatchRuntime
): DispatchRoute {
  if (host === 'unknown') {
    return { host, target, mode: 'legacy-fallback' };
  }
  return { host, target, ...KNOWN_DISPATCH_ROUTES[host][target] };
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
