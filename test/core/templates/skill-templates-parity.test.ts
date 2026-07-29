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
  getAutoCommandSkillTemplate: 'f7df540117aad7c8a3f4263281e60368f0af4ba583479d7f77377ebd22a38c79',
  getReviewCycleSkillTemplate: '7851f33086adae9cda7ec4d31bd7bf1e458144e37148384783912733185806a2',
  getHandoffSkillTemplate: '3df37fa1573c2d0e081caafee9b6660b2cf132258684f3dbb7d03f84f6b96302',
  getGoalPlanSkillTemplate: 'a208b3e314b42d24c3c2ee29942447f8dce980ccf5c1639c41d02f7ffed11246',
  getGoalIterateSkillTemplate: 'cdb8642cea83540c267e6ec7163678c410902c633bad1a6278c82e3ac9fdc933',
  getGoalReportSkillTemplate: '1ae653c5e7202ce8409af1396e8a7ea062576c373e5a28e49cb39d171f2175d2',
  getGoalCommandSkillTemplate: '8526e1ce67580236b2e93da3f188e9890a8157f26d130b5f6561cde7108069b7',
  getHelpSkillTemplate: '5687c5f8f751747c904a72bb634d9243abb56846cf7e55dc7e0a61c55a57a29d',
  getDirectionSkillTemplate: '2a832922740ad3051eeb5a3787b8df64a4fc61169ed4374acd2c2f306c1a2e38',
  // Expert skill templates (inlined; see expert-template-inlining)
  getBenchmarkSkillTemplate: '7d50d20c3aef688d3533d703ea68a64733a22f9b8fac4d680e8a37ad925e7e59',
  getCarefulSkillTemplate: '6e927feb4276cfa95e51d0717c62715623c411810d59960ec39579fa052834f0',
  getChromeUseSkillTemplate: '3d595ad2ca53e7a42c0e8fa1225d878a9f68940f22f6089e54cf7e803fd9b0ce',
  getCodebaseDesignSkillTemplate: '4fbc663f4a3b4c15b5f947673c057731a4f1f965816655f3397bde56277879a6',
  getCodexSkillTemplate: '0d9f84a14d54b08a30fbb5406d51f6d97fd38dd63662ab3069c73361f84f4ad2',
  getCsoSkillTemplate: '27fe05f8038c25e82bcb7cef707a87a37640219e6107b9e29df89bccfc92fcad',
  getDesignConsultationSkillTemplate: '514e717800d10a0b6c21af2c71c2cca0064f017ceeb1abd3104a0bfe0d5d26b5',
  getDesignReviewSkillTemplate: 'a0778fbea260713ac2079a18320071d4dd656a9b313dd30864783dff9a007c46',
  getInvestigateSkillTemplate: 'eceb9305c699173c5b80afb04e2c08c946ef1782b382cdebf10263cf4b8e6fc6',
  getNavigatorSkillTemplate: 'cd63ad9372a09aecd8934ed4c42c3a8b4bedaf0647bddd748d99f20c3059546f',
  getOfficeHoursSkillTemplate: '1d9e60c842cf2657303d2791f30f33dc89b273f791116cb72124eec08c481a60',
  getPrototypeSkillTemplate: '5bf6956d75dfc78a3d6fafb09aab97db1e4d945a2f51f9538c27f40511b64451',
  getQaSkillTemplate: 'd2f33b51769e19a28f16139119592be9633e8f669c34524ba3f53ef8b96e8f35',
  getQaOnlySkillTemplate: 'b510f65d00e7c2ad81467d9bdd9c73e014e1edb792285a626c1ceb19624e924d',
  getReviewSkillTemplate: '81621682f13f81bfbf93cf5fa3a0b32db52af603ca18ee0d8acaac27e4a46d4f',
  getTddSkillTemplate: 'fd7cb886b8752fbea7d3d3dd69fc22682edf69d062ade85d4ed1711d989fc25d',
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
  'rasen-auto': '936f86e184d3597e25febb0bd18bfda2603860e1d511621e250f949ce7c51d67',
  'rasen-review-cycle': '4a2b2401abad081e6fe3464055007f3870e2a07a0bf05983ac64a8855a505266',
  'rasen-handoff': '6d26aa07e2602dca0531b5167fd330561b4aaab82b811abe076217dd190c2302',
  'rasen-goal-plan': '44e93a0c8c739c8a69f729540789a9fdfbbdd5b0760d11ff3b87ab0b2f3293d9',
  'rasen-goal-iterate': '683358c6c61b6307e52cde1d7ecd45a89784d067999c4a788707d66c5fdac654',
  'rasen-goal-report': 'b4a03f4240078b0f77079d0b77be98e83e4440f0498005a714bb915251cb0e47',
  'rasen-goal': '41b9092acc248d03e428dfe7b73dcba4ffcae28dc84b54909c0075730a55fae0',
  'rasen-help': '89567c931c01472b83ec72e0040db6be5cabfc5979a800af53d9259cc351a4bc',
  'rasen-direction': 'd82020fddf7d8cf4d6e8baeb4f83de442218b98c72138a8527319758c816a93f',
  // Expert skills (inlined; see expert-template-inlining)
  'rasen-benchmark': '2992c5bff6fcc253fefe11d93115aba3e4be0cb70db5873d9f2c99fd65d83d62',
  'rasen-careful': '7c5ce19b2e3b4a2329d45f5a1ec55d92959b393d6663fcc5d0e511585b688dbf',
  'rasen-chrome-use': 'fc51cedf41327c5593ef1234dc4f8b17ec20f290d0578930cffaa500d98821d8',
  'rasen-codebase-design': '6e856af70ad26a7d2194bba2e04e5270c90627e50323934cf247c1e58db56946',
  'rasen-codex': '854a8de0e25261a7fda51bdc5431d42670f0b53abc62bc5a95a0c621dfda0078',
  'rasen-cso': 'ea0edd9b131f97470d74296f9d3ba74a6ec9457015b7cd84b2f9261ad27a9db6',
  'rasen-design-consultation': 'aa4b3715f669b077eac4b06691e4dce3b48d8b499b073b96611793180dbe9570',
  'rasen-design-review': '7ca3aec260fc41f3bd22e3f9f3f9c9820e4d9f516675f54363b7e3ab9c970e00',
  'rasen-investigate': '70fc46d2d3cfdb2db44296ed2307a30cf391f3ba34db73e0baf084d4ae6de432',
  'rasen-navigator': '4cfb814c2021537e85a4f78292ec15773760ec7d527b3a8805a25af0f718d733',
  'rasen-office-hours': '835234393006bfaaa469551815d302d3e8771fb95bbb71430298b15a6237e07c',
  'rasen-prototype': '43d79082e705ab15356c870e4eb7e000f587650be5c8411bd3b3c091f996a2d0',
  'rasen-qa': '8a771f3291136b43401139c60f7efd1f9b3b0207282eb8d16f656c16631ebd9d',
  'rasen-qa-only': '436d6b200bf90c49ac14232433720123ffc348cd870d0226226bfe3fd8dea926',
  'rasen-review': '12a302dcf07a59942567f4d847926e17da70c2445ba3751371b6a6154946f0ac',
  'rasen-tdd': '75aec30c2b80857c124634d08e3cc9729dca3acba4039c34efe91a4c1464080c',
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
