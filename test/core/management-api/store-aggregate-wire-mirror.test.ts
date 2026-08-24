/**
 * `store-issue-resources` task 5.2 — drift guard between the Store aggregate
 * wire types added to `src/core/management-api/wire-types.ts` and their
 * hand-maintained mirror in `packages/ui/src/api/types.ts`.
 *
 * Neither file's type-only exports exist at runtime (types are erased), so
 * this test parses SOURCE TEXT: for every wire type this change adds to the
 * core file's "Store aggregate" section, it asserts an identically-named
 * `export (type|interface) <Name>` exists in the UI mirror file.
 *
 * Two directions, because one is not a guard. list -> mirror catches a missing
 * mirror; section -> list catches a wire type the core file grew that the list
 * never learned about. Round 1 proved the second one is not hypothetical: the
 * list named 12 of the section's 13 types, and the 13th could have had its
 * mirror deleted outright with this file fully green.
 *
 * Deliberately independent of the `tsc`/`satisfies`-fixture drift tripwire
 * `packages/ui/test/api/fixtures.test.ts` already runs for the config API
 * mirror: a `satisfies <ResponseType>` fixture only proves an EXISTING
 * mirror type is shape-compatible with a sample value. It says nothing when
 * a wire type is added to the core file and its mirror is never written at
 * all — that OMISSION is the failure mode tasks.md calls out as untested,
 * and this file is the substitute for it, not a duplicate of it.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

const CORE_WIRE_TYPES = path.join(process.cwd(), 'src/core/management-api/wire-types.ts');
const UI_MIRROR_TYPES = path.join(process.cwd(), 'packages/ui/src/api/types.ts');

// The exact set of Store-aggregate wire type names this change adds to the
// core file (its "Store aggregate" section). Named explicitly, rather than
// derived by parsing the same section out of the core file, so the list
// itself is a legible acceptance criterion that cannot silently narrow to
// match whatever the core file happens to contain.
//
// The list is a FLOOR, not the whole guard. Both mirror assertions iterate
// over it, so on its own it can only ever check what someone remembered to
// add — a type the core file gains and the list does not would inherit zero
// coverage, which is exactly how `StoreExecutionPlanNodeInput` sat unmirror-
// checked through round 1. `sectionExportNames` below closes that direction
// by reading the core file's own section back, so the list keeps stating the
// criterion while the core file decides when the criterion is incomplete.
const STORE_AGGREGATE_WIRE_TYPES = [
  'StoreProjectsResponse',
  'StoreTargetLinesResponse',
  'StoreChangesResponse',
  'StoreIssuesResponse',
  'StoreIssueDetailResponse',
  'StoreIssueReferencesResponse',
  'StoreExecutionPlanResponse',
  'StoreIssueRecordResponse',
  'StoreExecutionPlanPublishResponse',
  'StoreIssueCreateRequest',
  'StoreIssueSetStateRequest',
  'StoreExecutionPlanNodeInput',
  'StoreExecutionPlanPublishRequest',
  // The Issue projection reads (issue-read-surface). Aliased core-side to the
  // `core/issue-read` payload types; redeclared UI-side like every other
  // mirror here, together with the whole `IssueStatus` tree they carry.
  'StoreIssueProjectionsResponse',
  'StoreIssueProjectionResponse',
  'StoreIssueAttentionResponse',
  'StoreChangeIssueLinksResponse',
] as const;

/**
 * The prefix of the banner line that opens the core file's Store-aggregate
 * section. Matched as a PREFIX because the banner continues into prose that is
 * free to be reworded; the section's name is what addresses it.
 */
const SECTION_TITLE = '// Store aggregate (store-issue-resources)';
/** The `// ------` rules that fence every section of the core file. */
const SECTION_RULE = /^\/\/ -{5,}\s*$/;

function declaredExportNames(source: string): Set<string> {
  const names = new Set<string>();
  const pattern = /export\s+(?:type|interface)\s+([A-Za-z0-9_]+)/g;
  for (const match of source.matchAll(pattern)) {
    names.add(match[1]!);
  }
  return names;
}

/**
 * Every type the core file's Store-aggregate section exports, read back out of
 * the section itself.
 *
 * Throws rather than returning an empty set when the section cannot be
 * located: a silently-empty result would make the completeness assertion below
 * pass vacuously, which is the same blindness this function exists to remove.
 */
function sectionExportNames(source: string): Set<string> {
  const lines = source.split(/\r?\n/);
  const titleIndex = lines.findIndex((line) => line.startsWith(SECTION_TITLE));
  if (titleIndex === -1) {
    throw new Error(
      `${CORE_WIRE_TYPES} no longer contains the banner line '${SECTION_TITLE}'. ` +
        `The completeness check cannot locate the Store-aggregate section; rename the ` +
        `banner here too rather than leaving the section unguarded.`
    );
  }
  const headerEnd = lines.findIndex((line, index) => index > titleIndex && SECTION_RULE.test(line));
  if (headerEnd === -1) {
    throw new Error(`${CORE_WIRE_TYPES}: the Store-aggregate banner has no closing rule.`);
  }
  const nextRule = lines.findIndex((line, index) => index > headerEnd && SECTION_RULE.test(line));
  const bodyEnd = nextRule === -1 ? lines.length : nextRule;
  const names = declaredExportNames(lines.slice(headerEnd + 1, bodyEnd).join('\n'));
  if (names.size === 0) {
    throw new Error(`${CORE_WIRE_TYPES}: the Store-aggregate section exports nothing.`);
  }
  return names;
}

describe('Store aggregate wire types have a UI mirror (task 5.2 drift guard)', () => {
  const coreSource = fs.readFileSync(CORE_WIRE_TYPES, 'utf8');
  const uiSource = fs.readFileSync(UI_MIRROR_TYPES, 'utf8');
  const coreNames = declaredExportNames(coreSource);
  const uiNames = declaredExportNames(uiSource);

  it('every named type is actually declared in the core wire-types file (sanity on the list itself)', () => {
    for (const name of STORE_AGGREGATE_WIRE_TYPES) {
      expect(coreNames.has(name), `${name} is not exported from ${CORE_WIRE_TYPES}`).toBe(true);
    }
  });

  it("the list carries every type the core file's Store-aggregate section exports", () => {
    // The direction the list alone cannot check. Without this, a wire type
    // added to the section and never added to the list is covered by nothing:
    // both mirror assertions iterate the list, so neither can miss what the
    // list never mentions. Asserted as a sorted array rather than set
    // membership so the failure names the type.
    const listed = new Set<string>(STORE_AGGREGATE_WIRE_TYPES);
    const unlisted = [...sectionExportNames(coreSource)].filter((name) => !listed.has(name)).sort();
    expect(
      unlisted,
      `${unlisted.join(', ')} is exported from the "Store aggregate" section of ` +
        `${CORE_WIRE_TYPES} but is absent from STORE_AGGREGATE_WIRE_TYPES, so no mirror ` +
        `assertion covers it. Add it to the list.`
    ).toEqual([]);
  });

  it.each(STORE_AGGREGATE_WIRE_TYPES)('%s has a same-named export in the UI mirror', (name) => {
    expect(
      uiNames.has(name),
      `${name} is declared in wire-types.ts but has no export of the same name in ` +
        `packages/ui/src/api/types.ts — a wire type added without its mirror is a known ` +
        `silent-drift failure mode in this repo.`
    ).toBe(true);
  });
});
