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
  getExploreSkillTemplate: '10bb979159540bb772fce9ebb3a91cc5cc63e9539a6df4d766ed513d3669c576',
  getNewChangeSkillTemplate: '51de138d1afb1115e75104aa54de1868f717cddfbde163b914593c83382c367c',
  getContinueChangeSkillTemplate: 'd4db3f01df9fc7e60678204e9eade270068d3673b64d4921662e3f9a70e14665',
  getApplyChangeSkillTemplate: 'a221204058d62c6181970f5afb3ea7d8b3d7d435ddcdd4f06395cc2bcfe11881',
  getFfChangeSkillTemplate: '4505bac7c5e58caff62ce52b7fc7db7d2595f73d321e80886d9bb4aff225c825',
  getSyncSpecsSkillTemplate: '03b1ce03b257587a43b62cf0de64be009a61a0f38889678e1e6681f470575d58',
  getOnboardSkillTemplate: 'dedbf0fd6aafc3d7e2dee57af1ddb56a03244ddda2ea2c40efcaa3aadb11f1d5',
  getOpsxExploreCommandTemplate: 'b8b4f89b8d9ab0a51c0292f5e52cde88c2e544a59551a1393a0abcdf0008538d',
  getOpsxNewCommandTemplate: 'abdfd5cdb0bf14e088596b88508d42b2f696b93fe87993ad2421407c52a32f5f',
  getOpsxContinueCommandTemplate: '32156499c11bed2144a8f4f0cf823874108dd4f3f8148e6f1ed56dfa5ecc1794',
  getOpsxApplyCommandTemplate: '33b4d4d1dc007a1980afca50fa73bd228dda4cb81a4e104f49cfabf3e0c7d917',
  getOpsxFfCommandTemplate: '16902509842b011d14085f56944185c8ce241a386763cd86919c5c09eb829f2c',
  getArchiveChangeSkillTemplate: '317f05c3481d08d65da06a1cc686ce2304716ab3761fa63f05de61e35c3e66be',
  getBulkArchiveChangeSkillTemplate: 'bf324a723df82445eb2f1176ffed76d53633664959ecedcf152c7432aded7f2f',
  getOpsxSyncCommandTemplate: 'f27ab2cd48f2ba00c404cb227d54d6718b98875ab0d894ab10b03394314196e7',
  getVerifyChangeSkillTemplate: 'e018101acc3fb54604b4915fd7872c238551e50ea438c953f1213116136c468b',
  getOpsxArchiveCommandTemplate: 'cb157e103633889e8eff019be6e423f3f73a03fc5a0422c3cda7d2919e76b37c',
  getOpsxOnboardCommandTemplate: '1a0f6bf24316befd3be15ecfff9da2e63abffba9307894a64fa6e9a67de40bac',
  getOpsxBulkArchiveCommandTemplate: '2c5c776bdfc55adbc06271f186c858aa6e364c246fa4b806e385369c47da8a8b',
  getOpsxVerifyCommandTemplate: '20880e597c7953056bba7132506e7627fd3ebd761d550254d6a0b993fc73407f',
  getOpsxProposeSkillTemplate: '35bef44dbafa8ebe81668349e7b2a5a7a95c7138d1b3e73f2c5eb038212322f5',
  getOpsxProposeCommandTemplate: '4293c76508442f72e9a0ff979c9f8aee1f26c6046fb951dab33e21d320994553',
  getFeedbackSkillTemplate: '42e934c355d9bf48ac33abb861bbf5c3893d1fe5b41c0610af5935858bbc3875',
  // Expert skill templates (inlined; see expert-template-inlining)
  getBenchmarkSkillTemplate: '57646757f5fcc5343d070c1bcca249805cc77f14401984efa7426f8886f43e4f',
  getCarefulSkillTemplate: '843881e0c981601513b09513ec56b57e77986c3b0706a6883adf73315c278d48',
  getCodebaseDesignSkillTemplate: '1bcc33526d704458a18db11267430950db6db98ccd125d338f07b1c28dee6ca8',
  getCodexSkillTemplate: 'd559635a007c548cb0dc2570fcfee86700740f131e324336ab0c855224913146',
  getCsoSkillTemplate: '0a5757a93f56532264aea2140b6a3aa224750cc877c5680354777fcb164b9e4a',
  getDesignConsultationSkillTemplate: '2dc482e5d842cdbc552e9cb0270cebb7839cade78fffe8f5fd51323a78a0e4f2',
  getDesignReviewSkillTemplate: 'b70021e08e1060d6a9b8ecb64273f0f6be2e5cba30fdc1468ef589f59dd3474b',
  getFreezeSkillTemplate: '53a4f9f33c55c8338bf1dd5be38b0893bc6c477fccaaf7d8033dabf8acce0aff',
  getGuardSkillTemplate: '5e237666345c99502b63883c63d2e98e42120a62babe12996e203fefeaf1a124',
  getInvestigateSkillTemplate: '976e1ae3926e11ab87f786bda0d8aefb29d10cc7eaa45c20941a775b0e5dcfdf',
  getNavigatorSkillTemplate: 'c25844301220e84417b66b5619072553a725572299fff8772a4a1c1e94e1db30',
  getOfficeHoursSkillTemplate: 'df0e053beb069b3ca9e537eec3cd472bcffbbbb42fde1a4645a6e16bf52322b6',
  getPrototypeSkillTemplate: '4fcc1d89a2704066a3426b72d6d777931e6f275067dd195e41f01761d0185bee',
  getQaSkillTemplate: '0c41f29a58cc311852cc13065f15f2612a23ab49a0734a3fd96e59d5a15fc0d9',
  getQaOnlySkillTemplate: 'dd7d82b2c5ba26bd37465562c6a2786fd170481de5432506424ffaf8bc366002',
  getReviewSkillTemplate: '775c5dead5bdfe0d0edfa80087fe55afe34e57b6441acf110be4071d29e0fec6',
  getTddSkillTemplate: 'ec13a6476b4bff1cc6bb7eb17dcae0ad1f9658297d57676176dc810a9375f20b',
  getUnfreezeSkillTemplate: 'd285f8d01cf10a3aa76b8813da2729e67c24ddf852499ba6d6e8310e78ec05bf',
};

