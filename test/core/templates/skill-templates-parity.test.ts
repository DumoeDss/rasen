import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  type SkillTemplate,
  getApplyChangeSkillTemplate,
  getArchiveChangeSkillTemplate,
  getBulkArchiveChangeSkillTemplate,
  getContinueChangeSkillTemplate,
  getExploreSkillTemplate,
  getFeedbackSkillTemplate,
  getNewChangeSkillTemplate,
  getOnboardSkillTemplate,
  getOpsxProposeSkillTemplate,
  getSyncSpecsSkillTemplate,
  getVerifyChangeSkillTemplate,
  // Workflow/orchestration templates (workflow-template-parity)
  getOfficeHoursCommandSkillTemplate,
  getVerifyEnhancedSkillTemplate,
  getShipCommandSkillTemplate,
  getRetainCommandSkillTemplate,
  getRetroCommandSkillTemplate,
  getAutoCommandSkillTemplate,
  getReviewCycleSkillTemplate,
  getHandoffSkillTemplate,
  getGoalPlanSkillTemplate,
  getGoalIterateSkillTemplate,
  getGoalReportSkillTemplate,
  getGoalCommandSkillTemplate,
  getHelpSkillTemplate,
  getDirectionSkillTemplate,
  // Expert skill templates
  getBenchmarkSkillTemplate,
  getCarefulSkillTemplate,
  getChromeUseSkillTemplate,
  getCodebaseDesignSkillTemplate,
  getCodexSkillTemplate,
  getCsoSkillTemplate,
  getDesignConsultationSkillTemplate,
  getDesignReviewSkillTemplate,
  getInvestigateSkillTemplate,
  getNavigatorSkillTemplate,
  getOfficeHoursSkillTemplate,
  getPrototypeSkillTemplate,
  getQaSkillTemplate,
  getQaOnlySkillTemplate,
  getReviewSkillTemplate,
  getTddSkillTemplate,
  getWorkflowAuthorSkillTemplate,
  getWorkflowReviewSkillTemplate,
} from '../../../src/core/templates/skill-templates.js';
import {
  generateSkillContent,
  getSkillTemplates,
} from '../../../src/core/shared/skill-generation.js';
import { STORE_SELECTION_GUIDANCE } from '../../../src/core/templates/workflows/store-selection.js';

