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
  getTaskLoopSkillTemplate,
  getHelpSkillTemplate,
  getDirectionSkillTemplate,
  // Expert skill templates
  getBenchmarkSkillTemplate,
  getCarefulSkillTemplate,
  getChromeUseSkillTemplate,
  getCodexSkillTemplate,
  getCsoSkillTemplate,
  getDesignConsultationSkillTemplate,
  getDesignReviewSkillTemplate,
  getInvestigateSkillTemplate,
  getOfficeHoursSkillTemplate,
  getQaSkillTemplate,
  getReviewSkillTemplate,
  getTeacherAdvisorSkillTemplate,
  getWorkflowAuthorSkillTemplate,
} from '../../../src/core/templates/skill-templates.js';
import {
  generateSkillContent,
  getSkillTemplates,
} from '../../../src/core/shared/skill-generation.js';
import { STORE_SELECTION_GUIDANCE } from '../../../src/core/templates/workflows/store-selection.js';

const EXPECTED_FUNCTION_HASHES: Record<string, string> = {
  getExploreSkillTemplate: 'a1e2f46932c5465b2037428e4c6fb677c53711efd7bb3641ad04af1745a32865',
  getNewChangeSkillTemplate: '3854a89ee563d1b2de6e66bbe298b553d0ea237729db87318aa90b8b871aa814',
  getContinueChangeSkillTemplate: '9163ecf8b096b01e2e550309307c52cdd895fe9844f1e0668a6ed342c606a18c',
  getApplyChangeSkillTemplate: 'ffb0dd75fb3df1b1799e9f3034d1f3c4c4824ab2d703505129510685fe8abc73',
  getSyncSpecsSkillTemplate: '63b9a9752e489127b23d45137ddc8c6c9e13f8c869184c1432aa981d66cd8114',
  getOnboardSkillTemplate: 'e17de7e291f363d95b3e22e7561375832cc5a431ddbd0da3c1b07ee52507186a',
  getArchiveChangeSkillTemplate: '60ead63b7f43e7b5cc937f63dc39766fe834b4031a76f3ca8a46ff638f455f62',
  getBulkArchiveChangeSkillTemplate: 'bb6543bf5e94e81925f2a384728cfe88d66e4597ae93f038cda0aa8fe64f2c59',
  getVerifyChangeSkillTemplate: 'dcce5539fc84564338ce414a28f8549d85ec3b2890458f38fb49cccd2e879bed',
  getOpsxProposeSkillTemplate: '4446c8f2568f8fd463e7a3d8e164ee88847e7c281f34b028f28ad4285e8d598a',
  getFeedbackSkillTemplate: '6bfb7caffad631f807678c2b5d194fb0eb2ed0bc4cbb4bf432b5a3c160c6cc87',
  // Workflow/orchestration templates (workflow-template-parity)
  getOfficeHoursCommandSkillTemplate: 'bbcc9ecef628e9987891994014e29e8e57911bb831a1a15d41c8290a4bad4e25',
  getVerifyEnhancedSkillTemplate: '15aa00fee4efc56445ec109bf1df622e8829184f3834c6c0adca82b5648e521a',
  getShipCommandSkillTemplate: '7ec6b452535ddf81ec9d0c5eb4640d5ac611a5e209bf04be93efc67824de87b0',
  getRetainCommandSkillTemplate: 'd2a6d17f9f79e33a6210069b3178774a28da774032f2a105fb3b827a95522705',
  getRetroCommandSkillTemplate: '64725c0d0c2d5ee285de0186c62e9bb9cfc6b2ddc95eabd408e089ff1d00c6db',
  getAutoCommandSkillTemplate: '7fb86c8d229f8b94cad835f2b74b8049429e8f7336d0e0c0a442e7365c399fea',
  getReviewCycleSkillTemplate: 'ba24c467eac4e489464fb77c5d2871582d39a81b0f7334718d59466324b6a4b4',
  getHandoffSkillTemplate: '531cea204f5d8627a0f9fe25d46cda29b9a1457a4ad1f4354217e9a170660580',
  getGoalPlanSkillTemplate: 'e5f9ed5944dfed8b8815c73bc3d242f41e5af7a5d3111643ac54f498a572f17f',
  getGoalIterateSkillTemplate: '60dedcf7f4d9a316e982e882f12f65fe9f43825d59dd9169f140452352c5eee4',
  getGoalReportSkillTemplate: '81d518de7527191e92d836c85420a1a0d420f3a55479ec0d5f63689577baea4b',
  getGoalCommandSkillTemplate: 'e8679317f75a909bb530bb80c50c8e7c801aca26561d0141bb65e95e295e966b',
  getTaskLoopSkillTemplate: 'b85886540eb9a28d52979a2751a602bbf171990f76a4d55772373f8054af8aff',
  getHelpSkillTemplate: 'e0722f13f6d2a4f5a46bd83e7b83057dc1924a20ca449b78706a69d32316841b',
  getDirectionSkillTemplate: '3d5e8cdb1e2f29dd20db1428912e87e09b93561af4d0da8fa0e11bb6a8c09e1f',
  // Expert skill templates (inlined; see expert-template-inlining)
  getBenchmarkSkillTemplate: '709b6b3b2fe21c38bbe2c3e81d43f3230488b8a2d33846eff8469a56b1aad16c',
  getCarefulSkillTemplate: '6e927feb4276cfa95e51d0717c62715623c411810d59960ec39579fa052834f0',
  getChromeUseSkillTemplate: '3d595ad2ca53e7a42c0e8fa1225d878a9f68940f22f6089e54cf7e803fd9b0ce',
  getCodexSkillTemplate: '84a902623a4fe02b57b3d79bec610f1969f2aa3a294d79b0586ea9a3309c58e7',
  getCsoSkillTemplate: '461fa3e5a3cbecc133b5c544a5f0d1b53724d4472ab018c8e87badc16ffb839f',
  getDesignConsultationSkillTemplate: '2d08b325352291593daa03513f364e1376feb97e8d017eb4b41ef374fb84fa00',
  getDesignReviewSkillTemplate: '0b616d6b3f3925f2530ba44a46301496ed863110f833e0a1f2494afbe3c1d410',
  getInvestigateSkillTemplate: '9d76ccc1a9148d2ae40d3569114d7e7a6cf5afe72bc109b3f3a87d0b3a0fa15a',
  getOfficeHoursSkillTemplate: 'e4fcb7af50b210a4b0a1ca3f9c28e657b7b12adcec937ced1d3083ae5811ac90',
  getQaSkillTemplate: 'b268c2cf7521d07116ff3c14482167b19837c4889a63586f35c50ba6cc0f4a31',
  getReviewSkillTemplate: '381c46e1c64a84ae00ae79e83a0792278295b95b06176af6e520a1f6a14065e5',
  getTeacherAdvisorSkillTemplate: '0629736b7cbade70395df095063ad62f10b71458cdf1dccb829163958c7cd4ec',
  getWorkflowAuthorSkillTemplate: 'f20cf7cf1399af1d521d3e70ec07983a84e1f96793349c466528f0451202f729',
};