const EXPECTED_GENERATED_SKILL_CONTENT_HASHES: Record<string, string> = {
  'openspec-explore': '9ab6869abfb762264a510d02fb2bf4e7f254f2c46c6c40465f1bb38928e5c5fa',
  'openspec-new-change': '3cfbfff68b445febc055105afb4f53474022ce1a028e6052e71e5bfbc91c1021',
  'openspec-continue-change': 'e3983188429abc73011defdd5c46d35bba99f224339a0abb6b41037e7bb636b8',
  'openspec-apply-change': '3802b3dd1a832b92b0e146af2391e992eb6197d0ad2b8e6b84d0d4857f986e69',
  'openspec-ff-change': 'c2f63950db87cb749172789e79bb292bc93a090a840ee4dcdaf7d68f05f45185',
  'openspec-sync-specs': 'c4e9dbd496ce3ea113bd0561207319be1e6ee8b282f5e2383a6337ec8054515a',
  'openspec-archive-change': '2c72cfa0ca9fbd00d7c8c433fa9609aa44abb6b07ab643e580dd15503dcde784',
  'openspec-bulk-archive-change': 'e72b68fe59453eb950b3df2ebd8a2152375b944e3ea008a8a3f28c335aa25ef0',
  'openspec-verify-change': '67d2e6ec9acb70d6a7fe4b7be3b02593c314f88d6e47d8d3059e7c8aea242e6f',
  'openspec-onboard': '582f3fb89f9040b2b2ab47432214c73994a273a78b2abd1d0271677bc41bdac6',
  'openspec-propose': 'ae6dd585cb2312d0fb96887b0803202664600c056123b4e704fc60889a970d23',
  // Expert skills (inlined; see expert-template-inlining)
  'openspec-benchmark': 'e74a846fdbc8cc765393b01fbe5f81982d3d5f36b5cc4a482932ccaed33e0fa6',
  'openspec-careful': '54df40b4935b8516ffe73f8653fb6c7eee283bfc59dd79863a570755da169631',
  'openspec-codebase-design': '2b5f817fc8e9fd478caa2354eb50b811237a59e4ea394ff58cc4ecd9b5063446',
  'openspec-codex': '6561bd4ba798a4f864cbd3b43a5e6071528e6999e96f8bf00efbf2efee0a8580',
  'openspec-cso': '724d01dbbb3f9d04f528e53321976c579b79b337b79f9f091736eed829fb4ff7',
  'openspec-design-consultation': '9b7e3999e4f2fcb180a8ef5220a103ffbf40120cd15dbdfb5db5f7b8d4e80f8c',
  'openspec-design-review': '6b2dc186f7073715a765c95de4604f088914238b9e5883eee90cb3bb486fda36',
  'openspec-freeze': '0e9673ccbe196210d70f4ff6594bd5598e2f6a04dfc422a07b6980c33d24b5d4',
  'openspec-guard': '75d80959b9a9fff3f445203cfe0a08f279f339275b8984511839f3e075689c59',
  'openspec-investigate': '8fb9940d090f5f4d093795ac96c60499365020e2bf4bd2bc922b81b24eff6f8a',
  'openspec-navigator': '22e675673e3f955b6d832663f5366ab3fdf1b94a71708603eeac511324e539e4',
  'openspec-office-hours': '8de608bb0d4ea1fef1e2bae4ee3fcc918325a11399641b79baa4e88972778462',
  'openspec-prototype': 'd7d0eb44681a75e7d16e1fac90793143267723853ec9485c6816c8cf295e06e1',
  'openspec-qa': '6cd9a347abf50c9788431f2a3db30b75be6638276c20abfdb519b165a57a09c2',
  'openspec-qa-only': '49b4240d7350c7a3f787033fb4cd50273faabd7d6e5a4525bfc24fff159f66f0',
  'openspec-review': 'fb57a5b3ae1351024ce262a5252dedfd30ca51836e9103368866369aa7fc5f9f',
  'openspec-tdd': 'ca448f3d5802a864d474dd144162a78276892fb780568f59c0d725cef1ab6c26',
  'openspec-unfreeze': 'ebced715e17dbb8a23158c89e743e1740477904d94e507002bf535777d4d38e7',
};

