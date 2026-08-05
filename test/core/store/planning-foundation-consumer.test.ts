import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  computeStorePlanningLayoutV2,
  deriveChangeInstanceId,
  derivePlanningScopeId,
  parseChangeInstanceSeed,
  parseProjectId,
  parseTargetLineId,
  serializeArchiveV2,
  type ChangeInstanceId,
  type ProjectId,
  type StorePlanningLayoutV2,
  type VerifiedChangeInstanceId,
  type VerifiedWorkspacePairId,
  type WorkspacePairId,
} from '../../../src/core/index.js';

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

    expectTypeOf(projectId).toEqualTypeOf<ProjectId>();
    expectTypeOf(changeInstanceId).toEqualTypeOf<VerifiedChangeInstanceId>();
    expectTypeOf<VerifiedChangeInstanceId>().toMatchTypeOf<ChangeInstanceId>();
    expectTypeOf<ChangeInstanceId>().not.toMatchTypeOf<
      Parameters<typeof computeStorePlanningLayoutV2>[0]['changeInstanceId']
    >();
    expectTypeOf<string>().not.toMatchTypeOf<
      Parameters<typeof computeStorePlanningLayoutV2>[0]['changeInstanceId']
    >();
    expectTypeOf<
      Parameters<typeof serializeArchiveV2>[0]['changeInstanceId']
    >().toEqualTypeOf<VerifiedChangeInstanceId>();
    expectTypeOf<
      Parameters<typeof serializeArchiveV2>[0]['workspacePairId']
    >().toEqualTypeOf<VerifiedWorkspacePairId>();
    expectTypeOf<WorkspacePairId>().not.toMatchTypeOf<
      Parameters<typeof serializeArchiveV2>[0]['workspacePairId']
    >();
    expectTypeOf(layout).toEqualTypeOf<StorePlanningLayoutV2>();
    expectTypeOf<string>().not.toMatchTypeOf<ProjectId>();
    expect(layout.activeChange).toContain('/consumer-change');
  });
});