const EXPECTED_GENERATED_SKILL_CONTENT_HASHES: Record<string, string> = {
  'rasen-explore': '2559f1783924f095a74730a76f9a65218253e31466fc834b4d3426ce8f955cd1',
  'rasen-new-change': '3151f2419905723dd9de94e24c9512b94638f717a1fe5c7a6d6f9e700ed1282e',
  'rasen-continue-change': '15d297fb350320374e8d9425b92e741fa52b5485b73d3611c651e24d843819b9',
  'rasen-apply-change': '95edffc10c0935d4bcd29e2384b06b99183feb5ba3e4873aa22d460d40b9a8b5',
  'rasen-sync-specs': '83051a9590eba7afd397ccf14e43c903837824c5a54acecf38ff736466806367',
  'rasen-archive-change': 'd6935d11cced67eeba2b70d15eab682f935ad167d0ee4bf49df9fc399057a8c2',
  'rasen-bulk-archive-change': 'f2abaf11300da38d5163ebe019183053450d310c2f246b3ea1e84e5ecfbf9803',
  'rasen-verify-change': 'e21a335b621b9908fef3f2e9f966ec83f23f687608a02db0c28f190ea9353c66',
  'rasen-onboard': '28957513ab3c25ca044f94d92b0bcc6955448b3263ff863e51c843a1d17c36d2',
  'rasen-propose': '9f04b3b1b395135ae05079e6a47826991cab0a36eb61624832ea9b359f55121d',
  // Workflow/orchestration templates (workflow-template-parity)
  'rasen-office-hours-command': '1a8355d9bc1f212001d62cd7d6231d7489455b601d938318ea0472a04c6c8fe7',
  'rasen-verify-enhanced': 'd335d81b791c5f66ef5b29871fdc54f323e30c49aaafeb4a3c999d6e3e012734',
  'rasen-ship': '4e016bdfee3d00f66e264d7ebed153e39b5d624abca813866621f6bc14d6b5eb',
  'rasen-retain': '1a2943cb9809e820f5db9bfa2c8b44e4e7fb540e20540abc39d664692efddfdc',
  'rasen-retro': 'af377d3849b0cbd34d1362044cc1be6f440a4fb93a3c1001dd5d64e7a58da008',
  'rasen-auto': '100c3560f69f898293d86c9b8cb4aff46debfe19b32b013ec6f75a13e3ef2b05',
  'rasen-review-cycle': '2c6ab5b4e5b441b0882ec3d95c43e9256029ba6effafcf6e44ddfe49339ae7fc',
  'rasen-handoff': '8394a841e91e5b62de574af103cbc2c3225f30b81bd538221719b18b5c77c24f',
  'rasen-goal-plan': '2bc4026408389837e84ac743df8b28199155426f0e0e72e5abf2fd056cad703e',
  'rasen-goal-iterate': '5b5480ddfe2840af63d3da3ba537ff92f9ded9018dba640204bc27ad10869949',
  'rasen-goal-report': '4dced9edf8c51bdff898b395d9b332946ac01052b8a7bf15120588df94847352',
  'rasen-goal': 'ea0956b2a5bc2089779fa75eadf95b8feedd76e509ff841520c4e07d8b195810',
  'rasen-task-loop': 'fc1535b615d8c529c0c5c292e15cd6fb523173ac6976599ddfc5dd9fb3da5fcc',
  'rasen-help': '44531c1ce27e93fb8ad9dc850d9a84b6239deefbebd4e76b92bd917f90efeeb6',
  'rasen-direction': '8ae91feb2a2930b48da60f59ee82d34a66f49691239831752301c41f994de024',
  // Expert skills (inlined; see expert-template-inlining)
  'rasen-benchmark': 'b5485245eb194689cda456fd36e3e97f7fe976cb376cb99300976dab6dcdcd2a',
  'rasen-careful': '7c5ce19b2e3b4a2329d45f5a1ec55d92959b393d6663fcc5d0e511585b688dbf',
  'rasen-chrome-use': 'fc51cedf41327c5593ef1234dc4f8b17ec20f290d0578930cffaa500d98821d8',
  'rasen-codex': '23cbf5fa51e6934fe2453ade79c11ba5c96c65629b0461ec00cddcf927ca78be',
  'rasen-cso': 'd9301db560dfcbda4474590f0920ae1cd3581870a369e96cd4ed8ab19ab347d8',
  'rasen-design-consultation': 'b6fb96d8cd334c49a42dff0aba844ed0b1804c2af542e2d8f66ad270737f4e97',
  'rasen-design-review': '2d644b4e99a1ba680b54b8e08c4d0a223508b3afe9c824277e976f8cc9ac4bf4',
  'rasen-investigate': 'a822c6ba7e3b6323eb2fe6871f0f1f0dd2d06be7a81311894f7c1fa54e929d55',
  'rasen-office-hours': '21b41517006dc4c935c4960057f31c95eb420a7ce181d7735fc405fbe5ced9e4',
  'rasen-qa': '3f57f82b9c3a257ee3c648e701effd240ef620ed4810b72672298fa0c378362e',
  'rasen-review': '406bc3d41285c0fcfb0b051c3b8277d7b7f17f2da069a1bfcb7074b70d4617db',
  'rasen-teacher-advisor': '49ef06c0ced5c1fe0c804870642cd64564324a970d8c4b994571dbb03bbe5c66',
  'rasen-workflow-author': 'd96176893f008efe9bb5f8b907ab81597c37959e299d1c899714c0ef84640583',
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
  ['rasen-task-loop', getTaskLoopSkillTemplate],
  ['rasen-help', getHelpSkillTemplate],
  ['rasen-direction', getDirectionSkillTemplate],
  ['rasen-benchmark', getBenchmarkSkillTemplate],
  ['rasen-careful', getCarefulSkillTemplate],
  ['rasen-chrome-use', getChromeUseSkillTemplate],
  ['rasen-codex', getCodexSkillTemplate],
  ['rasen-cso', getCsoSkillTemplate],
  ['rasen-design-consultation', getDesignConsultationSkillTemplate],
  ['rasen-design-review', getDesignReviewSkillTemplate],
  ['rasen-investigate', getInvestigateSkillTemplate],
  ['rasen-office-hours', getOfficeHoursSkillTemplate],
  ['rasen-qa', getQaSkillTemplate],
  ['rasen-review', getReviewSkillTemplate],
  ['rasen-teacher-advisor', getTeacherAdvisorSkillTemplate],
  ['rasen-workflow-author', getWorkflowAuthorSkillTemplate],
];

