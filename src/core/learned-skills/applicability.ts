/**
 * `path-exists` applicability: the only applicability contract in v1. Markers
 * are portable root-relative paths (validated with the same
 * `checkPortableRelativePath` the workflow registry uses — no glob, regex,
 * shell expansion, or arbitrary detector), composed with explicit `all`/`any`.
 * Matching resolves each marker against the project root with platform path
 * primitives and a native existence check, so a Windows separator / case-
 * insensitive alias yields the same result as its canonical form.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { checkPortableRelativePath } from '../workflow-registry/path-policy.js';
import type { Applicability } from './types.js';

export interface ApplicabilityCheck {
  valid: boolean;
  violations: string[];
  /** The NFC-normalized marker set when valid. */
  normalized?: Applicability;
}

export function validateApplicability(value: unknown): ApplicabilityCheck {
  const violations: string[] = [];
  if (typeof value !== 'object' || value === null) {
    return { valid: false, violations: ['applicability must be an object with mode and markers'] };
  }
  const record = value as { mode?: unknown; markers?: unknown };
  if (record.mode !== 'all' && record.mode !== 'any') {
    violations.push('applicability.mode must be "all" or "any"');
  }
  if (!Array.isArray(record.markers) || record.markers.length === 0) {
    violations.push('applicability.markers must be a non-empty array of portable relative paths');
    return { valid: false, violations };
  }

  const normalizedMarkers: string[] = [];
  for (const marker of record.markers) {
    if (typeof marker !== 'string') {
      violations.push('every applicability marker must be a string');
      continue;
    }
    const check = checkPortableRelativePath(marker);
    if (!check.valid || check.normalized === undefined) {
      violations.push(`marker "${marker}": ${check.message ?? 'invalid path'}`);
      continue;
    }
    normalizedMarkers.push(check.normalized);
  }

  if (violations.length > 0) {
    return { valid: false, violations };
  }
  return {
    valid: true,
    violations,
    normalized: { mode: record.mode as 'all' | 'any', markers: normalizedMarkers },
  };
}

/** Resolves one portable POSIX marker against a project root, platform-native. */
function markerExists(projectRoot: string, marker: string): boolean {
  const absolute = path.resolve(projectRoot, ...marker.split('/'));
  return fs.existsSync(absolute);
}

/**
 * True when the project root satisfies the applicability contract: `all`
 * markers must exist, or (in `any` mode) at least one must.
 */
export function matchesApplicability(applicability: Applicability, projectRoot: string): boolean {
  const { mode, markers } = applicability;
  if (markers.length === 0) return false;
  return mode === 'all'
    ? markers.every((marker) => markerExists(projectRoot, marker))
    : markers.some((marker) => markerExists(projectRoot, marker));
}
