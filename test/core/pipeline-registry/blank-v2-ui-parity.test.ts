import { describe, expect, it } from 'vitest';

import { createBlankCanvasPipelineDefinitionV2 } from '../../../packages/ui/src/canvas/draft.js';
import { createBlankPipelineDefinitionV2 } from '../../../src/core/pipeline-registry/definition.js';
import { BLANK_PIPELINE_DEFINITION_V2_FIXTURE } from '../../fixtures/blank-pipeline-definition-v2.js';

describe('blank Definition v2 factory parity', () => {
  it('pins the browser-safe Canvas mirror to the core public blank fixture', () => {
    const core = createBlankPipelineDefinitionV2('blank-parity', 'canvas');
    const canvas = createBlankCanvasPipelineDefinitionV2('blank-parity');

    expect(core).toEqual(BLANK_PIPELINE_DEFINITION_V2_FIXTURE);
    expect(canvas).toEqual(BLANK_PIPELINE_DEFINITION_V2_FIXTURE);
    expect(canvas).toEqual(core);
  });
});
