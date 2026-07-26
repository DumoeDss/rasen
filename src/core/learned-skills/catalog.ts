/**
 * Canonical catalog mechanics: reading managed records, distinguishing an
 * unmanaged/human-owned collision from an absent id, content/manifest digests,
 * evidence-tuple deduplication with bounded overflow provenance, and building
 * the canonical SKILL.md + manifest. The stable knowledge key is supplied by
 * the candidate (the agent synthesizes it); the core only re-checks identity.
 *
 * Two versions live here at once, on purpose. A version 1 record is read,
 * normalized IN MEMORY, and used — its file is never rewritten by a read, and
 * a newer shape appears only when a mutation the user performed needs one.
 */

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

import { FileSystemUtils } from '../../utils/file-system.js';
import { isOsJunkEntryName } from '../workflow-registry/path-policy.js';
import {
  LEARNED_SKILL_CONTENT_FILE,
  LEARNED_SKILL_GENERATED_BY,
  LEARNED_SKILL_MANIFEST_FILE,
  LEARNED_SKILL_MANIFEST_VERSION,
  LEARNED_SKILL_MANIFEST_V1_VERSION,
  LEARNED_SKILL_MAX_EVIDENCE_ENTRIES,
} from './constants.js';
import { describeDurableOwner, durableOwnerKey, sameDurableOwner } from './owner-identity.js';
import { LearnedSkillManifestSchema } from './schema.js';
import type { ResolvedStore } from './stores.js';
import type {
  Applicability,
  CanonicalKnowledgeIdentity,
  CanonicalLearnedSkill,
  DurableKnowledgeOwnerRef,
  EvidenceReference,
  LearnedSkillManifest,
  LearnedSkillManifestV1,
  LearnedSkillManifestV2,
  LearnedSkillScope,
  NormalizedEvidenceReference,
  PromotionSourceLocator,
} from './types.js';

/**
 * sha256:<hex> over UTF-8 bytes — the one digest form used across the module.
 *
 * Line endings are normalized first, and that matters specifically because a
 * Store's catalog lives in a Git repository: a checkout with `core.autocrlf`
 * on hands back CRLF for content Rasen wrote with LF. Digesting the raw bytes
 * would make every record on such a machine read as tampered-with. Everything
 * Rasen writes is LF, so normalizing changes no digest that already exists.
 */
export function digestContent(content: string): string {
  const normalized = content.replace(/\r\n/gu, '\n');
  return `sha256:${createHash('sha256').update(normalized, 'utf8').digest('hex')}`;
}

/**
 * Stable tuple key for evidence deduplication (NUL-separated, collision-safe).
 *
 * Both record versions produce the SAME key for the same contributor, so
 * version 1 and version 2 evidence from one project dedupe against each other
 * instead of accumulating the same fact twice under two spellings.
 */
export function evidenceTupleKey(
  entry: EvidenceReference | NormalizedEvidenceReference
): string {
  const owner =
    'projectId' in entry ? `project:${entry.projectId}` : durableOwnerKey(entry.owner);
  return [owner, entry.change, entry.artifact, entry.digest].join('\u0000');
}

export interface DedupedEvidence {
  entries: EvidenceReference[];
  overflow?: { count: number; digest: string };
}

export interface DedupedTypedEvidence {
  entries: NormalizedEvidenceReference[];
  overflow?: { count: number; digest: string };
}

/**
 * Deduplicates evidence by its stable tuple and caps it at
 * {@link LEARNED_SKILL_MAX_EVIDENCE_ENTRIES}. Overflow is summarized by count
 * and a digest over the dropped tuple keys rather than copied indefinitely, so
 * provenance stays bounded (design D3). Dedup is order-preserving.
 */
function dedupe<T extends EvidenceReference | NormalizedEvidenceReference>(
  evidence: readonly T[]
): { entries: T[]; overflow?: { count: number; digest: string } } {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const entry of evidence) {
    const key = evidenceTupleKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(entry);
  }
  if (unique.length <= LEARNED_SKILL_MAX_EVIDENCE_ENTRIES) {
    return { entries: unique };
  }
  const kept = unique.slice(0, LEARNED_SKILL_MAX_EVIDENCE_ENTRIES);
  const dropped = unique.slice(LEARNED_SKILL_MAX_EVIDENCE_ENTRIES);
  const digest = digestContent(dropped.map(evidenceTupleKey).join('\n'));
  return { entries: kept, overflow: { count: dropped.length, digest } };
}

