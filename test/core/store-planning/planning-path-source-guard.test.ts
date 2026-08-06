import * as fs from 'node:fs';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import { sourceFiles, withoutComments } from '../../helpers/source-guards.js';

type JoinClassification =
  | 'scope-seam'
  | 'standalone-only-adapter'
  | 'later-slice-owner';

const EXPECTED_DIRECT_JOINS: Readonly<
  Record<string, { readonly count: number; readonly classification: JoinClassification }>
> = {
  'src/commands/change.ts': { count: 1, classification: 'standalone-only-adapter' },
  'src/commands/spec.ts': { count: 1, classification: 'standalone-only-adapter' },
  'src/commands/workflow/shared.ts': { count: 2, classification: 'standalone-only-adapter' },
  'src/core/artifact-graph/instruction-loader.ts': {
    count: 1,
    classification: 'standalone-only-adapter',
  },
  'src/core/change-status-policy.ts': { count: 2, classification: 'standalone-only-adapter' },
  'src/core/change-work.ts': { count: 1, classification: 'standalone-only-adapter' },
  'src/core/file-placement.ts': { count: 1, classification: 'standalone-only-adapter' },
  'src/core/list.ts': { count: 2, classification: 'standalone-only-adapter' },
  'src/core/management-api/project-space.ts': { count: 2, classification: 'scope-seam' },
  'src/core/planning-home.ts': { count: 1, classification: 'scope-seam' },
  'src/core/root-selection.ts': { count: 3, classification: 'scope-seam' },
  'src/core/specs-apply.ts': { count: 2, classification: 'standalone-only-adapter' },
  'src/core/store/migration-ops.ts': { count: 2, classification: 'later-slice-owner' },
  'src/core/store-planning/internal/resolver.ts': { count: 10, classification: 'scope-seam' },
  'src/utils/change-utils.ts': { count: 1, classification: 'standalone-only-adapter' },
  'src/utils/item-discovery.ts': { count: 3, classification: 'standalone-only-adapter' },
};

// One-line joins that start from the workspace segment or an already-resolved
// planning-home variable. Collection/item joins below an explicitly supplied
// changesDir/specsDir are intentionally not matches: those consume a scoped
// collection and do not recreate a Store layout.
const DIRECT_PLANNING_JOIN =
  /\b(?:[\w$.]+\.)?join\([^\r\n]*(?:(?:WORKSPACE_DIR_NAME|['"]rasen['"])[^\r\n]*['"](?:projects|changes|specs|design-docs)['"]|(?:rasen|projectHome)\s*,\s*['"](?:projects|changes|specs|design-docs)['"])/gu;

// Foundation owns the literal Store v2 segment layout. No business caller or
// compatibility adapter may reproduce these arrays.
const STORE_V2_SEGMENTS =
  /\[\s*['"]rasen['"]\s*,\s*['"](?:projects|changes|specs|design-docs)['"]/gu;

function matchCount(source: string, pattern: RegExp): number {
  pattern.lastIndex = 0;
  return [...source.matchAll(pattern)].length;
}

describe('planning path source guard', () => {
  const repoRoot = process.cwd();

  it('keeps every flat planning join bounded and classified', () => {
    const observed: Record<string, number> = {};
    for (const file of sourceFiles(repoRoot)) {
      const source = withoutComments(fs.readFileSync(path.join(repoRoot, file), 'utf8'));
      const count = matchCount(source, DIRECT_PLANNING_JOIN);
      if (count > 0) observed[file] = count;
    }

    const expected = Object.fromEntries(
      Object.entries(EXPECTED_DIRECT_JOINS).map(([file, entry]) => [file, entry.count])
    );
    expect(observed).toEqual(expected);
  });

  it('keeps Store v2 segment construction inside the Foundation layout module', () => {
    const observed: Record<string, number> = {};
    for (const file of sourceFiles(repoRoot)) {
      const source = withoutComments(fs.readFileSync(path.join(repoRoot, file), 'utf8'));
      const count = matchCount(source, STORE_V2_SEGMENTS);
      if (count > 0) observed[file] = count;
    }

    expect(observed).toEqual({
      'src/core/store/planning-layout-v2.ts': 7,
    });
  });
});
