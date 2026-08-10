/**
 * Frozen-action session executor: the computed OS-by-backend capability matrix.
 *
 * The matrix is the SOLE "when capability allows" oracle for every driver face
 * (design D3; slice acceptance 6). It is a computed value, not prose: it
 * enumerates {linux, darwin, win32} x {in-tool, hosted-best-effort}, reads each
 * backend's frozen declaration, and joins it with current-platform availability
 * to produce a typed verdict per cell.
 *
 * Locked decision 13 scope: `hosted` is the shipped declared best-effort tier
 * on all three OSes (`exactCancel: false`, `scopeEmptyProof: false`); the
 * kernel-enforced authority tier is not a 0.2.0 backend. Locked decision 11:
 * `hosted` scope lifetime equals daemon lifetime.
 */

/**
 * The two declared 0.2.0 execution backends. The kernel-enforced tier is
 * deliberately absent (decision 13).
 */
export type ExecutionBackendId = 'in-tool' | 'hosted';

/**
 * The declared capability facts for one backend. These are the values the
 * matrix surfaces to every driver face BEFORE any backend process starts.
 *
 * `exactCancel` / `scopeEmptyProof` are optional rather than `false` for the
 * `in-tool` backend because in-tool makes NO process-authority claim at all
 * (design D2): the absence of a claim is itself the declared fact, not a false
 * value that could be read as "claimed and weak".
 */
export interface BackendDeclaration {
  readonly id: ExecutionBackendId;
  readonly durable: boolean;
  readonly headlessDriver: boolean;
  /** Present only when the backend makes an exact-termination claim. */
  readonly exactCancel?: boolean;
  /** Present only when the backend makes a scope-empty proof claim. */
  readonly scopeEmptyProof?: boolean;
  readonly usageAttribution: boolean;
  /** Exact durable multi-turn wake support for one stable hosted Session. */
  readonly continuableTurns: boolean;
  /**
   * Human label for the cancel terminal this backend produces, surfaced
   * before start so an operator cannot be surprised by it after a failure.
   */
  readonly cancelTerminalLabel: string;
}

/**
 * `in-tool`: the host tool (Claude Code / Codex) owns the worker process. rasen
 * declares no process-authority claim: not durable, not headless, no
 * exact-termination claim. The launcher-disappearance limitation is a declared
 * matrix fact, not an after-the-fact explanation.
 */
export const IN_TOOL_DECLARATION: BackendDeclaration = Object.freeze({
  id: 'in-tool',
  durable: false,
  headlessDriver: false,
  usageAttribution: true,
  continuableTurns: false,
  cancelTerminalLabel: 'launcher-disappeared / execution-lost',
});

/**
 * `hosted` best-effort: the rasen daemon owns a daemon-lifetime subprocess
 * through the shipped best-effort ProcessScope tiers (POSIX process group on
 * linux and darwin, Job object on win32). It declares `exactCancel: false` and
 * `scopeEmptyProof: false` before start with a `cancelled / emptiness-unproven`
 * cancel terminal. Daemon-lifetime durable and headless-driver capable.
 */
export const HOSTED_BEST_EFFORT_DECLARATION: BackendDeclaration = Object.freeze({
  id: 'hosted',
  durable: true,
  headlessDriver: true,
  exactCancel: false,
  scopeEmptyProof: false,
  usageAttribution: true,
  continuableTurns: true,
  cancelTerminalLabel: 'cancelled / emptiness-unproven',
});

/**
 * The frozen backend roster. Order is stable so matrix enumeration is stable.
 */
export const BACKEND_DECLARATIONS: readonly BackendDeclaration[] = Object.freeze([
  IN_TOOL_DECLARATION,
  HOSTED_BEST_EFFORT_DECLARATION,
]);

/**
 * The OSes the 0.2.0 roster declares support for. Any other platform has no
 * `hosted` tier and surfaces `authority-unavailable` rather than a silent
 * fallback.
 */
export const DECLARED_OPERATING_SYSTEMS = Object.freeze([
  'linux',
  'darwin',
  'win32',
] as const);

