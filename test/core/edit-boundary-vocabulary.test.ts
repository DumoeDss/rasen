import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const BANNED_LIVE_TOKENS = [
  'rasen-freeze',
  'rasen-guard',
  'rasen-unfreeze',
  'check-freeze.sh',
  'freeze-dir.txt',
] as const;

const SCAN_ROOTS = ['src', 'docs', 'skills', path.join('test', 'fixtures')] as const;
const ALLOWED_MIGRATION_FILES = new Set([
  path.normalize(path.join('src', 'core', 'retired-edit-boundary.ts')),
  path.normalize(path.join('src', 'core', 'legacy-cleanup.ts')),
]);

function filesUnder(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (
        target.includes(path.join('docs', 'architecture')) ||
        target.includes(path.join('docs', 'audits')) ||
        target.includes(path.join('docs', 'handoff'))
      ) {
        return [];
      }
      return filesUnder(target);
    }
    return entry.isFile() ? [target] : [];
  });
}

describe('retired edit-boundary vocabulary guard', () => {
  it('keeps live source, docs, fixtures, and packaged skills free of retired dependencies', () => {
    const violations: string[] = [];
    for (const file of SCAN_ROOTS.flatMap((root) => filesUnder(root))) {
      const normalized = path.normalize(file);
      if (ALLOWED_MIGRATION_FILES.has(normalized)) continue;
      let content: string;
      try {
        content = fs.readFileSync(file, 'utf-8');
      } catch {
        continue;
      }
      for (const token of BANNED_LIVE_TOKENS) {
        if (content.includes(token)) violations.push(`${normalized}: ${token}`);
      }
    }
    expect(violations).toEqual([]);
  });
});
