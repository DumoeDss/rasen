/**
 * Durable identity vocabulary (development plan §12) plus the Store UID
 * helpers (design D8).
 *
 * Types and pure helpers only — no filesystem or registry access — so every
 * layer from `foundation.ts` up to the command surfaces can import it without
 * creating a cycle. Sibling changes (project membership, session runtime
 * context, Store-scoped knowledge) import these declarations rather than
 * redeclaring them.
 */
import { randomUUID } from 'node:crypto';

/**
 * A Store named durably: the permanent identity is the authority, the display
 * alias is carried for readability only. Durable refs carry no root — a root is
 * machine-local and never travels in shared data.
 */
export interface StoreIdentityRef {
  type: 'store';
  uid: string;
  id?: string;
}

/** A project named durably by its `projectId` (child B's authority). */
export interface ProjectIdentityRef {
  type: 'project';
  projectId: string;
  id?: string;
}

/** The machine/global scope, which has no identity beyond being itself. */
export interface GlobalIdentityRef {
  type: 'global';
}

export type DurableOwnerRef = GlobalIdentityRef | StoreIdentityRef | ProjectIdentityRef;

/**
 * A Store that resolved to a local checkout.
 *
 * `uid` is optional here — and ONLY here — because a Store whose metadata
 * predates permanent identities resolves legitimately with no identity yet
 * (it reports `store_metadata_legacy`). Everything that records identity
 * durably must use `StoreIdentityRef`, whose `uid` is required.
 */
export interface ResolvedStoreRef {
  type: 'store';
  uid?: string;
  /** Display alias, always known for a resolved Store. */
  id: string;
  /** Canonical local root; machine-local, never written to shared data. */
  root: string;
}

/** A project checkout resolved on this machine (consumed by child B/C). */
export interface ResolvedProjectCheckoutRef {
  type: 'project';
  projectId: string;
  id?: string;
  root: string;
  home?: string;
}

/**
 * The Store a command expected but could not use. Distinct from
 * `StoreIdentityRef` because a bare-alias declaration that matches nothing has
 * no permanent identity to report — reporting the alias is the honest answer.
 */
export interface ExpectedStoreRef {
  type: 'store';
  uid?: string;
  id?: string;
  remote?: string;
}

/**
 * A project's durable Store declaration (`store: { uid, id?, remote? }`).
 * Nothing machine-specific ever enters it.
 */
export interface StorePointerV2 {
  uid: string;
  id?: string;
  remote?: string;
}

/**
 * Accepts any RFC 4122 textual form — the check exists to reject junk, not to
 * pin a version (same policy as the session-id check in
 * `management-api/router.ts`).
 */
const STORE_UID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** Mints a Store's permanent identity — the same primitive `projectId` uses. */
export function mintStoreUid(): string {
  return randomUUID();
}

/** Trim + lowercase, so a hand-edited uppercase UID is not read as a mismatch. */
export function normalizeStoreUid(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidStoreUid(value: unknown): value is string {
  return typeof value === 'string' && STORE_UID_PATTERN.test(value.trim());
}

/** Case- and whitespace-insensitive identity comparison (design D8). */
export function storeUidsMatch(
  left: string | undefined,
  right: string | undefined
): boolean {
  if (left === undefined || right === undefined) return false;
  return normalizeStoreUid(left) === normalizeStoreUid(right);
}

/**
 * An all-digit alias reads as an identity while the UID is the real one
 * (design D10). Warned on newly assigned aliases only.
 */
export function isAllDigitAlias(id: string): boolean {
  return /^[0-9]+$/u.test(id);
}
