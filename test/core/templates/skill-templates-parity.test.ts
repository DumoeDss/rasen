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
  getBenchmarkSkillTemplate: '5fe65ec5f8455bd9b942ffabc964aace95a41f36d5ad693d43f025f0b3d2407a',
  getCarefulSkillTemplate: 'e2ee6ded43180bdacee2369c1eaa3babdfa5fc3683f84f3d9d963db870b3886e',
  getChromeUseSkillTemplate: '00e22661ac58c9ad2efcb9d83f5f59cde8cbf3ca6c5ac9b474cdf21310b3c67d',
  getCodebaseDesignSkillTemplate: 'bf28c6bee2e9b5634a43ef5dc14d4f0ecf77be49d44d969e80f7e9790fadf97b',
  getCodexSkillTemplate: 'f338c3fb546894f4eb63cc52ec9b2d50c349cd3136a16a0bca26a05d3ead4eab',
  getCsoSkillTemplate: '769f48609e53738efbe5d1c04b86426f256b6b62b1bdb46e53be95b31c21626e',
  getDesignConsultationSkillTemplate: '9f5ebfa59acdd13adecc5ef84704f1b3b7a628a106771eb709d099b77cfdb23d',
  getDesignReviewSkillTemplate: '8c66a7fe9bd4b45884ae9aa8cfc5bb1a222a5cf6840f1ca24772dd4e523f3a85',
  getFreezeSkillTemplate: 'fcd4b8f4fc0912211b4f2d72f6a9fd084646c12d5058bbb5587cd12f02076a3d',
  getGuardSkillTemplate: 'dd20f6ec6be771840d6c63ea7329c3059051f6effe5ae8940aef5e54d65bdc0f',
  getInvestigateSkillTemplate: 'c759d1d0df37c21e31268c84e2dc3222f00332ff39dcbdc04d4226c00c0a93b3',
  getNavigatorSkillTemplate: '0d7919234eac89e6bea4e5a3617c640b2940068206282eeaf6bfc792753ea529',
  getOfficeHoursSkillTemplate: '15a216eebe29140173ec66dfaea0e4324d4db5d4961c67e09a694c5e9239675b',
  getPrototypeSkillTemplate: 'a891c71bb9b88557258fe72adce4601e6a6bc25085d6bef8da221e28b2b6a717',
  getQaSkillTemplate: 'c0e86c4c1b4e262d8fe6c089806d8cae05538a4117777a4deeb3825046529bd0',
  getQaOnlySkillTemplate: '33718f38d42299065d85d82a5fcac50160213c97b4353f23bb46f152abf3884c',
  getReviewSkillTemplate: '039c628d3cbf9cad7b8a1c30dced405884a780a31ee6ac04d5d8e66c070ee3cc',
  getTddSkillTemplate: 'd407c7d6e848ada28adfee96cf227c8e9fc14f0fab7a4e4e4f25ef8dc549a7c8',
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
  'rasen-benchmark': '501a32327f84e3bfa6387e9277f2fb8afc5404102f6d83775a3c541d77358dea',
  'rasen-careful': '63b4eb6cabbd5eef8ebf97199c1656cf9cb4b22d815d3cf873c3445e7aa91aa4',
  'rasen-chrome-use': 'a9feb10570115706693fe3ce6fc05afec87c753fd18e70c7bdadcca5b5eebe5e',
  'rasen-codebase-design': '9d32eb60a848e36c79780b41dead79f0ec6f637c5e80d24e0b703d9f46552a1a',
  'rasen-codex': '0e929faf60407b4a2970e0ce5268e5fea0d32e536ccfe599f6ed69e8f6fcb3ff',
  'rasen-cso': '6c6c760e4f7aa7180d1e066cab5c08f7956de6a58885d71533995d270fafb412',
  'rasen-design-consultation': 'eec5377e82c524794395e43cf6aa85e6492a1ebda706b74abce294e1852fe615',
  'rasen-design-review': 'd2fcfb63b19ae10eb0013137fc7edbcab2291d942ba61e206e5ad0b46ab2d851',
  'rasen-freeze': '8077fb923c13595886d66f304a347a5dcaeb164b31170e0c34d4a511be3da6f5',
  'rasen-guard': '3bf7c046d581c01f8b85632b5fb9c4d5f05e6dc629153ce13b523547665222c4',
  'rasen-investigate': '3c61b4d4104134399fa36a759f707bb454b8f24684e702fc389f4d1419bd230b',
  'rasen-navigator': '0ab5f328ad2a6a4e6a8c33015d52ce9385b64c34230d4ff7f1b757251d45a3b1',
  'rasen-office-hours': '80bd919748ca2719a46862e6eb1bb83f40bf296351d9f29f1a878228dfc50777',
  'rasen-prototype': 'e432bc133b92ce226e92cac0b252636dfad11f1bf3722b15718af2c02ada0cd9',
  'rasen-qa': '426465fbfade5a885781ec17a9d95f675e9f1116fe99f3a6d103db4bfc8192b6',
  'rasen-qa-only': 'de4425043050632af04752d4279d7595b11d839fb52e738d5639f07242cf1103',
  'rasen-review': '5a173ae1f93d30aecf8a81cbd3443b0a0836c782a80fb503346b08a277dd9172',
  'rasen-tdd': '1ba2b966aa4365270a274c55c3dc2066118feadea0625ea524f007ef3892a300',
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
