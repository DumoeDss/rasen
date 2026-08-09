import {
  ProcessAuthorityProviderRegistry,
  selectProcessAuthorityProviderFromRegistry,
} from './registry.js';
import {
  decodeProcessAuthorityReferenceForDispatch,
  type DispatchableProcessAuthorityReference,
  type NonDispatchableProcessAuthorityReference,
} from './reference-codec.js';
import type {
  ProcessAuthorityProvider,
  ProcessAuthorityProviderDescriptor,
} from './types.js';

export interface ResolvedProcessAuthorityReference
  extends DispatchableProcessAuthorityReference {
  readonly descriptor: ProcessAuthorityProviderDescriptor;
  readonly provider: ProcessAuthorityProvider;
}

export type ProcessAuthorityReferenceResolution =
  | ResolvedProcessAuthorityReference
  | NonDispatchableProcessAuthorityReference;

export function resolveProcessAuthorityReferenceForDispatch(
  registry: ProcessAuthorityProviderRegistry,
  reference: string
): ProcessAuthorityReferenceResolution {
  const parsed = decodeProcessAuthorityReferenceForDispatch(reference);
  if (parsed.state !== 'dispatchable') return parsed;
  const selected = selectProcessAuthorityProviderFromRegistry(registry, parsed.selection);
  if (selected.state !== 'selected') {
    return Object.freeze({
      state: 'authority-unavailable',
      reason: 'tuple-mismatch',
      reference,
      diagnostic: selected.diagnostic,
    });
  }
  const exact = decodeProcessAuthorityReferenceForDispatch(reference, selected.descriptor);
  if (exact.state !== 'dispatchable') return exact;
  return Object.freeze({
    ...exact,
    descriptor: selected.descriptor,
    provider: selected.provider,
  });
}
