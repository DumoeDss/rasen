/**
 * The metadata-identity and root-health stages of registered-store
 * resolution, as a non-throwing result.
 *
 * ONE shared inspection path — never fork it. `root-selection.ts` maps each
 * failure kind to its established `RootSelectionError`, the identity resolver
 * maps them to `StoreBindingResolution` reasons, the reference index assembler
 * maps them to warnings, and the config HTTP surface maps them to its result
 * vocabulary. It lives in `store/` (rather than `root-selection.ts`, where it
 * was first written) so the identity resolver can reuse it without inverting
 * the dependency direction — `root-selection.ts` re-exports it unchanged.
 */
import { FileSystemUtils } from '../../utils/file-system.js';
import { inspectOpenSpecRoot } from '../workspace-root.js';
import {
  getStoreMetadataPath,
  readOptionalStoreMetadataState,
  storeMetadataUid,
  type StoreMetadataState,
} from './foundation.js';

export type RegisteredStoreInspection =
  | {
      kind: 'ok';
      canonicalRoot: string;
      metadata: StoreMetadataState;
      /** The Store's permanent identity; absent for legacy (v1) metadata. */
      uid?: string;
    }
  | { kind: 'metadata_error'; error: unknown }
  | { kind: 'metadata_missing'; metadataPath: string }
  | { kind: 'metadata_id_mismatch'; actualId: string; uid?: string }
  | { kind: 'unhealthy_root'; problems: string; metadata: StoreMetadataState; uid?: string };

export async function inspectRegisteredStore(
  id: string,
  storeRoot: string
): Promise<RegisteredStoreInspection> {
  // Identity (metadata) failures win before root-health diagnostics.
  let metadata;
  try {
    metadata = await readOptionalStoreMetadataState(storeRoot);
  } catch (error) {
    return { kind: 'metadata_error', error };
  }

  if (!metadata) {
    return { kind: 'metadata_missing', metadataPath: getStoreMetadataPath(storeRoot) };
  }

  const uid = storeMetadataUid(metadata);

  if (metadata.id !== id) {
    return {
      kind: 'metadata_id_mismatch',
      actualId: metadata.id,
      ...(uid !== undefined ? { uid } : {}),
    };
  }

  const inspection = await inspectOpenSpecRoot(storeRoot);
  if (!inspection.healthy) {
    const problems =
      inspection.diagnostics.map((diagnostic) => diagnostic.message).join(' ') ||
      'Rasen root is missing or incomplete.';
    return {
      kind: 'unhealthy_root',
      problems,
      metadata,
      ...(uid !== undefined ? { uid } : {}),
    };
  }

  return {
    kind: 'ok',
    canonicalRoot: FileSystemUtils.canonicalizeExistingPath(storeRoot),
    metadata,
    ...(uid !== undefined ? { uid } : {}),
  };
}
