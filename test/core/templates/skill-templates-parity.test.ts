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
  getExploreSkillTemplate: 'ff27df8c4c11daa9cbb854e565eccf10df3e3061ffcb50a3e727c37fdf26db0d',
  getNewChangeSkillTemplate: '9c25db83333a43d53ba5e1c68aa69d55a3511f2548c5031b583d31ae64e22bd4',
  getContinueChangeSkillTemplate: '61e40865137de34378d1cad387851a8bbdb9b05ba28196fcc0dba093aa68ebde',
  getApplyChangeSkillTemplate: '2adc16a01dcbfef23e21e014fd113e70b181c683201c7c20af4b707de3b9714b',
  getSyncSpecsSkillTemplate: 'c6aa26de4276c6bbe4d86b0464693d2c73875a64ce475f98aab0c121e85c5fae',
  getOnboardSkillTemplate: 'bfae55562317c5a2de2c59cd02e24a08b6411b9c23d7b93e33ea6cf82dd2039a',
  getArchiveChangeSkillTemplate: '812000159ef2e87a13043476606f5bd06a33983858f3a97078b643ea09105794',
  getBulkArchiveChangeSkillTemplate: '11d6c8161d12d4231c0a6bb9c4b0bb22038fb7b1d9e270f74bbba26c16f2e73d',
  getVerifyChangeSkillTemplate: '6dc62f1c570622fa4fef76075c455bc1564a266828bcd8f367eb22bc7bad622b',
  getOpsxProposeSkillTemplate: 'da50937f5938a51de133c424cc623cd4da079df116c209d8291f4b8b5f99a40e',
  getFeedbackSkillTemplate: '6bfb7caffad631f807678c2b5d194fb0eb2ed0bc4cbb4bf432b5a3c160c6cc87',
  // Workflow/orchestration templates (workflow-template-parity)
  getOfficeHoursCommandSkillTemplate: 'e293aa3b1c092b83216b6008d0141fcd6ac74c526cabf8c393ad499ffddfdcb2',
  getVerifyEnhancedSkillTemplate: '2cb6b777ff55582191608d0fc77c3d92fc4c2d26c47f5308c6fd4577979945e1',
  getShipCommandSkillTemplate: 'c18415efe4442403ed9fd4201785e56249aa32c762df3744dfbf5d7d7d366d53',
  getRetainCommandSkillTemplate: '7d393153b2598fa1cafe00215f496892f01bc9ccfa757ffeaa913b77aef2ceae',
  getRetroCommandSkillTemplate: '64725c0d0c2d5ee285de0186c62e9bb9cfc6b2ddc95eabd408e089ff1d00c6db',
  getAutoCommandSkillTemplate: '6af8b8654556d0e0294d73c5d7fe14dfc5a08607452c1f2dbb22ae557067dfea',
  getReviewCycleSkillTemplate: '0308bda928bfb8d935182fbc78d0e360f7f2ca27dae1d66466e393a9908042db',
  getHandoffSkillTemplate: '6db0d1330fd5deba4a3999898a7933c39ecb93353bfcf428375422257855438b',
  getGoalPlanSkillTemplate: 'cce12d9c86ff6a10579ce2ce65c734e168b1de411525dbb568db8f51e6c9112a',
  getGoalIterateSkillTemplate: '7e3f4828bbc57e2a5fd9f223f7a86644765a24777f572733a6606ffa54520a8c',
  getGoalReportSkillTemplate: '802fc6970447f1ab5e98b76795c64433db45c03944767237fdbe534262ad6099',
  getGoalCommandSkillTemplate: '3fc5219c7887f7ff933696584bb755af31f3a71ac461ff110b96e9146b23047e',
  getHelpSkillTemplate: '85f8fd52aeb508a7c7716c4dffe2d76adfc7f68a31c2f05a426336c371c77949',
  getDirectionSkillTemplate: '4c3c0bc2629fc239b7da4ed96c1d72a6fdb654f0cf222ced208c1410f3e5ff7d',
  // Expert skill templates (inlined; see expert-template-inlining)
  getBenchmarkSkillTemplate: '279583dbf8ca3180d33ce15984126d952263e2c47a839804acfd299ee0f15279',
  getCarefulSkillTemplate: '17e95aa30ba86d858c4b2169bde0a7e5b990cb8e2606e37ce184f29747751f98',
  getChromeUseSkillTemplate: '38e95c350fc395e3f1c950a8bdd925e31d0295e1bab28e006dac52ba17b9f9b6',
  getCodebaseDesignSkillTemplate: 'a9b0f8a7bcb569627e00b4f511f6e5340a3ba03ad6ca985ae30aafe670e0c85e',
  getCodexSkillTemplate: 'f2b4cea97f371a734d41bed810aa354919a05260d8d0e0fa8f589b35b4cf12b2',
  getCsoSkillTemplate: 'faaa7dd29a3eac4f08b5c84e265860fac422baf83b2a306eaa08ed1a260f8afe',
  getDesignConsultationSkillTemplate: '94c333b3b54b4385338b9afa8e8894d20aa50debe205ff6a6ee581f9997816ea',
  getDesignReviewSkillTemplate: 'ab63b369b95fe592a32e2a78a02e204a34b4f0d0f21938430f5823a11079abfa',
  getInvestigateSkillTemplate: '23719e8af116f5d6a8df31a8e7506443f6b28cc85d8667675a0b95f7d11d63b1',
  getNavigatorSkillTemplate: 'b823770f2c88099cb4c0588e4d964f448982310fe40ee05ba94011c3e029ff06',
  getOfficeHoursSkillTemplate: '8dfc3b232a38a8dfc0d113811b06a428276f19d0373845a882e95c2409a905d4',
  getPrototypeSkillTemplate: '5108291474a29eeccde1ad6b3ed0546beea336a7d54c2e0a8e0341800d072fe4',
  getQaSkillTemplate: '72ee393107c56d26d9f004eb0db8395054283a0ffa443484c49834bd8ebf22c7',
  getQaOnlySkillTemplate: '53ced627195beb49f1410323db83a3436d3fe77745dc1180eab132565fee1418',
  getReviewSkillTemplate: 'ee5dfb25856b2ddfc7c248f546d4759e2bcf0cf87e21444c8c576b62cabbee3f',
  getTddSkillTemplate: '114fc2bf0343ef0cf3474dfb1127704a280bef37b28bc648796d8f9c6572bb25',
  getWorkflowAuthorSkillTemplate: '2f9e6e399502f19fbd0f1c783db01164329d0324176fa9897225eaeca9417669',
  getWorkflowReviewSkillTemplate: 'e8fb61a48b65010482cfc2b5df45f6dca413220b0682e181c671401817344c94',
};

