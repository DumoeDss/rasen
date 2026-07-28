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
  getWorkflowAuthorSkillTemplate,
  getWorkflowReviewSkillTemplate,
} from '../../../src/core/templates/skill-templates.js';
import {
  generateSkillContent,
  getSkillTemplates,
} from '../../../src/core/shared/skill-generation.js';
import { STORE_SELECTION_GUIDANCE } from '../../../src/core/templates/workflows/store-selection.js';

const EXPECTED_FUNCTION_HASHES: Record<string, string> = {
  getExploreSkillTemplate: 'cd8bb43cbee675a7567d951ea9db247ed652feb819848c73be52e4493fcf916b',
  getNewChangeSkillTemplate: 'd9cab370475fbf46ab3e5ca55e06995f8acfa9726a72cab871f2965317838a9c',
  getContinueChangeSkillTemplate: '7bc2fd2566b65a3991eefd7088ed6f201bfdd1c12568af8fe6353a78b9b7a52b',
  getApplyChangeSkillTemplate: '5f4f0eea10222457d26492ae98de05a7239412a5aaddafce2858b21257c9da18',
  getSyncSpecsSkillTemplate: '03543b5bb32ff9e73083cb502fca2426a6ba51a9b13aef24e20830d458578ee4',
  getOnboardSkillTemplate: 'cd694869504851be41187a1d015d55286a4c441b45184d556182a8db6d125a83',
  getArchiveChangeSkillTemplate: '48aefe92df9f6f2077ffacb8efd6251d79ca95f1dd9e2b21eeb9a3e27d5a0fe5',
  getBulkArchiveChangeSkillTemplate: '691ea9c3f6bbe9fa2a033484f99c3a6a6aa69958083321749e861859177d99c7',
  getVerifyChangeSkillTemplate: 'c44b202d0e71f7a36172c2d140de4fdec94ea63162e60fee17a696342881962c',
  getOpsxProposeSkillTemplate: '1c7bc9953f7a468fbc6c3df7cddbd7492ee51b426a5f0a7513ae2a260faa762e',
  getFeedbackSkillTemplate: '6bfb7caffad631f807678c2b5d194fb0eb2ed0bc4cbb4bf432b5a3c160c6cc87',
  // Workflow/orchestration templates (workflow-template-parity)
  getOfficeHoursCommandSkillTemplate: 'e1b5bd987dcad2cc977971e13b8e2f40f79b63a6f430845b285b29f912ff78d4',
  getVerifyEnhancedSkillTemplate: '2da07560ad97481f75bcfe5f39c69c0d26cf86367aa09f750e7a9fa35f52504c',
  getShipCommandSkillTemplate: '15848bb4862cf9ca78099d26921651f6fa4b744992d7b227ddccd646266f0dec',
  getRetainCommandSkillTemplate: 'e668aba497c3ffc48aa4c8cde70bbe089bcf69b4a1e89704871ed704679fc62e',
  getRetroCommandSkillTemplate: '64725c0d0c2d5ee285de0186c62e9bb9cfc6b2ddc95eabd408e089ff1d00c6db',
  getAutoCommandSkillTemplate: 'fc7c6a48d97b4fbe1b86494d9dfd6be68f39f5ba9a77e84b83c39e3ef6097614',
  getReviewCycleSkillTemplate: '158eb56e2256554e577bec1e888b1c45b2b5dfebe825671dcf4738900dbf93e5',
  getHandoffSkillTemplate: '3df37fa1573c2d0e081caafee9b6660b2cf132258684f3dbb7d03f84f6b96302',
  getGoalPlanSkillTemplate: 'a208b3e314b42d24c3c2ee29942447f8dce980ccf5c1639c41d02f7ffed11246',
  getGoalIterateSkillTemplate: 'd2c7b8a47e44bde046624a931d4bd157e0461380d8ad72c7161a04d256397a5b',
  getGoalReportSkillTemplate: 'f917b0c4a1a22a2a77e41288023a79bd5acac2103d70cb36e470637d1108ec9c',
  getGoalCommandSkillTemplate: '053408eccd34c4e2cc8a25fd2df7adac1909962baa1aa6792744b57cdb7e988c',
  getHelpSkillTemplate: '5687c5f8f751747c904a72bb634d9243abb56846cf7e55dc7e0a61c55a57a29d',
  getDirectionSkillTemplate: '2a832922740ad3051eeb5a3787b8df64a4fc61169ed4374acd2c2f306c1a2e38',
  // Expert skill templates (inlined; see expert-template-inlining)
  getBenchmarkSkillTemplate: 'ea8429378a87181d0efa44456164efa8d875b9c4e33ae0d76861a71490be1871',
  getCarefulSkillTemplate: '6e927feb4276cfa95e51d0717c62715623c411810d59960ec39579fa052834f0',
  getChromeUseSkillTemplate: '3d595ad2ca53e7a42c0e8fa1225d878a9f68940f22f6089e54cf7e803fd9b0ce',
  getCodebaseDesignSkillTemplate: '4fbc663f4a3b4c15b5f947673c057731a4f1f965816655f3397bde56277879a6',
  getCodexSkillTemplate: 'bb56a29bf6a2418c0f50be3d67a38f65ecf92951a70877ae7350e0931584fcf5',
  getCsoSkillTemplate: 'ccd8e7152d5b67ab0410dcaab434cdf7a3dc373b6459ae791f82eea2d2337bb9',
  getDesignConsultationSkillTemplate: '514e717800d10a0b6c21af2c71c2cca0064f017ceeb1abd3104a0bfe0d5d26b5',
  getDesignReviewSkillTemplate: 'd1316e8407fc988d505b1c9c04901d8b2c7be56e7089377e549bf99ab65a222a',
  getFreezeSkillTemplate: '4a777459531246084836b729875dae3f802f6280e6aafd4b30f735692d744dad',
  getGuardSkillTemplate: '2874b7aa8fd44a84a35b4b8c41a404cb3d46de2120a35c6368a2aed6e90872a9',
  getInvestigateSkillTemplate: 'dcc6e19176719a6b022badaa2f3c0467c07761aafd492b8e020cb70d843ff9d8',
  getNavigatorSkillTemplate: '40efee6adbde473c3a2c8a81e07163cb6a0393072cee19f7051ed6318ea73e98',
  getOfficeHoursSkillTemplate: '1d9e60c842cf2657303d2791f30f33dc89b273f791116cb72124eec08c481a60',
  getPrototypeSkillTemplate: '5bf6956d75dfc78a3d6fafb09aab97db1e4d945a2f51f9538c27f40511b64451',
  getQaSkillTemplate: '67ee1fead2d1f87a5031e0ed56e3b34fb39a1c3afbb11d51c2e562216926b145',
  getQaOnlySkillTemplate: '6eff9a3cd789f4da8849fcfd428b897b54cf8bfa7417f69c9a85cf8cb1d89b49',
  getReviewSkillTemplate: '9c432692e8be73d5e6954268260e6022cbf101590979a3848e1f57f8edd6411a',
  getTddSkillTemplate: 'fd7cb886b8752fbea7d3d3dd69fc22682edf69d062ade85d4ed1711d989fc25d',
  getUnfreezeSkillTemplate: '8d20a701598c07ad4fe48d76e8ff2852f650e5e29978f6e9991f5d17b4d6f985',
  getWorkflowAuthorSkillTemplate: '7867ae22bae784211cff291162c19be04b683bb973c78974473df20b1946bdd2',
  getWorkflowReviewSkillTemplate: 'c85b0d5326ae730905e232d710738d8c63864704d162d0e471d92289caff7c7c',
};

