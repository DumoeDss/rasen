/**
 * The durable-owner primitives every catalog write and every ordered output
 * goes through.
 *
 * One rule holds throughout, and it is the reason this module exists rather
 * than a handful of inline comparisons: **the display alias is displayed, and
 * nothing else.** Keys, comparisons, and sort orders are derived from the
 * permanent identity or from a stable canonical serialization. An alphabetical
 * tie-break on a renameable field is a winner chosen by accident, and it would
 * make a rename change records that were written before it.
 */
import {
  normalizeStoreUid,
  storeUidsMatch,
  type ResolvedStoreRef,
} from '../store/identity-types.js';
import type {
  DurableEvidenceOwnerRef,
  DurableKnowledgeOwnerRef,
  ResolvedKnowledgeOwnerRef,
} from './types.js';

/**
 * A stable key for one durable owner. Store owners key on the normalized
 * permanent identity, never the alias, so two Stores sharing a display name
 * produce two keys and one renamed Store keeps the key it had.
 */
export function durableOwnerKey(owner: DurableKnowledgeOwnerRef): string {
  switch (owner.type) {
    case 'global':
      return 'global';
    case 'project':
      return `project:${owner.projectId}`;
    case 'store':
      return `store:${normalizeStoreUid(owner.uid)}`;
  }
}

/** Identity equality: permanent identity for Stores, projectId for projects. */
export function sameDurableOwner(
  left: DurableKnowledgeOwnerRef,
  right: DurableKnowledgeOwnerRef
): boolean {
  if (left.type !== right.type) return false;
  if (left.type === 'global') return true;
  if (left.type === 'store' && right.type === 'store') {
    return storeUidsMatch(left.uid, right.uid);
  }
  return left.type === 'project' && right.type === 'project'
    ? left.projectId === right.projectId
    : false;
}

/**
 * Total order over durable owners, derived from {@link durableOwnerKey}. Used
 * wherever contributing owners are listed or written into a record: the order
 * a rename cannot change.
 */
export function compareDurableOwners(
  left: DurableKnowledgeOwnerRef,
  right: DurableKnowledgeOwnerRef
): number {
  const a = durableOwnerKey(left);
  const b = durableOwnerKey(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * How an owner is SHOWN. Child A's three-way rule: after resolving, display
 * uses the resolved name; the permanent identity travels alongside so the
 * reader can tell two namesakes apart.
 */
export function describeDurableOwner(owner: DurableKnowledgeOwnerRef): string {
  switch (owner.type) {
    case 'global':
      return 'global';
    case 'project':
      return `project:${owner.id ?? owner.projectId}`;
    case 'store':
      return owner.id === undefined ? `store:${owner.uid}` : `store:${owner.id} (${owner.uid})`;
  }
}

/** The selector that re-resolves this owner: `uid ?? id` for a Store. */
export function durableOwnerSelector(owner: DurableKnowledgeOwnerRef): string {
  switch (owner.type) {
    case 'global':
      return 'global';
    case 'project':
      return owner.projectId;
    case 'store':
      return owner.uid;
  }
}

/** Whether an evidence/source owner is one this catalog can name durably. */
export function isDurableEvidenceOwner(
  owner: DurableKnowledgeOwnerRef
): owner is DurableEvidenceOwnerRef {
  return owner.type !== 'global';
}

/**
 * A Store's durable owner, or null when the Store has no permanent identity
 * yet. Null is the honest answer for a checkout whose metadata predates
 * identities: the caller REFUSES and names `rasen store upgrade-identity`
 * rather than falling back to recording the display alias, which is exactly
 * the record this release exists to stop writing.
 */
export function storeOwnerFrom(store: ResolvedStoreRef): DurableKnowledgeOwnerRef | null {
  if (store.uid === undefined) return null;
  return { type: 'store', uid: store.uid, id: store.id };
}

/** The durable owner for a resolved runtime owner, or null for the same reason. */
export function durableOwnerFrom(
  owner: ResolvedKnowledgeOwnerRef
): DurableKnowledgeOwnerRef | null {
  switch (owner.type) {
    case 'global':
      return { type: 'global' };
    case 'project':
      return { type: 'project', projectId: owner.id };
    case 'store':
      return owner.uid === undefined
        ? null
        : { type: 'store', uid: owner.uid, id: owner.id };
  }
}
