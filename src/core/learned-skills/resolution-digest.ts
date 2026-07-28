/**
 * The identity of one RESOLVED piece of knowledge, and the managed body it
 * renders to.
 *
 * Version 2 exists because version 1 put a Store's DISPLAY NAME in the
 * identity. On a release that makes the display name renameable, that turns a
 * rename into what looks like a content change: every record a renamed Store
 * contributed to reports itself as edited, and the ownership records are
 * rewritten for a change nobody made.
 *
 * So version 2 takes, and takes only:
 *
 *   schema version · identifier · knowledge key · effective scope ·
 *   the SORTED PERMANENT identities of its sources · their content digests ·
 *   the rendered managed body
 *
 * No display alias reaches it. `durableOwnerKey` is what proves that — a Store
 * owner keys on its permanent identity and nothing else — and the body is
 * rendered through {@link renderManagedBody}, which lists sources by the same
 * durable key.
 *
 * The body the digest covers is the managed document WITHOUT its own
 * `resolutionDigest` line, which is what keeps the definition from being
 * circular: the digest covers everything the file says except the digest.
 */

import { quoteYamlValue } from '../shared/yaml.js';
import { digestContent } from './catalog.js';
import { LEARNED_SKILL_GENERATED_BY } from './constants.js';
import { durableOwnerKey } from './owner-identity.js';
import type { CanonicalKnowledgeIdentity, CanonicalLearnedSkill } from './types.js';

/** Current resolution-identity scheme. A change here is a MIGRATION, not an edit. */
export const RESOLUTION_DIGEST_VERSION = 2 as const;
/** The alias-keyed scheme that shipped only on an unreleased branch. */
export const RESOLUTION_DIGEST_V1_VERSION = 1 as const;

export type ResolutionDigestVersion =
  | typeof RESOLUTION_DIGEST_V1_VERSION
  | typeof RESOLUTION_DIGEST_VERSION;

/**
 * Strips a leading `---\n…\n---\n` YAML frontmatter block, returning the body
 * with its line endings normalized.
 *
 * Normalization is not cosmetic here. A Store's catalog lives in a Git
 * repository, so a checkout with `core.autocrlf` on hands back CRLF for content
 * Rasen wrote with LF. Without normalizing, two Stores holding the SAME record
 * on two differently configured machines would produce different identities and
 * be reported as a conflict nobody caused — and the body is embedded in the
 * identity below, where the digest's own normalization can no longer reach it
 * because JSON has already escaped the newline.
 */
export function stripFrontmatter(content: string): string {
  const normalized = content.replace(/\r\n/gu, '\n');
  const match = /^---\n[\s\S]*?\n---\n?/.exec(normalized);
  return match ? normalized.slice(match[0].length).trim() : normalized.trim();
}

/**
 * The sources line: every contributing owner by DURABLE key, sorted.
 *
 * A reader can still tell which Stores contributed; what they cannot do is
 * read a display name out of it, because none is written. That is the whole
 * point — this string is inside the digested body.
 */
export function renderSourceKeys(sources: readonly CanonicalKnowledgeIdentity[]): string {
  return [...new Set(sources.map((source) => `${durableOwnerKey(source.owner)}/${source.id}`))]
    .sort()
    .join(',');
}

export interface ManagedBodyInput {
  id: string;
  effectiveScope: 'project' | 'store' | 'global';
  sources: readonly CanonicalKnowledgeIdentity[];
  canonicalContentDigest: string;
  description: string;
  body: string;
}

/**
 * The managed document exactly as it is written, with `extraMetadata` appended
 * to the frontmatter's `metadata:` block.
 *
 * Called with NO extras it is "the rendered managed body" the identity covers;
 * called with the `resolutionDigest` line it is the file materialization
 * writes. One renderer for both, so the digest can never cover a document
 * shaped differently from the one that lands on disk — and it stays
 * non-circular, because the only line the digest does not cover is the digest.
 *
 * The frontmatter is an ordered list of lines rather than a serializer's
 * output: a reordering would change every digest at once and read as if every
 * record had been edited.
 */
export function renderManagedDocument(
  input: ManagedBodyInput,
  extraMetadata: readonly string[] = []
): string {
  return [
    '---',
    `name: ${quoteYamlValue(input.id)}`,
    `description: ${quoteYamlValue(input.description)}`,
    'license: MIT',
    'compatibility: Requires rasen CLI.',
    'metadata:',
    '  author: rasen',
    `  generatedBy: ${quoteYamlValue(LEARNED_SKILL_GENERATED_BY)}`,
    `  learnedSkillScope: ${quoteYamlValue(input.effectiveScope)}`,
    `  learnedSkillId: ${quoteYamlValue(input.id)}`,
    `  learnedSkillSources: ${quoteYamlValue(renderSourceKeys(input.sources))}`,
    `  contentDigest: ${quoteYamlValue(input.canonicalContentDigest)}`,
    ...extraMetadata,
    '---',
    '',
    input.body,
    '',
  ].join('\n');
}

/** The managed-body input for one resolved record. */
export function managedBodyInputFor(input: {
  id: string;
  effectiveScope: 'project' | 'store' | 'global';
  sources: readonly CanonicalKnowledgeIdentity[];
  record: CanonicalLearnedSkill;
}): ManagedBodyInput {
  return {
    id: input.id,
    effectiveScope: input.effectiveScope,
    sources: input.sources,
    canonicalContentDigest: input.record.manifest.contentDigest,
    description: input.record.manifest.description,
    body: stripFrontmatter(input.record.content),
  };
}

export interface ResolutionDigestInput {
  id: string;
  knowledgeKey: string;
  effectiveScope: 'project' | 'store' | 'global';
  sources: readonly CanonicalKnowledgeIdentity[];
  /** Every contributing copy's canonical content digest. */
  canonicalContentDigests: readonly string[];
  record: CanonicalLearnedSkill;
}

/**
 * Version 2 resolution identity.
 *
 * Sources are projected onto their durable keys BEFORE serialization, so the
 * object that carries a Store's display alias alongside its permanent identity
 * cannot leak that alias into the digest by being stringified whole. Order is
 * removed by sorting, so the same sources supplied in a different order
 * produce the same identity.
 */
export function resolutionDigestV2(input: ResolutionDigestInput): string {
  const sourceKeys = [
    ...new Set(input.sources.map((source) => `${durableOwnerKey(source.owner)}/${source.id}`)),
  ].sort();
  const contentDigests = [...new Set(input.canonicalContentDigests)].sort();
  return digestContent(
    JSON.stringify({
      schemaVersion: RESOLUTION_DIGEST_VERSION,
      id: input.id,
      knowledgeKey: input.knowledgeKey,
      effectiveScope: input.effectiveScope,
      sources: sourceKeys,
      canonicalContentDigests: contentDigests,
      managedBody: renderManagedDocument(
        managedBodyInputFor({
          id: input.id,
          effectiveScope: input.effectiveScope,
          sources: input.sources,
          record: input.record,
        })
      ),
    })
  );
}