const EXPECTED_FUNCTION_HASHES: Record<string, string> = {
  getExploreSkillTemplate: 'f1659662e2284051600aa930434e40df80fea9eb3d8b1a97441cb297c2ceeca4',
  getNewChangeSkillTemplate: 'ae5e1798fa0e495f209434d44f3e6043354224d210734eda9928fcbd9a6dc852',
  getContinueChangeSkillTemplate: '63192938a238bbb815f4ee840838948b12e9c3dd95c8a8a6bfbda9ecbf1b1c00',
  getApplyChangeSkillTemplate: '733f4ce38f48726bbcf431f0974f6641534fdef962dfe52a30b6e3e45ec8a626',
  getSyncSpecsSkillTemplate: '8177beb0cf664241cdf3e6016c8cf7a75b4331c64c9804e7178d1ba1566c8334',
  getOnboardSkillTemplate: '91da611a43f5630412f2101e6a3ed562b9f4f637c2bb144d5818e6f7449b9340',
  getArchiveChangeSkillTemplate: '8cac1c38dce25053e5c67131e970f1e2c181debde330ab7b7ba5d9a5fd51c946',
  getBulkArchiveChangeSkillTemplate: 'b06a31635587c1091771d1328d2134113602db65e6fde0400bec53ee543394c0',
  getVerifyChangeSkillTemplate: '812d80945c232889bb92fb8c9887036a9bd1d7a9ace0b5d852b8ce448176511d',
  getOpsxProposeSkillTemplate: '7133755fbf73a4a938ffe9509c5fd2e28c5b9164293e92eab119cb6ed35ef1c0',
  getFeedbackSkillTemplate: '6bfb7caffad631f807678c2b5d194fb0eb2ed0bc4cbb4bf432b5a3c160c6cc87',
  // Workflow/orchestration templates (workflow-template-parity)
  getOfficeHoursCommandSkillTemplate: 'abc86fb00aaac2c269009aa48a64984481de22d93447696b0574c7fe0eebcb0f',
  getVerifyEnhancedSkillTemplate: 'df54f584542668da6992813a683d7c8ed26b6bb03cc9fea809f738a44cb23dc1',
  getShipCommandSkillTemplate: '5700dc5b5f23efa0dccc598fe9fa79f66044dafc141c55d0ef5faa4430fe35e5',
  getRetainCommandSkillTemplate: '982277f7e373fe12f1a513402cd036be25d311e56bf009b630781aab1dd33b22',
  getRetroCommandSkillTemplate: '64725c0d0c2d5ee285de0186c62e9bb9cfc6b2ddc95eabd408e089ff1d00c6db',
  getAutoCommandSkillTemplate: '0e41a029924df8c9349c8522821beecebb0014736f0da3ef92e3ea11af978732',
  getReviewCycleSkillTemplate: '6421f5b3418fc151b2b5fd7f0d347735d8ccf498b7f60baead1f58ea4ca05704',
  getHandoffSkillTemplate: '2dd5358742c4771dbd5eca94526effe5a0f1868d8294e02cea08a8529cf4b7a9',
  getGoalPlanSkillTemplate: 'ef4208ba6a42fee7fd0139d3e26768a988155cc73d82e611e2877e7ef2cda898',
  getGoalIterateSkillTemplate: '4e4c01df15fbc865ea6e8ac3833846d677660bc0821583b302ebe6db69a0417d',
  getGoalReportSkillTemplate: 'a48c1b6c75c5734e051a4aa707ee803c0af73fd2b74b18fb7212e531568a4bed',
  getGoalCommandSkillTemplate: 'f6655e7b11172215eafa4848aca247439e9105e86c934e0e051877f619739d6e',
  getHelpSkillTemplate: '412d70c9b7d3f5a8c009db9253ed6ce07597a9adc310535d9429bc97163028fc',
  getDirectionSkillTemplate: '02bf07737760f788d668e29008c1276069eebc364e3b210b259b65e05980867b',
  // Expert skill templates (inlined; see expert-template-inlining)
  getBenchmarkSkillTemplate: '7c44efe822aabed02aeab4783426e7455b8a6d0fb8f7c977060da93dba28e283',
  getCarefulSkillTemplate: 'e1d464d2b51dda32c0ef37f7e9346ed41dbfec15f5ba56e3f3ecf2dd2045bbec',
  getChromeUseSkillTemplate: '887f74bc1c0d2c1a38f685352d0dd7a26182ca0f88705581f139f676499914a9',
  getCodebaseDesignSkillTemplate: 'c0459451628588b196d05aba88e9c94e02123cc1d30693795ff9acd8b39b5730',
  getCodexSkillTemplate: 'a6ddffac0c9aa424e33cee4c3933de7a957b151041f8da368b2e58209c8d5e39',
  getCsoSkillTemplate: '45d67ccbb254effba923944c37911452428bfe168c3e2fb3701342adcab409f2',
  getDesignConsultationSkillTemplate: '8a3ef8de2f3a17af5c59fcfd0606f7d84ee467baaf034d204ae070785e3455ce',
  getDesignReviewSkillTemplate: '280fc924f860f8a25029f82c9283c54137ec7995ed3f7f5d91032b3152b61315',
  getInvestigateSkillTemplate: 'ba54207d8b8f470e466e8d7f22f0bcd81bd4d5ba00d7ed622382c2cac509a011',
  getNavigatorSkillTemplate: '37724dc8810ce1e1078c464bdf05edbc6be2d8e54e758ecb361eddc35cef720a',
  getOfficeHoursSkillTemplate: '4a083781872fdf1ca991806be02d506b177f9059f6d35ef58678dad459b78fed',
  getPrototypeSkillTemplate: 'cbe38ed637dce4ba18586795111ab6cf70929b3225ee1b6eac734953e0a25958',
  getQaSkillTemplate: '27673c01da3edcc2c806cde8c993e841879337cdff20c365387d4d6032dc6187',
  getQaOnlySkillTemplate: '399ca9b3c7307e86e655a2de56dc85434c98c7af5d933f7c42d2600a0d1e8e66',
  getReviewSkillTemplate: '40d90bbba43c6b3087a362145239794709eaf55d69b3c696454032993c92c661',
  getTddSkillTemplate: '5ee24e317b5f1a1ab114153212a72ed633a40e1f1268c34b31102d9be9607701',
  getWorkflowAuthorSkillTemplate: '7493fb63c5361b40f1de2cc7ff7521fc83cd581707e82886f353285fa9781059',
  getWorkflowReviewSkillTemplate: 'af745dd997e44a1a758a59b6873cf86a8cc1304d3b70fa00cd920b9ad6f0e504',
};

