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
  getOnboardSkillTemplate: '0cc15720a0e7d5ad2e573bd70cb626a54f1328532db2440a25e3dc45e4995f2d',
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
  getOpsxOnboardCommandTemplate: '6dc24308340c2994b9ae6ce3a7799759ef783e42045749686087354762c3c3d4',
  getOpsxBulkArchiveCommandTemplate: '2ec110e158686fdf231de3ecd37b4bffc5707c4f814e2af20dc7aa15a0883bdd',
  getOpsxVerifyCommandTemplate: '564a6bdfe81ce189a5493e54d0c2769ba9e328a4df631b4012df45ead12584b9',
  getOpsxProposeSkillTemplate: '8392f11f5ec54a4a5adbffd55bde87d35b265a16276ca070b269fb2377db89b8',
  getOpsxProposeCommandTemplate: '3cee2b413e02429103283394de60bf6242385f5a02607b0aa64d5460675a2be4',
  getFeedbackSkillTemplate: '6bfb7caffad631f807678c2b5d194fb0eb2ed0bc4cbb4bf432b5a3c160c6cc87',
  // Expert skill templates (inlined; see expert-template-inlining)
  getBenchmarkSkillTemplate: '949df200e9076e3a76dd2756d7a01fdc642d0ac21b0b151e586c6b2ed7bd3755',
  getCarefulSkillTemplate: 'e2ee6ded43180bdacee2369c1eaa3babdfa5fc3683f84f3d9d963db870b3886e',
  getChromeUseSkillTemplate: 'b427d1e13d3ed206f391fc336ea7f20b396393e56d04595e179b8bfe69331306',
  getCodebaseDesignSkillTemplate: '3c7ce1db108484d2099e723a7141e1b270eea8891bbe2fde8dcfdbc162ac1c54',
  getCodexSkillTemplate: 'b921078385483e70753bc05cc847e0f52a28a5179d389fca2570ee2b5a09b2a4',
  getCsoSkillTemplate: '7360c973109003128702cf777a62e591a19fedfccd506ca172e6396759f28729',
  getDesignConsultationSkillTemplate: '48ba3863e5d4edeef0aa1a89b344fe2a69303c3abff4203a48521e9ae27b1d9b',
  getDesignReviewSkillTemplate: 'c0145d0bde3390f397a972169a45a1bb5c4e6c91a8f22cfce8ed42f281de8953',
  getFreezeSkillTemplate: 'fcd4b8f4fc0912211b4f2d72f6a9fd084646c12d5058bbb5587cd12f02076a3d',
  getGuardSkillTemplate: 'dd20f6ec6be771840d6c63ea7329c3059051f6effe5ae8940aef5e54d65bdc0f',
  getInvestigateSkillTemplate: '328b73b8317beb4ab6f7a4eef00c05d6285f48e736e463faaafc385190472e54',
  getNavigatorSkillTemplate: 'f84cdf76b1a2c9828583b03842e6dbd67f19fdc02248c19dd29a85b98b2686ce',
  getOfficeHoursSkillTemplate: '61da4d37167ab6044f54f4f03da1f64e061a7075f081e0d7b18942114d00a37d',
  getPrototypeSkillTemplate: 'a657c175c38b05136c7f0552e394296795b9b4b0481d1571b8e6fb59ed3a20ce',
  getQaSkillTemplate: '742ede49d1b748c37d7f492434fb5249a11ec8cf82ba0f6a3f59ea8f083c05eb',
  getQaOnlySkillTemplate: 'ddf1f635b11b06c2f4116a2693e38d58209e18b2685cc93c418a89f998448d1f',
  getReviewSkillTemplate: 'a0a3eaddf5a1897fa37ed5f4bb5ac5e182893af2be6d3fcf1d5a21a9e6e2b5aa',
  getTddSkillTemplate: '025da477b38a229213e4e4262e1ea19e2d0965f3e229a9bbbfcca583e4416193',
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
  'rasen-onboard': '51199524d72af97a0adfae717b05731dc68e330c49d2ef85b3661fd7989a5497',
  'rasen-propose': '4453501cf4ceb55121e11c12b6e2d07414ca2e2fe2480ced8417b2bc6cf0481c',
  // Expert skills (inlined; see expert-template-inlining)
  'rasen-benchmark': '9ba43095569d1ad5a5cc9595bc628a34668459f64acb279ae9efb9bf2fb309d1',
  'rasen-careful': '63b4eb6cabbd5eef8ebf97199c1656cf9cb4b22d815d3cf873c3445e7aa91aa4',
  'rasen-chrome-use': 'a1f366619feaa12058fb5ccf5b6b686c318a29fe128390faec4d7c39bec851b4',
  'rasen-codebase-design': '78b500263e385f9019695e26e5b1d85d45a849b142116643f5fd435bd59d2ccd',
  'rasen-codex': '39dcffc87e823739c76f0fa5d06b702b8856c4f4349341361a14b070728aa7c1',
  'rasen-cso': '04f9908c21f0a330bd5013675f85b1423ce4d5746ef801ba362e455391037033',
  'rasen-design-consultation': '85592bd569090da7b125d4e419ef00bbe2cedd34099c965e39f2739fb55bd82a',
  'rasen-design-review': '4a0ddc8fb87ae8f07623d4ee3d942005d87aba801995457db31b342a82aceb5f',
  'rasen-freeze': '8077fb923c13595886d66f304a347a5dcaeb164b31170e0c34d4a511be3da6f5',
  'rasen-guard': '3bf7c046d581c01f8b85632b5fb9c4d5f05e6dc629153ce13b523547665222c4',
  'rasen-investigate': 'bdd07357b0c10bb3f78e7c4ddd57e9a17b9575b5d3b6fc8b2a8cfd2d9c3bc244',
  'rasen-navigator': 'e14ace5c739495f7777fa70bdd59bf99ee03a783335b1df28c54b08ee47f570c',
  'rasen-office-hours': '9d88ec8e7740e64213f8ba88b62c98aa08123c12b5fc075daacd4b78d3a67691',
  'rasen-prototype': '6974c3e56f6899f81b1d7931c71fb11d344a96f98ca6c75dc7565d7a96a2cc4c',
  'rasen-qa': 'af0fbd119b4eeb12c29777891306c02f6cde3e8f44f4fb9c42219eea546cc71d',
  'rasen-qa-only': '134daba6d4caaa2dcdc5f4c9d852e606077ca2232012dea059913df47a72f18d',
  'rasen-review': '0f1ad5b422a3369ba2e45bf5f11e88adbb1cca590b0208a30af87f04df45b3f1',
  'rasen-tdd': '31ed926d545e24ea3a4d128491abfdedb8cd4e48df2912cb5e9db018eefc0a71',
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
