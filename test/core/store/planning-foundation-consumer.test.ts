import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  computeStorePlanningLayoutV2,
  deriveChangeInstanceId,
  derivePlanningScopeId,
  parseChangeInstanceSeed,
  parseProjectId,
  parseTargetLineId,
} from '../../../src/core/index.js';

/**
 * Task 5.2's runtime half: a consumer can compose validated values entirely
 * through the public `src/core/index.js` surface, importing no internal regex,
 * hash preimage, or path rule.
 *
 * 5.2's other half — that the brands actually discriminate — is asserted in
 * `planning-foundation-consumer.test-d.ts` and run by `pnpm run test:types`.
 * It deliberately does NOT live here: `expectTypeOf` is a runtime no-op, and
 * the root `tsconfig.json` excludes `test/`, so a type assertion in this file
 * would be checked by nothing and could never fail.
 */
describe('public Store planning foundation consumer surface', () => {
  it('lets consumers compose validated values without internal regex/hash/path imports', () => {
    const projectId = parseProjectId('8a0c76e8-faa9-49dc-b0d1-c35df3ad797f');
    const targetLineId = parseTargetLineId('line-0.2');
    const planningScopeId = derivePlanningScopeId({
      storeUid: '9d1d9f4b-8fd8-45d8-b5ef-f0c7a28491d0',
      projectId,
      targetLineId,
    });
    const changeInstanceId = deriveChangeInstanceId({
      planningScopeId,
      instanceSeed: parseChangeInstanceSeed('11'.repeat(16)),
    });
    const layout = computeStorePlanningLayoutV2({
      storeRoot: '/store',
      projectId,
      targetLineId,
      changeId: 'consumer-change',
      archiveDate: '2026-08-04',
      changeInstanceId,
      flavor: 'posix',
    });

    expect(layout.activeChange).toContain('/consumer-change');
  });
});

/**
 * The bare-string pins in `planning-foundation-consumer.test-d.ts` are only as
 * good as their completeness: a brand added later, with no pin, is invisible —
 * `tsc --noEmit` over `src/` cannot see a brand collapse (it is internally
 * consistent) and no runtime test can see a type at all. That is how 9 of the
 * 16 names came to be unpinned under a comment claiming otherwise.
 *
 * So the vocabulary is not maintained by hand here. It is read out of the three
 * Layer-0 sources, and a name without a pin fails by name.
 */
const LAYER_0_BRAND_SOURCES = [
  'planning-validation.ts',
  'planning-identity.ts',
  'planning-layout-v2.ts',
] as const;

const STORE_DIR = path.resolve(__dirname, '../../../src/core/store');
const TYPE_SUITE = path.resolve(__dirname, 'planning-foundation-consumer.test-d.ts');

/**
 * The store-planning `ChangeInstanceId` is published under a distinct name,
 * because `change-run` owns the bare one at the package root (`src/core/index.ts`).
 * Its pin therefore reads `StorePlanningChangeInstanceId`.
 */
const PUBLISHED_AS: Readonly<Record<string, string>> = {
  ChangeInstanceId: 'StorePlanningChangeInstanceId',
};

function declaredBrands(): string[] {
  const names: string[] = [];
  for (const fileName of LAYER_0_BRAND_SOURCES) {
    const source = fs.readFileSync(path.join(STORE_DIR, fileName), 'utf8');
    // `X = string & {` (a root brand) and `X = Y & {` (a verified subtype).
    for (const match of source.matchAll(/^export type (\w+) = (?:string|\w+) & \{/gmu)) {
      names.push(match[1]!);
    }
  }
  return names;
}

/** Exact type arguments, so `WorkspacePairId` is never satisfied by `VerifiedWorkspacePairId`. */
function pinnedBrands(): Set<string> {
  const source = fs.readFileSync(TYPE_SUITE, 'utf8');
  return new Set(
    [
      ...source.matchAll(
        /expectTypeOf<string>\(\)\.not\.toMatchTypeOf<\s*(\w+)\s*>\(\)/gu
      ),
    ].map(match => match[1]!)
  );
}

describe('Store planning v2 branded vocabulary is pinned exhaustively', () => {
  it('finds the whole declared vocabulary', () => {
    const brands = declaredBrands();
    // 18 from before system-assigned Issue identity, plus its four distinct
    // UID/key/selector/storage-locator brands — this count proves the guard's
    // vocabulary moved with the new identity seam.
    expect(brands.length).toBe(22);
    expect(new Set(brands).size).toBe(brands.length);
  });

  it.each(declaredBrands())('pins %s against a bare string', brandName => {
    const expected = PUBLISHED_AS[brandName] ?? brandName;
    expect(
      pinnedBrands().has(expected),
      `${brandName} is declared in src/core/store but has no ` +
        `expectTypeOf<string>().not.toMatchTypeOf<${expected}>() pin in ` +
        'planning-foundation-consumer.test-d.ts'
    ).toBe(true);
  });
});
