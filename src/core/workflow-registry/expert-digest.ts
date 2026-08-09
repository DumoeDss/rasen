import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import canonicalize from 'canonicalize';

import type { SkillTemplate } from '../templates/types.js';
import { sha256 } from './digest.js';
import type { WorkflowFileEntry } from './types.js';

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
 * Sidecars are text-only by contract. Canonicalize their line endings before
 * assigning a catalog identity so Git's checkout policy cannot make one
 * built-in workflow resolve to different digests on Windows and POSIX.
 */
export function canonicalizeSidecarText(content: string): string {
  return content.replace(/\r\n?/g, '\n');
}

/**
 * Resolves an expert's sidecar source directory (`skills/experts/<sourceId>`)
 * relative to the package root. Same depth convention as
 * `copySkillSidecars` in `../shared/skill-generation.ts`.
 */
export function resolveExpertSidecarDir(sourceId: string): string {
  return path.resolve(__dirname, '..', '..', '..', 'skills', 'experts', sourceId);
}

/** Resolves a built-in workflow sidecar tree by installed skill directory. */
export function resolveWorkflowSidecarDir(dirName: string): string {
  return path.resolve(__dirname, '..', '..', '..', 'skills', 'workflows', dirName);
}

/**
 * Recursively hashes a sidecar directory tree, applying the same filter and
 * traversal shape as the materialization path. Returns `[]` when `sourceDir`
 * does not exist (e.g. a published npm package that does not bundle
 * `skills/`, or an expert with no sidecar files of its own).
 */
export function readSidecarTree(sourceDir: string): WorkflowFileEntry[] {
  if (!fs.existsSync(sourceDir)) return [];
  const results: WorkflowFileEntry[] = [];

  const visit = (directory: string, prefix: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      const logicalPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        visit(entryPath, logicalPath);
        continue;
      }
      if (!entry.isFile() || !isSidecarFile(entry.name)) continue;
      const content = canonicalizeSidecarText(fs.readFileSync(entryPath, 'utf8'));
      results.push({ path: logicalPath, content, sha256: sha256(content) });
    }
  };

  visit(sourceDir, '');
  results.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  return results;
}

export function hashSidecarTree(sourceDir: string): HashedSidecarFile[] {
  return readSidecarTree(sourceDir).map(({ path: logicalPath, sha256: digest }) => ({
    path: logicalPath,
    sha256: digest,
  }));
}

/**
 * Digest preimage for `kind: 'expert'` definitions, distinct from
 * `digestBuiltIn` (skill) and `computeWorkflowDigest` (inline
 * `files[]`). Covers the inline template plus the hashed sidecar tree.
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
