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
  getExploreSkillTemplate: '6b8e81ae41af43d0c94465731732d585f402e3e078a311a299f3ba2ec1e5b569',
  getNewChangeSkillTemplate: 'a8ec48a8ad31bb2a81bdc879b6e1bd5d660aaf1a1232e339ce963aab8a10e7b4',
  getContinueChangeSkillTemplate: '87df8ec03ebf7ae5e0424419907c8f0a479b763b971402f8bca582e0b60ff137',
  getApplyChangeSkillTemplate: '16da16233abcc1d8e1782619146cfcf297d7f3477072d66a5e16937c3f191148',
  getFfChangeSkillTemplate: '3d614252c8980a09c2d92fc17b170dffc864298e0aa8dd8a3974d74ab08c5c10',
  getSyncSpecsSkillTemplate: 'e8c4ccbff172b205f80d47b32fb989cf53c13d72c786a735b12f4a2bc7cf4cfe',
  getOnboardSkillTemplate: '4a2d18b3fe88219ec561c0f11ecda451cd48b2d3ef6c4dc7f4c8f6d7ef8edf2a',
  getOpsxExploreCommandTemplate: 'f98f7861653fd17c7a169e75650250f65986726d3178e113c6990787cf194fb0',
  getOpsxNewCommandTemplate: 'b80a0652ed10276322abb461fd1717918e6e8dae70719f04fa8ade999689f37f',
  getOpsxContinueCommandTemplate: 'bb03c9c9ee2eab9290041500a1a1987cdec178b15da197ba63b10c19779ae58d',
  getOpsxApplyCommandTemplate: 'b93b014bb3a0d45af1e441246afc9db18f25e9e472f3ca4c14ed15f2b5919e44',
  getOpsxFfCommandTemplate: 'cb3b29553a96e8580c5544be2e47b8b1e99a9820816977926e6330b6ab6b483f',
  getArchiveChangeSkillTemplate: 'c904ae7db932514e36720131930071736c84d66a788146f5818ed00a55c98ffa',
  getBulkArchiveChangeSkillTemplate: '9e685055ddab0857c4578f7df952629755de9d0b8a64d4c655d63a452618b838',
  getOpsxSyncCommandTemplate: '31a92cde79edec4f63c629c273da1afb2782dbdf0f564a9a7811e314873ae91e',
  getVerifyChangeSkillTemplate: '341d0ecf56767d6761a89d599d0edc4dc81f18df9c1debe6c67011e613fac08d',
  getOpsxArchiveCommandTemplate: '0b76417b521fb526b4efcd0d52fae993bde9ba7dfd8a1bc2b1722f299720a678',
  getOpsxOnboardCommandTemplate: 'e3f991c851a77d64658895ac288435b5a7ac3018f80638ac6b599afb5e0d9814',
  getOpsxBulkArchiveCommandTemplate: '2ec110e158686fdf231de3ecd37b4bffc5707c4f814e2af20dc7aa15a0883bdd',
  getOpsxVerifyCommandTemplate: '564a6bdfe81ce189a5493e54d0c2769ba9e328a4df631b4012df45ead12584b9',
  getOpsxProposeSkillTemplate: '8392f11f5ec54a4a5adbffd55bde87d35b265a16276ca070b269fb2377db89b8',
  getOpsxProposeCommandTemplate: '3cee2b413e02429103283394de60bf6242385f5a02607b0aa64d5460675a2be4',
  getFeedbackSkillTemplate: '6bfb7caffad631f807678c2b5d194fb0eb2ed0bc4cbb4bf432b5a3c160c6cc87',
  // Expert skill templates (inlined; see expert-template-inlining)
  getBenchmarkSkillTemplate: '5f822c4cf09885044a4db4c2d7647bdefe7da124a547eb9ffddd48e82d6041af',
  getCarefulSkillTemplate: 'e2ee6ded43180bdacee2369c1eaa3babdfa5fc3683f84f3d9d963db870b3886e',
  getChromeUseSkillTemplate: '0bd51edb76f27df78830a18d7195836cd7a8370c3728b8533f3e90649934ffb2',
  getCodebaseDesignSkillTemplate: 'c07728ed0f03d79830d332ef36888f79941e6088ee5b827e5337120ddc23160c',
  getCodexSkillTemplate: '79baab67654ade8ae89d6f8b778a40da2ae0cff53195fa1ef4d1e030760ac8ce',
  getCsoSkillTemplate: '69498d17c9e031cd01d22a343fdbf63effba8628395a5d20971b6c84dd144e2d',
  getDesignConsultationSkillTemplate: '6b274ec6b13d5291b0c2c7a82e2c13f7eef21131b00f95665f0e347e4bef8c22',
  getDesignReviewSkillTemplate: '88535ec06dce203bcc3c37fc520b39bf6ec86c8e9efcc25c4f128e3fd3fac095',
  getFreezeSkillTemplate: 'fcd4b8f4fc0912211b4f2d72f6a9fd084646c12d5058bbb5587cd12f02076a3d',
  getGuardSkillTemplate: 'dd20f6ec6be771840d6c63ea7329c3059051f6effe5ae8940aef5e54d65bdc0f',
  getInvestigateSkillTemplate: '3db3d2cec0ff1fdba22f082c7c7dd57ca1442da186717638dc6924ff46793b28',
  getNavigatorSkillTemplate: 'e3307c095077f02c7d0ae97000fc57040cd1505d3f77a27a92325bf1d858d561',
  getOfficeHoursSkillTemplate: '2e360443b5fadfb65929f4feaed05a81ff48f5e884e2f9196755bff333180bd8',
  getPrototypeSkillTemplate: '1918dc87f5872ca3226694c3140622311a211ed52fa17c6a930b9773ba14c2ee',
  getQaSkillTemplate: '3f42fd32d01813513db57db02d8d7ddbb04cc65b511061b33e92627671accc41',
  getQaOnlySkillTemplate: '7db79b001650bfc6b2351708d8107ecde6cfc96d0332bc110f0fbee255731ae5',
  getReviewSkillTemplate: '7036bcae02bcefeed125eb1905484df5cbafafe4af5168e185f6062ce15fd357',
  getTddSkillTemplate: '60d272ad60300ff41fc6fa8e1a76e5a0bc085d3a7e0d1e0fc3d678dcb9e6882a',
  getUnfreezeSkillTemplate: '44a74b5bafa89c975c06abb4ea3c1a121870673c43487d10982ae6f6d6e8d802',
};

