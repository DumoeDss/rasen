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
  getExploreSkillTemplate: '5ed8abddb49e8ed4e090f98daec30d2c14fce3f60357a54ac960659e3a2d1589',
  getNewChangeSkillTemplate: '53a077c73ae0947f3f04c4880aa137621b14193a3bd839772559d5e7acbefd40',
  getContinueChangeSkillTemplate: 'e3d3a08d62c4b4d2b945ed839911f4870bc454c6226a3c26cccd62abb80e15ba',
  getApplyChangeSkillTemplate: '825f74c801c3fee5c71759e41659146d003f8066bf3f87594f4d071b2b532d1f',
  getSyncSpecsSkillTemplate: 'a4553254aff575c2107917ba5a0b5f56f006e31b58b1b098172ea9e991e18281',
  getOnboardSkillTemplate: '8f138622e1663a44ae32a624bd91efc62033e71a8c5427ce4ca4c7a62b26b6a2',
  getArchiveChangeSkillTemplate: '5c088c9872c543234344ecdf0aafc3180a54a92e89a821745f7e05c948bc9de3',
  getBulkArchiveChangeSkillTemplate: '1f5e02205558914ae80e40f7c758f31d54971afe45477703dd7bf7f49d949414',
  getVerifyChangeSkillTemplate: '55f900abfcb9df2b2b956601430db207d82fd572dc821a6b5e9925e12232b2d9',
  getOpsxProposeSkillTemplate: '09344aef12b8fe8492c999f0e95a2ab7d395bca18a66d91b2628bc6dd38e82eb',
  getFeedbackSkillTemplate: '6bfb7caffad631f807678c2b5d194fb0eb2ed0bc4cbb4bf432b5a3c160c6cc87',
  // Workflow/orchestration templates (workflow-template-parity)
  getOfficeHoursCommandSkillTemplate: 'a08f6f8388e9f63f8cadb3b40c1887444ab8d26213cc5a51090f316917a181ca',
  getVerifyEnhancedSkillTemplate: '2225f1a680ebdae417c7778ee372c17fbd16cf33605750bef567c6b66508aea1',
  getShipCommandSkillTemplate: '0b70caab40fb071587bc48ca2b162e6283c0cfd1f31810067de4755093232e45',
  getRetainCommandSkillTemplate: '2241d0fd8eb1575b60f58e619397f251de17f3c45bcd5258066c5285223425c7',
  getRetroCommandSkillTemplate: '64725c0d0c2d5ee285de0186c62e9bb9cfc6b2ddc95eabd408e089ff1d00c6db',
  getAutoCommandSkillTemplate: '931efebdc7d224357f3bb1d55a35a15a31a1062a095f4f6a4eb5e39c4a7bc8ce',
  getReviewCycleSkillTemplate: '84883047262ca782ccd913632be3f023481a316d2f006e968ee94eb475a64692',
  getHandoffSkillTemplate: '47faa4d7803ed1ca66773ead93bc925c08cdfe1a5c896d3d8723048d8cd40aaa',
  getGoalPlanSkillTemplate: 'd3009d2e2c67ded929f1de8a3ad151ac60c82e01b79080ba3a9309351d804979',
  getGoalIterateSkillTemplate: '0cb68e67ad1834c2031080162dc1840f0e39e1f1016bb2c3bf6328c4a97402a9',
  getGoalReportSkillTemplate: 'd91028cd01bae4941e3af73814457c1c0a11d74d2c50bd8de4783f31a4a470ee',
  getGoalCommandSkillTemplate: '664d942db8a399da77e0b6b902fd333682daa6a2f8de8457b1a90aedb8f0e6cd',
  getHelpSkillTemplate: 'd39e31b794570143ae00f774fd7dc9419aeeba1db11dff8d79c82e4cea0649e0',
  getDirectionSkillTemplate: 'ea077d73d9deb7e8edf0118cba85056458f159f78f1e5fd06e5afc752069df99',
  // Expert skill templates (inlined; see expert-template-inlining)
  getBenchmarkSkillTemplate: '7ae3a9cb1330fc06ebe1be815afc73279f3ca51daf7c500ba868996b34d9babd',
  getCarefulSkillTemplate: '2d61967836838832769ada21936dcdea7a97e0cbccfa59c345084142c1577c75',
  getChromeUseSkillTemplate: 'c43a0eef3ebb1d9099d3a06617cadfb0a11e9aec8c60772a3af9d293e6528dec',
  getCodebaseDesignSkillTemplate: 'a6fbbe7c2573e238dc9ef9f9b94e3d5fe30eb338cd03f341f5a0ad883f939f69',
  getCodexSkillTemplate: '1b7e2c29f094ec0c251802b30fbb5f531ca18257033552701b5f00dff7ab2373',
  getCsoSkillTemplate: '0c44454e1f7f1dda506d6d6e92333cbf2d44393724970c245362672d42c25630',
  getDesignConsultationSkillTemplate: 'da6e7b072cc87ae586964f8ebbb97681cd99390135fc7318c783bc5adb146a15',
  getDesignReviewSkillTemplate: 'a38d4cf742ca4046c3ec950bf0eafecc4a0c98b98245d876b5fb13d648950063',
  getInvestigateSkillTemplate: 'b294a8537d0644def61dbbc5dfa82b9242a8387bc6ebb5bef9e649556329548c',
  getNavigatorSkillTemplate: '6314db1a2f9263dba67b46d0da5b89b08c87cada186b0040351e75290da630ba',
  getOfficeHoursSkillTemplate: 'cc17f670f6920d2f14ef4612201605f3b15edd336c753eae50ccfaa5cfbf8fea',
  getPrototypeSkillTemplate: '627c4789c1e876bae31c00c29a5868f3012857f5fab51949d6b1a0ecb8c0a08e',
  getQaSkillTemplate: '84573c1d38c3597d838c9f07706de193682e0f47158383841e4e8ff34e320627',
  getQaOnlySkillTemplate: '097d4e616d05849278c2a48986d7d9ffbc566047dde3a33d3242541c654f8a4f',
  getReviewSkillTemplate: 'b1b95d3fb99a366a9c13e812e304ef2901ebacf31024ed0c153f479bbdf93c85',
  getTddSkillTemplate: '34cd29d5d98fb73fd304b5a8edad75fbf7a615d08dca92555fb0f9a8bb60f504',
  getWorkflowAuthorSkillTemplate: '180e517d700fed57cdacf3e1aa5b201a2f4499522c15125e60d539a07932b9bd',
  getWorkflowReviewSkillTemplate: '44b415a96711e81542d432fa92796f5f72f30378614027588aaac37b3fde14d0',
};

