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
  getArchiveChangeSkillTemplate: '39ac89129c3305abb5c58b9e0de94ef40dc8187d25bedf930cc2369a61541e9a',
  getBulkArchiveChangeSkillTemplate: '3ebdb0c12157fc3bb039e9d7a024485dc0f386f83fc431e889cb2b5c7bd21d31',
  getVerifyChangeSkillTemplate: 'dcce5539fc84564338ce414a28f8549d85ec3b2890458f38fb49cccd2e879bed',
  getOpsxProposeSkillTemplate: '4446c8f2568f8fd463e7a3d8e164ee88847e7c281f34b028f28ad4285e8d598a',
  getFeedbackSkillTemplate: '6bfb7caffad631f807678c2b5d194fb0eb2ed0bc4cbb4bf432b5a3c160c6cc87',
  // Workflow/orchestration templates (workflow-template-parity)
  getOfficeHoursCommandSkillTemplate: 'bbcc9ecef628e9987891994014e29e8e57911bb831a1a15d41c8290a4bad4e25',
  getVerifyEnhancedSkillTemplate: '15aa00fee4efc56445ec109bf1df622e8829184f3834c6c0adca82b5648e521a',
  getShipCommandSkillTemplate: '7ec6b452535ddf81ec9d0c5eb4640d5ac611a5e209bf04be93efc67824de87b0',
  getRetainCommandSkillTemplate: 'd2a6d17f9f79e33a6210069b3178774a28da774032f2a105fb3b827a95522705',
  getRetroCommandSkillTemplate: '64725c0d0c2d5ee285de0186c62e9bb9cfc6b2ddc95eabd408e089ff1d00c6db',
  getAutoCommandSkillTemplate: '68d20571af1625d533079062ed0659ccf13d580fd1ae40b6caac9307fe624960',
  getReviewCycleSkillTemplate: '927da23dbf290f35c8ea145fefd364362c23a3c3bd3298f8655691bd0d9f33f8',
  getHandoffSkillTemplate: '531cea204f5d8627a0f9fe25d46cda29b9a1457a4ad1f4354217e9a170660580',
  getGoalPlanSkillTemplate: 'e5f9ed5944dfed8b8815c73bc3d242f41e5af7a5d3111643ac54f498a572f17f',
  getGoalIterateSkillTemplate: '60dedcf7f4d9a316e982e882f12f65fe9f43825d59dd9169f140452352c5eee4',
  getGoalReportSkillTemplate: '81d518de7527191e92d836c85420a1a0d420f3a55479ec0d5f63689577baea4b',
  getGoalCommandSkillTemplate: 'e8679317f75a909bb530bb80c50c8e7c801aca26561d0141bb65e95e295e966b',
  getTaskLoopSkillTemplate: 'b85886540eb9a28d52979a2751a602bbf171990f76a4d55772373f8054af8aff',
  getHelpSkillTemplate: 'e0722f13f6d2a4f5a46bd83e7b83057dc1924a20ca449b78706a69d32316841b',
  getDirectionSkillTemplate: '3d5e8cdb1e2f29dd20db1428912e87e09b93561af4d0da8fa0e11bb6a8c09e1f',
  // Expert skill templates (inlined; see expert-template-inlining)
  getBenchmarkSkillTemplate: '665e4a69570850e4746d37cdc8434e7436e7f3984f7529ad578a8ea47d19ef93',
  getCarefulSkillTemplate: '013078f80183bc71cce95e82170456146a0db8a2b4618efe7c4b04d489b6a165',
  getChromeUseSkillTemplate: '44255c53e23fc22dafa0d558f6ce8de3b430af2b84978fa9b21906406b90f787',
  getCodexSkillTemplate: '978b0190b952e1283a4681bf44f1d51483b274a869c19650beabf36665fb8852',
  getCsoSkillTemplate: 'c4b68c2aa45a8183298af1e1d0c830429d224dc3e8fc996a3c77210f3e290461',
  getDesignConsultationSkillTemplate: '02893d4e3077803505c6bd5e694d9f5b401e438128766c8843ef933d0d577a56',
  getDesignReviewSkillTemplate: '0cca5144b66edf539f11e0a99b13c90574f0f1a70becb2c3d4962a24c2ee60aa',
  getInvestigateSkillTemplate: '09545cca2e9e5afa72fec4c4b43e48a56c79ca207545e64c6c715020da0782a6',
  getOfficeHoursSkillTemplate: 'd18afbe93395d2ba08087008b19d27ffa187db5bf8277626e1e91463645f3d69',
  getQaSkillTemplate: '2a48f20cfc061472fc5df60d1d7b8fb32f2c9ea077b741229ea0fc88f327e4aa',
  getReviewSkillTemplate: 'f42184900fc5e2664a8c16c1cc27ae9f4bf675340cdcf8f44403fcf251ca94e2',
  getTeacherAdvisorSkillTemplate: '97b8afc9b41d579901becd897770392b01fce67edaae1b26c841b5a4df24c598',
  getWorkflowAuthorSkillTemplate: '19532fdfeb6474eef3dd70c84385463f21be457ed290fd9ae536217f3f12901f',
};

