/**
 * Who may publish into a Store, and what counts as evidence that they should.
 *
 * Two authorities meet here, and neither substitutes for the other:
 *
 * 1. **Membership** comes from the Store's own per-project records (child B's
 *    `listStoreMembers`), never from the project's planning pointer. "Where
 *    does this project plan?" is a different question, and answering the
 *    membership question with it would let a project that merely plans in a
 *    Store vote on what the Store publishes.
 * 2. **Evidence** is an EXACT managed source record, resolved and digested, not
 *    an assertion inside the candidate. Two records sharing an id are not
 *    evidence for the same knowledge; two records sharing a knowledge key are.
 *
 * Everything here is read-only. A refusal writes nothing at all — no record, no
 * file, no ownership entry — because the whole output of a refusal is what
 * evidence exists and what is missing.
 */
import { listStoreMembers, type StoreMembershipRecord } from '../store/membership.js';
import { normalizeProjectIdentity } from '../store/project-records.js';
import type { ResolvedStoreRef } from '../store/identity-types.js';
import { digestContent, readCanonicalRecord, serializeManifest } from './catalog.js';
import { resolveLearnedSkillExecutionContext } from './context.js';
import { describeDurableOwner, durableOwnerKey } from './owner-identity.js';
import { learnedSkillDir, resolveCanonicalStore, type ResolvedStore } from './stores.js';
import type {
  CanonicalKnowledgeIdentity,
  DurableEvidenceOwnerRef,
  LearnedSkillContext,
  NormalizedEvidenceReference,
  PromotionSourceLocator,
  PromotionSourceSnapshot,
} from './types.js';

function globalDataDirOf(context: LearnedSkillContext): string | undefined {
  return context.execution?.globalDataDir ?? context.globalDataDir;
}

function pathOptions(context: LearnedSkillContext): { globalDataDir?: string } {
  const dir = globalDataDirOf(context);
  return dir === undefined ? {} : { globalDataDir: dir };
}

// -----------------------------------------------------------------------------
// Membership
// -----------------------------------------------------------------------------

/** One project the Store records, as the Store records it. */
export interface StoreKnowledgeMember {
  projectId: string;
  /** Display name, when the Store's record knew one. Never keys anything. */
  id?: string;
}

export interface StoreMemberQuery {
  /** The Store, by permanent identity. */
  store: { uid: string; id: string; root: string };
  /** Projects whose membership record grants the knowledge role. */
  members: StoreKnowledgeMember[];
  /** Projects the Store records, but NOT as knowledge members. */
  nonKnowledgeMembers: StoreKnowledgeMember[];
  diagnostics: Array<{ code: string; message: string }>;
}

function memberOf(record: StoreMembershipRecord): StoreKnowledgeMember {
  return {
    projectId: record.projectId,
    ...(record.id !== undefined ? { id: record.id } : {}),
  };
}

/**
 * The `ResolvedStoreRef` child B's provider expects, from a resolved catalog.
 *
 * The return type narrows `uid` to required: a store-typed durable owner always
 * carries one, and the guard below is what proves it. Saying so in the type
 * keeps the callers from casting the fact back in by hand.
 */
function storeRefFor(store: ResolvedStore): ResolvedStoreRef & { uid: string } {
  if (store.owner.type !== 'store' || store.storeRoot === undefined) {
    throw new Error('membership can only be queried for a resolved Store catalog');
  }
  return {
    type: 'store',
    uid: store.owner.uid,
    id: store.owner.id ?? store.owner.uid,
    root: store.storeRoot,
  };
}

/**
 * The Store's own answer to "which projects share knowledge with me?".
 *
 * The roles split is child B's, and it is load-bearing here: `planning` means
 * the project plans in this Store, `knowledge` means it shares knowledge with
 * it. Only the second grants a vote on what the Store publishes. A project
 * recorded for planning alone is reported separately so a refusal can say
 * "recorded, but not as a knowledge member" instead of the misleading "not a
 * member" — two different problems needing two different repairs.
 */
export async function queryStoreMemberProjects(
  store: ResolvedStore,
  context: LearnedSkillContext
): Promise<StoreMemberQuery> {
  const ref = storeRefFor(store);
  const listing = await listStoreMembers(ref, pathOptions(context));

  const members: StoreKnowledgeMember[] = [];
  const nonKnowledgeMembers: StoreKnowledgeMember[] = [];
  const diagnostics: StoreMemberQuery['diagnostics'] = listing.diagnostics.map((entry) => ({
    code: entry.code,
    message: entry.message,
  }));

  for (const record of listing.members) {
    (record.roles.knowledge ? members : nonKnowledgeMembers).push(memberOf(record));
    for (const diagnostic of record.diagnostics) {
      diagnostics.push({ code: diagnostic.code, message: diagnostic.message });
    }
  }

  return {
    store: { uid: ref.uid, id: ref.id, root: ref.root },
    members,
    nonKnowledgeMembers,
    diagnostics,
  };
}

// -----------------------------------------------------------------------------
// Promotion sources
// -----------------------------------------------------------------------------

export interface ResolvedPromotionSources {
  snapshots: PromotionSourceSnapshot[];
  evidence: NormalizedEvidenceReference[];
}

/** A source that could not be used, naming which one and why. */
export class PromotionSourceError extends Error {
  readonly locator: PromotionSourceLocator;

