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
  getFfChangeSkillTemplate,
  getNewChangeSkillTemplate,
  getOnboardSkillTemplate,
  getOpsxApplyCommandTemplate,
  getOpsxArchiveCommandTemplate,
  getOpsxBulkArchiveCommandTemplate,
  getOpsxContinueCommandTemplate,
  getOpsxExploreCommandTemplate,
  getOpsxFfCommandTemplate,
  getOpsxNewCommandTemplate,
  getOpsxOnboardCommandTemplate,
  getOpsxSyncCommandTemplate,
  getOpsxProposeCommandTemplate,
  getOpsxProposeSkillTemplate,
  getOpsxVerifyCommandTemplate,
  getSyncSpecsSkillTemplate,
  getVerifyChangeSkillTemplate,
  // Workflow/orchestration templates (workflow-template-parity)
  getOfficeHoursCommandSkillTemplate,
  getOpsxOfficeHoursCommandTemplate,
  getVerifyEnhancedSkillTemplate,
  getOpsxVerifyEnhancedCommandTemplate,
  getShipCommandSkillTemplate,
  getOpsxShipCommandTemplate,
  getRetroCommandSkillTemplate,
  getOpsxRetroCommandTemplate,
  getAutoCommandSkillTemplate,
  getOpsxAutoCommandTemplate,
  getReviewCycleSkillTemplate,
  getOpsxReviewCycleCommandTemplate,
  getHandoffSkillTemplate,
  getOpsxHandoffCommandTemplate,
  getGoalPlanSkillTemplate,
  getGoalIterateSkillTemplate,
  getGoalReportSkillTemplate,
  getGoalCommandSkillTemplate,
  getOpsxGoalCommandTemplate,
  // Expert skill templates
  getBenchmarkSkillTemplate,
  getCarefulSkillTemplate,
  getChromeUseSkillTemplate,
  getCodebaseDesignSkillTemplate,
  getCodexSkillTemplate,
  getCsoSkillTemplate,
  getDesignConsultationSkillTemplate,
  getDesignReviewSkillTemplate,
  getFreezeSkillTemplate,
  getGuardSkillTemplate,
  getInvestigateSkillTemplate,
  getNavigatorSkillTemplate,
  getOfficeHoursSkillTemplate,
  getPrototypeSkillTemplate,
  getQaSkillTemplate,
  getQaOnlySkillTemplate,
  getReviewSkillTemplate,
  getTddSkillTemplate,
  getUnfreezeSkillTemplate,
} from '../../../src/core/templates/skill-templates.js';
import {
  generateSkillContent,
  getCommandContents,
  getSkillTemplates,
} from '../../../src/core/shared/skill-generation.js';
import { STORE_SELECTION_GUIDANCE } from '../../../src/core/templates/workflows/store-selection.js';

