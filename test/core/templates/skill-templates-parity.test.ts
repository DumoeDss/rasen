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
  getFfChangeSkillTemplate,
  getNewChangeSkillTemplate,
  getOnboardSkillTemplate,
  getOpsxApplyCommandTemplate,
  getOpsxArchiveCommandTemplate,
  getOpsxBulkArchiveCommandTemplate,
  getOpsxContinueCommandTemplate,
  getOpsxExploreCommandTemplate,
  getOpsxFfCommandTemplate,
  getOpsxNewCommandTemplate,
  getOpsxOnboardCommandTemplate,
  getOpsxSyncCommandTemplate,
  getOpsxProposeCommandTemplate,
  getOpsxProposeSkillTemplate,
  getOpsxVerifyCommandTemplate,
  getSyncSpecsSkillTemplate,
  getVerifyChangeSkillTemplate,
  // Workflow/orchestration templates (workflow-template-parity)
  getOfficeHoursCommandSkillTemplate,
  getOpsxOfficeHoursCommandTemplate,
  getVerifyEnhancedSkillTemplate,
  getOpsxVerifyEnhancedCommandTemplate,
  getShipCommandSkillTemplate,
  getOpsxShipCommandTemplate,
  getRetroCommandSkillTemplate,
  getOpsxRetroCommandTemplate,
  getAutoCommandSkillTemplate,
  getOpsxAutoCommandTemplate,
  getReviewCycleSkillTemplate,
  getOpsxReviewCycleCommandTemplate,
  getHandoffSkillTemplate,
  getOpsxHandoffCommandTemplate,
  getGoalPlanSkillTemplate,
  getGoalIterateSkillTemplate,
  getGoalReportSkillTemplate,
  getGoalCommandSkillTemplate,
  getOpsxGoalCommandTemplate,
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
} from '../../../src/core/templates/skill-templates.js';
import {
  generateSkillContent,
  getCommandContents,
  getSkillTemplates,
} from '../../../src/core/shared/skill-generation.js';
import { STORE_SELECTION_GUIDANCE } from '../../../src/core/templates/workflows/store-selection.js';

