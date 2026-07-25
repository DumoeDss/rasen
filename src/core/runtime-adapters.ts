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
} as const satisfies Readonly<Record<string, RuntimeAdapterCapabilities>>;

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