export function dedupeEvidence(evidence: readonly EvidenceReference[]): DedupedEvidence {
  return dedupe(evidence);
}

export function dedupeTypedEvidence(
  evidence: readonly NormalizedEvidenceReference[]
): DedupedTypedEvidence {
  return dedupe(evidence);
}

/** The distinct stable project ids present in a version 1 evidence set. */
export function distinctProjectIds(evidence: readonly EvidenceReference[]): Set<string> {
  return new Set(evidence.map((entry) => entry.projectId));
}

/**
 * Version 1 evidence projected onto the durable shape. Performed in memory:
 * the file on disk is untouched, which is what lets an older catalog be read
 * and used without a read becoming a migration.
 */
export function normalizeEvidence(
  manifest: LearnedSkillManifest
): NormalizedEvidenceReference[] {
  return manifest.version === LEARNED_SKILL_MANIFEST_V1_VERSION
    ? manifest.evidence.map(({ projectId, change, artifact, digest }) => ({
        owner: { type: 'project' as const, projectId },
        change,
        artifact,
        digest,
      }))
    : manifest.evidence;
}

/** Builds the canonical SKILL.md: frontmatter (name = id, description) + synthesized body. */
export function buildCanonicalContent(id: string, description: string, instructions: string): string {
  const frontmatter = stringifyYaml({ name: id, description }, { lineWidth: 0 }).trimEnd();
  return `---\n${frontmatter}\n---\n\n${instructions.trim()}\n`;
}

/** Serializes a manifest to YAML with a stable key order. */
export function serializeManifest(manifest: LearnedSkillManifest): string {
  return stringifyYaml(manifest, { lineWidth: 0 });
}

export type CanonicalRecordRead =
  | { kind: 'managed'; record: CanonicalLearnedSkill }
  | {
      kind: 'unmanaged';
      reason: string;
      /**
       * True when the occupant carries Rasen's `generatedBy` marker and was
       * refused anyway — a record Rasen itself wrote that no longer verifies:
       * an edited body, a renamed directory, the wrong scope or owner, a
       * version that cannot own store knowledge, or a manifest this version's
       * strict schema will not accept (an added key, a retyped field, or a
       * record written by a NEWER release).
       *
       * The marker is the line, and it is read as early as it becomes
       * readable — at the schema-failure branch the YAML has already parsed,
       * so ownership is known there and is not thrown away.
       *
       * The distinction is what makes reporting these usable. An occupant with
       * no manifest, unparseable YAML, or a foreign `generatedBy` is simply
       * somebody else's file — the catalog is expected to contain those, and
       * warning about each one would bury the case that matters. Only a record
       * Rasen wrote can be "missing" from the user's point of view.
       */
      rasenAuthored?: boolean;
    }
  | { kind: 'absent' };

/**
 * Reads the record occupying a canonical directory. `managed` requires a valid
 * manifest carrying the exact {@link LEARNED_SKILL_GENERATED_BY} marker AND
 * agreeing with the catalog it was found in — scope, id, and durable owner. Any
 * other occupant (a human-authored skill, a differently-owned or malformed
 * manifest, a record copied in from another owner) is `unmanaged`: a collision
 * a mutation must not overwrite. A directory that does not exist is `absent`.
 *
 * `owner` is required rather than defaulted. A default would have to invent an
 * owner for a catalog it was never told about, and inventing a Store identity
 * is precisely what this change exists to stop.
 */