export type DeclaredOperatingSystem = (typeof DECLARED_OPERATING_SYSTEMS)[number];

/**
 * Why a hosted request cannot be served. Each value is a distinct typed reason;
 * none of them is "fall back to in-tool".
 */
export type AuthorityUnavailableReason =
  /**
   * The current host's best-effort scope could not be prepared (the scope
   * factory declined or the primitive is missing). The hosted tier is
   * declared for this OS but is not live on this host right now.
   */
  | 'hosted-tier-unavailable'
  /**
   * The cell describes a declared OS that is not the current host. A Run can
   * only execute on the current host; cross-host execution is out of scope.
   */
  | 'not-current-host'
  /**
   * The OS is not one of the declared hosted platforms. There is no hosted
   * tier to serve the request at all.
   */
  | 'unsupported-platform';

export type CapabilityAvailabilityVerdict =
  | { readonly kind: 'available' }
  | {
      readonly kind: 'authority-unavailable';
      readonly reason: AuthorityUnavailableReason;
      readonly message: string;
    };

/**
 * One matrix cell: a backend's declared facts joined with a typed availability
 * verdict for one OS.
 */
export interface ExecutionCapabilityCell {
  readonly operatingSystem: DeclaredOperatingSystem;
  readonly backend: ExecutionBackendId;
  readonly declaration: BackendDeclaration;
  readonly availability: CapabilityAvailabilityVerdict;
}

export interface ExecutionCapabilityMatrix {
  readonly hostPlatform: string;
  readonly cells: Readonly<Record<string, ExecutionCapabilityCell>>;
}

function cellKey(
  operatingSystem: DeclaredOperatingSystem,
  backend: ExecutionBackendId
): string {
  return `${operatingSystem}:${backend}`;
}

function isDeclaredOs(platform: string): platform is DeclaredOperatingSystem {
  return (DECLARED_OPERATING_SYSTEMS as readonly string[]).includes(platform);
}

/**
 * Compute the live availability verdict for a (os, backend) cell against the
 * current host platform and the prepared hosted-tier status.
 *
 * `in-tool` is available on every declared OS that is the current host: the
 * host tool is always present because rasen is running inside it. `hosted`
 * best-effort is available only on the current host AND only when its scope
 * tier prepared successfully; otherwise it returns a typed
 * `authority-unavailable` reason. A cell for an OS that is not the current host
 * is `authority-unavailable (not-current-host)` — the matrix documents the
 * declared roster, but only the current host can actually execute.
 */
function computeAvailability(
  operatingSystem: DeclaredOperatingSystem,
  backend: ExecutionBackendId,
  hostPlatform: string,
  hostedTierStatus: HostedTierStatus
): CapabilityAvailabilityVerdict {
  if (operatingSystem !== hostPlatform) {
    return {
      kind: 'authority-unavailable',
      reason: 'not-current-host',
      message: `The ${operatingSystem} cell is declared but is not the current host (${hostPlatform}); a Run can only execute on its own host.`,
    };
  }
  if (!isDeclaredOs(hostPlatform)) {
    return {
      kind: 'authority-unavailable',
      reason: 'unsupported-platform',
      message: `The current platform ${hostPlatform} has no declared hosted tier.`,
    };
  }
  if (backend === 'hosted') {
    if (hostedTierStatus !== 'available') {
      return {
        kind: 'authority-unavailable',
        reason: 'hosted-tier-unavailable',
        message:
          'The hosted best-effort scope could not be prepared on this host; the hosted tier is declared but not live.',
      };
    }
    return { kind: 'available' };
  }
  // in-tool: the host tool owns the worker; it is available on the current host
  // by definition because rasen is running inside it.
  return { kind: 'available' };
}

/**
 * Reflects whether the hosted best-effort scope could be prepared on the
 * current host. Defaults to `available`; an executor that observed a failed
 * preparation passes `unavailable` so the hosted cell reports
 * `authority-unavailable` rather than a silent fallback to in-tool.
 */
export type HostedTierStatus = 'available' | 'unavailable';

export interface BuildCapabilityMatrixOptions {
  readonly hostPlatform: string;
  readonly hostedTierStatus?: HostedTierStatus;
}