const EXPECTED_GENERATED_SKILL_CONTENT_HASHES: Record<string, string> = {
  'rasen-explore': '854ac9c76cc330788d3914f98d8c2ce66f25e3d5b9c04917007a5ca238a2af32',
  'rasen-new-change': '41e6ffdd565be0b3bd023ab7375f90cbc9bdf02f2810e9f539cfaa3c42b5b43a',
  'rasen-continue-change': 'ed54c7e07126b0c87ab6f1ccc4c0717044004b92c2625382df9f7007293d97c7',
  'rasen-apply-change': '5d7aeda3ce17ba15eddf2b9938c0f2efddf9d38366005b011d6ab8ee7cf479da',
  'rasen-sync-specs': 'b55134399a8d19e7581ff0a517c49445d6e6c77c50df8605f33eaa33623cabc6',
  'rasen-archive-change': '899f35229e3b84ca29ea0c3696a2446e2bf8e0eb5c42466b1ce6587365f3af9d',
  'rasen-bulk-archive-change': '030d62b9fc4a839c86ad57059ae34409632190539145054d50afb3f3f8c78554',
  'rasen-verify-change': 'f7b02d0e0ac402094867bba8ec625245bcf375f360c11347ecb4d93f218f440d',
  'rasen-onboard': 'ca929a0dfa8785bc945302d14f14d3f8da0cdde97ff87528c8e845a7021f730f',
  'rasen-propose': '8c3553716a378d012fa781d377a7d20fbe0719cacf2a75cccd16a3ffaaf59bdf',
  // Workflow/orchestration templates (workflow-template-parity)
  'rasen-office-hours-command': '952a4f8d2f489d599edce569990d1a110157d287d9da464a9c67c35f5404f688',
  'rasen-verify-enhanced': '9e9b888471cc44797ca6ee1f8544e038aca8555c2492a5d87a5a34d8c4066af4',
  'rasen-ship': '65245d898e1c77309184cdc6f965c742964c7af1e0aa63d5af8424cbdbf43e42',
  'rasen-retain': 'f1f20248542b4b40f29cef17cd4bb3ff39a39818d0fdc79541ae8db93c1723da',
  'rasen-retro': 'af377d3849b0cbd34d1362044cc1be6f440a4fb93a3c1001dd5d64e7a58da008',
  'rasen-auto': '603a3b362c596a71200817bb38aa219d38a5916ef89003ce0a318902e082ad5a',
  'rasen-review-cycle': 'afe18e1d599692cbf3757e8edef346467ffbb74d4d6092d68c94e049d333197a',
  'rasen-handoff': '6327278c9f06d21b445ffb3a1cd8868994f9d6da3ab24ed86c3c743843d7eb99',
  'rasen-goal-plan': '675ecc645213d6615d470b7c5f811ec8321012644e36e48532b63a482c6b4401',
  'rasen-goal-iterate': '0bd42b75112906e05cc8f2ff9a0e656ca46ac86bdf8a54ce5a5c1904c5b8fa81',
  'rasen-goal-report': 'cd60a56882984b4babed00f611793b3e1448e54a2bdb94796f8ac06c17445acc',
  'rasen-goal': '2a20e399f3f13d46fa738ad11eeb5ceeab3391fe14125d94c248cd991ad655a8',
  'rasen-help': '8b94e620dc89be009b61470d749556f7b849d30f118b04f500f1722ea88f6fb5',
  'rasen-direction': '5054415a3954571bd711e4ca93d57a14ee5c662ea078c965c9d6216d550f6c2a',
  // Expert skills (inlined; see expert-template-inlining)
  'rasen-benchmark': 'f07e973718d5476f65d984a85f563daf02655117ee5cb55666b71cc7289e8c87',
  'rasen-careful': 'b3f81a672fe3f110fb21574aefe5f4a908fb888ad090901291d83dc542f4ebd8',
  'rasen-chrome-use': 'eaf2f68497a641d62dc3916893c9e8789a9aced243ad7914499a1162465a051e',
  'rasen-codebase-design': 'd84f401fddbab582447df483858e021ab6b859516bc021ed1f2ca8134ba0bd28',
  'rasen-codex': '360a178d43f9904a76bbfc6a3aa0962b76c9d7c0b8e4c492be6423b295d986c4',
  'rasen-cso': '9d3cb8c2e8aa90d8a6f51f7c614a179daab0533209ce042fbb1b20353c307b7f',
  'rasen-design-consultation': '63d460f6b08dbd858823d282d1b449dc1a14735ae04bbdd4b367a5b5b22cfc1e',
  'rasen-design-review': 'd5d25d24d0e2947be981b4abe2b3f2d348822013a8e9d4e41e373cd277872a17',
  'rasen-investigate': '891dc60a0ad28254087810a3b8684e1cd8a4055aea6473b21de0897731938c43',
  'rasen-navigator': '028840a14af753389c7b700f1636eb0a85d025d3e337a46a2ff4e59203db35f3',
  'rasen-office-hours': 'f2248a99203aa18b3af7cb3c7b1dcb92db95ad21c5b47156dac14ac890f0700f',
  'rasen-prototype': '28b8e21f7079c4a39c4088c0b5e6cb6741302b35c02a9e90da417611c917dd3e',
  'rasen-qa': '2804e773f51ba72ab2e6cafa783d93f4adc3f74b8bee131e83e40d4c899aebbc',
  'rasen-qa-only': '85f9bf829a6acd0a6f26cc1603d4ed3b74ab8c959acff295c72a80af4d7bc302',
  'rasen-review': 'db19203db5962fddaccb846ec819f910f41c4df1c83472b3bab902376689d03d',
  'rasen-tdd': 'fe0fead48016db070ad3b55b9cd6c0bc45fd7b220ba410373d4fc6b71d21eefe',
  'rasen-workflow-author': '89669aca08003a6a61861e4cb4192f66e5d40aec10cfe10e5d550b46ac124599',
  'rasen-workflow-review': '42ae9b2f1dc938b83b9380a0867a6fde99bbcba87af8617c464ee431b5f0837f',
};