export function readCanonicalRecord(
  directory: string,
  scope: LearnedSkillScope,
  owner: DurableKnowledgeOwnerRef
): CanonicalRecordRead {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'absent' };
    throw error;
  }
  if (!stat.isDirectory()) {
    return { kind: 'unmanaged', reason: `${directory} exists and is not a directory` };
  }

  const manifestPath = FileSystemUtils.joinPath(directory, LEARNED_SKILL_MANIFEST_FILE);
  const contentPath = FileSystemUtils.joinPath(directory, LEARNED_SKILL_CONTENT_FILE);
  if (!fs.existsSync(manifestPath)) {
    return { kind: 'unmanaged', reason: `${directory} has no ${LEARNED_SKILL_MANIFEST_FILE} (not Rasen-managed)` };
  }

  let parsedManifest: unknown;
  try {
    parsedManifest = parseYaml(fs.readFileSync(manifestPath, 'utf-8'));
  } catch (error) {
    return { kind: 'unmanaged', reason: `${manifestPath} is not valid YAML: ${(error as Error).message}` };
  }
  const result = LearnedSkillManifestSchema.safeParse(parsedManifest);
  if (!result.success) {
    // The marker is readable HERE — the YAML parsed, only the strict schema
    // refused it — so ownership is known and must not be discarded. A record
    // carrying Rasen's marker that this version's schema cannot accept is
    // Rasen's record: an added key (every schema here is `.strict()`), a
    // retyped field, or a version written by a NEWER release reading back on
    // this one. The last needs no user error at all and is exactly the
    // cross-version, cross-machine Store sharing this catalog exists for, so
    // it is reported rather than vanishing without explanation.
    const marker = (parsedManifest as { generatedBy?: unknown } | null)?.generatedBy;
    if (marker === LEARNED_SKILL_GENERATED_BY) {
      return {
        kind: 'unmanaged',
        rasenAuthored: true,
        reason: `${manifestPath} carries Rasen's marker but does not match this version's record schema`,
      };
    }
    return { kind: 'unmanaged', reason: `${manifestPath} is not a valid managed manifest` };
  }
  const manifest = result.data as LearnedSkillManifest;
  if (manifest.generatedBy !== LEARNED_SKILL_GENERATED_BY) {
    return { kind: 'unmanaged', reason: `${directory} is owned by "${manifest.generatedBy}", not Rasen` };
  }
  // Everything below this point is a record Rasen WROTE that no longer
  // verifies, not somebody else's file: the `generatedBy` marker matched. Each
  // refusal therefore carries `rasenAuthored` so a surface can report it as a
  // record that has gone unreadable rather than dropping it indistinguishably
  // from a deletion.
  if (manifest.scope !== scope) {
    return {
      kind: 'unmanaged',
      rasenAuthored: true,
      reason: `${manifestPath} declares ${manifest.scope} scope inside the ${scope} catalog`,
    };
  }

  const identity: CanonicalKnowledgeIdentity = { owner, id: path.basename(directory) };
  if (manifest.id !== identity.id) {
    return {
      kind: 'unmanaged',
      rasenAuthored: true,
      reason: `${manifestPath} id "${manifest.id}" does not match its canonical directory "${identity.id}"`,
    };
  }
  // Version 1 has nowhere to record a Store's permanent identity, so a version
  // 1 file inside a Store catalog is not a Store record — it is a file that
  // wandered in, and treating it as one would key ownership on the directory.
  if (manifest.version === LEARNED_SKILL_MANIFEST_V1_VERSION && scope === 'store') {
    return {
      kind: 'unmanaged',
      rasenAuthored: true,
      reason: `${manifestPath} is a version 1 record, which cannot own store knowledge`,
    };
  }
  if (manifest.version === LEARNED_SKILL_MANIFEST_VERSION && !sameDurableOwner(manifest.owner, owner)) {
    return {
      kind: 'unmanaged',
      rasenAuthored: true,
      reason: `${manifestPath} records owner ${describeDurableOwner(manifest.owner)}, not ${describeDurableOwner(owner)}`,
    };
  }

  const content = fs.existsSync(contentPath) ? fs.readFileSync(contentPath, 'utf-8') : '';
  // The body must be the one the manifest was written for. Compared through
  // the line-ending-normalizing digest, so a Git checkout that rewrote the
  // catalog's newlines is still the same record.
  if (digestContent(content) !== manifest.contentDigest) {
    return {
      kind: 'unmanaged',
      rasenAuthored: true,
      reason: `${contentPath} does not match the content digest recorded in ${LEARNED_SKILL_MANIFEST_FILE}`,
    };
  }
  return {
    kind: 'managed',
    record: {
      identity,
      manifest,
      scope,
      directory,
      content,
      evidence: normalizeEvidence(manifest),
    },
  };
}

/** A record Rasen wrote that the catalog can no longer read, and why. */
export interface UnreadableCanonicalRecord {
  /** The canonical id, which is the directory's own name. */
  id: string;
  directory: string;
  reason: string;
}

export interface StoreCatalogRead {
  records: CanonicalLearnedSkill[];
  /**
   * Rasen-authored records the catalog refused. Reported rather than dropped:
   * verification that silently removes a record is indistinguishable from a
   * deletion, and the user who edited `SKILL.md` by hand has no way to find
   * out why the skill vanished.
   */
  unreadable: UnreadableCanonicalRecord[];
}

