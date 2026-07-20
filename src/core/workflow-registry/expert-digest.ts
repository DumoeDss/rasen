import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import canonicalize from 'canonicalize';

import type { SkillTemplate } from '../templates/types.js';
import { sha256 } from './digest.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Mirrors `isSidecarFile` in `../shared/skill-generation.ts` (the
 * materialization path this digest tracks) — keep the two definitions in
 * lockstep, or the digest will disagree with what actually gets installed.
 */
function isSidecarFile(fileName: string): boolean {
  if (fileName === 'SKILL.md') return false;
  if (fileName.endsWith('.tmpl')) return false;
  return (
    fileName.endsWith('.md') ||
    fileName.endsWith('.sh') ||
    fileName.endsWith('.mjs') ||
    fileName.endsWith('.js')
  );
}

export interface HashedSidecarFile {
  path: string;
  sha256: string;
}

/**
 * Resolves an expert's sidecar source directory (`skills/experts/<sourceId>`)
 * relative to the package root. Same depth convention as
 * `copySkillSidecars` in `../shared/skill-generation.ts`.
 */
export function resolveExpertSidecarDir(sourceId: string): string {
  return path.resolve(__dirname, '..', '..', '..', 'skills', 'experts', sourceId);
}

/**
 * Recursively hashes a sidecar directory tree, applying the same filter and
 * traversal shape as the materialization path. Returns `[]` when `sourceDir`
 * does not exist (e.g. a published npm package that does not bundle
 * `skills/`, or an expert with no sidecar files of its own).
 */
export function hashSidecarTree(sourceDir: string): HashedSidecarFile[] {
  if (!fs.existsSync(sourceDir)) return [];
  const results: HashedSidecarFile[] = [];

  const visit = (directory: string, prefix: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      const logicalPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        visit(entryPath, logicalPath);
        continue;
      }
      if (!entry.isFile() || !isSidecarFile(entry.name)) continue;
      results.push({ path: logicalPath, sha256: sha256(fs.readFileSync(entryPath)) });
    }
  };

  visit(sourceDir, '');
  results.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  return results;
}

/**
 * Digest preimage for `kind: 'expert'` definitions, distinct from
 * `digestBuiltIn` (skill+command) and `computeWorkflowDigest` (inline
 * `files[]`). Covers the inline template plus the hashed sidecar tree, so two
 * experts sharing a sidecar directory (`qa`/`qa-only`) still get distinct
 * digests because `id`/`dirName`/`template` differ.
 */
export function digestExpert(
  id: string,
  dirName: string,
  template: SkillTemplate,
  sidecars: readonly HashedSidecarFile[]
): string {
  const preimage = {
    format: 'rasen-expert-digest',
    version: 1,
    id,
    dirName,
    template,
    sidecars,
  };
  const canonical = canonicalize(preimage);
  if (canonical === undefined) throw new TypeError('Expert digest preimage is not JSON');
  return sha256(canonical);
}