  constructor(locator: PromotionSourceLocator, reason: string) {
    super(`source ${describeDurableOwner(locator.owner)}/${locator.id} ${reason}`);
    this.name = 'PromotionSourceError';
    this.locator = locator;
  }
}

/**
 * One source owner's own catalog, resolved independently of the caller's.
 *
 * `sessionContext: null` is deliberate: which records a source project owns is
 * a fact about that project, not about the session this command runs in. It is
 * an explicit opt-out, not a fallback — the caller's own context was already
 * resolved (and would already have failed) before any source is looked at.
 */
async function resolveSourceCatalog(
  owner: DurableEvidenceOwnerRef,
  context: LearnedSkillContext
): Promise<ResolvedStore> {
  const callerRoot =
    context.execution?.owner.type === 'project' || context.execution?.owner.type === 'store'
      ? context.execution.owner.root
      : context.projectRoot;
  const execution = await resolveLearnedSkillExecutionContext({
    ...(callerRoot !== undefined ? { launchDirectory: callerRoot } : {}),
    selector:
      owner.type === 'project'
        ? { project: owner.projectId }
        : { store: owner.uid },
    requestedScope: owner.type,
    sessionContext: null,
    ...pathOptions(context),
  });
  const resolution = await resolveCanonicalStore(owner.type, {
    execution,
    ...pathOptions(context),
  });
  if (!resolution.ok) throw new Error(resolution.message);
  return resolution.store;
}

/**
 * Resolves each named source to an EXACT active managed record and snapshots
 * it. Every check is a refusal reason a user can act on: the record must
 * exist, be Rasen-managed, be active, and carry both the key the locator
 * claimed and the key the target is being published under.
 *
 * The last of those is what makes "the same name is not the same knowledge"
 * enforceable — two projects can each own `retry-with-backoff` about entirely
 * different things, and only the knowledge key says whether they agree.
 */
export async function resolvePromotionSources(
  locators: readonly PromotionSourceLocator[],
  targetKnowledgeKey: string,
  context: LearnedSkillContext
): Promise<ResolvedPromotionSources> {
  const snapshots: PromotionSourceSnapshot[] = [];
  const evidence: NormalizedEvidenceReference[] = [];

  for (const locator of locators) {
    let store: ResolvedStore;
    try {
      store = await resolveSourceCatalog(locator.owner, context);
    } catch (error) {
      throw new PromotionSourceError(
        locator,
        `is unavailable: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    const read = readCanonicalRecord(
      learnedSkillDir(store, locator.id),
      locator.owner.type,
      store.owner
    );
    if (read.kind !== 'managed') {
      throw new PromotionSourceError(
        locator,
        read.kind === 'absent' ? 'was not found' : `is not usable: ${read.reason}`
      );
    }

    const record = read.record;
    if (record.manifest.status !== 'active') {
      throw new PromotionSourceError(locator, 'is retired');
    }
    if (record.manifest.knowledgeKey !== locator.knowledgeKey) {
      throw new PromotionSourceError(
        locator,
        `carries knowledge key "${record.manifest.knowledgeKey}", not the "${locator.knowledgeKey}" it was named with`
      );
    }
    if (record.manifest.knowledgeKey !== targetKnowledgeKey) {
      throw new PromotionSourceError(
        locator,
        `carries knowledge key "${record.manifest.knowledgeKey}", which is not the target's "${targetKnowledgeKey}" — a shared id is not shared knowledge`
      );
    }
    if (record.identity.owner.type === 'global') {
      throw new PromotionSourceError(locator, 'is global; global knowledge is never a source');
    }

    snapshots.push({
      locator: {
        owner: record.identity.owner,
        id: record.identity.id,
        knowledgeKey: record.manifest.knowledgeKey,
      },
      identity: record.identity,
      contentDigest: record.manifest.contentDigest,
      manifestDigest: digestContent(serializeManifest(record.manifest)),
      updatedAt: record.manifest.updatedAt,
    });
    evidence.push(...record.evidence);
  }

  return { snapshots, evidence };
}

/**
 * Whether the sources are still exactly what the plan was made against. A
 * source that changed between planning and committing would give the
 * publication provenance nobody reviewed, so it aborts instead.
 */
export function promotionSnapshotsEqual(
  expected: readonly PromotionSourceSnapshot[],
  actual: readonly PromotionSourceSnapshot[]
): boolean {
  if (expected.length !== actual.length) return false;
  return expected.every((left, index) => {
    const right = actual[index];
    return (
      right !== undefined &&
      identityKey(left.identity) === identityKey(right.identity) &&
      left.contentDigest === right.contentDigest &&
      left.manifestDigest === right.manifestDigest &&
      left.updatedAt === right.updatedAt
    );
  });
}

/** Owner key plus record id — the pair that names one record durably. */
export function identityKey(identity: CanonicalKnowledgeIdentity): string {
  return `${durableOwnerKey(identity.owner)}/${identity.id}`;
}

/** The projects a source set draws on, normalized as child B records them. */
export function sourceProjectIds(snapshots: readonly PromotionSourceSnapshot[]): string[] {
  const ids: string[] = [];
  for (const snapshot of snapshots) {
    const owner = snapshot.identity.owner;
    if (owner.type === 'project') ids.push(normalizeProjectIdentity(owner.projectId));
  }
  return ids;
}
