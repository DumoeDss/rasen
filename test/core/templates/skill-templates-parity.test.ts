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
  getCodexSkillTemplate,
  getCsoSkillTemplate,
  getDesignConsultationSkillTemplate,
  getDesignReviewSkillTemplate,
  getInvestigateSkillTemplate,
  getOfficeHoursSkillTemplate,
  getQaSkillTemplate,
  getReviewSkillTemplate,
  getWorkflowAuthorSkillTemplate,
} from '../../../src/core/templates/skill-templates.js';
import {
  generateSkillContent,
  getSkillTemplates,
} from '../../../src/core/shared/skill-generation.js';
import { STORE_SELECTION_GUIDANCE } from '../../../src/core/templates/workflows/store-selection.js';

const EXPECTED_FUNCTION_HASHES: Record<string, string> = {
  getExploreSkillTemplate: '5734712e3b0735d7c5219a1d6f9a2ed89491f0f5f9a580c07d990ee32c95b5ae',
  getNewChangeSkillTemplate: 'd9cab370475fbf46ab3e5ca55e06995f8acfa9726a72cab871f2965317838a9c',
  getContinueChangeSkillTemplate: '7bc2fd2566b65a3991eefd7088ed6f201bfdd1c12568af8fe6353a78b9b7a52b',
  getApplyChangeSkillTemplate: 'e9a92f05ca22a60e47d144794b6fcca36223636513e3158a97c20a9cb08718d4',
  getSyncSpecsSkillTemplate: '03543b5bb32ff9e73083cb502fca2426a6ba51a9b13aef24e20830d458578ee4',
  getOnboardSkillTemplate: 'cd694869504851be41187a1d015d55286a4c441b45184d556182a8db6d125a83',
  getArchiveChangeSkillTemplate: '48aefe92df9f6f2077ffacb8efd6251d79ca95f1dd9e2b21eeb9a3e27d5a0fe5',
  getBulkArchiveChangeSkillTemplate: '691ea9c3f6bbe9fa2a033484f99c3a6a6aa69958083321749e861859177d99c7',
  getVerifyChangeSkillTemplate: 'c44b202d0e71f7a36172c2d140de4fdec94ea63162e60fee17a696342881962c',
  getOpsxProposeSkillTemplate: '7082ddbb40dedc2bae75f46909a9453004a0972a8f8211df307150f98f77b584',
  getFeedbackSkillTemplate: '6bfb7caffad631f807678c2b5d194fb0eb2ed0bc4cbb4bf432b5a3c160c6cc87',
  // Workflow/orchestration templates (workflow-template-parity)
  getOfficeHoursCommandSkillTemplate: 'e1b5bd987dcad2cc977971e13b8e2f40f79b63a6f430845b285b29f912ff78d4',
  getVerifyEnhancedSkillTemplate: 'c888312a0fb04f6b5d582a7c68fc02eb02a3272babcb080ac1930433aef1defe',
  getShipCommandSkillTemplate: '15848bb4862cf9ca78099d26921651f6fa4b744992d7b227ddccd646266f0dec',
  getRetainCommandSkillTemplate: 'e668aba497c3ffc48aa4c8cde70bbe089bcf69b4a1e89704871ed704679fc62e',
  getRetroCommandSkillTemplate: '64725c0d0c2d5ee285de0186c62e9bb9cfc6b2ddc95eabd408e089ff1d00c6db',
  getAutoCommandSkillTemplate: 'ec64b0dbbb3bcb3e53e2537627dfc55ed7b6dadd8ec9241184c2e298d6159263',
  getReviewCycleSkillTemplate: '0ae73ab41b873cbb96e56ee4d2bf1638662ca87381c2496020dab0011b559d3a',
  getHandoffSkillTemplate: '3df37fa1573c2d0e081caafee9b6660b2cf132258684f3dbb7d03f84f6b96302',
  getGoalPlanSkillTemplate: 'a208b3e314b42d24c3c2ee29942447f8dce980ccf5c1639c41d02f7ffed11246',
  getGoalIterateSkillTemplate: 'cdb8642cea83540c267e6ec7163678c410902c633bad1a6278c82e3ac9fdc933',
  getGoalReportSkillTemplate: '1ae653c5e7202ce8409af1396e8a7ea062576c373e5a28e49cb39d171f2175d2',
  getGoalCommandSkillTemplate: '8526e1ce67580236b2e93da3f188e9890a8157f26d130b5f6561cde7108069b7',
  getHelpSkillTemplate: 'f89b56c1c7d8572dee20f54d28089f8db0590bd667035cae6134fb21b50c0966',
  getDirectionSkillTemplate: '2a832922740ad3051eeb5a3787b8df64a4fc61169ed4374acd2c2f306c1a2e38',
  // Expert skill templates (inlined; see expert-template-inlining)
  getBenchmarkSkillTemplate: '68a5d6f9188ec9198c80208b7f4fa0557ff7064e244793fcf5fdab135927620e',
  getCarefulSkillTemplate: '6e927feb4276cfa95e51d0717c62715623c411810d59960ec39579fa052834f0',
  getChromeUseSkillTemplate: '3d595ad2ca53e7a42c0e8fa1225d878a9f68940f22f6089e54cf7e803fd9b0ce',
  getCodexSkillTemplate: 'e35ea78d6a2f7eacc04af94082f884d698e30f5c52310ff0563b6eceef53c694',
  getCsoSkillTemplate: 'b5d859a071979e4873442354c095f3c05fbdc0ca01a430fdad12440dcd7875cb',
  getDesignConsultationSkillTemplate: '514e717800d10a0b6c21af2c71c2cca0064f017ceeb1abd3104a0bfe0d5d26b5',
  getDesignReviewSkillTemplate: '4598926ea2f8efad92b7bf085b4c7d04e80a79915c2a3da34e3f1afc80c00605',
  getInvestigateSkillTemplate: '4b64a9219b94f4bfae96131e9b151189ebaca2c05cac7c14668c8fa777eb2ae3',
  getOfficeHoursSkillTemplate: '1d9e60c842cf2657303d2791f30f33dc89b273f791116cb72124eec08c481a60',
  getQaSkillTemplate: '8d1ceb88edd7230adcfc3b758861178b74bfefc1a30b76b98e7d5f7898d7f9bb',
  getReviewSkillTemplate: '9335996ec77328e5769c96078a06364a07a7ffb06a88c8ed3bf84e4058b1d108',
  getWorkflowAuthorSkillTemplate: 'f20cf7cf1399af1d521d3e70ec07983a84e1f96793349c466528f0451202f729',
};

