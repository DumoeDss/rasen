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
  getExploreSkillTemplate: '7a01e5f242d229c0d89974d701fab6f97857f6654da515a6a5bd5c5e8f56d092',
  getNewChangeSkillTemplate: 'd9cab370475fbf46ab3e5ca55e06995f8acfa9726a72cab871f2965317838a9c',
  getContinueChangeSkillTemplate: '7bc2fd2566b65a3991eefd7088ed6f201bfdd1c12568af8fe6353a78b9b7a52b',
  getApplyChangeSkillTemplate: 'e9a92f05ca22a60e47d144794b6fcca36223636513e3158a97c20a9cb08718d4',
  getSyncSpecsSkillTemplate: '03543b5bb32ff9e73083cb502fca2426a6ba51a9b13aef24e20830d458578ee4',
  getOnboardSkillTemplate: 'cd694869504851be41187a1d015d55286a4c441b45184d556182a8db6d125a83',
  getArchiveChangeSkillTemplate: '2ec51e1d72a816e6ce8f7fac9627a851e444d8fa529c68e15b3d2f56e4398c40',
  getBulkArchiveChangeSkillTemplate: 'c4b22c9c642c7c3f3d8d7091a558a3e49dcaca0f0774fc159cd985b99cf710cd',
  getVerifyChangeSkillTemplate: 'ebb5ac70463a5b6603c97709417af408f3523b3f0e16520b0a3c23bcd16b05ec',
  getOpsxProposeSkillTemplate: '132d69e306b0338bcbc9a4e0ec4eca53f9a36f7d2229347b46d3f5ec49b3fd31',
  getFeedbackSkillTemplate: '6bfb7caffad631f807678c2b5d194fb0eb2ed0bc4cbb4bf432b5a3c160c6cc87',
  // Workflow/orchestration templates (workflow-template-parity)
  getOfficeHoursCommandSkillTemplate: 'e1b5bd987dcad2cc977971e13b8e2f40f79b63a6f430845b285b29f912ff78d4',
  getVerifyEnhancedSkillTemplate: 'f636bf485c3eefab30b6c77688851844ccaecc1012999bb4760d140c5798f668',
  getShipCommandSkillTemplate: 'eb9d4a7ddc3eb70473b0cbea17ce5d1b2ce919905271a5c9305bf1a72c8e22bd',
  getRetainCommandSkillTemplate: 'e668aba497c3ffc48aa4c8cde70bbe089bcf69b4a1e89704871ed704679fc62e',
  getRetroCommandSkillTemplate: '64725c0d0c2d5ee285de0186c62e9bb9cfc6b2ddc95eabd408e089ff1d00c6db',
  getAutoCommandSkillTemplate: '595d20a75d585912597c28eb633121ada6d6a5f5470eddf0fd6289591a18a9a5',
  getReviewCycleSkillTemplate: '78f5e4e1ae7c8968a5e616643b8af234a4ba1f2e5fecd1e12b376ef034c21be8',
  getHandoffSkillTemplate: '02586c9f30c6cf2f2555e58fe05b1d81a3a9cea655ff80a4990a491597beef58',
  getGoalPlanSkillTemplate: 'a208b3e314b42d24c3c2ee29942447f8dce980ccf5c1639c41d02f7ffed11246',
  getGoalIterateSkillTemplate: '3a3c8036d9ef7e4a2aa92ff2190ccf746521cb16dbdddbbd4c92cf57011408e7',
  getGoalReportSkillTemplate: '1ae653c5e7202ce8409af1396e8a7ea062576c373e5a28e49cb39d171f2175d2',
  getGoalCommandSkillTemplate: '8526e1ce67580236b2e93da3f188e9890a8157f26d130b5f6561cde7108069b7',
  getHelpSkillTemplate: '62013205c6e31447528743d092a52611dd6e7a5b511f2101dc640e5ca7bd98ac',
  getDirectionSkillTemplate: '2a832922740ad3051eeb5a3787b8df64a4fc61169ed4374acd2c2f306c1a2e38',
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
  getWorkflowAuthorSkillTemplate: 'f20cf7cf1399af1d521d3e70ec07983a84e1f96793349c466528f0451202f729',
};

