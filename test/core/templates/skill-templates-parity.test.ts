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
  getRetroCommandSkillTemplate: '89d11fc4e62b6e6e59fed4082cd44ce3ce3b9673a9d2d15ed5aceb020cd7e58f',
  getOpsxRetroCommandTemplate: 'f61e8e183e129cc1499c4bc581e7a48015e2ef2b76f5a2815ce4aa59efcbe1e8',
  getAutoCommandSkillTemplate: 'b4514fcdc457c89b1b8cd5e90a58e9bffc174bf678ae913997543df297a7b37e',
  getOpsxAutoCommandTemplate: '835fcf6151a018f6eaa14f697c9e2022cb29b8fdebb801d36925de0ead2edc7c',
  getReviewCycleSkillTemplate: 'd14bd38ee51dff5cb70ba2ed5d1a40708bf2a583457a14c64cf0a5ab96493890',
  getOpsxReviewCycleCommandTemplate: '8c680d7dd388875aede56f515884f196c6ee2593097f167f6d9935bb03d8cc9e',
  getHandoffSkillTemplate: '15d442acbf369e27a21a8b6631f15386fe11fb1eeb3f9fbdb5065cb2a0627722',
  getOpsxHandoffCommandTemplate: 'f50bbf855ea18de05412f83775cde998bfde0143af782dbcbf18c71d483d55d9',
  getGoalPlanSkillTemplate: '7f390a14a5bb3e7e5ec9e1de06fe4ab4c5b1357cbd74c3bc36090af699931d46',
  getGoalIterateSkillTemplate: 'e76b7a1b238f8e412736b763d2aeefa0c881d800213cd01ce91a835c2da536f6',
  getGoalReportSkillTemplate: 'a48c1b6c75c5734e051a4aa707ee803c0af73fd2b74b18fb7212e531568a4bed',
  getGoalCommandSkillTemplate: 'e84badd838560fe0419f1b4d684f82859b1ebbef60a6c9b3ee84d8b785569034',
  getOpsxGoalCommandTemplate: '13fd121dffbcbac4245862b8c39a8846acbfe3e6bdea299da1fa810ed4a2d261',
  // Expert skill templates (inlined; see expert-template-inlining)
  getBenchmarkSkillTemplate: '865b6a31eda95522c856706103f651f409df9987c657fc8e640f87977590a38b',
  getCarefulSkillTemplate: '490370a34e8ee6f57ad128d155cc095c48ab52cc09cb6f19dbbaae1b777f3576',
  getChromeUseSkillTemplate: 'f3b8d10339bac1ec68ec138e19661b1e148df039cc13cf940902f6176737a2da',
  getCodebaseDesignSkillTemplate: '32a82a9dd2633b90cd543454e3e56387f88a34c665c756f89a20e166ea9d1833',
  getCodexSkillTemplate: 'ba36dc7f7816f3ad1ce1cfc5f9ec3d397effdc7d5a31c69ef10193604af8f781',
  getCsoSkillTemplate: '73fd727d2a7c4b62ecc6f99aa5bfa4fc6a9fa1640cce54a6db3b0ee781169930',
  getDesignConsultationSkillTemplate: '8ff33d679fb7641c1359b16821ece309189eba786167079a58e13ac679139c1a',
  getDesignReviewSkillTemplate: 'efc2d286bfd3d198441c65cfb578dabfee12f77b69a675659b095069a82f2d36',
  getFreezeSkillTemplate: '985f1c0042bac9c17ce68f387e2b4065820c576a9bf035006a5253ed980476ce',
  getGuardSkillTemplate: 'a1997d27fd18bc5ed92e0ee923f34bc782f40e60743065edb768b5a8cdc01143',
  getInvestigateSkillTemplate: '106be2ee320b146ddd9af8e185280f2bf864ec397f7509aefe085f85398cdb3a',
  getNavigatorSkillTemplate: '1ed652e02ab214f061e0be5068a64f78ce57354b9d3969650827fc7ac700ef8e',
  getOfficeHoursSkillTemplate: 'e915b1148de453d4754f6dc55372e545f5d8fcdfa0b92767a005d1e31c4f7889',
  getPrototypeSkillTemplate: 'a3abd04c70ddeb62726df37f08e306051846b08a06bc257cc95968f0d867c9bc',
  getQaSkillTemplate: '03c615f2016e5258d5d8a0dc319f2103dc2079fe3651f4fee450329c805d4fdc',
  getQaOnlySkillTemplate: '642f47429a7b5bc01a2098e91c2233e77b321458ad8d478b112567bce894a81e',
  getReviewSkillTemplate: '0169054adad4155f1e26c19146df734ef2043578f5d5ec294c90bde30464dbde',
  getTddSkillTemplate: '006785744142cca7726178df3aba0d04c37d53c94eeaea689c5dcda4c77a8728',
  getUnfreezeSkillTemplate: 'dcf14636aa5ae051a6b3be21ed36a2e965fe4569b53af544e4216f41e2a5510d',
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
  'rasen-retro': 'f64dcc0b05157ea233171f9021d9261288b5a9a5e436e4a86ddd62ba822ed6b1',
  'rasen-auto': '2b29824805b98579ce415693713a151895e32af0bbeb2bf66014e2f9d47516be',
  'rasen-review-cycle': '313ecebc4e30f6423d0f24e58d84fb537326929fae442d26e6dca3241ff3cb9d',
  'rasen-handoff': '7250b4d70dceada36244440e2e08ce55460bfe8b0ab0aba7de55f9b269bb5879',
  'rasen-goal-plan': '8e88a7ca5dd5cf866a154da94688f108b45614e6e8efcef9cd160352560d7d21',
  'rasen-goal-iterate': '5f3affcb7a470b0e887c227173cb9179a4c8b415aa013a061839059fbf0af0f0',
  'rasen-goal-report': 'cd60a56882984b4babed00f611793b3e1448e54a2bdb94796f8ac06c17445acc',
  'rasen-goal': '53da3aa14c797461a57a459b134ab31fff7292a58584952e5367e3beffbf35b5',
  // Expert skills (inlined; see expert-template-inlining)
  'rasen-benchmark': '003a8238e5007544b1dfa66678401d14b76557e5c15df385ccb16bc23d876c49',
  'rasen-careful': '662a886deb2052718a93d0d3d4151a7959111b32de9c73c99ece2eae9bf20ff1',
  'rasen-chrome-use': 'a2be0b82603b93b3df38256c0a8fda1c00f510c52d5e7185c1ca05e506fc4e48',
  'rasen-codebase-design': 'ca9b8724b4734f389da0ff1673e1a649b6f2bfcefd4d359a42596608060a8faf',
  'rasen-codex': '0433536da52eeca81374345c008796cf006bd62b84068489348712aac744550d',
  'rasen-cso': '1194bc290fba8bee3d79b5db0646c1c240825ee28c6993669300d5d9e5064e42',
  'rasen-design-consultation': '7a7b08ba634adf8c30d58404084903654b9d74be49bd135614e55e398cc6e71b',
  'rasen-design-review': '3d0ff4051064c49f792af02aad0faa5dbbfdc370e4dd0ea6de6dba39667d7ad6',
  'rasen-freeze': '4ade70db06162cc08e7bcd1606101b4921420cbc17f323edf65da2ab75aa77ff',
  'rasen-guard': 'ca17f9320886938d37b64c81e33a0293a2aaa09e3592afb43bf697ad47aa70d5',
  'rasen-investigate': '4d82caa7bfbb3e81631c4257ba93e08a98dddb5cddcf57455f80d67ae5d22f76',
  'rasen-navigator': '1e3ee77fd494d86bb8446b19c92169dd237df9efe3a58972db46d37977b58c59',
  'rasen-office-hours': 'cc13323e555b89deba3f5afcf663417bf16467ed1ffeea829e133078c41c560c',
  'rasen-prototype': '3ecf4ca3b5026cbf43367c166900069f2536f2f84c7355accc141e06579e636f',
  'rasen-qa': '59a7056c596e94e67658e40085713fa805834a6fa78ec7fa7e116adf2615f96c',
  'rasen-qa-only': 'f7a260b5ba2903ed45b283176b7d57c99d979da92188b88482b242e16d8e2e4d',
  'rasen-review': '6f2d7cdac3bdf228f7364be239d4ac5b7a62f51ede413fd3c65da3abf224cbd0',
  'rasen-tdd': '8e4a230d27441b997344076b2f796c4c142a701b64458a4408bc7e32d03852a9',
  'rasen-unfreeze': 'eb17f73e170630d182ec0eaed3359739040e0728827c2ee456e7f4a12f37c6ca',
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
