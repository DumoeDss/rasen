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
  'StoreExecutionPlanPublishRequest',
] as const;

function declaredExportNames(source: string): Set<string> {
  const names = new Set<string>();
  const pattern = /export\s+(?:type|interface)\s+([A-Za-z0-9_]+)/g;
  for (const match of source.matchAll(pattern)) {
    names.add(match[1]!);
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

  it.each(STORE_AGGREGATE_WIRE_TYPES)('%s has a same-named export in the UI mirror', (name) => {
    expect(
      uiNames.has(name),
      `${name} is declared in wire-types.ts but has no export of the same name in ` +
        `packages/ui/src/api/types.ts — a wire type added without its mirror is a known ` +
        `silent-drift failure mode in this repo.`
    ).toBe(true);
  });
});