/**
 * Reads a catalog, keeping BOTH halves of the answer.
 *
 * Occupants that are not Rasen's — a hand-written skill, a stray directory —
 * are skipped in silence, exactly as before; a catalog is expected to contain
 * those. Only a record carrying Rasen's own marker that then failed
 * verification is reported, because only that one looks to the user like
 * something that disappeared.
 *
 * Mutation debris is skipped for a different reason, and the reason is load
 * bearing: a `.rasen-learned-skill-backup-*` directory holds a REAL Rasen
 * manifest whose id no longer matches its directory, which is a reported
 * refusal — it stays silent only because `isOsJunkEntryName` skips every
 * dot-prefixed entry. The leading dot on both debris prefixes is therefore
 * part of the contract, not cosmetics: rename either to a non-dot name and
 * every killed mutation starts reporting its own backup as a corrupt record.
 */
export function readStoreCatalog(store: ResolvedStore, scope: LearnedSkillScope): StoreCatalogRead {
  if (!fs.existsSync(store.dir)) return { records: [], unreadable: [] };
  const entries = fs.readdirSync(store.dir, { withFileTypes: true });
  const records: CanonicalLearnedSkill[] = [];
  const unreadable: UnreadableCanonicalRecord[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || isOsJunkEntryName(entry.name)) continue;
    const directory = FileSystemUtils.joinPath(store.dir, entry.name);
    const read = readCanonicalRecord(directory, scope, store.owner);
    if (read.kind === 'managed') {
      records.push(read.record);
      continue;
    }
    if (read.kind === 'unmanaged' && read.rasenAuthored === true) {
      unreadable.push({ id: entry.name, directory, reason: read.reason });
    }
  }
  return { records, unreadable };
}

/** Loads every managed record in a catalog (unmanaged/absent entries are skipped). */
export function loadStoreCatalog(store: ResolvedStore, scope: LearnedSkillScope): CanonicalLearnedSkill[] {
  return readStoreCatalog(store, scope).records;
}

/**
 * Builds a version 1 manifest for a create/rewrite (timestamps supplied by the
 * caller). Still the written shape for project and global records with no
 * store-typed provenance, so nothing already on disk is churned into a new
 * version by an ordinary rewrite.
 */
export function buildManifestV1(input: {
  id: string;
  knowledgeKey: string;
  scope: 'project' | 'global';
  contentDigest: string;
  description: string;
  applicability: Applicability;
  evidence: DedupedEvidence;
  createdAt: string;
  updatedAt: string;
}): LearnedSkillManifestV1 {
  return {
    version: LEARNED_SKILL_MANIFEST_V1_VERSION,
    id: input.id,
    knowledgeKey: input.knowledgeKey,
    scope: input.scope,
    status: 'active',
    generatedBy: LEARNED_SKILL_GENERATED_BY,
    contentDigest: input.contentDigest,
    description: input.description,
    applicability: input.applicability,
    evidence: input.evidence.entries,
    ...(input.evidence.overflow ? { evidenceOverflow: input.evidence.overflow } : {}),
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };
}

/** Builds a version 2 manifest: durable owner, durable evidence, exact sources. */
export function buildManifestV2(input: {
  id: string;
  knowledgeKey: string;
  scope: LearnedSkillScope;
  owner: DurableKnowledgeOwnerRef;
  contentDigest: string;
  description: string;
  applicability: Applicability;
  evidence: DedupedTypedEvidence;
  sources: PromotionSourceLocator[];
  createdAt: string;
  updatedAt: string;
}): LearnedSkillManifestV2 {
  return {
    version: LEARNED_SKILL_MANIFEST_VERSION,
    id: input.id,
    knowledgeKey: input.knowledgeKey,
    scope: input.scope,
    owner: input.owner,
    status: 'active',
    generatedBy: LEARNED_SKILL_GENERATED_BY,
    contentDigest: input.contentDigest,
    description: input.description,
    applicability: input.applicability,
    evidence: input.evidence.entries,
    sources: input.sources,
    ...(input.evidence.overflow ? { evidenceOverflow: input.evidence.overflow } : {}),
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };
}

/** Compatibility alias: project/global writes stay version 1 by default. */
export const buildManifest = buildManifestV1;
