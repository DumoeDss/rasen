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
