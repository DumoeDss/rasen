import path from 'node:path';

import {
  PROCESS_AUTHORITY_PROVIDER_MANIFEST_SCHEMA,
  ProcessAuthorityProviderRegistry,
  type ProcessAuthorityProvider,
  type ProcessAuthorityProviderManifest,
} from '../../src/core/session-host/process-authority/index.js';

export function createTestProcessAuthorityProviderManifest(
  providers: readonly ProcessAuthorityProvider[]
): ProcessAuthorityProviderManifest {
  return Object.freeze({
    schema: PROCESS_AUTHORITY_PROVIDER_MANIFEST_SCHEMA,
    providers: Object.freeze(providers.map((provider, index) => Object.freeze({
      ...provider.descriptor,
      artifactPath: `providers/test-${index}/helper`,
    }))),
  });
}

export function createTestProcessAuthorityProviderRegistry(
  providers: readonly ProcessAuthorityProvider[]
): ProcessAuthorityProviderRegistry {
  return new ProcessAuthorityProviderRegistry(providers, {
    manifest: createTestProcessAuthorityProviderManifest(providers),
    manifestRoot: path.resolve('test-process-authority-package'),
  });
}
