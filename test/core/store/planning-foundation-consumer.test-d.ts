import { describe, expectTypeOf, it } from 'vitest';

import type { ChangeInstanceId as ChangeRunChangeInstanceId } from '../../../src/core/change-run/index.js';
import type {
  computeStorePlanningLayoutV2,
  deriveChangeInstanceId,
  parseProjectId,
  serializeArchiveV2,
  ChangeInstanceId,
  ProjectId,
  StorePlanningChangeInstanceId,
  StorePlanningLayoutV2,
  VerifiedChangeInstanceId,
  VerifiedWorkspacePairId,
  WorkspacePairId,
} from '../../../src/core/index.js';

/**
 * Task 5.2's brand half. These assertions live in a `*.test-d.ts` file, not in
 * `planning-foundation-consumer.test.ts`, because `expectTypeOf` is a runtime
 * no-op and the root `tsconfig.json` excludes `test/` — so an `expectTypeOf`
 * inside a `.test.ts` is checked by nothing in this repository and cannot fail.
 * `pnpm run test:types` type-checks this file against `tsconfig.typecheck.json`.
 *
 * Everything here is deliberately type-only: no value is constructed, so the
 * assertions cannot be satisfied by runtime behaviour standing in for a type.
 */
describe('public Store planning foundation type surface', () => {
  it('gives the public entry points their branded return types', () => {
    expectTypeOf<ReturnType<typeof parseProjectId>>().toEqualTypeOf<ProjectId>();
    expectTypeOf<ReturnType<typeof deriveChangeInstanceId>>().toEqualTypeOf<
      VerifiedChangeInstanceId
    >();
    expectTypeOf<ReturnType<typeof computeStorePlanningLayoutV2>>().toEqualTypeOf<
      StorePlanningLayoutV2
    >();
  });

  // Each branded name is pinned against a bare `string` INDIVIDUALLY, not only
  // through the verified-id parameters. Pinning only the parameters leaves the
  // underlying brands free: collapsing `ChangeInstanceId` to `string` keeps
  // `VerifiedChangeInstanceId` branded by its own symbol, so the parameter
  // assertions stay green while the whole public vocabulary silently accepts
  // bare strings — and `tsc --noEmit` over `src/` reports nothing, because the
  // collapse is internally consistent. Found by mutation, not by reading.
  it('refuses a bare string where a branded value is required', () => {
    expectTypeOf<string>().not.toMatchTypeOf<ProjectId>();
    expectTypeOf<string>().not.toMatchTypeOf<ChangeInstanceId>();
    expectTypeOf<string>().not.toMatchTypeOf<StorePlanningChangeInstanceId>();
    expectTypeOf<string>().not.toMatchTypeOf<WorkspacePairId>();
    expectTypeOf<string>().not.toMatchTypeOf<VerifiedChangeInstanceId>();
    expectTypeOf<string>().not.toMatchTypeOf<VerifiedWorkspacePairId>();
    expectTypeOf<string>().not.toMatchTypeOf<
      Parameters<typeof computeStorePlanningLayoutV2>[0]['changeInstanceId']
    >();
  });

  it('refuses an unverified id where a verified one is required', () => {
    expectTypeOf<VerifiedChangeInstanceId>().toMatchTypeOf<StorePlanningChangeInstanceId>();
    expectTypeOf<StorePlanningChangeInstanceId>().not.toMatchTypeOf<
      Parameters<typeof computeStorePlanningLayoutV2>[0]['changeInstanceId']
    >();
    expectTypeOf<WorkspacePairId>().not.toMatchTypeOf<
      Parameters<typeof serializeArchiveV2>[0]['workspacePairId']
    >();
  });

  it('requires verified identities at the durable Archive writer', () => {
    expectTypeOf<
      Parameters<typeof serializeArchiveV2>[0]['changeInstanceId']
    >().toEqualTypeOf<VerifiedChangeInstanceId>();
    expectTypeOf<
      Parameters<typeof serializeArchiveV2>[0]['workspacePairId']
    >().toEqualTypeOf<VerifiedWorkspacePairId>();
  });

  // `src/core/index.ts` resolves a genuine ambiguity: `change-run/contracts.ts`
  // and `store/planning-identity.ts` each define an unrelated `ChangeInstanceId`
  // brand, and both are star-exported. Deleting the disambiguation is already a
  // hard TS2308, but its DIRECTION was unpinned — aiming the published name at
  // the Store-planning brand instead compiled cleanly and broke nothing, even
  // though it silently changes what `import type { ChangeInstanceId } from
  // '@atelierai/rasen'` means for an external consumer. These two assertions are
  // what a flip of that re-export has to get past.
  it('keeps the published ChangeInstanceId pointing at the change-run brand', () => {
    expectTypeOf<ChangeInstanceId>().toEqualTypeOf<ChangeRunChangeInstanceId>();
    expectTypeOf<ChangeInstanceId>().not.toEqualTypeOf<StorePlanningChangeInstanceId>();
    expectTypeOf<StorePlanningChangeInstanceId>().not.toEqualTypeOf<ChangeRunChangeInstanceId>();
  });
});