/**
 * Build the computed capability matrix. Enumerate the declared OSes x the
 * declared backends and read each cell's declaration + live availability. The
 * matrix is queryable before any Run starts and before any backend process is
 * started.
 */
export function buildExecutionCapabilityMatrix(
  options: BuildCapabilityMatrixOptions
): ExecutionCapabilityMatrix {
  const hostPlatform = options.hostPlatform;
  const hostedTierStatus: HostedTierStatus = options.hostedTierStatus ?? 'available';
  const cells: Record<string, ExecutionCapabilityCell> = {};
  // Enumerate the declared roster first so the matrix documents the full
  // OS x backend support table on every host.
  for (const operatingSystem of DECLARED_OPERATING_SYSTEMS) {
    for (const declaration of BACKEND_DECLARATIONS) {
      const availability = computeAvailability(
        operatingSystem,
        declaration.id,
        hostPlatform,
        hostedTierStatus
      );
      cells[cellKey(operatingSystem, declaration.id)] = Object.freeze({
        operatingSystem,
        backend: declaration.id,
        declaration,
        availability,
      });
    }
  }
  // If the current host is not one of the declared OSes, synthesize its cells
  // so the absence of a hosted tier is a queryable, pre-start-visible declared
  // boundary rather than a silent hole. Every cell on an undeclared host
  // reports `authority-unavailable (unsupported-platform)`.
  if (!isDeclaredOs(hostPlatform)) {
    for (const declaration of BACKEND_DECLARATIONS) {
      const availability: CapabilityAvailabilityVerdict = {
        kind: 'authority-unavailable',
        reason: 'unsupported-platform',
        message: `The current platform ${hostPlatform} has no declared ${declaration.id} tier.`,
      };
      cells[cellKey(hostPlatform as DeclaredOperatingSystem, declaration.id)] = Object.freeze({
        operatingSystem: hostPlatform as DeclaredOperatingSystem,
        backend: declaration.id,
        declaration,
        availability,
      });
    }
  }
  return Object.freeze({ hostPlatform, cells: Object.freeze(cells) });
}

/**
 * Query a single cell. Returns `undefined` for an (os, backend) pair outside
 * the declared roster — there is no cell to query, which is itself an
 * authority-unavailable signal at the resolver layer.
 */
export function queryCapabilityCell(
  matrix: ExecutionCapabilityMatrix,
  operatingSystem: string,
  backend: ExecutionBackendId
): ExecutionCapabilityCell | undefined {
  return matrix.cells[cellKey(operatingSystem as DeclaredOperatingSystem, backend)];
}

/**
 * The cells for the current host platform, in stable backend order. These are
 * the cells a driver face on this host consults to decide start/resume/cancel/
 * inspect availability.
 */
export function currentHostCells(
  matrix: ExecutionCapabilityMatrix
): readonly ExecutionCapabilityCell[] {
  return BACKEND_DECLARATIONS.map((declaration) =>
    matrix.cells[cellKey(matrix.hostPlatform as DeclaredOperatingSystem, declaration.id)]
  ).filter((cell): cell is ExecutionCapabilityCell => cell !== undefined);
}

/**
 * Provenance trail for a backend selection. `in-tool` is selectable ONLY by an
 * explicit request or an explicit pre-start-visible default; a hosted
 * unavailability is NEVER a valid origin for an in-tool selection.
 */
export type BackendSelectionOrigin =
  | { readonly kind: 'explicit-request'; readonly backend: ExecutionBackendId }
  | { readonly kind: 'explicit-default'; readonly backend: ExecutionBackendId }
  | { readonly kind: 'hosted-available'; readonly backend: 'hosted' };

export type BackendSelection =
  | {
      readonly kind: 'selected';
      readonly backend: ExecutionBackendId;
      readonly origin: BackendSelectionOrigin;
      readonly cell: ExecutionCapabilityCell;
    }
  | {
      readonly kind: 'authority-unavailable';
      readonly reason: AuthorityUnavailableReason;
      readonly message: string;
      readonly requested: ExecutionBackendId | 'hosted';
    };