const EXPECTED_GENERATED_SKILL_CONTENT_HASHES: Record<string, string> = {
  'rasen-explore': '5dec2d6967b4cf5569f4c9a6bcaa61124e49e00f8d51aaf3be95650076f87cf8',
  'rasen-new-change': 'f2c1abfe12e72328fa2a430fc7bba0f534cf857bac484c154e8ca851722bae7e',
  'rasen-continue-change': '617a13eaf19211be39a0afeb7f053d6ba81d4a1b889e5df254817b08f54b54de',
  'rasen-apply-change': '8d7927008056926629d15b3fbfe9771b3a73fbf7d21a76eafc33ff47cd39f3de',
  'rasen-ff-change': 'eb482863f96f07b7ca9c4cdb7c7a630821bbc1bf819c41dc6085b43308b21a76',
  'rasen-sync-specs': 'ffaf1b95740798cf16c8ce5c756ac4ae8d4f4164b32ab1dd578f20831c978698',
  'rasen-archive-change': 'e518c85d7f900bd08c9d45d0dc82020733e87cecfbcaea5ad2c6b24326390787',
  'rasen-bulk-archive-change': 'c8cc59d68ebac30d54216f653e03fa4bdadf2dbc8a078cf5d07bf4eb3d4be4c2',
  'rasen-verify-change': '2ee68153364b38b14a622c0a2c785cf67a874c14b147a34813825414852b67d7',
  'rasen-onboard': '35c4f0714b842cb7a3a3bb8c5a6537045efe6e8fdc6a8dff5c9b7028df7c9369',
  'rasen-propose': '4453501cf4ceb55121e11c12b6e2d07414ca2e2fe2480ced8417b2bc6cf0481c',
  // Expert skills (inlined; see expert-template-inlining)
  'rasen-benchmark': '15fb34cf8b9f01f2ec312fda53be32dbe00f0ea7d86b3eab02424ab9de8c5315',
  'rasen-careful': '63b4eb6cabbd5eef8ebf97199c1656cf9cb4b22d815d3cf873c3445e7aa91aa4',
  'rasen-chrome-use': '891615213cf1a5d615827035b036f24a9ea93d496b912d8e2e15ddb3d55fe3f9',
  'rasen-codebase-design': '50986af8b6836491f83ec4754dd3cad7e43076e478315e2f9738e0e98634972f',
  'rasen-codex': '6f3282687975938439b3dc4742c051c22a38f5f3bdbe0493e5da62383925a7fd',
  'rasen-cso': 'a314f82fb11aaae2b6704756a3f9827d2fa070a8af7f24b3ae657992e0ecc3e0',
  'rasen-design-consultation': 'e2b2925c2b4e10f12c1de7e135effb878af71741fd024a006161387e3a96d0be',
  'rasen-design-review': '59803587e6a6ad878a49e8509d2f09737e51393a6cd6330999039f1f6b1ce82d',
  'rasen-freeze': '8077fb923c13595886d66f304a347a5dcaeb164b31170e0c34d4a511be3da6f5',
  'rasen-guard': '3bf7c046d581c01f8b85632b5fb9c4d5f05e6dc629153ce13b523547665222c4',
  'rasen-investigate': '03a100f88207dfbfbea01e5527091fd37e0bb9558a7b8a4067b68394d7df8001',
  'rasen-navigator': '00db514fd15e813acfa8e9d2de63a684bbcd7ebbda0d7dc7790996a675fdcff1',
  'rasen-office-hours': 'cd519a8050c0cb0188939cbbc352e4c57672e10767606ce0278b7a788ac451ab',
  'rasen-prototype': '6262d86fc6abae9f9d04a1b45da3b97fcdb599dfffdc27d4e7dc9bcfc314d91c',
  'rasen-qa': 'c95e219f574da7461ff0dce45258f4c8de69fc59bdbaf0ec010ad7a5c973b320',
  'rasen-qa-only': '190b8f8a903138c900ff41218db1e71811810d3c25a2ec0f5ca0e40a17bd706a',
  'rasen-review': 'a85ed9e38d3ea7209aeeea67df84645bcaee80b7e331f36cc56e0784dbe1deb6',
  'rasen-tdd': '5ccba4f683d1cfa9998b20228314013916bc83fa7c8bf8a36614e1e2e0927685',
  'rasen-unfreeze': 'f32b9b0a5b2a5dff8b8d83e510142d19e75ff0765050016fc7479bf8919b34c8',
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