const EXPECTED_FUNCTION_HASHES: Record<string, string> = {
  getExploreSkillTemplate: 'd8f7ff12b43807d18df7cbbfd8cd3579d82e2116d49b19f04af44a026092fb08',
  getNewChangeSkillTemplate: 'ae5e1798fa0e495f209434d44f3e6043354224d210734eda9928fcbd9a6dc852',
  getContinueChangeSkillTemplate: 'bac549929bf918880ef14c4a47e2480b4a4b6201e49874076bd7d944c2cd9769',
  getApplyChangeSkillTemplate: '1cfd3b818f1a4d3d81914f393b97dac582d682e578b75023c4248845e578e2f8',
  getFfChangeSkillTemplate: 'b936a28204e7a6bf2eb6d68ea27afbea1775c043532ae38043fead190be694b1',
  getSyncSpecsSkillTemplate: '8177beb0cf664241cdf3e6016c8cf7a75b4331c64c9804e7178d1ba1566c8334',
  getOnboardSkillTemplate: 'a8adef8224d54fc93b65393983aace3037a87f6d84e9246f553268fe9abadb12',
  getOpsxExploreCommandTemplate: '30067ef509cf1c05d9f49469f5da26688f8da4a37c3fc6044f9a9b78926251dd',
  getOpsxNewCommandTemplate: '89fe510f54d5c773da4b6ae548bff413d385ff842b0a26b8699673ef29fb759e',
  getOpsxContinueCommandTemplate: '5ac9e223635e5df8ccf3443108473af69b468e30614afb792e6d02366045e69b',
  getOpsxApplyCommandTemplate: '98480e2c0067990327203f63f7a98d9310e6c001f3f1652c970f42041fd1b1b3',
  getOpsxFfCommandTemplate: 'a480ef3b2276be263e57954ef591f2550bf04cbd7537cadc77ff6696a26d049a',
  getArchiveChangeSkillTemplate: 'd2d6885a9a98834251c05cb076f53b8cdc82c2382451e739930d5bea0c45a620',
  getBulkArchiveChangeSkillTemplate: 'b06a31635587c1091771d1328d2134113602db65e6fde0400bec53ee543394c0',
  getOpsxSyncCommandTemplate: '710112fc225b93836f5fa01607eca23522e104ee811fa2d6d407df64021924d8',
  getVerifyChangeSkillTemplate: '6b6c48c46b7bb6bfa42d5033ab078abbc8e0db1e10802bca49ecb661692f7347',
  getOpsxArchiveCommandTemplate: '7ffae70976aa185fab7cc0c8c77ec5a140474d6ecb1d1cf602bd3aac167c9871',
  getOpsxOnboardCommandTemplate: 'ac46c37daf95b16f36d7f163980b153af9bd24d760f24249a2c08812fff94cca',
  getOpsxBulkArchiveCommandTemplate: '18eee7f1056a6d4e86eb74aae67a7da3e3aa76d9838b730f8a27d3d35e01aa02',
  getOpsxVerifyCommandTemplate: 'c3504a48f248d98411b9990e7ba61e53863e58b7435cc9e429adc37ed6601d71',
  getOpsxProposeSkillTemplate: '9ed74d2aa15be0540cb2c0d8586c0527d63c374155db3beb1336f8c9a0843f92',
  getOpsxProposeCommandTemplate: '5830977f62823b35e416ffb37d1d84dc33c7b0980b7bdca0d04f41495690e06c',
  getFeedbackSkillTemplate: '6bfb7caffad631f807678c2b5d194fb0eb2ed0bc4cbb4bf432b5a3c160c6cc87',
  // Workflow/orchestration templates (workflow-template-parity)
  getOfficeHoursCommandSkillTemplate: 'eb28bb9620b4c23c6901389d0a29a711b99a51d9ee4ca605e93619a869b1b128',
  getOpsxOfficeHoursCommandTemplate: '133749e872c34c8faf63be0dc1ce36a88f7c0fdb29e2860cbdd518e3a7c85aca',
  getVerifyEnhancedSkillTemplate: 'c8e0805ab156e6fe55ce88fdbfa39a6dc164fabdd3f40428e822483c2b8f95e9',
  getOpsxVerifyEnhancedCommandTemplate: '1d4642f8de63144cd776425feb37764ec18091c27aab312eb2dd83d401246e92',
  getShipCommandSkillTemplate: '54a6c43264e24a4c5ba6d2581dfc483f500440fb3a5866dee8aff826598c9ab7',
  getOpsxShipCommandTemplate: 'e86a6bf999bc2fd1f844c894dc5d67db5d844b534233f25ee4a6c0083fb205db',
  getRetroCommandSkillTemplate: '2292ca3e5d65f75d868efdfeca8bb2fe74c71385cb70c238b1afbdc5bb7e1f7d',
  getOpsxRetroCommandTemplate: '9426c0176d7bbf3b201f7cfd8622af3d1c20c80111fd63803afb9c821e5d8cf2',
  getAutoCommandSkillTemplate: '957f5ec487b71129de2cd02fd278421c910689fd6f0fb7b6e839f56ee1f30979',
  getOpsxAutoCommandTemplate: 'c7faded6d24ac8df2814d7cd18aa72033eb3d040a2cf44c87dfe8d97354a3d78',
  getReviewCycleSkillTemplate: '498e40e77d3cc9f6aa4e3ff24e6fa88d21bcd3390c3b959a839f95e146563bce',
  getOpsxReviewCycleCommandTemplate: 'e6f9c44dcf84be55a9b77f33753f92a64a10b08084dc5a7cc0217310fafaab53',
  getHandoffSkillTemplate: 'b99141c959fb745b15560652bedb30a0606e182b663bffb451cb00047bc0ef4c',
  getOpsxHandoffCommandTemplate: 'ccea185c91e3c7db0ebd9a8e981b76993409e782649c20a2312bafb29813d9fc',
  getGoalPlanSkillTemplate: '7f390a14a5bb3e7e5ec9e1de06fe4ab4c5b1357cbd74c3bc36090af699931d46',
  getGoalIterateSkillTemplate: 'e76b7a1b238f8e412736b763d2aeefa0c881d800213cd01ce91a835c2da536f6',
  getGoalReportSkillTemplate: 'a48c1b6c75c5734e051a4aa707ee803c0af73fd2b74b18fb7212e531568a4bed',
  getGoalCommandSkillTemplate: '89610a77bd84e2c5982d393ed9f34cb28cf62063f95b2693f0022fe09c8a3f3c',
  getOpsxGoalCommandTemplate: 'd750abc46d8b2bda6a870f132504af0425a4e0881b5682b62837b0abb2389ea5',
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
  getNavigatorSkillTemplate: 'de777fcedb96db69aff4d1e22cfbb35946561df3abdeba119308a82a9c896a52',
  getOfficeHoursSkillTemplate: '887b746a31dbc7849b7c1df2beef8fe65c4b075636a80b99f53edb673ace0322',
  getPrototypeSkillTemplate: 'd45f6628b0d18231dc84e2c54f79c7153523d9733b2649ad3210675b907c3bef',
  getQaSkillTemplate: '2f89fc92b21fbfe9c8dac40ea74763c5d2f32fb69c13880171ae39b137dbdf04',
  getQaOnlySkillTemplate: 'db11f0648ea3591f4609910525180d62462faa9e36796fcf638e2f3abfd29a65',
  getReviewSkillTemplate: '208332231bceafa883316cc4f787edb4a93857f391f1829efd7c2f08a0e01fe1',
  getTddSkillTemplate: '5c4149303ad3b322d0500431b67d7a4c35af2e4071c56d2499ae8f511de989e1',
  getUnfreezeSkillTemplate: '6bedb3316477b441b7da2f82ee465ca0233a36cd46cbf2434a8f185b14126f87',
};