const EXPECTED_GENERATED_SKILL_CONTENT_HASHES: Record<string, string> = {
  'rasen-explore': 'd3de30d35a508a2fc4bc1518077e79772f624205c6fde15419a231639fb815ea',
  'rasen-new-change': '49bfac8ab2b426bed7fae5af39692dcc9a08a0739c05db5cf9c501cbb5b1472c',
  'rasen-continue-change': '29563d734c41e5416f9cc6d59e59162ff29c77bef207c69cfca41dfe4079e1b6',
  'rasen-apply-change': '8f91a66afc386056d7b4571e9355ba656a9d8ec035f2fb1348f51961eb67ae4a',
  'rasen-sync-specs': 'ca33058e2808aa1f4bc6a849d7d7a151b21be50e6d9220259b2e469d0642a1f4',
  'rasen-archive-change': '1b48b7479b6dd8593f63f4be90e72f094070ee27d9fe16b2948ec1733754944e',
  'rasen-bulk-archive-change': 'ef70cb1afc262c287f9cec9bd6f84b50d0ac0d3522da09e1b3f236cf866a1b7e',
  'rasen-verify-change': 'c9fc8b1acd70bfbbd679a956f712c97e12eddf253ea640647b4ea81a4b77ab20',
  'rasen-onboard': 'b37aec13d6247ca514b28c98c823374907eb70246436ae8f0bbede1d0acdb57b',
  'rasen-propose': 'a12e25f07049c70e4049e5c60a339435c9da27af3c2d283e5edfe13e627aff50',
  // Workflow/orchestration templates (workflow-template-parity)
  'rasen-office-hours-command': '4a8de582e5ad7fde1057150e0d9d557d0a777fd4aac50183572d1b9460079096',
  'rasen-verify-enhanced': 'a1de34dd62d9ef54e76b676017480dc4ec4e6424d0fcce2fb201f89edaf9606c',
  'rasen-ship': 'a6fcab24bdaacf1db616264b2c5d32bf70bf9cb9937b61f9af986bbfdea85fb7',
  'rasen-retain': 'cf304454fd0b43f6d7d07b9d25d95225d306bef30e5281bc2737cb106b0498ee',
  'rasen-retro': 'af377d3849b0cbd34d1362044cc1be6f440a4fb93a3c1001dd5d64e7a58da008',
  'rasen-auto': '27774ec535bed5f593120c3c5eb33de6592259d7d45486766fecc3e38003911e',
  'rasen-review-cycle': 'b28b868f3d60e8d40104adadae1749b770f360c332320a53aaf690db2b98190b',
  'rasen-handoff': '8330b43ad8d382178258bafa5fd8ffb675af6019f09d08551daa9f5d71e76f02',
  'rasen-goal-plan': '651638edafced47ecba39a0c3c7715d0f5cc362680762627e333f441b53ec24a',
  'rasen-goal-iterate': '19f5e3992de78900dd182a45331c87e572f3c316907bea3397018ef3d09cd680',
  'rasen-goal-report': '5ed2aa34cd7f2c2d879974b8ad96e8fcff48765413b87f6837f70fcab0e13b44',
  'rasen-goal': 'de2c6634441c05e2b44b0380854e99c7f69af1f371adf5afe0e16b8c8e5b8de7',
  'rasen-help': '08a9843859943e3c6ced3408c638b178c3eb29b51c26827692e815c98e914815',
  'rasen-direction': '1a7c35be672134e32fe477fbc5af73083c07dda13b47e0978966205ac8115d6a',
  // Expert skills (inlined; see expert-template-inlining)
  'rasen-benchmark': '637a424623ed5057b7cf01465a557c8a570b41145af315ca905c2d0aa5f79ff5',
  'rasen-careful': 'a2c90892b29ee3eb1cb6afd1a3f5a52ec5247d3e25d4cd3c73346a743c000544',
  'rasen-chrome-use': '1fd10099ef50d757c333d902ba6d5e5d75a20e3a18eff2305bb35f1e9f84a2ef',
  'rasen-codebase-design': '7d0df665b8ff31327a37e761eeca1c3b2074800d51d06f9f12d7ab11d13d3f55',
  'rasen-codex': '93b61761cb2d83f510debf420a30d6d57c52ba152ef083544304c941625e90a1',
  'rasen-cso': '272ed00d49071dfad734084f1a823db5ecba2355b2ab86ae3701299b9e313187',
  'rasen-design-consultation': '633a1a0339c5aed9329b1344a797cac690352f899168246e0639e089e6b1042c',
  'rasen-design-review': 'd239ec5ab95e8e9ee5fa55f00ef3f3d68a28df65f07941cb3a38d707b31330a8',
  'rasen-investigate': 'bfc1146f3e0b8a3ce581d41a0e63566629b7ade1b3ecfc9eb210d2d316b40b2c',
  'rasen-navigator': '36653a56dbcef91ba871ecbfb0675ffe6cf60f63371c85cad30ff9346513ac8f',
  'rasen-office-hours': '7f28f3497a77850ffe71dcdb53c6077009658cbd0a9d4dd4af509f52f18de6d0',
  'rasen-prototype': '6429de484a9fd95a44ceee46edcf75eec878070348fc5539f0aded65d3781cc7',
  'rasen-qa': '2a1d1449712dae0c232ee09e3304993fc986baabcccc9b53b67daed7c1930718',
  'rasen-qa-only': 'f918d5397096e5b8d99390046156c81c370e9bd57e73a0e45727e796a1722f9f',
  'rasen-review': '5c2daf75effc442ab3b18c64404d1fbb0cb86fe876119b07d14d33dc5e7bbdae',
  'rasen-tdd': '182e4663b7d128864d42cfbda3060438353ab20db7266b1c4827e6ff7618f28d',
  'rasen-workflow-author': 'e5a3af7f6ba4cefb20cb2c2bcbcaf4d9e7570dd0b0dbb5c76f38cc2ce0b9c4df',
  'rasen-workflow-review': 'fd756310a7fe5c550fdb798c9389208a3db0c7a4110b81feb54dcfca28f7e236',
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