// Intentionally excludes getFeedbackSkillTemplate: this list only models templates
// deployed via generateSkillContent, while feedback is covered in function payload parity.
const GENERATED_SKILL_FACTORIES: Array<[string, () => SkillTemplate]> = [
  ['rasen-explore', getExploreSkillTemplate],
  ['rasen-new-change', getNewChangeSkillTemplate],
  ['rasen-continue-change', getContinueChangeSkillTemplate],
  ['rasen-apply-change', getApplyChangeSkillTemplate],
  ['rasen-sync-specs', getSyncSpecsSkillTemplate],
  ['rasen-archive-change', getArchiveChangeSkillTemplate],
  ['rasen-bulk-archive-change', getBulkArchiveChangeSkillTemplate],
  ['rasen-verify-change', getVerifyChangeSkillTemplate],
  ['rasen-onboard', getOnboardSkillTemplate],
  ['rasen-propose', getOpsxProposeSkillTemplate],
  // Workflow/orchestration templates (workflow-template-parity)
  ['rasen-office-hours-command', getOfficeHoursCommandSkillTemplate],
  ['rasen-verify-enhanced', getVerifyEnhancedSkillTemplate],
  ['rasen-ship', getShipCommandSkillTemplate],
  ['rasen-retain', getRetainCommandSkillTemplate],
  ['rasen-retro', getRetroCommandSkillTemplate],
  ['rasen-auto', getAutoCommandSkillTemplate],
  ['rasen-review-cycle', getReviewCycleSkillTemplate],
  ['rasen-handoff', getHandoffSkillTemplate],
  ['rasen-goal-plan', getGoalPlanSkillTemplate],
  ['rasen-goal-iterate', getGoalIterateSkillTemplate],
  ['rasen-goal-report', getGoalReportSkillTemplate],
  ['rasen-goal', getGoalCommandSkillTemplate],
  ['rasen-help', getHelpSkillTemplate],
  ['rasen-direction', getDirectionSkillTemplate],
  ['rasen-benchmark', getBenchmarkSkillTemplate],
  ['rasen-careful', getCarefulSkillTemplate],
  ['rasen-chrome-use', getChromeUseSkillTemplate],
  ['rasen-codebase-design', getCodebaseDesignSkillTemplate],
  ['rasen-codex', getCodexSkillTemplate],
  ['rasen-cso', getCsoSkillTemplate],
  ['rasen-design-consultation', getDesignConsultationSkillTemplate],
  ['rasen-design-review', getDesignReviewSkillTemplate],
  ['rasen-investigate', getInvestigateSkillTemplate],
  ['rasen-navigator', getNavigatorSkillTemplate],
  ['rasen-office-hours', getOfficeHoursSkillTemplate],
  ['rasen-prototype', getPrototypeSkillTemplate],
  ['rasen-qa', getQaSkillTemplate],
  ['rasen-qa-only', getQaOnlySkillTemplate],
  ['rasen-review', getReviewSkillTemplate],
  ['rasen-tdd', getTddSkillTemplate],
  ['rasen-workflow-author', getWorkflowAuthorSkillTemplate],
  ['rasen-workflow-review', getWorkflowReviewSkillTemplate],
];