// Intentionally excludes getFeedbackSkillTemplate: this list only models templates
// deployed via generateSkillContent, while feedback is covered in function payload parity.
const GENERATED_SKILL_FACTORIES: Array<[string, () => SkillTemplate]> = [
  ['openspec-explore', getExploreSkillTemplate],
  ['openspec-new-change', getNewChangeSkillTemplate],
  ['openspec-continue-change', getContinueChangeSkillTemplate],
  ['openspec-apply-change', getApplyChangeSkillTemplate],
  ['openspec-ff-change', getFfChangeSkillTemplate],
  ['openspec-sync-specs', getSyncSpecsSkillTemplate],
  ['openspec-archive-change', getArchiveChangeSkillTemplate],
  ['openspec-bulk-archive-change', getBulkArchiveChangeSkillTemplate],
  ['openspec-verify-change', getVerifyChangeSkillTemplate],
  ['openspec-onboard', getOnboardSkillTemplate],
  ['openspec-propose', getOpsxProposeSkillTemplate],
  ['openspec-benchmark', getBenchmarkSkillTemplate],
  ['openspec-careful', getCarefulSkillTemplate],
  ['openspec-codebase-design', getCodebaseDesignSkillTemplate],
  ['openspec-codex', getCodexSkillTemplate],
  ['openspec-cso', getCsoSkillTemplate],
  ['openspec-design-consultation', getDesignConsultationSkillTemplate],
  ['openspec-design-review', getDesignReviewSkillTemplate],
  ['openspec-freeze', getFreezeSkillTemplate],
  ['openspec-guard', getGuardSkillTemplate],
  ['openspec-investigate', getInvestigateSkillTemplate],
  ['openspec-navigator', getNavigatorSkillTemplate],
  ['openspec-office-hours', getOfficeHoursSkillTemplate],
  ['openspec-prototype', getPrototypeSkillTemplate],
  ['openspec-qa', getQaSkillTemplate],
  ['openspec-qa-only', getQaOnlySkillTemplate],
  ['openspec-review', getReviewSkillTemplate],
  ['openspec-tdd', getTddSkillTemplate],
  ['openspec-unfreeze', getUnfreezeSkillTemplate],
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

  it('teaches store selection in every deployed opsx command template', () => {
    for (const entry of getCommandContents()) {
      expect(entry.body, entry.id).toContain(STORE_SELECTION_GUIDANCE);
    }

    // Feedback has no store-capable command and intentionally carries no
    // store teaching; it ships outside both registries.
    expect(getFeedbackSkillTemplate().instructions).not.toContain('**Store selection:**');
  });

  it('generates no workspace-planning residue in any workflow template (4.1)', () => {
    const allSkills: Array<[string, () => SkillTemplate]> = [
      ['openspec-apply-change', getApplyChangeSkillTemplate],
      ['openspec-sync-specs', getSyncSpecsSkillTemplate],
      ['openspec-archive-change', getArchiveChangeSkillTemplate],
      ['openspec-bulk-archive-change', getBulkArchiveChangeSkillTemplate],
      ['openspec-verify-change', getVerifyChangeSkillTemplate],
    ];

    for (const [dirName, createTemplate] of allSkills) {
      const content = generateSkillContent(createTemplate(), 'PARITY-BASELINE');
      expect(content, dirName).not.toContain('workspace-planning');
      expect(content, dirName).not.toContain('Workspace guard');
    }
  });

  // The /opsx:auto skill embeds the orchestration playbook; its changeRoot
  // blackboard teaching (tasks 3.1/3.2) and store-scoped resume teaching (M1)
  // are otherwise unpinned by any hash (auto is not in the golden-master map),
  // so a regression that dropped either would pass silently. Pin them here.
  it('teaches changeRoot blackboard resolution and store-scoped resume in the generated opsx:auto skill', () => {
    const autoSkill = getSkillTemplates().find(({ dirName }) => dirName === 'openspec-opsx-auto');
    expect(autoSkill, 'openspec-opsx-auto skill template').toBeDefined();
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