const EXPECTED_GENERATED_SKILL_CONTENT_HASHES: Record<string, string> = {
  'rasen-explore': '9c798efdcda23eae739f863fd919d4e1be685ebd031bc2ca382fa90d30e0bdd8',
  'rasen-new-change': '41e6ffdd565be0b3bd023ab7375f90cbc9bdf02f2810e9f539cfaa3c42b5b43a',
  'rasen-continue-change': 'de33cdf2ddde0c4f070eebd9fe47cf4f20b586548e43b8ce88affe3f57b3a1a5',
  'rasen-apply-change': '85cb9f82238bea10a601a74a87b18d11ac2dd1e2e07fcb721c8671671a4b6228',
  'rasen-ff-change': '36fd7ca637ef0e8ef664729afa319bf04d27ea737a8213aaecc7db886e89475e',
  'rasen-sync-specs': 'b55134399a8d19e7581ff0a517c49445d6e6c77c50df8605f33eaa33623cabc6',
  'rasen-archive-change': 'e8a6b0788338b2e8d15b471ccdb1ed061a844ad9d6adca6738f28ef8de4e9de5',
  'rasen-bulk-archive-change': '030d62b9fc4a839c86ad57059ae34409632190539145054d50afb3f3f8c78554',
  'rasen-verify-change': '4a2c545e1702cc3ff5744a26e569f194f8ab5b6521b2fd3a20035eb14b9aec0f',
  'rasen-onboard': 'a397c75be833cf7a00c704a749aff7b5d3cfd343e6f0af423c1c9a059bb2610f',
  'rasen-propose': '8a5ea478e1224a005b43503877cbfeded151ea401d0ffd06832f297e374b5d51',
  // Workflow/orchestration templates (workflow-template-parity)
  'rasen-office-hours-command': '3e1373992bce7e89ef612f0c0a1af54f0c124807a1f8de7a45ce8ef7cabdf8e0',
  'rasen-verify-enhanced': '0aacd7dd21872f52942d2cecb033ae2d101012e3c3143effc31c579d45eb2db5',
  'rasen-ship': '06d57a946cb0e1c8891918e8c77acb51f5ce8305f694bb8df8d564b4070599e3',
  'rasen-retro': '4974bdfab1c8393f173a9abec30d984763b99815fc92e590a4cbab4beacb79b5',
  'rasen-auto': '7c12fad27fdc3b1be944c364d6016f8050f210b0fd826e34828eebd0de37efe3',
  'rasen-review-cycle': '56edb30abb6e33b002a3db45aa4111f1d9462e1cb199b044795327d415937f03',
  'rasen-handoff': 'e235fb09f0de1f00de8f6ee76157cfd376e6b7e5746c4f8814c47baefaf85ae9',
  'rasen-goal-plan': '8e88a7ca5dd5cf866a154da94688f108b45614e6e8efcef9cd160352560d7d21',
  'rasen-goal-iterate': '5f3affcb7a470b0e887c227173cb9179a4c8b415aa013a061839059fbf0af0f0',
  'rasen-goal-report': 'cd60a56882984b4babed00f611793b3e1448e54a2bdb94796f8ac06c17445acc',
  'rasen-goal': 'bebe5ac644fb92b31825a4a5ba91ec31883d8288ce201b0bc682ff73de80e2bc',
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
  'rasen-navigator': '175b47706f7d3836c2987faa23fdad46df2a0808eef8e0c1750f857fd83af190',
  'rasen-office-hours': '7b2e2e87d1e33456634a14d44d1da7049bddfb44be0ad60a80937fd4ab9b887b',
  'rasen-prototype': '3f612a29047c8da994c467d5a62a13c66669bbecb123aa75375c695708145395',
  'rasen-qa': '2a35556c5fab8715f9b0c0621a87104b6acf3ab8cf3c20a39b86c31a2b1dc284',
  'rasen-qa-only': '00fcccc3d2b403e5ee648cfac08a039f241285d32cb0e17ce8ddf8986d0bdd20',
  'rasen-review': '085ffaa479d47fd331845b6092daec476be379639b655b8b539a4bc27b733dd5',
  'rasen-tdd': '8d953757ae31296a628010b07d1f229d4c3d983e44836e3b70031aafcbb9a463',
  'rasen-unfreeze': 'ca727311494108d775f3f34f7c21ea104943e2e12f17f5c1051e3952cd5486e2',
};