// C4 grep-guard scope (design D3): generated workflow skill bodies plus the
// navigator router body (a pure cross-reference map). Expert skills that
// carry frozen `_shared.ts` dispatched-contract content (review, cso, qa,
// qa-only, benchmark, design-review, codex, ...) are excluded from this
// guard 鈥?their colon references live in `_shared.ts`'s `PLAN_STATUS_FOOTER`,
// which is a non-goal (C3) of this change.
const WORKFLOW_BODY_DIR_NAMES = new Set([
  'rasen-explore',
  'rasen-new-change',
  'rasen-continue-change',
  'rasen-apply-change',
  'rasen-sync-specs',
  'rasen-archive-change',
  'rasen-bulk-archive-change',
  'rasen-verify-change',
  'rasen-onboard',
  'rasen-propose',
  'rasen-office-hours-command',
  'rasen-verify-enhanced',
  'rasen-ship',
  'rasen-retain',
  'rasen-retro',
  'rasen-auto',
  'rasen-review-cycle',
  'rasen-handoff',
  'rasen-goal-plan',
  'rasen-goal-iterate',
  'rasen-goal-report',
  'rasen-goal',
  'rasen-help',
  'rasen-direction',
  'rasen-navigator',
]);

const WORKFLOW_AND_NAVIGATOR_SKILL_FACTORIES = GENERATED_SKILL_FACTORIES.filter(([dirName]) =>
  WORKFLOW_BODY_DIR_NAMES.has(dirName)
);

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`);

    return `{${entries.join(',')}}`;
  }

  return JSON.stringify(value);
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

describe('skill templates split parity', () => {
  it('preserves all template function payloads exactly', () => {
    const functionFactories: Record<string, () => unknown> = {
      getExploreSkillTemplate,
      getNewChangeSkillTemplate,
      getContinueChangeSkillTemplate,
      getApplyChangeSkillTemplate,
      getSyncSpecsSkillTemplate,
      getOnboardSkillTemplate,
      getArchiveChangeSkillTemplate,
      getBulkArchiveChangeSkillTemplate,
      getVerifyChangeSkillTemplate,
      getOpsxProposeSkillTemplate,
      getFeedbackSkillTemplate,
      // Workflow/orchestration templates (workflow-template-parity)
      getOfficeHoursCommandSkillTemplate,
      getVerifyEnhancedSkillTemplate,
      getShipCommandSkillTemplate,
      getRetainCommandSkillTemplate,
      getRetroCommandSkillTemplate,
      getAutoCommandSkillTemplate,
      getReviewCycleSkillTemplate,
      getHandoffSkillTemplate,
      getGoalPlanSkillTemplate,
      getGoalIterateSkillTemplate,
      getGoalReportSkillTemplate,
      getGoalCommandSkillTemplate,
      getHelpSkillTemplate,
      getDirectionSkillTemplate,
      getBenchmarkSkillTemplate,
      getCarefulSkillTemplate,
      getChromeUseSkillTemplate,
      getCodebaseDesignSkillTemplate,
      getCodexSkillTemplate,
      getCsoSkillTemplate,
      getDesignConsultationSkillTemplate,
      getDesignReviewSkillTemplate,
      getInvestigateSkillTemplate,
      getNavigatorSkillTemplate,
      getOfficeHoursSkillTemplate,
      getPrototypeSkillTemplate,
      getQaSkillTemplate,
      getQaOnlySkillTemplate,
      getReviewSkillTemplate,
      getTddSkillTemplate,
      getWorkflowAuthorSkillTemplate,
      getWorkflowReviewSkillTemplate,
    };

    const actualHashes = Object.fromEntries(
      Object.entries(functionFactories).map(([name, fn]) => [name, hash(stableStringify(fn()))])
    );

    expect(actualHashes).toEqual(EXPECTED_FUNCTION_HASHES);
  });

  it('preserves generated skill file content exactly', () => {
    const actualHashes = Object.fromEntries(
      GENERATED_SKILL_FACTORIES.map(([dirName, createTemplate]) => [
        dirName,
        hash(generateSkillContent(createTemplate(), 'PARITY-BASELINE')),
      ])
    );

    expect(actualHashes).toEqual(EXPECTED_GENERATED_SKILL_CONTENT_HASHES);
  });

  // Iterating the production registries (not a local list) means a newly
  // added workflow is covered automatically; the full-constant containment
  // check fails if any template's interpolation drifts.
  it('teaches store selection in every deployed skill template', () => {
    for (const { template, dirName } of getSkillTemplates()) {
      const content = generateSkillContent(template, 'PARITY-BASELINE');
      expect(content, dirName).toContain(STORE_SELECTION_GUIDANCE);
    }
  });

  it('the feedback skill intentionally carries no store teaching', () => {
    // Feedback has no store-capable workflow counterpart and intentionally
    // carries no store teaching; it ships outside the deployed registry.
    expect(getFeedbackSkillTemplate().instructions).not.toContain('**Store selection:**');
  });

  it('generates no workspace-planning residue in any workflow template (4.1)', () => {
    const allSkills: Array<[string, () => SkillTemplate]> = [
      ['rasen-apply-change', getApplyChangeSkillTemplate],
      ['rasen-sync-specs', getSyncSpecsSkillTemplate],
      ['rasen-archive-change', getArchiveChangeSkillTemplate],
      ['rasen-bulk-archive-change', getBulkArchiveChangeSkillTemplate],
      ['rasen-verify-change', getVerifyChangeSkillTemplate],
    ];

    for (const [dirName, createTemplate] of allSkills) {
      const content = generateSkillContent(createTemplate(), 'PARITY-BASELINE');
      expect(content, dirName).not.toContain('workspace-planning');
      expect(content, dirName).not.toContain('Workspace guard');
    }
  });

  it('generated workflow skill bodies and the navigator router contain no /rasen: colon reference (5.1)', () => {
    for (const [dirName, createTemplate] of WORKFLOW_AND_NAVIGATOR_SKILL_FACTORIES) {
      const content = generateSkillContent(createTemplate(), 'PARITY-BASELINE');
      expect(content, dirName).not.toMatch(/\/rasen:/);
    }
  });

  it('the apply skill relays CLI nextWorkflows with the zero-CLI fallback, not a hardcoded chain (5.2)', () => {
    const content = generateSkillContent(getApplyChangeSkillTemplate(), 'PARITY-BASELINE');
    expect(content).toContain('nextWorkflows');
    expect(content).toContain('rasen status --change "<name>" --json');
    expect(content).not.toMatch(/rasen-verify-change/);
    expect(content).not.toMatch(/rasen-ship\b/);
  });

  // The /rasen-auto skill embeds the orchestration playbook; its changeRoot
  // blackboard teaching (tasks 3.1/3.2) and store-scoped resume teaching (M1)
  // are otherwise unpinned by any hash (auto is not in the golden-master map),
  // so a regression that dropped either would pass silently. Pin them here.
  it('teaches changeRoot blackboard resolution and store-scoped resume in the generated rasen-auto skill', () => {
    const autoSkill = getSkillTemplates().find(({ dirName }) => dirName === 'rasen-auto');
    expect(autoSkill, 'rasen-auto skill template').toBeDefined();
    const content = generateSkillContent(autoSkill!.template, 'PARITY-BASELINE');

    // Step F: resolve the absolute change directory from the changeRoot field
    // (NOT changeDir) before writing run-state.
    expect(content).toContain('changeRoot');
    expect(content).toContain('`changeRoot` field (NOT `changeDir`)');

    // Resume must thread --store in a store-scoped run so it resolves the store
    // root instead of the cwd (the headline break this change fixes).
    expect(content).toContain('rasen pipeline resume <change> --store <id> --json');

    // Fresh auto must request the execution-preflight view instead of
    // dispatching a merely structural pipeline show result.
    expect(content).toContain('rasen pipeline show <name> --for-execution --json');
  });
});
