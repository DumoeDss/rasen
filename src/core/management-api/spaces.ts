/**
 * `GET /api/v1/spaces` handler (planning-space-addressing design D4/D6):
 * every addressable planning space in one response — in-repo projects from
 * the machine project registry and registered stores, with each store's
 * member projects reverse-enumerated from the registry's pointer-repo
 * (`mode: 'store'`) entries and validated at read time against each member's
 * own current `store:` pointer.
 *
 * Read-only throughout: dead roots are filtered from the response but the
 * registries are never modified (pruning stays `rasen doctor --gc`'s job).
 */
import { pathIsDirectory } from '../file-state.js';
import { readStorePointer } from '../project-config.js';
import { readProjectRegistryState, type ProjectRegistryEntryState } from '../project-registry.js';
import { listRegisteredStores } from '../store/registry.js';
import { FileSystemUtils } from '../../utils/file-system.js';
import type { SpaceEntry, SpaceMember, SpacesResponse } from './wire-types.js';

function canonicalizeOrResolve(target: string): string {
  try {
    return FileSystemUtils.canonicalizeExistingPath(target);
  } catch {
    return target;
  }
}

/**
 * Builds the spaces listing (design D6): live in-repo projects and live
 * registered stores (with inline members), a store root never double-listed
 * as a project. `mode: 'store'` pointer-repo entries never appear as
 * top-level spaces — only inside their store's `members`.
 */
export async function handleSpaces(): Promise<SpacesResponse> {
  const registryState = await readProjectRegistryState();
  const projectEntries: [string, ProjectRegistryEntryState][] = registryState
    ? Object.entries(registryState.projects)
    : [];

  const stores = (await listRegisteredStores()).filter((store) => store.type === 'store');

  // Canonical roots of every registered store, for the project/store dedupe
  // (a store's own root self-registers as an `in-repo` project when the CLI
  // runs inside it — present it once, as the store space).
  const storeRootSet = new Set(stores.map((store) => canonicalizeOrResolve(store.storeRoot)));

  // Candidate members: every pointer-repo registry entry (design D4's
  // candidate index is `mode: 'store'`; the authority is each repo's own
  // `store:` pointer, re-read below).
  const memberCandidates = projectEntries.filter(([, entry]) => entry.mode === 'store');

  const spaces: SpaceEntry[] = [];

  for (const [root, entry] of projectEntries) {
    if (entry.mode !== 'in-repo') continue;
    if (!(await pathIsDirectory(root))) continue;
    if (storeRootSet.has(canonicalizeOrResolve(root))) continue;
    spaces.push({ type: 'project', id: entry.projectId, name: entry.name, root });
  }

  for (const store of stores) {
    if (!(await pathIsDirectory(store.storeRoot))) continue;

    const members: SpaceMember[] = [];
    for (const [root, entry] of memberCandidates) {
      if (!(await pathIsDirectory(root))) continue;
      // Authority is the member repo's current `store:` declaration, read
      // fresh (design D4): a repo whose pointer no longer names this store is
      // excluded even though its registry entry still marks it a pointer repo.
      if (readStorePointer(root).value === store.id) {
        members.push({ projectId: entry.projectId, name: entry.name, root });
      }
    }

    spaces.push({
      type: 'store',
      id: store.id,
      name: store.id,
      root: canonicalizeOrResolve(store.storeRoot),
      members,
    });
  }

  return { spaces };
}