const EXPECTED_GENERATED_SKILL_CONTENT_HASHES: Record<string, string> = {
  'rasen-explore': '5523302af6d81032925ae9d1e66a6db5c2e7ba3da98fec634001149d44adfaaa',
  'rasen-new-change': 'c98e88eb3c2e589b5e68c7d7223b269cbbc5b60a9ae6d97986de9aed461ce197',
  'rasen-continue-change': '292d9f607c39f821e8fe020a0df252a8b1deebde8951560d74d736840c29f132',
  'rasen-apply-change': '8cee6d9278cb9bf03997e55639bf402d8cbb5aea3da337ce44b896920362d114',
  'rasen-sync-specs': '4f3d5b0f97366a18fb8da009987c2a2561b3ebfc49d4d34c1685dd4c340e33d6',
  'rasen-archive-change': '8a844eb65632f64fa9e1174d4224548d0aee5412ea52713e1690015dd2492104',
  'rasen-bulk-archive-change': 'a78e0935a8c1301b2e2b6f91d78cd8a3de155ce9400779cac61945130c65a4a3',
  'rasen-verify-change': 'bc95c9c35fd06f5ef164c5ff87b2cb2b890ec8751e34e1db981094deaa364117',
  'rasen-onboard': '899eb154cf8ddbaf1b4d57e02c2d241aeb142dc84b6b92f8dcf2220bd082c47d',
  'rasen-propose': '843059bbe0498e8b2c5d7bd0822e45888bd33af3557a93f0c2e5348b0fe10c7b',
  // Workflow/orchestration templates (workflow-template-parity)
  'rasen-office-hours-command': 'e2987933356d0ea9e25e0815d9859a34c271aa0a3cf4c99834e042accacf832c',
  'rasen-verify-enhanced': '454cc68a6e00608f8c56c40b8130f94d6fba92fdfd50c5e7c88a004c5c5e54b7',
  'rasen-ship': '937180e1cdcfe7b59d263c7170081e93989ede9ba262b1fe10e761fd22f563cf',
  'rasen-retain': 'b5d3118c0542dd22fe8a9bcdcdeb8c96405978cfb97a5f1827c279ab546ee9a8',
  'rasen-retro': 'af377d3849b0cbd34d1362044cc1be6f440a4fb93a3c1001dd5d64e7a58da008',
  'rasen-auto': '09c058a876ca572ae5fec75c07816c1236a45c634c40022146c532552c0880d3',
  'rasen-review-cycle': '7f1fffbe82a4d5ae278cdb6b12e48e175cbd17bfa99ce6e23ef16a4baea8cdd7',
  'rasen-handoff': '902bd44d87dc773ba0ef9757e09770da6cec8ee6de08d16a41d2067a47889a8c',
  'rasen-goal-plan': '44e93a0c8c739c8a69f729540789a9fdfbbdd5b0760d11ff3b87ab0b2f3293d9',
  'rasen-goal-iterate': 'ee9f89dbaabc00c6741f48822e5f9e6d6847cf9f4ff7892a8ee79ba9ea4bd595',
  'rasen-goal-report': 'b4a03f4240078b0f77079d0b77be98e83e4440f0498005a714bb915251cb0e47',
  'rasen-goal': '41b9092acc248d03e428dfe7b73dcba4ffcae28dc84b54909c0075730a55fae0',
  'rasen-help': '352196a21dce3000410d9eaf5b290f3655d8b060517f0a8e621bf291b118e4d6',
  'rasen-direction': 'd82020fddf7d8cf4d6e8baeb4f83de442218b98c72138a8527319758c816a93f',
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