const EXPECTED_FUNCTION_HASHES: Record<string, string> = {
  getExploreSkillTemplate: 'a765ccf687a836fdcdeb6e920a0d13f906917064c8343af0e9bcf26669944b00',
  getNewChangeSkillTemplate: 'a8ec48a8ad31bb2a81bdc879b6e1bd5d660aaf1a1232e339ce963aab8a10e7b4',
  getContinueChangeSkillTemplate: 'e2bb6a9f94bb949e9fc8d701f66d19bb6fc12fb2edf65b2c8a29d306127716b5',
  getApplyChangeSkillTemplate: 'f6d871f73450a6cdcdfc9fbb566b3772f273b41427b65ccd75293a7e74a0e736',
  getFfChangeSkillTemplate: '3d614252c8980a09c2d92fc17b170dffc864298e0aa8dd8a3974d74ab08c5c10',
  getSyncSpecsSkillTemplate: '5bc0424818eb7a17da3421f4711568424941c07fd84bb63e25de860a5cf24f89',
  getOnboardSkillTemplate: '4a2d18b3fe88219ec561c0f11ecda451cd48b2d3ef6c4dc7f4c8f6d7ef8edf2a',
  getOpsxExploreCommandTemplate: '4929741c81dcfc1c33c2fb361bf9ce336073b8ae66930757dfeaea9df00792a6',
  getOpsxNewCommandTemplate: 'b80a0652ed10276322abb461fd1717918e6e8dae70719f04fa8ade999689f37f',
  getOpsxContinueCommandTemplate: '3a7d2146c4cf6c4944e83ba475329e9d16ee333d22241e3f086a50982ca3b7b3',
  getOpsxApplyCommandTemplate: '0983b062c67bfc7ad277aacf7e8f71d1d86780644ddb53b9d1790571d8b641a3',
  getOpsxFfCommandTemplate: 'cb3b29553a96e8580c5544be2e47b8b1e99a9820816977926e6330b6ab6b483f',
  getArchiveChangeSkillTemplate: '654210fc28bbe381261bd946c9f0657370cd82d426214f7b2cc834502df327bb',
  getBulkArchiveChangeSkillTemplate: '70d53392a0ece75957fa018aede0ad9e188cda1e6272ce69692a403ba30c023e',
  getOpsxSyncCommandTemplate: '3b4597289d9090a82c914cf0dca670e897222f0f47aa0d6ca866f80ccdd7d366',
  getVerifyChangeSkillTemplate: '84b9887e224a73f6d3ea177356a53c650d948ed738157985c9512e1ab3a5a640',
  getOpsxArchiveCommandTemplate: 'de1378bccbce1ea029f43c89807d9d207616ef25255a90f50ec0753a540c4a2a',
  getOpsxOnboardCommandTemplate: 'e3f991c851a77d64658895ac288435b5a7ac3018f80638ac6b599afb5e0d9814',
  getOpsxBulkArchiveCommandTemplate: '76e2a15179f9bf2bb5bc96cdaf0bc59c314893547c618aabe70eb7038e355c4f',
  getOpsxVerifyCommandTemplate: '76856d2c42b38e7d38df1a5326bcf04828c7e917c04ba217338227413232e1bc',
  getOpsxProposeSkillTemplate: 'c7ba6459b256c98dec1fa42ddef70b59f4d2cd3d7c6e4872699b4de98bdbd582',
  getOpsxProposeCommandTemplate: '08ea46e537fa32b084bf5b9c62a967d287c94aebf9bc30cc15097b252cc8cf44',
  getFeedbackSkillTemplate: '6bfb7caffad631f807678c2b5d194fb0eb2ed0bc4cbb4bf432b5a3c160c6cc87',
  // Workflow/orchestration templates (workflow-template-parity)
  getOfficeHoursCommandSkillTemplate: '2a4d3b28ea8df0ea51f37235ff9d14b3d4764ec8c4532524c70e74fe4f227d08',
  getOpsxOfficeHoursCommandTemplate: '381ece48b54d0c87ea6118a1c75889e85fd4a1ae0c3323fcf661a7c61292a4b3',
  getVerifyEnhancedSkillTemplate: 'c06bceda94f8a5f8a598ec86ed85b6c8e1553ca61e24b17ad186cd580f632af5',
  getOpsxVerifyEnhancedCommandTemplate: 'ce8b117a75842aa9c3762274384b2961b54f0c82b7b9427d50963ca2cf717e31',
  getShipCommandSkillTemplate: '1341852f381e7e19a9f9d67b63c13db63443f20c0337b609303653bbd5c22c3b',
  getOpsxShipCommandTemplate: 'c9f7ab17e8d9176190d1ed0825e8379b26c1aa7f4519efd18687d8368dd9800d',
  getRetroCommandSkillTemplate: 'dfe036478169e0c9575521614ebc4e64fd69c3b3731bab6950aba1e4e3c54b90',
  getOpsxRetroCommandTemplate: '0efaa4356df69963be881f0fbcb09904d82ba1b0939083128699b9af93f0bb5c',
  getAutoCommandSkillTemplate: '6b9abc117370013dddc8d49559b4b8ed11ae4609be2545a47d6493ddfb9263a4',
  getOpsxAutoCommandTemplate: 'cfb4b052c6d6d797ed4815f84d01a8f42ee8022f9cea020e8066167c3f7aefb9',
  getReviewCycleSkillTemplate: '31befed3ee7c65e6d03fbea1f2cad2421ca3ed83a7c0980d2201496a9849bff9',
  getOpsxReviewCycleCommandTemplate: '8add24910f8a5edd34d7bb286fdc4ff24065c36ac2c265944924b7cdb493e699',
  getHandoffSkillTemplate: 'e533ba4a71f4fe3ff87f4bbb69fdaf8a161066a1f26736f83416ce4b0310a9d9',
  getOpsxHandoffCommandTemplate: 'db96aa68ad39a42b91cfbcace6255b60c360ecaff6b0e013e6ab8e0a5c223fc7',
  getGoalPlanSkillTemplate: '82d1a8885b2a318db821e6c3e70e0b2480bd6d572d4f9ea2c528a24748076713',
  getGoalIterateSkillTemplate: 'bf98284251d07a5ddb867355225c6ea49367602f60f880990ce4e1abf7ca2ecd',
  getGoalReportSkillTemplate: '110f9c9eb613af59f66798fc8cbe456eedf9a74a161d9ae35b898cee20907c52',
  getGoalCommandSkillTemplate: '83d74e6c53b21208d35bd74ec4417665001951bc16d1dd2993384e4328429fb5',
  getOpsxGoalCommandTemplate: '4881c5470b6452451aeaf8dfd58216e6184f88aefd33772baf7f94379c6a052a',
  // Expert skill templates (inlined; see expert-template-inlining)
  getBenchmarkSkillTemplate: '5948431d7be54861d1d83c8abe48439a8dd6a66fd1c1b5e904030943ef2a8308',
  getCarefulSkillTemplate: 'e2ee6ded43180bdacee2369c1eaa3babdfa5fc3683f84f3d9d963db870b3886e',
  getChromeUseSkillTemplate: '95cf4a8ec5f9d9ad5e51e291e3e8777e8d5ac274007ae0795feca2b13f919d02',
  getCodebaseDesignSkillTemplate: 'bab72b2982681608a3b56ff3730e54e72677752b1dc0dc0ebde215a9c9851dfc',
  getCodexSkillTemplate: 'f8383ea0c0d0f7db65dc19005a706277dbc9b1fa8f25b781cb4d447e75d4a01a',
  getCsoSkillTemplate: '4a32993f6aec85eea11a4ed22c9460c423d4d1725c925b11c95288e6c849b08a',
  getDesignConsultationSkillTemplate: '211288f35053f476b66bb9f5a940aa85fc87b3e9150b4ac68bc9eaa538d2883a',
  getDesignReviewSkillTemplate: 'fe13e7de98cbd29a01592d2c789d059caefd97774019a2474801d2c4f8e9ed4e',
  getFreezeSkillTemplate: 'fcd4b8f4fc0912211b4f2d72f6a9fd084646c12d5058bbb5587cd12f02076a3d',
  getGuardSkillTemplate: 'dd20f6ec6be771840d6c63ea7329c3059051f6effe5ae8940aef5e54d65bdc0f',
  getInvestigateSkillTemplate: '102026747c85487d3c0acd94feaa077369e29a943d3dfc21ce6b79a3ab96e222',
  getNavigatorSkillTemplate: 'e3d792eba53430bf1c9729b1234f72495fdb1146d52a9f7ca1219941ea41215a',
  getOfficeHoursSkillTemplate: 'fc8f5939ab315f974011dc6d8ad4cd3ae4698c6b62e806ebb01e1493d4d2eda8',
  getPrototypeSkillTemplate: '8fccaff04dbdf7bd21298d8454806f2ab47e098bb2de54330dfef96d50a1276d',
  getQaSkillTemplate: '9792bd3e8f0bfc10f1d14644cbbc6e06a42d67ef25ed5b5611e6b2c170740aee',
  getQaOnlySkillTemplate: '9869cabd0d5307f81bc56d572fa83b267610d341555cb661500fe55d82310985',
  getReviewSkillTemplate: '8bb18e9018e0328dc3bf9674adfc7878bc2d2a8b63a61bd79574b69788e72100',
  getTddSkillTemplate: 'ef9e3251579f06ccb4e2728b38852efc948583fed63e762fd445c7da900abff0',
  getUnfreezeSkillTemplate: '44a74b5bafa89c975c06abb4ea3c1a121870673c43487d10982ae6f6d6e8d802',
};

