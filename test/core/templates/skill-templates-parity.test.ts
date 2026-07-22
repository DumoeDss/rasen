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
  getRetroCommandSkillTemplate,
  getAutoCommandSkillTemplate,
  getReviewCycleSkillTemplate,
  getHandoffSkillTemplate,
  getGoalPlanSkillTemplate,
  getGoalIterateSkillTemplate,
  getGoalReportSkillTemplate,
  getGoalCommandSkillTemplate,
  getHelpSkillTemplate,
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
  getExploreSkillTemplate: 'f1659662e2284051600aa930434e40df80fea9eb3d8b1a97441cb297c2ceeca4',
  getNewChangeSkillTemplate: 'ae5e1798fa0e495f209434d44f3e6043354224d210734eda9928fcbd9a6dc852',
  getContinueChangeSkillTemplate: '63192938a238bbb815f4ee840838948b12e9c3dd95c8a8a6bfbda9ecbf1b1c00',
  getApplyChangeSkillTemplate: '733f4ce38f48726bbcf431f0974f6641534fdef962dfe52a30b6e3e45ec8a626',
  getSyncSpecsSkillTemplate: '8177beb0cf664241cdf3e6016c8cf7a75b4331c64c9804e7178d1ba1566c8334',
  getOnboardSkillTemplate: '91da611a43f5630412f2101e6a3ed562b9f4f637c2bb144d5818e6f7449b9340',
  getArchiveChangeSkillTemplate: '8cac1c38dce25053e5c67131e970f1e2c181debde330ab7b7ba5d9a5fd51c946',
  getBulkArchiveChangeSkillTemplate: 'b06a31635587c1091771d1328d2134113602db65e6fde0400bec53ee543394c0',
  getVerifyChangeSkillTemplate: 'c62fe1057fb3e940ac4504dcff0517b42925923bc3b262da6de9154d4e518e18',
  getOpsxProposeSkillTemplate: '7133755fbf73a4a938ffe9509c5fd2e28c5b9164293e92eab119cb6ed35ef1c0',
  getFeedbackSkillTemplate: '6bfb7caffad631f807678c2b5d194fb0eb2ed0bc4cbb4bf432b5a3c160c6cc87',
  // Workflow/orchestration templates (workflow-template-parity)
  getOfficeHoursCommandSkillTemplate: 'abc86fb00aaac2c269009aa48a64984481de22d93447696b0574c7fe0eebcb0f',
  getVerifyEnhancedSkillTemplate: 'a4df1c8928150a14957b38352b3c1fab89a618d8a97a88dae5ba77d4e009a289',
  getShipCommandSkillTemplate: '67374b0b2b697501cd42789d024241a4fae0dae793711703a998c771f2b7ffc8',
  getRetroCommandSkillTemplate: '53eacb51d137ea9c79503ab51864c558cd7d040abd33e63bb04de8329883b170',
  getAutoCommandSkillTemplate: '04195d840884f53e7548311e014900802cfebafac5b3cc47c936dc9f5cc5a727',
  getReviewCycleSkillTemplate: 'c685ba2adde06b48da269200d8ace96597c8e55603167fdbd26e9b3f38d78967',
  getHandoffSkillTemplate: '2dd5358742c4771dbd5eca94526effe5a0f1868d8294e02cea08a8529cf4b7a9',
  getGoalPlanSkillTemplate: 'cf74e6ab19069d7c1d3545c216eabf0ad90d9b241f4a86c3635441b73458184c',
  getGoalIterateSkillTemplate: 'e76b7a1b238f8e412736b763d2aeefa0c881d800213cd01ce91a835c2da536f6',
  getGoalReportSkillTemplate: 'a48c1b6c75c5734e051a4aa707ee803c0af73fd2b74b18fb7212e531568a4bed',
  getGoalCommandSkillTemplate: '4be69d8ff92cf0a8d60e503e82a67e76155eff1c673120f2bcab463124aedb37',
  getHelpSkillTemplate: 'f45bbe71a1a337e3155d30950cc0f8ae77c6cf5c078aa6accc847220c91d0f2e',
  // Expert skill templates (inlined; see expert-template-inlining)
  getBenchmarkSkillTemplate: 'e532d9adbae401c36d797101b3220fa41a7c89788368e2022734c64219757008',
  getCarefulSkillTemplate: 'e1d464d2b51dda32c0ef37f7e9346ed41dbfec15f5ba56e3f3ecf2dd2045bbec',
  getChromeUseSkillTemplate: '887f74bc1c0d2c1a38f685352d0dd7a26182ca0f88705581f139f676499914a9',
  getCodebaseDesignSkillTemplate: 'c0459451628588b196d05aba88e9c94e02123cc1d30693795ff9acd8b39b5730',
  getCodexSkillTemplate: '5d12d958487a8fc4a5b9ea4f9e528fcc6dfbd9646a9f469a315aeadcbba1d1c1',
  getCsoSkillTemplate: '2f0c59342bf1e7f23b8477327c735afad4a858fc98d24e49a50c02e9d53de531',
  getDesignConsultationSkillTemplate: '8a3ef8de2f3a17af5c59fcfd0606f7d84ee467baaf034d204ae070785e3455ce',
  getDesignReviewSkillTemplate: '6edce579c579acfa1526afc3175da8d4ac529f9f13371d46b6df1a251040c67a',
  getFreezeSkillTemplate: '7432fb383e3e12cec423308e3f0835488be99a61eb8d557f337dddba595210f2',
  getGuardSkillTemplate: 'ab5c3028eae0d532d096dc13be0e9101c9ed7cf7251c19f6bf0ce6190b106e2a',
  getInvestigateSkillTemplate: '2be629df42ad6beda5e1cfced4e4db678d99b9a6519a1367137e9e2a97990d59',
  getNavigatorSkillTemplate: 'ba25e60a398399dca52a8f56eec68cb51bd8c6694d4987a9977bf2f49ab20cad',
  getOfficeHoursSkillTemplate: '4a083781872fdf1ca991806be02d506b177f9059f6d35ef58678dad459b78fed',
  getPrototypeSkillTemplate: 'cbe38ed637dce4ba18586795111ab6cf70929b3225ee1b6eac734953e0a25958',
  getQaSkillTemplate: '3c5ec8f914024f60b916d2bb12de3277e342c23e135b18e2024e4299e190b2c9',
  getQaOnlySkillTemplate: '2e7f55a9664bd1a2e34ab1be74fe0ad70494436addb6cad561aef85423599dc3',
  getReviewSkillTemplate: '9e4c564be0fdfa22b2d78e4524368c7b9800cdbc4144d1eb6dc8b3bada372395',
  getTddSkillTemplate: '5ee24e317b5f1a1ab114153212a72ed633a40e1f1268c34b31102d9be9607701',
  getUnfreezeSkillTemplate: 'a8f1126bc4b1a9db8dfbae048bde8fe340eca8af68bc5d6dca50a5cec8dacf81',
  getWorkflowAuthorSkillTemplate: '394ba85dc1d03fde795bc926e87668ae05a29153d470b472471a0b563474af8e',
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
  'rasen-verify-change': 'ec1f1aec03d4aae9daf689b3d7b7941e3657c6c7c8fdd1da5f3059ba0063fd9b',
  'rasen-onboard': 'ca929a0dfa8785bc945302d14f14d3f8da0cdde97ff87528c8e845a7021f730f',
  'rasen-propose': '8c3553716a378d012fa781d377a7d20fbe0719cacf2a75cccd16a3ffaaf59bdf',
  // Workflow/orchestration templates (workflow-template-parity)
  'rasen-office-hours-command': '40abb0f8df06501b21b33f7615b0a36bb65015c0652b4548e30cd6bdd4b19e34',
  'rasen-verify-enhanced': 'd5e3f30b5f03af6979ecb4d3ee6693984135aacac63d218eff2618b8db692d38',
  'rasen-ship': 'cc8e158cc3d3657fe0d531fd74129ce621e59ede1326cffb3e2a3a63e86d5b10',
  'rasen-retro': '458aa2ff649293a5e4c5b711e538d16b02e494e909ff6408ff99c28bb987ff73',
  'rasen-auto': '8edd872e2b470afe47e23cd712013bdd4663abdbdf5125d53a7a0fd698cd87bf',
  'rasen-review-cycle': 'cf250cd53aabef7aef97dc5588f38481519554903be673e896a26bac79c66c4f',
  'rasen-handoff': '6327278c9f06d21b445ffb3a1cd8868994f9d6da3ab24ed86c3c743843d7eb99',
  'rasen-goal-plan': 'ef751463eb35fcf9d9d9c9692dc5a871a812f262f5209cd3912ab235cea987cf',
  'rasen-goal-iterate': '5f3affcb7a470b0e887c227173cb9179a4c8b415aa013a061839059fbf0af0f0',
  'rasen-goal-report': 'cd60a56882984b4babed00f611793b3e1448e54a2bdb94796f8ac06c17445acc',
  'rasen-goal': '75c616c7602cc914da2cafa9f8424934dc130eb5d1d59560e6a72e496032e02a',
  'rasen-help': 'd4741dd2c9502d7fdb972d57b8d831d99414d4c138832f763c0bac5a01b5fcd6',
  // Expert skills (inlined; see expert-template-inlining)
  'rasen-benchmark': 'e0b06186a7c28369ebec78d0b8a7b1a68c44b18b1ba06c4bf52d44c6e67bac55',
  'rasen-careful': 'b3f81a672fe3f110fb21574aefe5f4a908fb888ad090901291d83dc542f4ebd8',
  'rasen-chrome-use': 'eaf2f68497a641d62dc3916893c9e8789a9aced243ad7914499a1162465a051e',
  'rasen-codebase-design': 'd84f401fddbab582447df483858e021ab6b859516bc021ed1f2ca8134ba0bd28',
  'rasen-codex': 'e053f25f97257678608eb0d0e35dd27f0af4104bf79e53a137547ed6df9110df',
  'rasen-cso': 'fbb542b1c9be07c2ab4ade0e8ba1c9982fe9dcdeaa7dcdc9af2ca957dd7c3ecf',
  'rasen-design-consultation': '63d460f6b08dbd858823d282d1b449dc1a14735ae04bbdd4b367a5b5b22cfc1e',
  'rasen-design-review': 'a99d8b8990187fbd53bfbda8c80821bc8012386af45049a22ca50e722c6d6f09',
  'rasen-freeze': 'd6e38d901e456e28c9d1cc51fac6462be0d9d8aff885e34697fce303c8d89de5',
  'rasen-guard': 'b10f98eaf65e41dd37a58c9ddc4bba49b005f65e2c66eb4b3ccabeabed174d39',
  'rasen-investigate': 'e8e02b011b308abd910917d26399c46a2824b9708c6b1a1f42037768afff7469',
  'rasen-navigator': '413bed4b17971a392f035cd94ae4ce8ab7b5440ec37ccbd9b0b83b2c8a85c035',
  'rasen-office-hours': 'f2248a99203aa18b3af7cb3c7b1dcb92db95ad21c5b47156dac14ac890f0700f',
  'rasen-prototype': '28b8e21f7079c4a39c4088c0b5e6cb6741302b35c02a9e90da417611c917dd3e',
  'rasen-qa': '1eeba9dfcd33f21f371ff103ac65d2d0b2937f6a0d1d0101612720b7d208d5fc',
  'rasen-qa-only': '3b83a6a334c62ed08064e1498ab67564318b8bde524e4634ee737034de14d9c6',
  'rasen-review': '18fa34083ee719dc2fefba5a8bb44b08c10d220a0b08eb5266a6cfdf18af3951',
  'rasen-tdd': 'fe0fead48016db070ad3b55b9cd6c0bc45fd7b220ba410373d4fc6b71d21eefe',
  'rasen-unfreeze': 'ae901355f45f538d1567d9848198a74b55726a4ae4193052c49f1bd55f0a11b9',
  'rasen-workflow-author': '1dc87300dcf059accbf84cd82af89c48230a94bc5ec1b44e44f809e8d160ded4',
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
  ['rasen-retro', getRetroCommandSkillTemplate],
  ['rasen-auto', getAutoCommandSkillTemplate],
  ['rasen-review-cycle', getReviewCycleSkillTemplate],
  ['rasen-handoff', getHandoffSkillTemplate],
  ['rasen-goal-plan', getGoalPlanSkillTemplate],
  ['rasen-goal-iterate', getGoalIterateSkillTemplate],
  ['rasen-goal-report', getGoalReportSkillTemplate],
  ['rasen-goal', getGoalCommandSkillTemplate],
  ['rasen-help', getHelpSkillTemplate],
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
// guard — their colon references live in `_shared.ts`'s `PLAN_STATUS_FOOTER`,
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
  'rasen-retro',
  'rasen-auto',
  'rasen-review-cycle',
  'rasen-handoff',
  'rasen-goal-plan',
  'rasen-goal-iterate',
  'rasen-goal-report',
  'rasen-goal',
  'rasen-help',
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
      getRetroCommandSkillTemplate,
      getAutoCommandSkillTemplate,
      getReviewCycleSkillTemplate,
      getHandoffSkillTemplate,
      getGoalPlanSkillTemplate,
      getGoalIterateSkillTemplate,
      getGoalReportSkillTemplate,
      getGoalCommandSkillTemplate,
      getHelpSkillTemplate,
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
