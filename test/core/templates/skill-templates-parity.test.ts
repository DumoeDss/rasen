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
  getExploreSkillTemplate: '6b8e81ae41af43d0c94465731732d585f402e3e078a311a299f3ba2ec1e5b569',
  getNewChangeSkillTemplate: 'a8ec48a8ad31bb2a81bdc879b6e1bd5d660aaf1a1232e339ce963aab8a10e7b4',
  getContinueChangeSkillTemplate: '87df8ec03ebf7ae5e0424419907c8f0a479b763b971402f8bca582e0b60ff137',
  getApplyChangeSkillTemplate: '16da16233abcc1d8e1782619146cfcf297d7f3477072d66a5e16937c3f191148',
  getFfChangeSkillTemplate: '3d614252c8980a09c2d92fc17b170dffc864298e0aa8dd8a3974d74ab08c5c10',
  getSyncSpecsSkillTemplate: 'e8c4ccbff172b205f80d47b32fb989cf53c13d72c786a735b12f4a2bc7cf4cfe',
  getOnboardSkillTemplate: '0cc15720a0e7d5ad2e573bd70cb626a54f1328532db2440a25e3dc45e4995f2d',
  getOpsxExploreCommandTemplate: 'fb7d74bef25ff86e3a116941d11bb42f6efc2d4715a2d309aeb4d1e38ceb5b40',
  getOpsxNewCommandTemplate: 'b27f4f0da35f8a177c7211db2e684f96ce616010b8e8d8afa78aadfdb8a88e39',
  getOpsxContinueCommandTemplate: 'e8122abe5b5c300d46b1a90bd6622d7ff610ba6b7964a79e2438fb8fa90f2ce4',
  getOpsxApplyCommandTemplate: 'def43bf7629acb4d8e51e2b7d1ae55ae14f4fdbaa154711d4a25aa3455c145bb',
  getOpsxFfCommandTemplate: '75b9ca28276e4becce76ce7fd2e1738ef0c0cbbdb0c6a29e4a97d2c5330ba76e',
  getArchiveChangeSkillTemplate: 'c904ae7db932514e36720131930071736c84d66a788146f5818ed00a55c98ffa',
  getBulkArchiveChangeSkillTemplate: '9e685055ddab0857c4578f7df952629755de9d0b8a64d4c655d63a452618b838',
  getOpsxSyncCommandTemplate: 'b3e63d9c30da6f35fa4c38c0852ad528bda1beb3195f49a8739df0276c704808',
  getVerifyChangeSkillTemplate: 'dff473f600ed8e7c63d03592d8d687a0aa7771a3255efd7a56a16912016b5428',
  getOpsxArchiveCommandTemplate: '1d9c146a6285febde4355cda56746293db5087fb7b3e1686ab3c42ef6aaacf4e',
  getOpsxOnboardCommandTemplate: '81c613888c293a379afa5645ce84d6c1baec21ede57419ffbd4166eeb8909ea0',
  getOpsxBulkArchiveCommandTemplate: 'e821e2576a042f0f5d5d68a11d170e99345ffbb2d72c280aa839a5f2e7a13779',
  getOpsxVerifyCommandTemplate: 'c54f53d54d71b733f4558cdf0c522d2ec322a6cafcec368ab8c8e13315039520',
  getOpsxProposeSkillTemplate: '8392f11f5ec54a4a5adbffd55bde87d35b265a16276ca070b269fb2377db89b8',
  getOpsxProposeCommandTemplate: 'a4ca86646131f824f9a2feb2410d3b116622e3d5643402d9b42c030d3e7d46fa',
  getFeedbackSkillTemplate: '6bfb7caffad631f807678c2b5d194fb0eb2ed0bc4cbb4bf432b5a3c160c6cc87',
  // Expert skill templates (inlined; see expert-template-inlining)
  getBenchmarkSkillTemplate: '1c6cef540473e6e6e6f107549437a7f548610d7827edd6ef9b8f8b29024b1cad',
  getCarefulSkillTemplate: 'e2ee6ded43180bdacee2369c1eaa3babdfa5fc3683f84f3d9d963db870b3886e',
  getCodebaseDesignSkillTemplate: 'c1f1e68aa314bd5fc88acd3519d1851d9adff47545ad7d5f22d32d8278c27952',
  getCodexSkillTemplate: '5d68c98273e0f1b0be97dedc360a6c2bec4821ca40b827f21cb5ccddb29e998c',
  getCsoSkillTemplate: '71a83b9142c423cf147c3ac5f11d4aa501a02d0508dbdecaea2e45a7000fdbfe',
  getDesignConsultationSkillTemplate: 'b77ef6263e21049a52b7d62aabac523f5cdf7f015cd09329d8979f4ea2eed99f',
  getDesignReviewSkillTemplate: '9a773730b5b85e80e2d1b1a4e03ec8af4de98280b64447a14d41a1a5a4b17514',
  getFreezeSkillTemplate: 'fcd4b8f4fc0912211b4f2d72f6a9fd084646c12d5058bbb5587cd12f02076a3d',
  getGuardSkillTemplate: 'dd20f6ec6be771840d6c63ea7329c3059051f6effe5ae8940aef5e54d65bdc0f',
  getInvestigateSkillTemplate: '340ecc9dfe548c4badde2900dd6d60f69cfe51c6075c92a6a0c135240c4c0a0c',
  getNavigatorSkillTemplate: 'b92cb768ada681ea5fac7d73527066db1b59e712d48d238e5c030a8ffd8bccf6',
  getOfficeHoursSkillTemplate: '90791649e09e440e0078ab47d6478414571800ef174a38b92f80399af967c03c',
  getPrototypeSkillTemplate: 'de5882c6b3d811b74aca51cb28ab4707bf4c78107a7c8b9533831db3d2fdc413',
  getQaSkillTemplate: 'd93db4ecc4ca0e11da958c293a3e1a20dfb3488ab8e2f26163db314636eebbca',
  getQaOnlySkillTemplate: '2daee6a3c6baa4e73af540ff9ef9eac2e61edb4a4c045eae9ec695b3bbf18fa6',
  getReviewSkillTemplate: '20dc097b5f7e79b72d836643b95fea840963a55cf29a5c997c1392de24a0d96d',
  getTddSkillTemplate: '307331fef0e716c5b1ffdd4a7e629e2d3041e37752485c1558178698a34b182e',
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
  'rasen-verify-change': 'fa190883ea086c21a4d4a640b6c0fc54f00fa8341a09241b163211d21a7790e7',
  'rasen-onboard': '51199524d72af97a0adfae717b05731dc68e330c49d2ef85b3661fd7989a5497',
  'rasen-propose': '4453501cf4ceb55121e11c12b6e2d07414ca2e2fe2480ced8417b2bc6cf0481c',
  // Expert skills (inlined; see expert-template-inlining)
  'rasen-benchmark': 'ffca736c29ef74213d8f3924fb051c7c3053fda4be8ce78bde1bb7b5f693f026',
  'rasen-careful': '63b4eb6cabbd5eef8ebf97199c1656cf9cb4b22d815d3cf873c3445e7aa91aa4',
  'rasen-codebase-design': '9287b5d36d04aee82f53c1d127f11cd40fe39465235aa54d535081634edb3ae1',
  'rasen-codex': 'e050eb797f58d194fa3d0391d282cb5e6b1867edf168a8842b4a3ff8a2c03e2b',
  'rasen-cso': '6f7845f47d34bc7b0c8b3fd42fcc15fba209ab958dae5734fed0f8e4bcd6648b',
  'rasen-design-consultation': 'ab71efbed9c3cad70b10edfcc67d45c90989dc72a65d010ba06ffe38fec9a660',
  'rasen-design-review': '81202cf2dbfc44c8c33801beab739d3efc023b0419ea27ff09079583f9c41151',
  'rasen-freeze': '8077fb923c13595886d66f304a347a5dcaeb164b31170e0c34d4a511be3da6f5',
  'rasen-guard': '3bf7c046d581c01f8b85632b5fb9c4d5f05e6dc629153ce13b523547665222c4',
  'rasen-investigate': '35b18158729186066434b3ca218247e1756abd339a79624f3af52ccbad4ff1d0',
  'rasen-navigator': 'a4954e48bb73de59b93d6d030d4844cb15e61a12cda3d01281112f39c9ae9a76',
  'rasen-office-hours': 'fb220dbb7416f7ccd3f69445f4a5eec00b7160c219961c08da5e83ae7af3237d',
  'rasen-prototype': '8ccb8f5db431146ea219834bc062cda6f3d8a799bb27213d9c7544defaaedacf',
  'rasen-qa': '38bd9b939bb7016008816914b254638e4039801d6fd7b2f4cdd4c54da641984a',
  'rasen-qa-only': '4f6a265d4b4dda5c96c3e918695ecbad59ed1af41780f3c9ba13b23ad75530df',
  'rasen-review': '9750e2aeebcad8d87c68a5a6ca9b3d9d0f78cd9536993f5d8878ab9385279a29',
  'rasen-tdd': 'd5cf8cd0a3aa2d6362485d0a8b04dd7b8e2cafef21afc5987455c2cffc04b8f3',
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
