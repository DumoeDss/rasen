import * as fs from 'node:fs';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  flatPathHelperCalls,
  sourceFiles,
  withoutComments,
} from '../../helpers/source-guards.js';

type JoinClassification =
  | 'scope-seam'
  | 'standalone-only-adapter'
  | 'later-slice-owner'
  | 'migration-source-reader'
  | 'legacy-frozen-adapter'
  | 'legacy-write-path-adapter'
  | 'layout-dispatcher'
  | 'in-project-layout'
  | 'helper-definition';

const EXPECTED_DIRECT_JOINS: Readonly<
  Record<string, { readonly count: number; readonly classification: JoinClassification }>
> = {
  'src/commands/change.ts': { count: 1, classification: 'standalone-only-adapter' },
  'src/commands/spec.ts': { count: 1, classification: 'standalone-only-adapter' },
  'src/commands/workflow/shared.ts': { count: 2, classification: 'standalone-only-adapter' },
  'src/core/archive-engine.ts': {
    count: 1,
    classification: 'standalone-only-adapter',
  },
  'src/core/artifact-graph/instruction-loader.ts': {
    count: 1,
    classification: 'standalone-only-adapter',
  },
  'src/core/change-status-policy.ts': { count: 3, classification: 'standalone-only-adapter' },
  'src/core/change-work.ts': { count: 1, classification: 'standalone-only-adapter' },
  'src/core/file-placement.ts': { count: 1, classification: 'standalone-only-adapter' },
  'src/core/list.ts': { count: 2, classification: 'standalone-only-adapter' },
  'src/core/management-api/project-space.ts': { count: 2, classification: 'scope-seam' },
  'src/core/planning-home.ts': { count: 1, classification: 'scope-seam' },
  'src/core/root-selection.ts': { count: 3, classification: 'scope-seam' },
  'src/core/specs-apply.ts': { count: 2, classification: 'standalone-only-adapter' },
  'src/core/store/layout-migration/flat-source.ts': {
    count: 1,
    classification: 'migration-source-reader',
  },
  'src/core/store/consistency-gates.ts': { count: 1, classification: 'scope-seam' },
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

// `store-layout-v2-migration` task 1.3. The literal joins above are only half
// the flat-Store surface: `specsDir()`, `changesDir()`, and `inRepoArchiveDir()`
// ARE the flat Store path constructors, so calling one with a Store root is a
// flat Store write address even though no literal segment appears.
//
// The census is INVERTED (see `test/helpers/source-guards.ts`). The version
// this replaced matched four literal argument spellings and so saw 7 of the 23
// calls that existed the day it shipped: `changesDir(root)`,
// `inRepoArchiveDir(projectRoot)`, `specsDir(sourcePath)` and a second argument
// all escaped it, while the document that depended on it called it "the
// enforcement". Now every call is enumerated whatever its argument is called,
// and a new one fails here first — including one whose argument spelling nobody
// thought to enumerate.
//
// Argument tokens are listed because the token is the only thing separating a
// Store address from a project one at the source level: a reviewer classifies
// each, and a NEW token in an existing file, or any call in a new file, breaks
// the map.
const EXPECTED_FLAT_HELPER_CALLS: Readonly<
  Record<
    string,
    {
      readonly classification: JoinClassification;
      readonly calls: Readonly<Record<string, number>>;
    }
  >
> = {
  // The module that DEFINES the three helpers, plus the two generic listers
  // that take whichever root the caller resolved.
  'src/core/store/migration.ts': {
    classification: 'helper-definition',
    calls: {
      'specsDir(declaration)': 1,
      'changesDir(declaration)': 1,
      'inRepoArchiveDir(declaration)': 1,
      'changesDir(root)': 2,
      'specsDir(root)': 1,
    },
  },
  // The migration Module's ONE source-side reader. Nothing else in the Module
  // may address the flat layout.
  'src/core/store/layout-migration/flat-source.ts': {
    classification: 'migration-source-reader',
    calls: {
      'specsDir(storeRoot)': 1,
      'changesDir(storeRoot)': 1,
      'inRepoArchiveDir(storeRoot)': 1,
    },
  },
  // `sourcePath`, `destinationPath` and `projectRoot` are PROJECT roots — the
  // in-project flat layout adopt reads from and eject restores to, which this
  // change does not touch. Only the four `storeRoot` calls are Store addresses,
  // and those are the frozen legacy adapter: eject from, and archive relocation
  // into, a legacy flat Store are the only reads/writes the flat Store
  // namespace still accepts (both guarded by `storeIsV2` / the target-line
  // requirement, so a v2 Store reaches neither).
  'src/core/store/migration-ops.ts': {
    classification: 'legacy-frozen-adapter',
    calls: {
      'specsDir(sourcePath)': 2,
      'changesDir(sourcePath)': 2,
      'inRepoArchiveDir(sourcePath)': 2,
      'specsDir(destinationPath)': 1,
      'changesDir(destinationPath)': 1,
      'inRepoArchiveDir(projectRoot)': 2,
      'specsDir(storeRoot)': 1,
      'changesDir(storeRoot)': 1,
      'inRepoArchiveDir(storeRoot)': 2,
    },
  },
};

// --------------------------------------------------------------------------
// Census 4 (store-v2-compat-hardening §3): single-layout record parsers.
//
// `readStoreProjectRecord` is the version-1 membership parser. Calling it
// directly against a Store root reads a v2 project catalog as broken data —
// the exact defect child 3 found in `bootstrap.ts`. The layout-dispatching
// accessor is `readStoreMembership` in `membership-layout.ts`; every other
// caller is enumerated here so a new unclassified site fails this test.
//
// This census is extended by ENUMERATING entries individually with a recorded
// reason. It SHALL NOT be relaxed into a directory exemption, a path prefix
// rule, or an aggregate total — each of those makes the census pass while
// destroying the per-site precision it exists for. A removed site also fails
// (equality, not subset), so deleting a call is a deliberate edit.
// --------------------------------------------------------------------------
const RECORD_PARSER_CALL =
  /(?<!\bfunction )readStoreProjectRecord\s*\(/gu;

const EXPECTED_RECORD_PARSER_CALLS: Readonly<
  Record<string, { readonly count: number; readonly classification: JoinClassification }>
> = {
  // The layout dispatcher: calls the v1 parser as the version-1 arm of
  // `readStoreMembership`. This IS the correct dispatch site.
  'src/core/store/membership-layout.ts': {
    count: 1,
    classification: 'layout-dispatcher',
  },
  // Write-path state verification in the legacy membership module. These calls
  // read the v1 record to verify state before writing. For a Store v2 session,
  // writes route through `migration-ops-v2.ts`, so these legacy calls are only
  // reached for flat-layout Stores. Reads (`resolveProjectMembership`,
  // `listStoreMembers`) were migrated to `readStoreMembership` by child 3.
  'src/core/store/membership.ts': {
    count: 3,
    classification: 'legacy-write-path-adapter',
  },
  // Migration-source readers: the migration engine reads v1 records as the
  // source side of a v1→v2 migration. This is the correct reader for that
  // purpose — migration reads v1 to produce v2.
  'src/core/store/migration-ops.ts': {
    count: 4,
    classification: 'migration-source-reader',
  },
};

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

  it('enumerates every flat path helper call, whatever the argument is spelled', () => {
    const observed: Record<string, Record<string, number>> = {};
    for (const file of sourceFiles(repoRoot)) {
      const calls = flatPathHelperCalls(fs.readFileSync(path.join(repoRoot, file), 'utf8'));
      if (Object.keys(calls).length > 0) observed[file] = calls;
    }

    const expected = Object.fromEntries(
      Object.entries(EXPECTED_FLAT_HELPER_CALLS).map(([file, entry]) => [file, entry.calls])
    );
    expect(observed).toEqual(expected);
  });

  it('sees a flat Store address the old spelling-matched census let through', () => {
    // The guard is only worth its allowlist if it fails for the spellings that
    // defeated the previous one. These are the exact escapes measured against
    // the shipped regex; each must now be visible, and visible with its own
    // argument token so it cannot be mistaken for an already-classified call.
    expect(flatPathHelperCalls('const d = changesDir(planningRoot);')).toEqual({
      'changesDir(planningRoot)': 1,
    });
    expect(flatPathHelperCalls('const d = inRepoArchiveDir(resolvedStoreRoot);')).toEqual({
      'inRepoArchiveDir(resolvedStoreRoot)': 1,
    });
    expect(flatPathHelperCalls('const d = specsDir(this.storeRoot);')).toEqual({
      'specsDir(this.storeRoot)': 1,
    });
    expect(flatPathHelperCalls('const d = changesDir(storeRoot, opts);')).toEqual({
      'changesDir(storeRoot)': 1,
    });
    expect(flatPathHelperCalls('const d = changesDir(store.paths().root);')).toEqual({
      'changesDir(store.paths().root)': 1,
    });
    // An optional call is a call. `?.(` is idiomatic in this repo (39 sites), so
    // this was a flat-Store address one keystroke away from invisible.
    expect(flatPathHelperCalls('const d = changesDir?.(storeRoot);')).toEqual({
      'changesDir(storeRoot)': 1,
    });
    // A bare reference is not a call: `changesDir` is a common local variable
    // name in this repo and counting those would make the census unreadable.
    expect(flatPathHelperCalls('const changesDir = paths.changes;')).toEqual({});
  });

  it('bounds every direct single-layout record-parser call by file and count', () => {
    const observed: Record<string, number> = {};
    for (const file of sourceFiles(repoRoot)) {
      const source = withoutComments(fs.readFileSync(path.join(repoRoot, file), 'utf8'));
      const count = matchCount(source, RECORD_PARSER_CALL);
      if (count > 0) observed[file] = count;
    }

    const expected = Object.fromEntries(
      Object.entries(EXPECTED_RECORD_PARSER_CALLS).map(([file, entry]) => [file, entry.count])
    );
    expect(observed).toEqual(expected);
  });

  it('fails the record-parser census for an unclassified call site', () => {
    // A gate that has not been shown to fail is not known to be a gate.
    // An unclassified `readStoreProjectRecord` call in a file not listed in
    // EXPECTED_RECORD_PARSER_CALLS would inflate the observed set and fail
    // the equality assertion above. Verify the regex actually catches one.
    const fixture = 'const r = await readStoreProjectRecord(storeRoot, id);';
    expect(matchCount(fixture, RECORD_PARSER_CALL)).toBe(1);

    // The function definition must NOT be counted — only calls.
    const definition = 'export async function readStoreProjectRecord(\n  storeRoot: string,\n  projectId: string,\n)';
    expect(matchCount(definition, RECORD_PARSER_CALL)).toBe(0);

    // An import must NOT be counted.
    const importLine = 'import { readStoreProjectRecord } from "...";';
    expect(matchCount(importLine, RECORD_PARSER_CALL)).toBe(0);
  });
});