export interface ResolveBackendSelectionOptions {
  readonly matrix: ExecutionCapabilityMatrix;
  /**
   * The backend an operator or author explicitly requested. When present and
   * available, it is selected with `explicit-request` provenance.
   */
  readonly requested?: ExecutionBackendId;
  /**
   * The explicit pre-start-visible default. Used only when no backend was
   * explicitly requested. The matrix MUST have shown this default to the user
   * before start (the caller enforces visibility; the resolver records the
   * origin).
   */
  readonly explicitDefault?: ExecutionBackendId;
  /** Require exact stable-Session continuation for an eligible source Action. */
  readonly requiresContinuableTurns?: boolean;
}

/**
 * Resolve a backend selection honouring the never-silently-reroute rule
 * (design D3; requirement "A hosted request the platform cannot serve is typed
 * authority-unavailable and never silently reroutes").
 *
 * A `hosted` request the current host cannot serve returns typed
 * `authority-unavailable` and starts NO in-tool backend in its place. `in-tool`
 * is selected only by an explicit request or an explicit pre-start-visible
 * default. There is no code path in this resolver that selects `in-tool` as an
 * automatic response to hosted unavailability.
 */
export function resolveBackendSelection(
  options: ResolveBackendSelectionOptions
): BackendSelection {
  const { matrix, requested, explicitDefault } = options;
  const host = matrix.hostPlatform;
  const desired = requested ?? explicitDefault;
  if (desired === 'hosted') {
    const cell = queryCapabilityCell(matrix, host, 'hosted');
    if (cell === undefined) {
      return {
        kind: 'authority-unavailable',
        reason: 'unsupported-platform',
        message: `The current platform ${host} has no declared hosted tier.`,
        requested: 'hosted',
      };
    }
    if (cell.availability.kind !== 'available') {
      return {
        kind: 'authority-unavailable',
        reason: cell.availability.reason,
        message: cell.availability.message,
        requested: 'hosted',
      };
    }
    if (options.requiresContinuableTurns && !cell.declaration.continuableTurns) {
      return {
        kind: 'authority-unavailable',
        reason: 'hosted-tier-unavailable',
        message: 'consultation-continuation-unavailable: selected backend cannot continue an exact stable Session.',
        requested: 'hosted',
      };
    }
    const origin: BackendSelectionOrigin =
      requested === 'hosted'
        ? { kind: 'explicit-request', backend: 'hosted' }
        : { kind: 'explicit-default', backend: 'hosted' };
    return { kind: 'selected', backend: 'hosted', origin, cell };
  }
  if (desired === 'in-tool') {
    const cell = queryCapabilityCell(matrix, host, 'in-tool');
    if (cell === undefined || cell.availability.kind !== 'available') {
      // in-tool is available on every declared current host by definition; a
      // missing cell means the platform is undeclared, which is itself a
      // typed unavailable signal rather than a reroute.
      return {
        kind: 'authority-unavailable',
        reason: 'unsupported-platform',
        message: `The current platform ${host} has no declared in-tool backend.`,
        requested: 'in-tool',
      };
    }
    if (options.requiresContinuableTurns) {
      return {
        kind: 'authority-unavailable',
        reason: 'hosted-tier-unavailable',
        message: 'consultation-continuation-unavailable: in-tool execution does not own a durable continuable Session.',
        requested: 'in-tool',
      };
    }
    const origin: BackendSelectionOrigin =
      requested === 'in-tool'
        ? { kind: 'explicit-request', backend: 'in-tool' }
        : { kind: 'explicit-default', backend: 'in-tool' };
    return { kind: 'selected', backend: 'in-tool', origin, cell };
  }
  // No backend requested and no explicit default: refuse to invent a backend.
  // Selecting one silently here would be exactly the implicit-launcher decision
  // this change exists to remove.
  return {
    kind: 'authority-unavailable',
    reason: 'hosted-tier-unavailable',
    message:
      'No backend was explicitly requested or declared as a pre-start-visible default; the executor refuses to select one implicitly.',
    requested: 'hosted',
  };
}