const EXPECTED_GENERATED_SKILL_CONTENT_HASHES: Record<string, string> = {
  'rasen-explore': 'a8f4575c7b4da106a9921ecd6ea93c55b4cc229add54100f34374be3b911699c',
  'rasen-new-change': 'f2c1abfe12e72328fa2a430fc7bba0f534cf857bac484c154e8ca851722bae7e',
  'rasen-continue-change': '03a4eec35a8034d78fe679065f6dd633bb9a7252ab4a475063a95baa1aa5ec34',
  'rasen-apply-change': '749c3ef906e59739499598d0ea1d76767a52404ecb20584d33273f1c22a7acb7',
  'rasen-ff-change': 'eb482863f96f07b7ca9c4cdb7c7a630821bbc1bf819c41dc6085b43308b21a76',
  'rasen-sync-specs': 'd2fbc1446af1159082aab71edce2e832c391b72c26908cb5baf428a8c97c3b2f',
  'rasen-archive-change': '166a792f2cd38f262e8306ab88bec8e5492fb01776b6d16e692865fd704485cd',
  'rasen-bulk-archive-change': '1860bd913b716a7bfd33bf6a56b2da8f8c243038c596193213e74e1a3cbecf9e',
  'rasen-verify-change': 'f8b3e0a2b42ea169a6dcaecc39dce11892ac9b258d0e4f31834d7b0b143d8fe7',
  'rasen-onboard': '35c4f0714b842cb7a3a3bb8c5a6537045efe6e8fdc6a8dff5c9b7028df7c9369',
  'rasen-propose': 'ccde6ae64c0c1cba7fe3914ff7bcd0252d59e46f7c4f839622a4cda40245e6dc',
  // Workflow/orchestration templates (workflow-template-parity)
  'rasen-office-hours-command': '9c5dacb1632226cc01e6b3ff5993545f220d6f64a933ce852c227853250dfb48',
  'rasen-verify-enhanced': '01040f92979c09e58161cec2413edf427f12b646144c267fb9ec2d93dfe70a41',
  'rasen-ship': '61be30ba7efa78c9101aa3d4a880346673ace5da40322c08beec6731b1eca500',
  'rasen-retro': '5d68d1f9262b4748ea85d7b9e4f2882630387b6a4d918f0d214682be009ff728',
  'rasen-auto': '9639f453ffb2359fbf686310944ec9941b5b5b2c2146ce343889da61627273fe',
  'rasen-review-cycle': '587b776645ad658c23a0894a2827ab676129b4369850cef519c70ec7532d2cc0',
  'rasen-handoff': '12a1abbc6ce5cbc23136c679f94f16de7a9f614fc0b66d69a7867a0c9c8edde7',
  'rasen-goal-plan': 'e9c4ba86303ea5aff78c6ecd9f4be96afded9372bf4621c58485a3db883a4479',
  'rasen-goal-iterate': '5ee85a49ba336d7618a1c7d91402419715877e5013207104eb8275a9a917adb8',
  'rasen-goal-report': '91230e30fe414a45d785f7066a236e4454311ff5939ff8c390f5894a3d5dd03a',
  'rasen-goal': 'a495e3861f779e5167ad88dd1f831c14ba57450e00a763aba4022480ff488db9',
  // Expert skills (inlined; see expert-template-inlining)
  'rasen-benchmark': '95865bd2ecc0715e42ecd8a47c0715dd66deaaa11e7bc901e22385197854781d',
  'rasen-careful': '63b4eb6cabbd5eef8ebf97199c1656cf9cb4b22d815d3cf873c3445e7aa91aa4',
  'rasen-chrome-use': 'f970b8bbebe15f707f5cd1793527a8b1bba158ce9e192c5e7e22b4a2b0756862',
  'rasen-codebase-design': 'c49648f1fcc686432664cec242c32079ffd7dba55a705f00a44e5ad44ad5cefa',
  'rasen-codex': '43e6013470cce1b7db006f096e5ffc7452f5b485f3ef05d5b5ee810139c4f68f',
  'rasen-cso': '4e1b2a8c054e851202345e34ca03c1051e8d3e80dd2d7385763da3c5c2c002c7',
  'rasen-design-consultation': '9a45452240cc767b6edd8c7ee5dccf121fc09e4d5e995de49ede934709409ed7',
  'rasen-design-review': 'a320d53ece3f6841b5f854330e23fc4d60b782afa1417c8bb96b72a6b0307053',
  'rasen-freeze': '8077fb923c13595886d66f304a347a5dcaeb164b31170e0c34d4a511be3da6f5',
  'rasen-guard': '3bf7c046d581c01f8b85632b5fb9c4d5f05e6dc629153ce13b523547665222c4',
  'rasen-investigate': 'ac03ba3896a5402a64276ab28865de8ecfdcb4f15fa14fc659c872fb124e2ee1',
  'rasen-navigator': 'f7ad58aada9b1392c79c0679a7bbb26cd984a63d69e5a06898e40b292855eed0',
  'rasen-office-hours': 'a572ff25481f9a7c12c17526ec051f749fdfe0577fcd9307401892b0da377ea2',
  'rasen-prototype': '687e7d92e706841702430fefb2df8b6739df93f5ff7f885bb8909d079f640a51',
  'rasen-qa': '184cc0fee0fd539aeec04d6ed7004e4897a3d7669550d14b9df8a6057003d196',
  'rasen-qa-only': '233638bbfc16a1376cf33e8838241d09636cab0e121b7151be8e09d3f203f81a',
  'rasen-review': '3f487b5c4b9a3707640a67bc189b5a57848b8461ef12be21089f1b444b562669',
  'rasen-tdd': 'ff62091a47d853b8db20be7e20f6aeb095b6a93214ea4a79e168e3816dbbe15a',
  'rasen-unfreeze': 'f32b9b0a5b2a5dff8b8d83e510142d19e75ff0765050016fc7479bf8919b34c8',
};

