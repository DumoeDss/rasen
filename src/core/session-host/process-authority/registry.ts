import {
  PROCESS_AUTHORITY_COMMON_CONTRACT_VERSION,
  RECURSIVE_PROCESS_SCOPE_CAPABILITY_ID,
  RECURSIVE_PROCESS_SCOPE_SEMANTICS,
  type ProcessAuthorityProvider,
  type ProcessAuthorityProviderDescriptor,
  type ProcessAuthorityProviderSelectionResult,
  type ProcessAuthoritySelection,
} from './types.js';
import {
  manifestEntryMatchesDescriptor,
  validateProcessAuthorityProviderManifest,
  type ProcessAuthorityProviderManifest,
} from './manifest.js';

const IDENTITY_PATTERN = /^[a-z0-9](?:[a-z0-9._/-]{0,126}[a-z0-9])?$/;
const authenticRegistries = new WeakSet<ProcessAuthorityProviderRegistry>();

function tupleKey(selection: ProcessAuthoritySelection): string {
  return JSON.stringify([
    selection.providerId,
    selection.capabilityId,
    selection.protocolVersion,
  ]);
}

function copySelection(selection: ProcessAuthoritySelection): ProcessAuthoritySelection {
  return Object.freeze({
    providerId: selection.providerId,
    capabilityId: selection.capabilityId,
    protocolVersion: selection.protocolVersion,
  });
}

function snapshotSelection(selection: ProcessAuthoritySelection): ProcessAuthoritySelection | undefined {
  try {
    if (!selection || typeof selection !== 'object' || Array.isArray(selection)) return undefined;
    const snapshot = copySelection(selection);
    validateIdentity('provider id', snapshot.providerId);
    validateIdentity('capability id', snapshot.capabilityId);
    validatePositiveVersion('protocol version', snapshot.protocolVersion);
    return snapshot;
  } catch {
    return undefined;
  }
}

function unavailableSelectionSnapshot(selection: ProcessAuthoritySelection): ProcessAuthoritySelection {
  try {
    return Object.freeze({
      providerId: typeof selection?.providerId === 'string' ? selection.providerId : '',
      capabilityId: typeof selection?.capabilityId === 'string' ? selection.capabilityId : '',
      protocolVersion: Number.isSafeInteger(selection?.protocolVersion)
        ? selection.protocolVersion
        : 0,
    });
  } catch {
    return Object.freeze({ providerId: '', capabilityId: '', protocolVersion: 0 });
  }
}

function copyDescriptor(
  descriptor: ProcessAuthorityProviderDescriptor
): ProcessAuthorityProviderDescriptor {
  return Object.freeze({
    ...copySelection(descriptor),
    commonContractVersion: descriptor.commonContractVersion,
    providerReferenceVersion: descriptor.providerReferenceVersion,
    semantics: Object.freeze([...descriptor.semantics]),
  });
}

function validateIdentity(name: string, value: string): void {
  if (!IDENTITY_PATTERN.test(value)) {
    throw new TypeError(`Process-authority ${name} is malformed.`);
  }
}

function validatePositiveVersion(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`Process-authority ${name} must be a positive safe integer.`);
  }
}

function validateDescriptor(descriptor: ProcessAuthorityProviderDescriptor): void {
  const keys = Object.keys(descriptor).sort();
  const expected = [
    'capabilityId',
    'commonContractVersion',
    'protocolVersion',
    'providerId',
    'providerReferenceVersion',
    'semantics',
  ].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new TypeError('Process-authority provider descriptor has an unknown or missing field.');
  }
  validateIdentity('provider id', descriptor.providerId);
  validateIdentity('capability id', descriptor.capabilityId);
  validatePositiveVersion('protocol version', descriptor.protocolVersion);
  validatePositiveVersion('provider-reference version', descriptor.providerReferenceVersion);
  if (descriptor.commonContractVersion !== PROCESS_AUTHORITY_COMMON_CONTRACT_VERSION) {
    throw new TypeError('Process-authority provider common-contract version is unsupported.');
  }
  if (descriptor.capabilityId !== RECURSIVE_PROCESS_SCOPE_CAPABILITY_ID) {
    throw new TypeError('Process-authority provider does not declare the recursive-scope capability.');
  }
  if (
    !Array.isArray(descriptor.semantics) ||
    descriptor.semantics.length !== RECURSIVE_PROCESS_SCOPE_SEMANTICS.length ||
    descriptor.semantics.some(
      (semantic, index) => semantic !== RECURSIVE_PROCESS_SCOPE_SEMANTICS[index]
    )
  ) {
    throw new TypeError('Process-authority recursive-scope semantics are incomplete or ambiguous.');
  }
}

export class ProcessAuthorityProviderRegistry {
  readonly #providersByTuple: ReadonlyMap<string, ProcessAuthorityProvider>;
  readonly #descriptors: readonly ProcessAuthorityProviderDescriptor[];

