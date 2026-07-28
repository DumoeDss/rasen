import { Buffer } from 'node:buffer';

import { WORKFLOW_LIMITS } from './limits.js';

const PORTABLE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SKILL_REFERENCE_PATTERN = /^[a-z0-9][a-z0-9:-]{0,127}$/;
const WINDOWS_DEVICE_PATTERN = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const WINDOWS_FORBIDDEN_PATTERN = /[<>:"|?*]/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

export interface PortablePathCheck {
  valid: boolean;
  normalized?: string;
  code?: string;
  message?: string;
}

export function isPortableWorkflowId(value: string): boolean {
  return PORTABLE_ID_PATTERN.test(value);
}

/**
 * Operating-system metadata entries (Finder's `.DS_Store`, any dot-prefixed
 * entry, Windows `Thumbs.db`/`desktop.ini`) are never legitimate workflow
 * content: workflow IDs cannot start with a dot, and the files are OS noise.
 * Library scans and source-tree walks skip them silently instead of
 * reporting them as invalid entries or embedding them in packages.
 */
export function isOsJunkEntryName(name: string): boolean {
  if (name.startsWith('.')) return true;
  const lowered = name.toLowerCase();
  return lowered === 'thumbs.db' || lowered === 'desktop.ini';
}

export function isPortableSkillReference(value: string): boolean {
  return SKILL_REFERENCE_PATTERN.test(value);
}

export function checkPortableRelativePath(value: string): PortablePathCheck {
  if (value.length === 0) {
    return { valid: false, code: 'path_empty', message: 'Path must not be empty' };
  }
  if (value.startsWith('/') || /^[A-Za-z]:/.test(value)) {
    return { valid: false, code: 'path_absolute', message: 'Path must be relative' };
  }
  if (value.includes('\\')) {
    return { valid: false, code: 'path_backslash', message: 'Path must use POSIX separators' };
  }
  if (CONTROL_CHARACTER_PATTERN.test(value)) {
    return { valid: false, code: 'path_control_character', message: 'Path contains a control character' };
  }

  const normalized = value.normalize('NFC');
  if (normalized !== value) {
    return { valid: false, code: 'path_not_nfc', message: 'Path must use Unicode NFC normalization' };
  }
  if (Buffer.byteLength(normalized, 'utf8') > WORKFLOW_LIMITS.maxPathBytes) {
    return {
      valid: false,
      code: 'path_too_long',
      message: `Path exceeds ${WORKFLOW_LIMITS.maxPathBytes} UTF-8 bytes`,
    };
  }

  const segments = normalized.split('/');
  for (const segment of segments) {
    if (segment.length === 0) {
      return { valid: false, code: 'path_empty_segment', message: 'Path contains an empty segment' };
    }
    if (segment === '.' || segment === '..') {
      return { valid: false, code: 'path_traversal', message: 'Path contains a traversal segment' };
    }
    if (segment.endsWith('.') || segment.endsWith(' ')) {
      return {
        valid: false,
        code: 'path_trailing_dot_space',
        message: 'Path segment must not end in a dot or space',
      };
    }
    // Windows also reserves COM/LPT names written with superscript 1, 2, or 3.
    // NFKC maps those compatibility digits to ASCII before the device check.
    if (WINDOWS_DEVICE_PATTERN.test(segment.normalize('NFKC'))) {
      return {
        valid: false,
        code: 'path_windows_device',
        message: `Path segment "${segment}" is reserved on Windows`,
      };
    }
    if (WINDOWS_FORBIDDEN_PATTERN.test(segment)) {
      return {
        valid: false,
        code: 'path_windows_character',
        message: `Path segment "${segment}" contains a character forbidden on Windows`,
      };
    }
  }

  return { valid: true, normalized };
}

export function portablePathCollisionKey(value: string): string {
  // NFKC catches compatibility aliases (including ligatures), while the
  // lower-upper-lower stabilization approximates Unicode full case folding for
  // expanding and contextual mappings such as both sharp-s forms and Greek
  // final sigma.
  // The original spelling is still required to be NFC by the path validator.
  return value
    .normalize('NFKC')
    .toLowerCase()
    .toUpperCase()
    .toLowerCase()
    .normalize('NFC');
}