// Intentionally excludes getFeedbackSkillTemplate: this list only models templates
// deployed via generateSkillContent, while feedback is covered in function payload parity.
const GENERATED_SKILL_FACTORIES: Array<[string, () => SkillTemplate]> = [
  ['rasen-explore', getExploreSkillTemplate],
  ['rasen-new-change', getNewChangeSkillTemplate],
  ['rasen-continue-change', getContinueChangeSkillTemplate],
  ['rasen-apply-change', getApplyChangeSkillTemplate],
  ['rasen-ff-change', getFfChangeSkillTemplate],
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
];

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
      getFfChangeSkillTemplate,
      getSyncSpecsSkillTemplate,
      getOnboardSkillTemplate,
      getOpsxExploreCommandTemplate,
      getOpsxNewCommandTemplate,
      getOpsxContinueCommandTemplate,
      getOpsxApplyCommandTemplate,
      getOpsxFfCommandTemplate,
      getArchiveChangeSkillTemplate,
      getBulkArchiveChangeSkillTemplate,
      getOpsxSyncCommandTemplate,
      getVerifyChangeSkillTemplate,
      getOpsxArchiveCommandTemplate,
      getOpsxOnboardCommandTemplate,
      getOpsxBulkArchiveCommandTemplate,
      getOpsxVerifyCommandTemplate,
      getOpsxProposeSkillTemplate,
      getOpsxProposeCommandTemplate,
      getFeedbackSkillTemplate,
      // Workflow/orchestration templates (workflow-template-parity)
      getOfficeHoursCommandSkillTemplate,
      getOpsxOfficeHoursCommandTemplate,
      getVerifyEnhancedSkillTemplate,
      getOpsxVerifyEnhancedCommandTemplate,
      getShipCommandSkillTemplate,
      getOpsxShipCommandTemplate,
      getRetroCommandSkillTemplate,
      getOpsxRetroCommandTemplate,
      getAutoCommandSkillTemplate,
      getOpsxAutoCommandTemplate,
      getReviewCycleSkillTemplate,
      getOpsxReviewCycleCommandTemplate,
      getHandoffSkillTemplate,
      getOpsxHandoffCommandTemplate,
      getGoalPlanSkillTemplate,
      getGoalIterateSkillTemplate,
      getGoalReportSkillTemplate,
      getGoalCommandSkillTemplate,
      getOpsxGoalCommandTemplate,
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

  it('teaches store selection in every deployed rasen command template', () => {
    for (const entry of getCommandContents()) {
      expect(entry.body, entry.id).toContain(STORE_SELECTION_GUIDANCE);
    }

    // Feedback has no store-capable command and intentionally carries no
    // store teaching; it ships outside both registries.
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
  });
});
