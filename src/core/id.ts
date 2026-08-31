/**
 * The shared kebab id grammar for Project ids, Change ids, and legacy
 * initiative ids. Store display aliases intentionally use the looser
 * folder-segment grammar below; permanent Store identity is a UUID.
 */
export const KEBAB_ID_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export function isKebabId(value: string): boolean {
  return KEBAB_ID_REGEX.test(value);
}

/** Human rendering of the grammar, shared so the wording never forks. */
export const KEBAB_ID_DESCRIPTION =
  'must be kebab-case with lowercase letters, numbers, and single hyphen separators';

/** The fix-line twin of KEBAB_ID_DESCRIPTION, shared for the same reason. */
export const KEBAB_ID_FIX =
  'Use kebab-case with lowercase letters, numbers, and single hyphen separators.';

/**
 * Best-effort kebab-casing: lowercases, collapses runs of non-alphanumeric
 * characters into a single hyphen, and trims leading/trailing hyphens. A
 * non-empty result always satisfies `isKebabId`. Callers decide the fallback
 * for an empty result (e.g. a name that kebab-cases to nothing).
 */
export function toKebabCase(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
}

/**
 * The minimal folder-segment grammar shared by Store display aliases and
 * workset member labels. Callers may layer their own grammar on top (Project,
 * Change, and legacy initiative ids use kebab-case). Returns a problem
 * description, or null when valid.
 */
export function folderStyleNameProblem(
  value: string,
  label: string
): string | null {
  if (value.length === 0) {
    return `${label} must not be empty`;
  }

  if (value === '.' || value === '..') {
    return `${label} must not be '${value}'`;
  }

  if (/[\\/]/u.test(value)) {
    return `${label} must not contain path separators`;
  }

  return null;
}
