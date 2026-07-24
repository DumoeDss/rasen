/** Canonical catalog parsing, normalization, identity checks, and serialization. */
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
  LEARNED_SKILL_MAX_EVIDENCE_ENTRIES,
} from './constants.js';
import { LearnedSkillManifestSchema } from './schema.js';
import type { ResolvedStore } from './stores.js';
import type {
  Applicability,
  CanonicalKnowledgeIdentity,
  CanonicalLearnedSkill,
  EvidenceReference,
  KnowledgeOwnerRef,
  LearnedSkillManifest,
  LearnedSkillManifestV1,
  LearnedSkillManifestV2,
  LearnedSkillScope,
  NormalizedEvidenceReference,
  PromotionSourceLocator,
} from './types.js';

export function digestContent(content: string): string {
  return `sha256:${createHash('sha256').update(content, 'utf8').digest('hex')}`;
}

export function evidenceTupleKey(
  entry: EvidenceReference | NormalizedEvidenceReference
): string {
  const owner =
    'projectId' in entry
      ? `project:${entry.projectId}`
      : `${entry.owner.type}:${entry.owner.id}`;
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
  if (unique.length <= LEARNED_SKILL_MAX_EVIDENCE_ENTRIES) return { entries: unique };
  const kept = unique.slice(0, LEARNED_SKILL_MAX_EVIDENCE_ENTRIES);
  const dropped = unique.slice(LEARNED_SKILL_MAX_EVIDENCE_ENTRIES);
  return {
    entries: kept,
    overflow: {
      count: dropped.length,
      digest: digestContent(dropped.map(evidenceTupleKey).join('\n')),
    },
  };
}

export function dedupeEvidence(evidence: readonly EvidenceReference[]): DedupedEvidence {
  return dedupe(evidence);
}

export function dedupeTypedEvidence(
  evidence: readonly NormalizedEvidenceReference[]
): DedupedTypedEvidence {
  return dedupe(evidence);
}

export function distinctProjectIds(evidence: readonly EvidenceReference[]): Set<string> {
  return new Set(evidence.map((entry) => entry.projectId));
}

export function normalizeEvidence(
  manifest: LearnedSkillManifest
): NormalizedEvidenceReference[] {
  return manifest.version === 1
    ? manifest.evidence.map(({ projectId, change, artifact, digest }) => ({
        owner: { type: 'project' as const, id: projectId },
        change,
        artifact,
        digest,
      }))
    : manifest.evidence;
}

export function buildCanonicalContent(
  id: string,
  description: string,
  instructions: string
): string {
  const frontmatter = stringifyYaml({ name: id, description }, { lineWidth: 0 }).trimEnd();
  return `---\n${frontmatter}\n---\n\n${instructions.trim()}\n`;
}

export function serializeManifest(manifest: LearnedSkillManifest): string {
  return stringifyYaml(manifest, { lineWidth: 0 });
}

export type CanonicalRecordRead =
  | { kind: 'managed'; record: CanonicalLearnedSkill }
  | { kind: 'unmanaged'; reason: string }
  | { kind: 'absent' };

function sameOwner(left: KnowledgeOwnerRef, right: KnowledgeOwnerRef): boolean {
  return (
    left.type === right.type &&
    (left.type === 'global' ||
      (right.type !== 'global' && left.id === right.id))
  );
}

export function readCanonicalRecord(
  directory: string,
  scope: LearnedSkillScope,
  owner: KnowledgeOwnerRef =
    scope === 'global' ? { type: 'global' } : { type: scope, id: '' }
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
    return {
      kind: 'unmanaged',
      reason: `${directory} has no ${LEARNED_SKILL_MANIFEST_FILE} (not Rasen-managed)`,
    };
  }
  let parsedManifest: unknown;
  try {
    parsedManifest = parseYaml(fs.readFileSync(manifestPath, 'utf-8'));
  } catch (error) {
    return {
      kind: 'unmanaged',
      reason: `${manifestPath} is not valid YAML: ${(error as Error).message}`,
    };
  }
  const result = LearnedSkillManifestSchema.safeParse(parsedManifest);
  if (!result.success) {
    return { kind: 'unmanaged', reason: `${manifestPath} is not a valid managed manifest` };
  }
  const manifest = result.data as LearnedSkillManifest;
  if (manifest.generatedBy !== LEARNED_SKILL_GENERATED_BY) {
    return {
      kind: 'unmanaged',
      reason: `${directory} is owned by "${manifest.generatedBy}", not Rasen`,
    };
  }
  if (manifest.scope !== scope) {
    return {
      kind: 'unmanaged',
      reason: `${manifestPath} declares ${manifest.scope} scope under the ${scope} catalog`,
    };
  }
  const expectedIdentity: CanonicalKnowledgeIdentity = {
    owner,
    id: path.basename(directory),
  };
  if (manifest.id !== expectedIdentity.id) {
    return {
      kind: 'unmanaged',
      reason: `${manifestPath} id "${manifest.id}" does not match canonical directory "${expectedIdentity.id}"`,
    };
  }
  if (manifest.version === 1 && scope === 'store') {
    return { kind: 'unmanaged', reason: `${manifestPath} version 1 cannot own store knowledge` };
  }
  if (manifest.version === 2 && !sameOwner(manifest.owner, owner)) {
    return {
      kind: 'unmanaged',
      reason: `${manifestPath} owner does not match canonical ${owner.type}${owner.type === 'global' ? '' : `:${owner.id}`}`,
    };
  }
  const content = fs.existsSync(contentPath) ? fs.readFileSync(contentPath, 'utf-8') : '';
  if (digestContent(content) !== manifest.contentDigest) {
    return {
      kind: 'unmanaged',
      reason: `${contentPath} does not match the stored content digest`,
    };
  }
  return {
    kind: 'managed',
    record: {
      identity: expectedIdentity,
      manifest,
      scope,
      directory,
      content,
      evidence: normalizeEvidence(manifest),
    },
  };
}

export function loadStoreCatalog(
  store: ResolvedStore,
  scope: LearnedSkillScope
): CanonicalLearnedSkill[] {
  if (!fs.existsSync(store.dir)) return [];
  const records: CanonicalLearnedSkill[] = [];
  for (const entry of fs.readdirSync(store.dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || isOsJunkEntryName(entry.name)) continue;
    const read = readCanonicalRecord(
      FileSystemUtils.joinPath(store.dir, entry.name),
      scope,
      store.owner
    );
    if (read.kind === 'managed') records.push(read.record);
  }
  return records;
}

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
    version: 1,
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

export function buildManifestV2(input: {
  id: string;
  knowledgeKey: string;
  scope: LearnedSkillScope;
  owner: KnowledgeOwnerRef;
  contentDigest: string;
  description: string;
  applicability: Applicability;
  evidence: DedupedTypedEvidence;
  sources: PromotionSourceLocator[];
  createdAt: string;
  updatedAt: string;
}): LearnedSkillManifestV2 {
  return {
    version: 2,
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

/** Compatibility helper: project/global v1 writes remain v1-representable. */
export const buildManifest = buildManifestV1;