const EXPECTED_GENERATED_SKILL_CONTENT_HASHES: Record<string, string> = {
  'rasen-explore': '7ddc8ba34407a79938647cebdcf32f74cb622da898d274c4ee8440bd6e5f3e8d',
  'rasen-new-change': 'c98e88eb3c2e589b5e68c7d7223b269cbbc5b60a9ae6d97986de9aed461ce197',
  'rasen-continue-change': '292d9f607c39f821e8fe020a0df252a8b1deebde8951560d74d736840c29f132',
  'rasen-apply-change': '8cee6d9278cb9bf03997e55639bf402d8cbb5aea3da337ce44b896920362d114',
  'rasen-sync-specs': '4f3d5b0f97366a18fb8da009987c2a2561b3ebfc49d4d34c1685dd4c340e33d6',
  'rasen-archive-change': '8eae2d42dd6372238ebdd6dd63c883cb45add074bb0681e7a8cef1c27f718fbe',
  'rasen-bulk-archive-change': '546f2e7f67768517a220b55c8a87ded2a304ec1d2ffc0dca630271911834f0f6',
  'rasen-verify-change': 'f1c6e60c0a71a8ada4fb77591058ee065850fbde73109adbf10cfda3a5f68931',
  'rasen-onboard': '899eb154cf8ddbaf1b4d57e02c2d241aeb142dc84b6b92f8dcf2220bd082c47d',
  'rasen-propose': '23b89da5cd53be819352fd06e440978ccae99339c2d013a1e20adb365af2e411',
  // Workflow/orchestration templates (workflow-template-parity)
  'rasen-office-hours-command': 'e2987933356d0ea9e25e0815d9859a34c271aa0a3cf4c99834e042accacf832c',
  'rasen-verify-enhanced': '9566101e31a0b68122f854808c743f88790fe83e855e91c1975b8f43659a8962',
  'rasen-ship': '093a33f9a81c9bf7105dec8dc674a9314e1aecfb5cc478348b2f8c9e4276b473',
  'rasen-retain': 'b5d3118c0542dd22fe8a9bcdcdeb8c96405978cfb97a5f1827c279ab546ee9a8',
  'rasen-retro': 'af377d3849b0cbd34d1362044cc1be6f440a4fb93a3c1001dd5d64e7a58da008',
  'rasen-auto': 'cae86480935c4357e66105fc3381ed691fec661dc50f77c41b34e00bbe6d7099',
  'rasen-review-cycle': '13d1a6431623b105e6b7d75a4195b6e7b6139068b8317717ff46490654f1c1ed',
  'rasen-handoff': '6d26aa07e2602dca0531b5167fd330561b4aaab82b811abe076217dd190c2302',
  'rasen-goal-plan': '44e93a0c8c739c8a69f729540789a9fdfbbdd5b0760d11ff3b87ab0b2f3293d9',
  'rasen-goal-iterate': '683358c6c61b6307e52cde1d7ecd45a89784d067999c4a788707d66c5fdac654',
  'rasen-goal-report': 'b4a03f4240078b0f77079d0b77be98e83e4440f0498005a714bb915251cb0e47',
  'rasen-goal': '41b9092acc248d03e428dfe7b73dcba4ffcae28dc84b54909c0075730a55fae0',
  'rasen-help': '085d6b7a024d2c552443b3143dbdbd5795bb14c37903032786142e7f00957de5',
  'rasen-direction': 'd82020fddf7d8cf4d6e8baeb4f83de442218b98c72138a8527319758c816a93f',
  // Expert skills (inlined; see expert-template-inlining)
  'rasen-benchmark': '2a7f7fcd1568cf16031bdaf7f62cc9caa493bd1faa1ce9ff83e061e54e4c2d0a',
  'rasen-careful': '7c5ce19b2e3b4a2329d45f5a1ec55d92959b393d6663fcc5d0e511585b688dbf',
  'rasen-chrome-use': 'fc51cedf41327c5593ef1234dc4f8b17ec20f290d0578930cffaa500d98821d8',
  'rasen-codex': '3b0966418b05777d7ea669a4ad6d6e4708646191f40bfb68144981d95bc9780a',
  'rasen-cso': '880f55a2a4e4e290bdb0db3547e4082bb6f2b5bb309f167f28d0fa44be0d9125',
  'rasen-design-consultation': 'aa4b3715f669b077eac4b06691e4dce3b48d8b499b073b96611793180dbe9570',
  'rasen-design-review': '02dbb5cd68c68fd89f5aa58964c6f2b59f1ff2d010594ae8a3e2630ecf0ccf32',
  'rasen-investigate': 'c2ec7353e66c78c08d4d4af2665dd39e89d09f7c07e6d4caaa9b78a0a1fef623',
  'rasen-office-hours': '835234393006bfaaa469551815d302d3e8771fb95bbb71430298b15a6237e07c',
  'rasen-qa': '77ac5c48a15b50b93176cf0304579d7f536c62d0e09ed973e6ac39eacc691322',
  'rasen-review': '51e6ff79347ae80a19337f819a117a1be5ec56b8d3ed4a39ee33d2fdbbcf9cfb',
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