  constructor(
    providers: readonly ProcessAuthorityProvider[],
    options: {
      readonly manifest: ProcessAuthorityProviderManifest;
      readonly manifestRoot: string;
    } | undefined = undefined
  ) {
    const providersByTuple = new Map<string, ProcessAuthorityProvider>();
    const providerIds = new Set<string>();
    const descriptors: ProcessAuthorityProviderDescriptor[] = [];

    for (const provider of [...providers]) {
      if (!provider || typeof provider !== 'object') {
        throw new TypeError('Process-authority provider must be an object.');
      }
      if (
        typeof provider.prepare !== 'function' ||
        typeof provider.inspect !== 'function' ||
        typeof provider.terminate !== 'function' ||
        typeof provider.abort !== 'function'
      ) {
        throw new TypeError('Process-authority provider contract is incomplete.');
      }
      validateDescriptor(provider.descriptor);
      const descriptor = copyDescriptor(provider.descriptor);
      const key = tupleKey(descriptor);
      if (providerIds.has(descriptor.providerId)) {
        throw new TypeError(`Duplicate process-authority provider id: ${descriptor.providerId}.`);
      }
      if (providersByTuple.has(key)) {
        throw new TypeError('Duplicate process-authority provider tuple.');
      }
      providerIds.add(descriptor.providerId);
      providersByTuple.set(key, Object.freeze({
        descriptor,
        prepare: provider.prepare.bind(provider),
        inspect: provider.inspect.bind(provider),
        terminate: provider.terminate.bind(provider),
        abort: provider.abort.bind(provider),
      }));
      descriptors.push(descriptor);
    }

    if (descriptors.length > 0 && !options) {
      throw new TypeError(
        'Every non-empty process-authority provider registry requires an exact manifest binding.'
      );
    }

    if (options) {
      const manifest = validateProcessAuthorityProviderManifest(
        options.manifest,
        options.manifestRoot
      );
      if (manifest.providers.length !== descriptors.length) {
        throw new TypeError('Process-authority manifest and runtime provider counts differ.');
      }
      for (const descriptor of descriptors) {
        const entry = manifest.providers.find((candidate) =>
          candidate.providerId === descriptor.providerId
        );
        if (!entry || !manifestEntryMatchesDescriptor(entry, descriptor)) {
          throw new TypeError('Process-authority manifest entry does not match its runtime descriptor.');
        }
      }
    }

    this.#providersByTuple = providersByTuple;
    this.#descriptors = Object.freeze(descriptors);
    authenticRegistries.add(this);
    Object.freeze(this);
  }

  descriptors(): readonly ProcessAuthorityProviderDescriptor[] {
    return Object.freeze(this.#descriptors.map(copyDescriptor));
  }

  select(selection: ProcessAuthoritySelection): ProcessAuthorityProviderSelectionResult {
    const exact = snapshotSelection(selection);
    if (!exact) {
      return Object.freeze({
        state: 'authority-unavailable',
        selection: unavailableSelectionSnapshot(selection),
        diagnostic: 'Process-authority selection is malformed.',
      });
    }
    const provider = this.#providersByTuple.get(tupleKey(exact));
    if (!provider) {
      return Object.freeze({
        state: 'authority-unavailable',
        selection: exact,
        diagnostic: 'No exact process-authority provider is registered.',
      });
    }
    return Object.freeze({
      state: 'selected',
      descriptor: copyDescriptor(provider.descriptor),
      provider,
    });
  }
}

const authenticRegistrySelect = ProcessAuthorityProviderRegistry.prototype.select;

/**
 * Internal operational selector. Public overrides and structurally similar
 * objects are never an authority source for coordinator dispatch.
 */
export function selectProcessAuthorityProviderFromRegistry(
  registry: ProcessAuthorityProviderRegistry,
  selection: ProcessAuthoritySelection
): ProcessAuthorityProviderSelectionResult {
  try {
    if (
      !authenticRegistries.has(registry) ||
      Object.getPrototypeOf(registry) !== ProcessAuthorityProviderRegistry.prototype
    ) {
      return Object.freeze({
        state: 'authority-unavailable',
        selection: unavailableSelectionSnapshot(selection),
        diagnostic: 'Process-authority registry provenance is invalid.',
      });
    }
    return authenticRegistrySelect.call(registry, selection);
  } catch {
    return Object.freeze({
      state: 'authority-unavailable',
      selection: unavailableSelectionSnapshot(selection),
      diagnostic: 'Process-authority registry provenance is invalid.',
    });
  }
}

export function createEmptyProcessAuthorityProviderRegistry(): ProcessAuthorityProviderRegistry {
  return new ProcessAuthorityProviderRegistry([]);
}
