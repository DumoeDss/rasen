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
  getAutoCommandSkillTemplate: '5180b5e41d93ffda6030b8fc7c4032afdfd63c884ba7df648a3000758c13b02b',
  getReviewCycleSkillTemplate: 'c20a925950ddf4ffa05987d388990d91e13e6434e0e9fd23250b7631795e4356',
  getHandoffSkillTemplate: '2dd5358742c4771dbd5eca94526effe5a0f1868d8294e02cea08a8529cf4b7a9',
  getGoalPlanSkillTemplate: '7f390a14a5bb3e7e5ec9e1de06fe4ab4c5b1357cbd74c3bc36090af699931d46',
  getGoalIterateSkillTemplate: 'e76b7a1b238f8e412736b763d2aeefa0c881d800213cd01ce91a835c2da536f6',
  getGoalReportSkillTemplate: 'a48c1b6c75c5734e051a4aa707ee803c0af73fd2b74b18fb7212e531568a4bed',
  getGoalCommandSkillTemplate: '48451ad616e8a1a6f1ad223a6b2f75a6dc5d1f1e07b43df7214d58a92875206f',
  getHelpSkillTemplate: 'f45bbe71a1a337e3155d30950cc0f8ae77c6cf5c078aa6accc847220c91d0f2e',
  // Expert skill templates (inlined; see expert-template-inlining)
  getBenchmarkSkillTemplate: '8a38b79c63a4c429d1c22825d481db7f5ea3ab50e9f37ad27970e529c6abbbfd',
  getCarefulSkillTemplate: 'e8d342630bb867799f6356252199ccd318ba546048d3d01eb3b287aeec4bb99a',
  getChromeUseSkillTemplate: '78d042d37bc3a2e949c3e4cf4863c1d35cdf36376f49e4cb595b397c9d2e5069',
  getCodebaseDesignSkillTemplate: '18ba11e92021633cc216d3bbbf5962542d6d9f30a8ad882d1f7a9636fd929a1f',
  getCodexSkillTemplate: '7f23b8cf1da78fcdd39c380b9b74764d4c4098e06bb7c8e9812054f7f11ad946',
  getCsoSkillTemplate: '3742557b4dd04f0eb95d2048404c172e7a24ecdf9fd0b1d1a186a100d8362f89',
  getDesignConsultationSkillTemplate: 'c44442097e2af1e684e9ac936adcb5c07bfd442deec178d9fc86e789e1248264',
  getDesignReviewSkillTemplate: '1cb281e397df9e88e703ec1614583b09e71213a78ec3bcb143106b674bc39c33',
  getFreezeSkillTemplate: '9df5e9cbade2c7935f661ec83732927355e03578f52d47503acd0a32a57aea09',
  getGuardSkillTemplate: '98c4694a5d36aa158eb52ccca58ca2fd787c2986695f0d328d78bb8b39f52ba3',
  getInvestigateSkillTemplate: '8e3b407408309461007f0fdb53cc3266e91cc719275b14e7dde29846eedf51b0',
  getNavigatorSkillTemplate: '38ee23e6e4e1a53c680b5c04dca72b8e4da9c4239dd34e828b477130a129e4c7',
  getOfficeHoursSkillTemplate: '887b746a31dbc7849b7c1df2beef8fe65c4b075636a80b99f53edb673ace0322',
  getPrototypeSkillTemplate: 'dcd8aadd8544c757079efaa6e06b402a9bf07f7472dabf8bc9b8c3e9df6426e1',
  getQaSkillTemplate: '2f89fc92b21fbfe9c8dac40ea74763c5d2f32fb69c13880171ae39b137dbdf04',
  getQaOnlySkillTemplate: 'db11f0648ea3591f4609910525180d62462faa9e36796fcf638e2f3abfd29a65',
  getReviewSkillTemplate: '208332231bceafa883316cc4f787edb4a93857f391f1829efd7c2f08a0e01fe1',
  getTddSkillTemplate: '5c4149303ad3b322d0500431b67d7a4c35af2e4071c56d2499ae8f511de989e1',
  getUnfreezeSkillTemplate: '6bedb3316477b441b7da2f82ee465ca0233a36cd46cbf2434a8f185b14126f87',
  getWorkflowAuthorSkillTemplate: '44dd6e005524eac0e07aa9fbce67fcd839fdb9479b6e2ddb06a1b80cd21130be',
  getWorkflowReviewSkillTemplate: 'a708138b0c17df357cb97b038fe74ec9c925bd4f67f57c71504d6e788c980363',
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
  'rasen-auto': '52d9969b7350e2fe6c9fc06ae4ee211effde060e35f24ace3419d179ae576f98',
  'rasen-review-cycle': 'f6746d9e3bde59daeccbfc3d43f69dc67ef133da2641a887da0694070d1eb05f',
  'rasen-handoff': '6327278c9f06d21b445ffb3a1cd8868994f9d6da3ab24ed86c3c743843d7eb99',
  'rasen-goal-plan': '8e88a7ca5dd5cf866a154da94688f108b45614e6e8efcef9cd160352560d7d21',
  'rasen-goal-iterate': '5f3affcb7a470b0e887c227173cb9179a4c8b415aa013a061839059fbf0af0f0',
  'rasen-goal-report': 'cd60a56882984b4babed00f611793b3e1448e54a2bdb94796f8ac06c17445acc',
  'rasen-goal': '9587a87c24a5242ae1bf54ab44ee1048b0c0bb236def0241b86c42581ad05912',
  'rasen-help': 'd4741dd2c9502d7fdb972d57b8d831d99414d4c138832f763c0bac5a01b5fcd6',
  // Expert skills (inlined; see expert-template-inlining)
  'rasen-benchmark': 'fe2afd87621432ab60b3baaa252d8e4d616e5bd0d8c9225903c61d7f77686c7e',
  'rasen-careful': '1bd68426e8c5ffcdcdaa724211ea2580c1cd3e2cf213eff21b8afc9d4bed539d',
  'rasen-chrome-use': '4d08a5c379a47b48d3dc5ae6f6e9699590e49fa890edf6a1c5277688eb233b80',
  'rasen-codebase-design': 'eb07a5047b731caca9d59e13838cf25a233cee154a3063d2e43fefe14a754dec',
  'rasen-codex': '0ea96bc867fa915041f2ef65042334b171b9568d3c8c3ee981d694fa4a83a59b',
  'rasen-cso': 'cec6228e9acb12c97259607c0c033076ee9b69b40a42d36ab1d1db530b597cef',
  'rasen-design-consultation': 'f05d3bf69fa70c93c4feb9c80077723c163d1f235e9899a95785fbb520a54913',
  'rasen-design-review': 'e6702e78a80b243f068cbaffc12cb1d23010de7d59d19560ba170e4a71e1df54',
  'rasen-freeze': 'f3ef82c79cf162b59aaaa3b0b2706f919cd6bfb4cade0678c743616c804db937',
  'rasen-guard': 'e9f77e4fdaf73fab74128c2cdb469bde69bf6432ed7e1d1e27de360e6eca7c59',
  'rasen-investigate': '1aca9ed41ed12cab377a12e77b276f0bfa96bb7ec675b564f98ac572b98e6514',
  'rasen-navigator': '67847739c03150558d2a6ed3d26cad9e832286d9295390c6850886e32a2169ec',
  'rasen-office-hours': '7b2e2e87d1e33456634a14d44d1da7049bddfb44be0ad60a80937fd4ab9b887b',
  'rasen-prototype': 'e0747e26486e63f5579bf497b78376d7e6b1994eab89c351eda7e6412d5b0da8',
  'rasen-qa': '2a35556c5fab8715f9b0c0621a87104b6acf3ab8cf3c20a39b86c31a2b1dc284',
  'rasen-qa-only': '00fcccc3d2b403e5ee648cfac08a039f241285d32cb0e17ce8ddf8986d0bdd20',
  'rasen-review': '085ffaa479d47fd331845b6092daec476be379639b655b8b539a4bc27b733dd5',
  'rasen-tdd': '8d953757ae31296a628010b07d1f229d4c3d983e44836e3b70031aafcbb9a463',
  'rasen-unfreeze': 'ca727311494108d775f3f34f7c21ea104943e2e12f17f5c1051e3952cd5486e2',
  'rasen-workflow-author': '8689649db6da6c28852716fe767255b49c1c8903654f32ac107cefd5950b2de3',
  'rasen-workflow-review': '94e56651467d0687e1a20d1c425ab75795b0092eed608ecc52db1c9c6e232fd3',
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

    // Fresh auto must request the execution-preflight view instead of
    // dispatching a merely structural pipeline show result.
    expect(content).toContain('rasen pipeline show <name> --for-execution --json');
  });
});