// Intentionally excludes getFeedbackSkillTemplate: this list only models templates
// deployed via generateSkillContent, while feedback is covered in function payload parity.
const GENERATED_SKILL_FACTORIES: Array<[string, () => SkillTemplate]> = [
  ['rasen-explore', getExploreSkillTemplate],
  ['rasen-new-change', getNewChangeSkillTemplate],
  ['rasen-continue-change', getContinueChangeSkillTemplate],
  ['rasen-apply-change', getApplyChangeSkillTemplate],
  ['rasen-ff-change', getFfChangeSkillTemplate],
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
  ['rasen-retro', getRetroCommandSkillTemplate],
  ['rasen-auto', getAutoCommandSkillTemplate],
  ['rasen-review-cycle', getReviewCycleSkillTemplate],
  ['rasen-handoff', getHandoffSkillTemplate],
  ['rasen-goal-plan', getGoalPlanSkillTemplate],
  ['rasen-goal-iterate', getGoalIterateSkillTemplate],
  ['rasen-goal-report', getGoalReportSkillTemplate],
  ['rasen-goal', getGoalCommandSkillTemplate],
  ['rasen-benchmark', getBenchmarkSkillTemplate],
  ['rasen-careful', getCarefulSkillTemplate],
  ['rasen-chrome-use', getChromeUseSkillTemplate],
  ['rasen-codebase-design', getCodebaseDesignSkillTemplate],
  ['rasen-codex', getCodexSkillTemplate],
  ['rasen-cso', getCsoSkillTemplate],
  ['rasen-design-consultation', getDesignConsultationSkillTemplate],
  ['rasen-design-review', getDesignReviewSkillTemplate],
  ['rasen-freeze', getFreezeSkillTemplate],
  ['rasen-guard', getGuardSkillTemplate],
  ['rasen-investigate', getInvestigateSkillTemplate],
  ['rasen-navigator', getNavigatorSkillTemplate],
  ['rasen-office-hours', getOfficeHoursSkillTemplate],
  ['rasen-prototype', getPrototypeSkillTemplate],
  ['rasen-qa', getQaSkillTemplate],
  ['rasen-qa-only', getQaOnlySkillTemplate],
  ['rasen-review', getReviewSkillTemplate],
  ['rasen-tdd', getTddSkillTemplate],
  ['rasen-unfreeze', getUnfreezeSkillTemplate],
];

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
      getFfChangeSkillTemplate,
      getSyncSpecsSkillTemplate,
      getOnboardSkillTemplate,
      getOpsxExploreCommandTemplate,
      getOpsxNewCommandTemplate,
      getOpsxContinueCommandTemplate,
      getOpsxApplyCommandTemplate,
      getOpsxFfCommandTemplate,
      getArchiveChangeSkillTemplate,
      getBulkArchiveChangeSkillTemplate,
      getOpsxSyncCommandTemplate,
      getVerifyChangeSkillTemplate,
      getOpsxArchiveCommandTemplate,
      getOpsxOnboardCommandTemplate,
      getOpsxBulkArchiveCommandTemplate,
      getOpsxVerifyCommandTemplate,
      getOpsxProposeSkillTemplate,
      getOpsxProposeCommandTemplate,
      getFeedbackSkillTemplate,
      // Workflow/orchestration templates (workflow-template-parity)
      getOfficeHoursCommandSkillTemplate,
      getOpsxOfficeHoursCommandTemplate,
      getVerifyEnhancedSkillTemplate,
      getOpsxVerifyEnhancedCommandTemplate,
      getShipCommandSkillTemplate,
      getOpsxShipCommandTemplate,
      getRetroCommandSkillTemplate,
      getOpsxRetroCommandTemplate,
      getAutoCommandSkillTemplate,
      getOpsxAutoCommandTemplate,
      getReviewCycleSkillTemplate,
      getOpsxReviewCycleCommandTemplate,
      getHandoffSkillTemplate,
      getOpsxHandoffCommandTemplate,
      getGoalPlanSkillTemplate,
      getGoalIterateSkillTemplate,
      getGoalReportSkillTemplate,
      getGoalCommandSkillTemplate,
      getOpsxGoalCommandTemplate,
      getBenchmarkSkillTemplate,
      getCarefulSkillTemplate,
      getChromeUseSkillTemplate,
      getCodebaseDesignSkillTemplate,
      getCodexSkillTemplate,
      getCsoSkillTemplate,
      getDesignConsultationSkillTemplate,
      getDesignReviewSkillTemplate,
      getFreezeSkillTemplate,
      getGuardSkillTemplate,
      getInvestigateSkillTemplate,
      getNavigatorSkillTemplate,
      getOfficeHoursSkillTemplate,
      getPrototypeSkillTemplate,
      getQaSkillTemplate,
      getQaOnlySkillTemplate,
      getReviewSkillTemplate,
      getTddSkillTemplate,
      getUnfreezeSkillTemplate,
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

  it('teaches store selection in every deployed rasen command template', () => {
    for (const entry of getCommandContents()) {
      expect(entry.body, entry.id).toContain(STORE_SELECTION_GUIDANCE);
    }

    // Feedback has no store-capable command and intentionally carries no
    // store teaching; it ships outside both registries.
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

  // The /rasen:auto skill embeds the orchestration playbook; its changeRoot
  // blackboard teaching (tasks 3.1/3.2) and store-scoped resume teaching (M1)
  // are otherwise unpinned by any hash (auto is not in the golden-master map),
  // so a regression that dropped either would pass silently. Pin them here.
  it('teaches changeRoot blackboard resolution and store-scoped resume in the generated rasen:auto skill', () => {
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
  });
});
