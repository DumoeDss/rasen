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
import { storeBindingDeclarationFrom } from '../effective-config.js';
import { readProjectRegistryState, type ProjectRegistryEntryState } from '../project-registry.js';
// Enumeration, not by-id lookup: this handler lists EVERY registered store,
// which the identity boundary permits (the ban targets resolving one store by
// its display name). Recorded deliberately rather than left implicit — child C
// rewrites this file's resolution and decides whether to retire the import.
import { listRegisteredStores } from '../store/registry.js';
import { resolveStoreBinding } from '../store/identity.js';
import type { ResolvedStoreRef } from '../store/identity-types.js';
import { listStoreMembers } from '../store/membership.js';
import { cachedGitWorktreeList } from '../store/worktree-inventory-cache.js';
import { getActiveChangeIds } from '../../utils/item-discovery.js';
import {
  resolveProjectPlanningSpaceFromRoot,
  type ResolvedSpace,
} from '../config-api/project-addressing.js';
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

  // Each pointer repo's own declaration, resolved ONCE through the shared
  // identity resolver rather than compared per store.
  //
  // Comparing the declared display alias is what this used to do, and it was
  // wrong twice over: a declaration that records only the store's permanent
  // identity carries no alias at all (so its repo silently vanished from the
  // store's members), and an alias shared by two stores matched both. The
  // resolver answers which store the declaration actually names.
  const pointerMembers: Array<{
    root: string;
    entry: ProjectRegistryEntryState;
    store: ResolvedStoreRef;
  }> = [];
  for (const [root, entry] of memberCandidates) {
    if (!(await pathIsDirectory(root))) continue;
    const binding = await resolveStoreBinding({
      declaration: storeBindingDeclarationFrom(readStorePointer(root)),
      projectRoot: root,
    });
    if (binding.kind !== 'resolved') continue;
    pointerMembers.push({ root, entry, store: binding.store });
  }

  // Every live checkout on this machine, by project identity — how a member
  // the store RECORDS acquires a root when it has one. Not restricted to
  // pointer repos: a project can be a store's member while planning elsewhere,
  // which is exactly what separating membership from planning binding buys.
  const liveCheckouts = new Map<string, { root: string; name: string }>();
  for (const [root, entry] of projectEntries) {
    if (liveCheckouts.has(entry.projectId)) continue;
    if (!(await pathIsDirectory(root))) continue;
    liveCheckouts.set(entry.projectId, { root, name: entry.name });
  }

  for (const store of stores) {
    if (!(await pathIsDirectory(store.storeRoot))) continue;

    const storeRef: ResolvedStoreRef = {
      type: 'store',
      id: store.id,
      root: canonicalizeOrResolve(store.storeRoot),
      ...(store.uid !== undefined ? { uid: store.uid } : {}),
    };

    // Members are the UNION of two sources, presented once per project
    // identity: the pointer-derived entries (kept, so a store with no records
    // yet does not suddenly list zero members) and the store's own membership
    // records (so a recorded member shows up even when its repo points
    // elsewhere). Both halves are read-only.
    const byProjectId = new Map<string, SpaceMember>();

    for (const candidate of pointerMembers) {
      if (!sameStore(candidate.store, storeRef)) continue;
      byProjectId.set(candidate.entry.projectId, {
        projectId: candidate.entry.projectId,
        name: candidate.entry.name,
        root: candidate.root,
      });
    }

    const listing = await listStoreMembers(storeRef).catch(() => null);
    for (const member of listing?.members ?? []) {
      if (byProjectId.has(member.projectId)) continue;
      const checkout = liveCheckouts.get(member.projectId);
      byProjectId.set(member.projectId, {
        projectId: member.projectId,
        name: member.id ?? checkout?.name ?? member.projectId,
        // A recorded member with no live checkout here is listed WITHOUT a
        // root: omitting it would hide a real membership, and inventing a path
        // would be worse.
        ...(checkout ? { root: checkout.root } : {}),
      });
    }

    spaces.push({
      type: 'store',
      id: store.id,
      name: store.id,
      root: storeRef.root,
      members: [...byProjectId.values()],
    });
  }

  return { spaces };
}

/** Identity first, canonical root second — never the renameable display name. */
function sameStore(left: ResolvedStoreRef, right: ResolvedStoreRef): boolean {
  if (left.uid !== undefined && right.uid !== undefined) {
    return left.uid.trim().toLowerCase() === right.uid.trim().toLowerCase();
  }
  const a = canonicalizeOrResolve(left.root);
  const b = canonicalizeOrResolve(right.root);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/**
 * `GET /api/v1/spaces/worktrees` handler (worktree-aware-spaces D3): the live
 * worktree inventory of an already-resolved project scope, derived from
 * `git worktree list` at read time and never persisted. Each entry reports the
 * worktree's root, branch (null when detached), the main-checkout flag, and the
 * count of active Changes in that worktree's effective project planning scope
 * (same active-change definition as the changes listing — `proposal.md`
 * present). Standalone worktrees may therefore differ; Store-bound worktrees
 * share the verified project partition. A
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
export async function handleSpaceWorktrees(
  space: ResolvedSpace
): Promise<SpaceWorktreesResponse> {
  // Only a root is needed, so a legacy flat Store space is answerable here for
  // the same reason it is answerable for Changes: it is a real checkout with
  // real worktrees. A Store v2 aggregate is screened out by the caller
  // (`isStoreAggregateSpace`), not by the shape of this parameter.
  const root = space.type === 'project' ? space.executionRoot ?? space.root : space.root;
  const inventory = await cachedGitWorktreeList(root);
  if (!inventory) {
    return { worktrees: [] };
  }

  const worktrees = await Promise.all(
    inventory.map(async (worktree) => {
      const resolved = await resolveProjectPlanningSpaceFromRoot(worktree.root);
      const activeChangeCount =
        resolved.ok && resolved.space.type === 'project'
          ? (
              await getActiveChangeIds(
                resolved.space.root,
                resolved.space.changesDir
              )
            ).length
          : 0;
      return {
        root: canonicalizeOrResolve(worktree.root),
        branch: worktree.branch,
        isMain: worktree.isMain,
        activeChangeCount,
      };
    })
  );
  return { worktrees };
}
