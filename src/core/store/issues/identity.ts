/**
 * The Issue identity seam.
 *
 * UID is authority, key is human presentation, slug/aliases are convenience,
 * and storageKey is an internal locator. No caller may turn a raw selector
 * into a path or lock key.
 */
import { createHash } from 'node:crypto';

import {
  parseIssueId,
  parseIssueKey,
  parseIssueStorageKey,
  parseIssueUid,
  type IssueKey,
  type IssueSelector,
  type IssueStorageKey,
  type IssueUid,
} from '../planning-validation.js';
import { issueError } from './diagnostics.js';
import type { StoredIssueRecord } from './types.js';

export type IssueAliasKind = 'legacy-id' | 'former-slug' | 'custom';

export interface IssueAliasV1 {
  readonly kind: IssueAliasKind;
  readonly value: string;
}

export interface IssueIdentityV2 {
  readonly uid: IssueUid;
  readonly key: IssueKey;
  readonly slug: string | null;
  readonly aliases: readonly IssueAliasV1[];
}

export interface ResolvedIssueIdentity {
  readonly identity: IssueIdentityV2;
  readonly storageKey: IssueStorageKey;
  readonly sourceVersion: 1 | 2;
}

export interface IssueIdentityCandidate extends ResolvedIssueIdentity {
  readonly title: string;
}

/**
 * Proves that an Issue-owned durable resource belongs to one resolved Issue.
 * V2 resources name the UID directly; V1 resources belong only to the V1
 * Issue whose retained storage key equals their legacy owner id.
 */
export function issueResourceOwnerMatches(
  owner: ResolvedIssueIdentity,
  resource:
    | { readonly version: 1; readonly issueId: string }
    | { readonly version: 2; readonly issueUid: string }
): boolean {
  return resource.version === 2
    ? resource.issueUid === owner.identity.uid
    : owner.sourceVersion === 1 && resource.issueId === String(owner.storageKey);
}

export const ISSUE_IDENTITY_ALLOCATION_ATTEMPTS = 8;
export const ISSUE_KEY_PREFIX = 'ISS-';
const ISSUE_KEY_DOMAIN = 'rasen.issue-key.v1\0';
const LEGACY_UID_DOMAIN = 'rasen:issue:v1:';
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CONTROL_PATTERN = /[\x00-\x1f\x7f]/u;

function uuidBytes(value: string): Buffer {
  return Buffer.from(parseIssueUid(value).replace(/-/gu, ''), 'hex');
}

function formatUuid(bytes: Uint8Array): IssueUid {
  const hex = Buffer.from(bytes).toString('hex');
  return parseIssueUid(
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  );
}