const EXPECTED_GENERATED_SKILL_CONTENT_HASHES: Record<string, string> = {
  'rasen-explore': '2559f1783924f095a74730a76f9a65218253e31466fc834b4d3426ce8f955cd1',
  'rasen-new-change': '3151f2419905723dd9de94e24c9512b94638f717a1fe5c7a6d6f9e700ed1282e',
  'rasen-continue-change': '15d297fb350320374e8d9425b92e741fa52b5485b73d3611c651e24d843819b9',
  'rasen-apply-change': '95edffc10c0935d4bcd29e2384b06b99183feb5ba3e4873aa22d460d40b9a8b5',
  'rasen-sync-specs': '83051a9590eba7afd397ccf14e43c903837824c5a54acecf38ff736466806367',
  'rasen-archive-change': '265c081d412847036b80f23754c6a8a88bb34bf2113cb05e9bfcaad82d4a2c29',
  'rasen-bulk-archive-change': 'd6185da36f898abdd9d95d2c23292ed271c7e6e9d88b75cfa0412a03d92c4bc8',
  'rasen-verify-change': 'e21a335b621b9908fef3f2e9f966ec83f23f687608a02db0c28f190ea9353c66',
  'rasen-onboard': '28957513ab3c25ca044f94d92b0bcc6955448b3263ff863e51c843a1d17c36d2',
  'rasen-propose': '9f04b3b1b395135ae05079e6a47826991cab0a36eb61624832ea9b359f55121d',
  // Workflow/orchestration templates (workflow-template-parity)
  'rasen-office-hours-command': '1a8355d9bc1f212001d62cd7d6231d7489455b601d938318ea0472a04c6c8fe7',
  'rasen-verify-enhanced': 'd335d81b791c5f66ef5b29871fdc54f323e30c49aaafeb4a3c999d6e3e012734',
  'rasen-ship': '4e016bdfee3d00f66e264d7ebed153e39b5d624abca813866621f6bc14d6b5eb',
  'rasen-retain': '1a2943cb9809e820f5db9bfa2c8b44e4e7fb540e20540abc39d664692efddfdc',
  'rasen-retro': 'af377d3849b0cbd34d1362044cc1be6f440a4fb93a3c1001dd5d64e7a58da008',
  'rasen-auto': '8d862fad9f28994d7475b86d69471e76146fbf1d429c55e32c28c21425c0eaad',
  'rasen-review-cycle': '78e622efb9f7145d609689c6616536a81b94250157a230a49175e6a3c89fa4b1',
  'rasen-handoff': '8394a841e91e5b62de574af103cbc2c3225f30b81bd538221719b18b5c77c24f',
  'rasen-goal-plan': '2bc4026408389837e84ac743df8b28199155426f0e0e72e5abf2fd056cad703e',
  'rasen-goal-iterate': '5b5480ddfe2840af63d3da3ba537ff92f9ded9018dba640204bc27ad10869949',
  'rasen-goal-report': '4dced9edf8c51bdff898b395d9b332946ac01052b8a7bf15120588df94847352',
  'rasen-goal': 'ea0956b2a5bc2089779fa75eadf95b8feedd76e509ff841520c4e07d8b195810',
  'rasen-task-loop': 'fc1535b615d8c529c0c5c292e15cd6fb523173ac6976599ddfc5dd9fb3da5fcc',
  'rasen-help': '44531c1ce27e93fb8ad9dc850d9a84b6239deefbebd4e76b92bd917f90efeeb6',
  'rasen-direction': '8ae91feb2a2930b48da60f59ee82d34a66f49691239831752301c41f994de024',
  // Expert skills (inlined; see expert-template-inlining)
  'rasen-benchmark': 'b6c95ae333c94038bb8b1a80c543579bdabac57d3f6764385e473dca1a3b0f04',
  'rasen-careful': '3e81de406672ea05b0f56b4c2628540d1843cfececfad7fe12716f40fa207e51',
  'rasen-chrome-use': 'b6b883f4c631f0da7f236abc10921c8b9877d3e34683d5f2006385056fe35c23',
  'rasen-codex': '9a433ce4c3a571e7400ec0a95c3c84c262e8d16381bdbc0e6fbb7e0b18618a4e',
  'rasen-cso': 'cd4a76c3c1f95d112c853d22b905e6866456b7be1140c6cbb7ec84819191e2d5',
  'rasen-design-consultation': '368137adf17e6ec3028770cf4f5c1af58c42d70942d719ce07fc0ec3af5ba4e8',
  'rasen-design-review': '35b5efbb42f61a159ca60e53f1c821312ba96779fc5d48f6a449d3042a2612f1',
  'rasen-investigate': '63a92096a72d5ad457479fda38c92fb5b49c69788ea629d12304ea11a7abe29f',
  'rasen-office-hours': '535d15ef9adece6a79126120911b5db88b2c036e2b66091088c01fb83ecc9de4',
  'rasen-qa': '5155dd12424448d7412d00c238d9af0f2cf666cec64296c154f3e18b89cc3210',
  'rasen-review': '801c47f30f6624ecfac3b9297e6df849d38442d4d6fd5c3044ac1fd5895455c1',
  'rasen-teacher-advisor': '9388b35a8db85875743193b426aec0d2d9233e46e0850fc2c1e7c07e2d7979d8',
  'rasen-workflow-author': '242e526bbd31d3a77c6061764cdb4e2485a87611e192e82642144df7fb5de8bb',
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
    );    expect(actualHashes).toEqual(EXPECTED_FUNCTION_HASHES);
  });

  it('preserves generated skill file content exactly', () => {
    const actualHashes = Object.fromEntries(
      GENERATED_SKILL_FACTORIES.map(([dirName, createTemplate]) => [
        dirName,
        hash(generateSkillContent(createTemplate(), 'PARITY-BASELINE')),
      ])
    );    expect(actualHashes).toEqual(EXPECTED_GENERATED_SKILL_CONTENT_HASHES);
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