const EXPECTED_GENERATED_SKILL_CONTENT_HASHES: Record<string, string> = {
  'rasen-explore': '681a13cfbe37aee3ff0be725be3080c9cac4d139c40b4a14a39b4e5cd1faea34',
  'rasen-new-change': 'f92554ee9b0be432ad28ed07ab0b0f4ea6631626338e21da3c4b32ca9c101d34',
  'rasen-continue-change': '12b19901ec75125f3b808c587bf031908109a5e10e01056a96c712c01d3b70d2',
  'rasen-apply-change': '394d7e690bc091028fd257546c93f5eb4880c7e0966bd0ac16a1c38442ef8c2f',
  'rasen-sync-specs': '2652d2f2660ce06422d2f7e2ecdf7f1acc5a77c18fdef06bc662205acd0562cb',
  'rasen-archive-change': 'c8d6417d426bc675a40bdb8a549fd0c69526f2c2bc4aa602eb359afabe5b46b8',
  'rasen-bulk-archive-change': '3d620c20bf4e7c9977318bbc52ddb97d0f036d88988a1282672eefe573e5ff1c',
  'rasen-verify-change': 'c93b4ec7b05b7b257b7caefbc378b914b287492bed3518f9b694ccbd46168512',
  'rasen-onboard': '690009ab08ffbf386f16c0348d6370e47abb739f7073c127d9a9a7344349de7b',
  'rasen-propose': '892639fa95013f68c77b206a024cb2239adc9382acefcd3ec1878b2b3d36ce17',
  // Workflow/orchestration templates (workflow-template-parity)
  'rasen-office-hours-command': '23e5233eada521df82e0c451558c0866cdab9e105e8611ec8aa342395bea0351',
  'rasen-verify-enhanced': 'de3cd3615a23678190ff4d02d84289ca029444e020aa04502a1ade7230e0d6e8',
  'rasen-ship': '1ebae30e14c4b850b83a48c93528895eaf9b319664765ca37bd10368ade1497d',
  'rasen-retain': '43b7c49740fcbc9bff61bb90084a0ded55698571a461edf9d37ae22943623df3',
  'rasen-retro': 'af377d3849b0cbd34d1362044cc1be6f440a4fb93a3c1001dd5d64e7a58da008',
  'rasen-auto': '9a2b113e5a6613192d5117b4bc2dd3e186a18b7846e8d5018e0560732e00442e',
  'rasen-review-cycle': 'be4cac7061258735e05fcc39858d7a1e05dc6e2ef9444d361cceb5e6a7d44eee',
  'rasen-handoff': 'f04a83a17940544f44c8686297970981076da88c507be224725b422c3f0227da',
  'rasen-goal-plan': '65b8b40fde640c6bbc2ecca2b9c615cd648d31352c60a973690cc222c33c5422',
  'rasen-goal-iterate': '6b7a91f9c74c368a1da9facdafc61472abf0999127a5f15cd961264de77fb7ab',
  'rasen-goal-report': 'fefe236dd54d620e00cff9e87168409afbc400218395fedf476337c9ece6e67c',
  'rasen-goal': '47e9bab92e3fc5fc559e1994add368dccdf5ecd99a1560d8123f04fe43e4586a',
  'rasen-help': 'eb457dfd099af1042e45552af00c756f15745d954600eb3a0e7488662b0c5445',
  'rasen-direction': 'c9f2d150e5e5e9a553a892a5a2ba63d29259d4da242b90bfffc742727c7fab85',
  // Expert skills (inlined; see expert-template-inlining)
  'rasen-benchmark': '6369994a2481ee3ab4abac65b7ea6b11dace34eeacd44b756f0fce61a99c73cc',
  'rasen-careful': '42026bc839362e075598602e50fa9d2fe2c781aa3a6888fde5baa8f39e9d6e6d',
  'rasen-chrome-use': 'fbda9496943181a6768c05770149962d1473a28f607bd70660a27a48cb4207f6',
  'rasen-codebase-design': 'f8b0890c2ef8f19272689107cf372b1c7f530b1d996102959ed36f4c358db7d4',
  'rasen-codex': 'a3fe3a006f71b001c80e5f837dcf03138a282be3676e80b34671b61db79a1f07',
  'rasen-cso': '1f894792f4feded87c3c0a7b6516d0556cc93961333e746d33941377cb4a69a5',
  'rasen-design-consultation': 'f113f32e680995835e0ec9c47ec8484dd62bd50c21b883589cddfacf32bb422a',
  'rasen-design-review': '4bf33c7f0af7f1f779304a183f0b33caf759419953b88f4d7f1598fb0b4563f2',
  'rasen-investigate': '4a97b6dd1ca59e87eb7ab395c69f3294174eaa1380df4040deeaece70b6dee4e',
  'rasen-navigator': 'ecc8aa5a333da03a4bfe5bc9087aa4c59952a6147bcc7bbaec4d961f409dea0d',
  'rasen-office-hours': 'ae2ba6a4aacfcf0c74d93111237553a76dcee28fe33c745dc928b7a437e309cc',
  'rasen-prototype': '1c03f8713bb604aede7517d2eebf3b1b0a877a613bd67b1cb9f0674e41a86972',
  'rasen-qa': '419b9ddc67b867f16deaa014408c63b2bd797696fe4b312227f4e1735dff3cf1',
  'rasen-qa-only': 'f525662fd253fb7c1bac1cc2e7c4de7d860441453a742a6121ad47eddfdf2bf4',
  'rasen-review': 'a70ce7dabf7f3ba584ff99559d72ff6c9c6c4536ace1b39b68bc1becf551de91',
  'rasen-tdd': '0a6a7fda1330ac8915addf6bcf1c9a3bf8987688d7728f1d8ae8c6150578eb0a',
  'rasen-workflow-author': '5627e0c6fa0c0336c276bf81aa644c7b599461553026f035b376617c666f12ba',
  'rasen-workflow-review': '36ce07d02c8f69dea12e1be6d2da0d16cb9958aa4f7b57d229600be27c9aa057',
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