/** RFC 4122 UUIDv5 with the Store UID as namespace. */
export function deriveLegacyIssueUid(storeUid: string, legacyIssueId: string): IssueUid {
  const namespace = uuidBytes(storeUid);
  const legacyId = parseIssueId(legacyIssueId, 'legacyIssueId');
  const digest = createHash('sha1')
    .update(namespace)
    .update(`${LEGACY_UID_DOMAIN}${legacyId}`, 'utf8')
    .digest();
  const bytes = Uint8Array.from(digest.subarray(0, 16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  return formatUuid(bytes);
}

function encodeCrockford80(bytes: Uint8Array): string {
  if (bytes.length !== 10) throw new TypeError('Issue key input must be exactly 80 bits.');
  let value = BigInt(`0x${Buffer.from(bytes).toString('hex')}`);
  const encoded = new Array<string>(16);
  for (let index = encoded.length - 1; index >= 0; index -= 1) {
    encoded[index] = CROCKFORD[Number(value & 31n)] as string;
    value >>= 5n;
  }
  return encoded.join('');
}

/** Stable human key protocol. Fixed vectors guard every byte of this function. */
export function deriveIssueKey(uid: string): IssueKey {
  const canonicalUid = parseIssueUid(uid);
  const digest = createHash('sha256')
    .update(ISSUE_KEY_DOMAIN, 'utf8')
    .update(canonicalUid, 'utf8')
    .digest();
  return parseIssueKey(`${ISSUE_KEY_PREFIX}${encodeCrockford80(digest.subarray(0, 10))}`);
}

/** Best-effort ASCII search alias. Non-ASCII-only titles validly produce null. */
export function deriveIssueSlug(title: string): string | null {
  const normalized = title
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 64)
    .replace(/-+$/gu, '');
  return normalized.length === 0 ? null : normalized;
}

export function parseIssueAlias(value: string, field = 'issueAlias'): string {
  if (value.length === 0 || value !== value.trim()) {
    throw issueError('issue_selector_invalid', `${field} must be non-empty without surrounding whitespace.`);
  }
  if (value.length > 200 || CONTROL_PATTERN.test(value)) {
    throw issueError('issue_selector_invalid', `${field} must be at most 200 characters and contain no control characters.`);
  }
  return value;
}

export function projectLegacyIssueIdentity(input: {
  readonly storeUid: string;
  readonly legacyIssueId: string;
}): ResolvedIssueIdentity {
  const legacyId = parseIssueId(input.legacyIssueId, 'legacyIssueId');
  const uid = deriveLegacyIssueUid(input.storeUid, legacyId);
  return {
    identity: {
      uid,
      key: deriveIssueKey(uid),
      slug: legacyId,
      aliases: [{ kind: 'legacy-id', value: legacyId }],
    },
    storageKey: parseIssueStorageKey(legacyId),
    sourceVersion: 1,
  };
}

export function projectV2IssueIdentity(input: {
  readonly identity: IssueIdentityV2;
  readonly storageKey: string;
}): ResolvedIssueIdentity {
  const uid = parseIssueUid(input.identity.uid);
  const key = parseIssueKey(input.identity.key);
  if (deriveIssueKey(uid) !== key) {
    throw issueError(
      'issue_identity_conflict',
      `Issue key '${key}' does not derive from Issue UID '${uid}'.`
    );
  }
  const storageKey = parseIssueStorageKey(input.storageKey);
  if (String(storageKey) !== String(uid)) {
    throw issueError(
      'issue_storage_identity_mismatch',
      `V2 Issue '${uid}' is stored below '${storageKey}' instead of its UID.`
    );
  }
  return {
    identity: {
      uid,
      key,
      slug: input.identity.slug,
      aliases: input.identity.aliases,
    },
    storageKey,
    sourceVersion: 2,
  };
}

/** Project either durable record version into the one identity/storage view. */
export function projectStoredIssueIdentity(input: {
  readonly storeUid: string;
  readonly record: StoredIssueRecord;
  readonly storageKey: string;
}): ResolvedIssueIdentity {
  const storageKey = parseIssueStorageKey(input.storageKey);
  if (input.record.version === 2) {
    return projectV2IssueIdentity({ identity: input.record.identity, storageKey });
  }
  if (String(storageKey) !== String(input.record.id)) {
    throw issueError(
      'issue_storage_identity_mismatch',
      `V1 Issue '${input.record.id}' is stored below '${storageKey}' instead of its recorded identifier.`
    );
  }
  return projectLegacyIssueIdentity({
    storeUid: input.storeUid,
    legacyIssueId: input.record.id,
  });
}

export function allocateIssueIdentity(input: {
  readonly title: string;
  readonly existing: readonly IssueIdentityCandidate[];
  readonly mintIssueUid: () => string;
  readonly compatibilityAlias?: string;
  readonly maxAttempts?: number;
}): IssueIdentityV2 {
  const alias =
    input.compatibilityAlias === undefined
      ? undefined
      : parseIssueAlias(input.compatibilityAlias, 'compatibilityAlias');
  if (
    alias !== undefined &&
    input.existing.some(candidate => matchesUnprefixed(candidate, alias))
  ) {
    throw issueError('issue_alias_conflict', `Issue alias '${alias}' already identifies an Issue.`);
  }

  const attempts = input.maxAttempts ?? ISSUE_IDENTITY_ALLOCATION_ATTEMPTS;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const uid = parseIssueUid(input.mintIssueUid());
    const key = deriveIssueKey(uid);
    if (input.existing.some(candidate => candidate.identity.uid === uid || candidate.identity.key === key)) {
      continue;
    }
    return {
      uid,
      key,
      slug: deriveIssueSlug(input.title),
      aliases: alias === undefined ? [] : [{ kind: 'legacy-id', value: alias }],
    };
  }
  throw issueError(
    'issue_identity_allocation_failed',
    `Unable to allocate a non-conflicting Issue identity after ${attempts} attempts.`
  );
}

