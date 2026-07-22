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
import { cachedGitWorktreeList } from '../store/worktree-inventory-cache.js';
import { getActiveChangeIds } from '../../utils/item-discovery.js';
import { FileSystemUtils } from '../../utils/file-system.js';
import type {
  ProjectSpaceEntry,
  SpaceEntry,
  SpaceMember,
  SpacesResponse,
  SpaceWorktreesResponse,
} from './wire-types.js';

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

  // Live in-repo project entries (dead roots filtered; a store's own root
  // presented as the store, never a project).
  const liveInRepo: { root: string; entry: ProjectRegistryEntryState }[] = [];
  for (const [root, entry] of projectEntries) {
    if (entry.mode !== 'in-repo') continue;
    if (!(await pathIsDirectory(root))) continue;
    if (storeRootSet.has(canonicalizeOrResolve(root))) continue;
    liveInRepo.push({ root, entry });
  }

  // Collapse legacy worktree duplicates read-side (worktree-aware-spaces D3):
  // group by (projectId, home) — worktree-shared entries share BOTH by
  // construction, while independent clones share only projectId (distinct
  // homes) and correctly stay separate rows. Insertion order is preserved.
  const groups = new Map<string, { root: string; entry: ProjectRegistryEntryState }[]>();
  for (const item of liveInRepo) {
    const key = JSON.stringify([item.entry.projectId, item.entry.home]);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }

  // One live worktree inventory per group, run concurrently: it both picks the
  // main-checkout row for a duplicate group and supplies the badge count. A
  // failure (non-git / git-unavailable) just omits the count. Read-only.
  // Cached (TTL + worktree-add/remove mtime invalidation + in-flight
  // coalescing): uncached, every page load spawned one git.exe per project.
  const projectSpaces = await Promise.all(
    [...groups.values()].map(async (group): Promise<ProjectSpaceEntry> => {
      const inventory = await cachedGitWorktreeList(group[0].root);
      let chosen = group[0];
      if (inventory) {
        const main = inventory.find((worktree) => worktree.isMain);
        if (main) {
          const canonicalMain = canonicalizeOrResolve(main.root);
          const match = group.find((member) => canonicalizeOrResolve(member.root) === canonicalMain);
          if (match) chosen = match;
        }
      }
      const worktreeCount = inventory && inventory.length > 1 ? inventory.length : undefined;
      return {
        type: 'project',
        id: chosen.entry.projectId,
        name: chosen.entry.name,
        root: chosen.root,
        ...(worktreeCount !== undefined ? { worktreeCount } : {}),
      };
    })
  );
  spaces.push(...projectSpaces);

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

/**
 * `GET /api/v1/spaces/worktrees` handler (worktree-aware-spaces D3): the live
 * worktree inventory of an already-resolved space `root`, derived from
 * `git worktree list` at read time and never persisted. Each entry reports the
 * worktree's root, branch (null when detached), the main-checkout flag, and the
 * count of active changes in that worktree's OWN `rasen/changes` (same
 * active-change definition as the changes listing — `proposal.md` present). A
 * non-git root yields an empty inventory, not an error. Read-only throughout.
 *
 * `root` is canonicalized (`canonicalizeOrResolve`, not the raw porcelain
 * value) so it matches the form every other wire root uses — notably session
 * `cwd` (worktree-aware-spaces review M1: `git worktree list --porcelain`
 * emits forward-slash paths even on Windows, while `canonicalizeExistingPath`
 * elsewhere produces backslash paths there; comparing the two verbatim, as
 * the board's live-session count and the `?wt=` selector round-trip both do,
 * silently never matched). `canonicalizeOrResolve` degrades to a lexical
 * `path.resolve` for a deleted/prunable worktree root that no longer exists
 * on disk, still normalizing separators.
 */
export async function handleSpaceWorktrees(root: string): Promise<SpaceWorktreesResponse> {
  const inventory = await cachedGitWorktreeList(root);
  if (!inventory) {
    return { worktrees: [] };
  }

  const worktrees = await Promise.all(
    inventory.map(async (worktree) => ({
      root: canonicalizeOrResolve(worktree.root),
      branch: worktree.branch,
      isMain: worktree.isMain,
      activeChangeCount: (await getActiveChangeIds(worktree.root)).length,
    }))
  );
  return { worktrees };
}
