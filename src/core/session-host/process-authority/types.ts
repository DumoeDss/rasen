declare const providerAuthorityReferenceBrand: unique symbol;

/** Opaque provider-side authority. Common callers can retain it but cannot inspect it. */
export type ProviderAuthorityReference = string & {
  readonly [providerAuthorityReferenceBrand]: true;
};

declare const processAuthorityReferenceBrand: unique symbol;

/**
 * Durable authority value exposed above the provider boundary.
 *
 * This full value is a sensitive replayable control reference. It may be
 * persisted only by trusted authority owners and must not be logged. Use the
 * redacted public view for diagnostics.
 */
export type ProcessAuthorityReference = string & {
  readonly [processAuthorityReferenceBrand]: true;
};

export const PROCESS_AUTHORITY_COMMON_CONTRACT_VERSION = 1 as const;
export const RECURSIVE_PROCESS_SCOPE_CAPABILITY_ID =
  'rasen-recursive-process-scope/1' as const;

export const RECURSIVE_PROCESS_SCOPE_SEMANTICS = Object.freeze([
  'forked-descendant-non-escape',
  'root-exit-distinct',
  'natural-exact-empty',
  'recursive-terminate',
  'recursive-abort',
  'bounded-controls',
  'identity-drift-detection',
  'event-completeness',
] as const);

export type RecursiveProcessScopeSemantic =
  (typeof RECURSIVE_PROCESS_SCOPE_SEMANTICS)[number];

export interface ProcessAuthoritySelection {
  readonly providerId: string;
  readonly capabilityId: string;
  readonly protocolVersion: number;
}

export interface ProcessAuthorityProviderDescriptor extends ProcessAuthoritySelection {
  readonly commonContractVersion: typeof PROCESS_AUTHORITY_COMMON_CONTRACT_VERSION;
  readonly providerReferenceVersion: number;
  readonly semantics: readonly RecursiveProcessScopeSemantic[];
}

export type AuthorityOperationPhase =
  | 'prepare'
  | 'publish'
  | 'activate'
  | 'inspect'
  | 'terminate'
  | 'abort'
  | 'exact-empty-observation';

export interface AuthorityOperationContext {
  readonly phase: AuthorityOperationPhase;
  readonly operationId: string;
  readonly deadline: number;
  readonly signal: AbortSignal;
}

export interface AuthorityPrepareInput {
  /** Server-resolved absolute executable; providers must not resolve it through PATH. */
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly windowsVerbatimArguments?: boolean;
}

export interface AuthorityTerminationIntent {
  readonly reason: string;
  readonly graceMs: number;
}

export type ProviderRetainedOutcome =
  | { readonly state: 'authority-unavailable'; readonly diagnostic: string }
  | { readonly state: 'authority-uncertain'; readonly diagnostic: string }
  | { readonly state: 'identity-drift'; readonly diagnostic: string }
  | { readonly state: 'event-gap'; readonly diagnostic: string }
  | {
      readonly state: 'timeout';
      readonly phase: AuthorityOperationPhase;
      readonly diagnostic: string;
    }
  | {
      readonly state: 'control-loss';
      readonly phase: AuthorityOperationPhase;
      readonly diagnostic: string;
    };

export type ProviderRootExited =
  | {
      readonly state: 'root-exited';
      readonly code: number;
      readonly signal: string | null;
    }
  | {
      readonly state: 'root-exited';
      readonly code: null;
      readonly signal: string;
    };

export type ProviderObservation =
  | { readonly state: 'prepared-inert' | 'published-inert' | 'live' }
  | ProviderRootExited
  | { readonly state: 'exact-scope-empty' }
  | ProviderRetainedOutcome;

export type ProviderControlOutcome =
  | { readonly state: 'exact-scope-empty' }
  | { readonly state: 'live' }
  | ProviderRootExited
  | ProviderRetainedOutcome;

export interface ProviderPreparedAuthority {
  readonly reference: ProviderAuthorityReference;
  /** Provider activation stays inert until the common coordinator calls this seam. */
  activate(context: AuthorityOperationContext): Promise<ProviderObservation>;
}

/** Expected prepare-time inability to establish the exact advertised authority. */
export interface ProviderPreparationUnavailable {
  readonly state: 'authority-unavailable';
  readonly diagnostic: string;
}

export type ProviderPreparationResult =
  | ProviderPreparedAuthority
  | ProviderPreparationUnavailable;

export interface ProcessAuthorityProvider {
  readonly descriptor: ProcessAuthorityProviderDescriptor;
  prepare(
    input: AuthorityPrepareInput,
    context: AuthorityOperationContext
  ): Promise<ProviderPreparationResult>;
  inspect(
    reference: ProviderAuthorityReference,
    context: AuthorityOperationContext
  ): Promise<ProviderObservation>;
  terminate(
    reference: ProviderAuthorityReference,
    intent: AuthorityTerminationIntent,
    context: AuthorityOperationContext
  ): Promise<ProviderControlOutcome>;
  abort(
    reference: ProviderAuthorityReference,
    reason: string,
    context: AuthorityOperationContext
  ): Promise<ProviderControlOutcome>;
}

export interface SelectedProcessAuthorityProvider {
  readonly state: 'selected';
  readonly descriptor: ProcessAuthorityProviderDescriptor;
  readonly provider: ProcessAuthorityProvider;
}

export interface ProcessAuthorityUnavailableSelection {
  readonly state: 'authority-unavailable';
  readonly selection: ProcessAuthoritySelection;
  readonly diagnostic: string;
}

export type ProcessAuthorityProviderSelectionResult =
  | SelectedProcessAuthorityProvider
  | ProcessAuthorityUnavailableSelection;