// C4 grep-guard scope (design D3): generated workflow skill bodies. Expert skills that
// carry frozen `_shared.ts` dispatched-contract content (review, cso, qa,
// benchmark, design-review, codex, ...) are excluded from this
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
  'rasen-task-loop',
  'rasen-help',
  'rasen-direction',
]);

const WORKFLOW_SKILL_FACTORIES = GENERATED_SKILL_FACTORIES.filter(([dirName]) =>
  WORKFLOW_BODY_DIR_NAMES.has(dirName)
);

const BARE_EXPERT_INVOCATION = /(?:^|[\s(`])\/(?:review|cso|qa|design-review)\b/m;

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
      getTaskLoopSkillTemplate,
      getHelpSkillTemplate,
      getDirectionSkillTemplate,
      getBenchmarkSkillTemplate,
      getCarefulSkillTemplate,
      getChromeUseSkillTemplate,
      getCodexSkillTemplate,
      getCsoSkillTemplate,
      getDesignConsultationSkillTemplate,
      getDesignReviewSkillTemplate,
      getInvestigateSkillTemplate,
      getOfficeHoursSkillTemplate,
      getQaSkillTemplate,
      getReviewSkillTemplate,
      getTeacherAdvisorSkillTemplate,
      getWorkflowAuthorSkillTemplate,
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

  it('generated workflow skill bodies use canonical names, not colon or bare expert invocations (5.1)', () => {
    for (const [dirName, createTemplate] of WORKFLOW_SKILL_FACTORIES) {
      const content = generateSkillContent(createTemplate(), 'PARITY-BASELINE');
      expect(content, dirName).not.toMatch(/\/rasen:/);
      expect(content, dirName).not.toMatch(BARE_EXPERT_INVOCATION);
    }
  });

  it('rejects plain and Markdown-wrapped bare expert fixtures while allowing canonical names', () => {
    expect('Invoke /review for a code review.').toMatch(BARE_EXPERT_INVOCATION);
    expect('Invoke `/review` for a code review.').toMatch(BARE_EXPERT_INVOCATION);
    expect('Invoke `rasen-review` for a code review.').not.toMatch(BARE_EXPERT_INVOCATION);
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