const EXPECTED_GENERATED_SKILL_CONTENT_HASHES: Record<string, string> = {
  'rasen-explore': 'bebc0b25f2a023d5433d277ad7f23f14034c0c6cf82c112eb08d0f51f82c6305',
  'rasen-new-change': 'c98e88eb3c2e589b5e68c7d7223b269cbbc5b60a9ae6d97986de9aed461ce197',
  'rasen-continue-change': '292d9f607c39f821e8fe020a0df252a8b1deebde8951560d74d736840c29f132',
  'rasen-apply-change': '5f3cdecfd8307ecb52648d41949b01fa49661de5767ba8ef849028c17e8618a7',
  'rasen-sync-specs': '4f3d5b0f97366a18fb8da009987c2a2561b3ebfc49d4d34c1685dd4c340e33d6',
  'rasen-archive-change': '8eae2d42dd6372238ebdd6dd63c883cb45add074bb0681e7a8cef1c27f718fbe',
  'rasen-bulk-archive-change': '546f2e7f67768517a220b55c8a87ded2a304ec1d2ffc0dca630271911834f0f6',
  'rasen-verify-change': 'f1c6e60c0a71a8ada4fb77591058ee065850fbde73109adbf10cfda3a5f68931',
  'rasen-onboard': '899eb154cf8ddbaf1b4d57e02c2d241aeb142dc84b6b92f8dcf2220bd082c47d',
  'rasen-propose': 'a1f85a38c2a8dc1596591015aa41682d02df4b1295762d3e771833d744c4b880',
  // Workflow/orchestration templates (workflow-template-parity)
  'rasen-office-hours-command': 'e2987933356d0ea9e25e0815d9859a34c271aa0a3cf4c99834e042accacf832c',
  'rasen-verify-enhanced': 'b068d77be2ea37de11baad96faa6145062d80d50f0a251e797c8aa9d493e4758',
  'rasen-ship': '093a33f9a81c9bf7105dec8dc674a9314e1aecfb5cc478348b2f8c9e4276b473',
  'rasen-retain': 'b5d3118c0542dd22fe8a9bcdcdeb8c96405978cfb97a5f1827c279ab546ee9a8',
  'rasen-retro': 'af377d3849b0cbd34d1362044cc1be6f440a4fb93a3c1001dd5d64e7a58da008',
  'rasen-auto': '551d1c814f900a1a27d888e25a41686fcf292f7abc26f83125e506ef6654f9b1',
  'rasen-review-cycle': 'd1f49918c9aa42637c63455aa01eb2755bc97e2ea284d48487744cddb00cf3eb',
  'rasen-handoff': '6d26aa07e2602dca0531b5167fd330561b4aaab82b811abe076217dd190c2302',
  'rasen-goal-plan': '44e93a0c8c739c8a69f729540789a9fdfbbdd5b0760d11ff3b87ab0b2f3293d9',
  'rasen-goal-iterate': 'f5c20e753491df6cb6c862ecfb20e9e17c2dc28b2b6073ab14e4be95c3de6a35',
  'rasen-goal-report': '6bfdf710519fa339e6bcf5d03509a3e6f1a6cfdef4f5962e10c8603fe95a5a04',
  'rasen-goal': '80c635a56a52dbdc131c47a8a1f4bc602b8d27539ba6580fe9dc62a1cf55c8c7',
  'rasen-help': '89567c931c01472b83ec72e0040db6be5cabfc5979a800af53d9259cc351a4bc',
  'rasen-direction': 'd82020fddf7d8cf4d6e8baeb4f83de442218b98c72138a8527319758c816a93f',
  // Expert skills (inlined; see expert-template-inlining)
  'rasen-benchmark': '516257d2363aaa8bfaf0d214a1b227774c25c62bbd50695bd14d0b5847c91fd8',
  'rasen-careful': '7c5ce19b2e3b4a2329d45f5a1ec55d92959b393d6663fcc5d0e511585b688dbf',
  'rasen-chrome-use': 'fc51cedf41327c5593ef1234dc4f8b17ec20f290d0578930cffaa500d98821d8',
  'rasen-codebase-design': '6e856af70ad26a7d2194bba2e04e5270c90627e50323934cf247c1e58db56946',
  'rasen-codex': '78c56beec0f60927a6ae5cd73bef41e51e0400b41c7f7af1ac6e0e6f3840102c',
  'rasen-cso': '984af5e8b79f087caf33863a3721243865a2bb67e7dcd5942e8b579982a4fd3b',
  'rasen-design-consultation': 'aa4b3715f669b077eac4b06691e4dce3b48d8b499b073b96611793180dbe9570',
  'rasen-design-review': '3f4793102f4340e2358c284dfaded343743aeeac364543728c6267561a522759',
  'rasen-freeze': '8e35e3b815eb37cefb3b9e90eb9fac052ac7c3e971d4e3991374161e78e05306',
  'rasen-guard': '6d469bba60a744f1c855eaea87fddc9ef9309b3a6936cf5932c32b61fbbd8ee9',
  'rasen-investigate': 'ccf4dd64a62ecb77c931b4f07795876df807aa9af2d254622b644d287eddcb43',
  'rasen-navigator': 'e2ad4b7fcc58969c90859435a3345d601e1497661bb0edd61c03f305d2ef71f7',
  'rasen-office-hours': '835234393006bfaaa469551815d302d3e8771fb95bbb71430298b15a6237e07c',
  'rasen-prototype': '43d79082e705ab15356c870e4eb7e000f587650be5c8411bd3b3c091f996a2d0',
  'rasen-qa': '90eb45e77a3877aa98aa94c11d936224329b7dbdd4685eda4a89e1708bc193db',
  'rasen-qa-only': 'de199b49d1ed1daf529adabf679eca14214694e40cac28a303b8bd45516d11be',
  'rasen-review': '1b6dc5b67c21bac6589352be1bb70b08da18b14712a89f375fa118a2c2108310',
  'rasen-tdd': '75aec30c2b80857c124634d08e3cc9729dca3acba4039c34efe91a4c1464080c',
  'rasen-unfreeze': 'f7d99aaeb967e4bb75f56304a87a2a41d9a81c673d41eb443478c09039650438',
  'rasen-workflow-author': 'c08ee1ec021f7cff272990986357947e374d5a54ba9f029e0c63af823769969a',
  'rasen-workflow-review': '3057019f8a116af86fd8b89ffd0e4e07e4b11ff556e029e8184a30d192693791',
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