export function parseIssueSelector(value: string): IssueSelector {
  return parseIssueAlias(value, 'issueSelector') as IssueSelector;
}

function matchesUnprefixed(candidate: IssueIdentityCandidate, selector: string): boolean {
  const { identity } = candidate;
  if (selector.toLowerCase() === identity.uid) return true;
  if (selector.toUpperCase() === identity.key) return true;
  if (identity.slug === selector) return true;
  return identity.aliases.some(alias => alias.value === selector);
}

function candidateMatches(candidate: IssueIdentityCandidate, selector: string): boolean {
  const separator = selector.indexOf(':');
  if (separator > 0) {
    const prefix = selector.slice(0, separator).toLowerCase();
    const value = selector.slice(separator + 1);
    if (prefix === 'uid') return candidate.identity.uid === value.toLowerCase();
    if (prefix === 'key') return candidate.identity.key === value.toUpperCase();
    if (prefix === 'legacy') {
      return candidate.identity.aliases.some(alias => alias.kind === 'legacy-id' && alias.value === value);
    }
  }
  return matchesUnprefixed(candidate, selector);
}

function validateExplicitSelector(selector: string): void {
  const separator = selector.indexOf(':');
  if (separator <= 0) return;
  const prefix = selector.slice(0, separator).toLowerCase();
  const value = selector.slice(separator + 1);
  try {
    if (prefix === 'uid') {
      parseIssueUid(value);
    } else if (prefix === 'key') {
      parseIssueKey(value.toUpperCase());
    } else if (prefix === 'legacy') {
      parseIssueAlias(value, 'legacy selector');
    }
  } catch (error) {
    throw issueError(
      'issue_selector_invalid',
      `Issue selector '${selector}' has an invalid ${prefix} value: ${error instanceof Error ? error.message : String(error)}.`
    );
  }
}

export function resolveIssueSelector(input: {
  readonly selector: string;
  readonly candidates: readonly IssueIdentityCandidate[];
  readonly complete?: boolean;
}): IssueIdentityCandidate {
  const selector = parseIssueSelector(input.selector);
  validateExplicitSelector(selector);
  if (input.complete === false) {
    throw issueError(
      'store_query_ref_unreadable',
      `Issue selector '${selector}' cannot be resolved uniquely because the Store catalog is incomplete.`
    );
  }
  const matches = input.candidates.filter(candidate => candidateMatches(candidate, selector));
  const byUid = new Map<IssueUid, IssueIdentityCandidate[]>();
  for (const candidate of matches) {
    const grouped = byUid.get(candidate.identity.uid) ?? [];
    grouped.push(candidate);
    byUid.set(candidate.identity.uid, grouped);
  }
  if (byUid.size === 0) {
    throw issueError('issue_not_found', `Issue selector '${selector}' matches no Issue.`);
  }
  if (byUid.size > 1) {
    const choices = [...byUid.values()]
      .map(candidates => candidates[0] as IssueIdentityCandidate)
      .map(
        candidate =>
          `${candidate.identity.key} (${candidate.identity.uid}, ${JSON.stringify(candidate.title)})`
      )
      .sort()
      .join(', ');
    throw issueError(
      'issue_selector_ambiguous',
      `Issue selector '${selector}' matches more than one Issue: ${choices}.`
    );
  }
  const candidates = [...byUid.values()][0] as IssueIdentityCandidate[];
  const storageKeys = new Set(candidates.map(candidate => String(candidate.storageKey)));
  if (storageKeys.size > 1) {
    throw issueError(
      'issue_identity_conflict',
      `Issue UID '${candidates[0]?.identity.uid ?? ''}' is claimed by more than one storage location: ${[
        ...storageKeys,
      ].sort().join(', ')}.`
    );
  }
  return candidates[0] as IssueIdentityCandidate;
}
