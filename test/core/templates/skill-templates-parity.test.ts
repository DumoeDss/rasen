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
  getExploreSkillTemplate: '67c211d3e7070f1f19ca6f861ac84b7dbcfdd969ff6537775169717da92a8bea',
  getNewChangeSkillTemplate: 'e14a9cb7c7f990ed624086f3ce6547f9a7bce3e4f5bdf00e89676d82a37c349c',
  getContinueChangeSkillTemplate: '03e05717ddd9d920c97fc3bd0a3342008ad66b4b9c581361fdc9dc9417e281f3',
  getApplyChangeSkillTemplate: 'be8efbd8c785c90426d668997325781b3e997480d0b188cc306fe1d01cf5d6a1',
  getFfChangeSkillTemplate: 'd4c2746c4f3bafc85fa924409b5ef1af1d364fd3e0f7dfc7479905994dd5fc30',
  getSyncSpecsSkillTemplate: 'c58cd827c529bdb5f7aa4e528bcf3958feff9787546c932fbb476c55dce30785',
  getOnboardSkillTemplate: '4cf45e460c725597ae71701eb753744eabeaa28a03e41fc19fa73c6613f759ba',
  getOpsxExploreCommandTemplate: '76279b089ac5fbc85ad89c0cf367591b09fc6cac50a6ff147a6bc480de92781d',
  getOpsxNewCommandTemplate: '1fb261c018eb7998dec9d5ed2208709ecf9ec73543c5cc719ab70f341207445b',
  getOpsxContinueCommandTemplate: 'bebada98b3c6cc12af3df2d666f12b68ef28b043352cac8e77f2a60a2bc1d2ba',
  getOpsxApplyCommandTemplate: 'aef925d8f0775b47ceb6894b258a2b9d5cee7f1fea2bd53b6959642a2a9fea49',
  getOpsxFfCommandTemplate: '0ffd348e0334d8ac09c2efb5df519d353a9d98ecdf54719693c3702dec7d7806',
  getArchiveChangeSkillTemplate: '5df8da8228c8326d122c2d85f1690bc5ecb15a2a499e24a188a99162fdaa3c51',
  getBulkArchiveChangeSkillTemplate: 'af53b3871db899f4839abfefb619a366e8a5d2b579c699424f562d0b0f0fdd11',
  getOpsxSyncCommandTemplate: '75f4558c97e82ef1aac397b55a264ce37e713c24d5eb77b508683f5941c12495',
  getVerifyChangeSkillTemplate: 'de76503551851541dabcf4363ea4f80e7ab6ec136bd1327039a57d3e2a49e1e8',
  getOpsxArchiveCommandTemplate: '3a787bf6926eec692c8bef77650fe627df87e381cbd4c5d37be760130af29d74',
  getOpsxOnboardCommandTemplate: '3b914879fd21b5a8627bf68bff5e328c5fdee6a6757fedd8fa244aca97f4a683',
  getOpsxBulkArchiveCommandTemplate: '576bdb58fe5e63ad2dea4ad762ad60b3f7149c2cc5c342a65627d6963063911b',
  getOpsxVerifyCommandTemplate: '70c8a55c185fe661d64500549ab5049dc775e484c7b48a5eaa93b0ff58549692',
  getOpsxProposeSkillTemplate: 'b4c299c68f5e6eb07fd4000e52f390159d9c17c5b4c2688bacd17abf56228bbc',
  getOpsxProposeCommandTemplate: '91b123924c2c8fbda2c0db6c42b143c219b7bf3f7672789be5814b230cfa3724',
  getFeedbackSkillTemplate: 'd7d83c5f7fc2b92fe8f4588a5bf2d9cb315e4c73ec19bcd5ef28270906319a0d',
  // Expert skill templates (inlined; see expert-template-inlining)
  getBenchmarkSkillTemplate: 'f6a3678655f4c1be1470684e4d8ccfffc56ff145f94bbba087256df09fc834d3',
  getCarefulSkillTemplate: 'e0b2195f539c7ba52b03a59ec5b3af8ac8ac96bf691e375ed9ace01b1ea51e5e',
  getCodebaseDesignSkillTemplate: '031c8c89f7c817f9da9c7e4e6a9c5046d164b9f837ff0bcef4003180c9bf2453',
  getCodexSkillTemplate: 'e6b23f1f13bf3b683e176c4fcb97b0abe5993429704b7786b79c9bfa91ac366a',
  getCsoSkillTemplate: '84ccf7018f045c9f67d84ec0b88fabdecc8bb3cdd076910790ecb705a661b0aa',
  getDesignConsultationSkillTemplate: '07bb3ae6fea14eb38b6a7f2c5192ee0e02d37c24ae588cda87401ed9d5a8c384',
  getDesignReviewSkillTemplate: '95e5ff71e7c99df148ac2dc4b298226b4cf6ed557391ce55995e75d5395795ae',
  getFreezeSkillTemplate: '2de920ff75c848b3cf704914d87ef2a4381bcc83d9d69f262a2a7e08bd85c292',
  getGuardSkillTemplate: 'e5359e80bd9d60231efe0304b03d8bd41b7eb2d791d7688acffd9bbea986c0d3',
  getInvestigateSkillTemplate: 'eb81dd437851c0acd68520a82699950aaccbe0ebe6e4aef256d20275c3623381',
  getNavigatorSkillTemplate: '3d2cdd018b926129e2f997cf78bdbb84508e76f68bd7d3941895b1d8e954d700',
  getOfficeHoursSkillTemplate: 'fd0f6e615e9d413bd93878bd7bdf23f4b557c92d14932060dc8f0d8e8f43b357',
  getPrototypeSkillTemplate: '969e75359af7653fe78d97ab9f600cd53330701ddfe37b08bd7d6deccb943ed1',
  getQaSkillTemplate: '8b3571450d1918733969f03bd7ac095f90047f396779434528d62544c27f74a3',
  getQaOnlySkillTemplate: '31e1dd613cbdc4aaf94f1fe22abc475317742365c016fa8a0ec2e7462148bbb6',
  getReviewSkillTemplate: '7d3c532b66e54392a6d0f9d06ac700dc22bfdd2bd80f7ad2b01e8ff4d90706f7',
  getTddSkillTemplate: '658d19a17b5f229502e2a5feaeb9eaf1b600c945bc903956f5c4fd429332217a',
  getUnfreezeSkillTemplate: '5f05a3b7933db7aa8674beeacfbf0b8575763347159c7cabf8b26a9aab106e7a',
};

const EXPECTED_GENERATED_SKILL_CONTENT_HASHES: Record<string, string> = {
  'openspec-explore': 'a2a5427529afd1d573f2066b199a372a9b013631a563afd98056ef82df5a18dd',
  'openspec-new-change': 'd5940b3b0d7a5371fe2524003925d7c8cd886fc7839cf280c6fd14984aa3e149',
  'openspec-continue-change': '614ce8bd6c122224cda932905635687d51fb0384a2c909ed558a874fbf79505d',
  'openspec-apply-change': 'f6c4ae1f5c9943d7296ddb5e1102cafd9bb8189d09ed13afeef45e1861338c86',
  'openspec-ff-change': 'eef07229a7ef768c19e809d30be176c8e2f55e662b2d88ab380081258e224406',
  'openspec-sync-specs': '39b8666ce58527c1a483252839e906c5c79f7149ecc001d062739a872f4f375b',
  'openspec-archive-change': 'b73ad9ed46a752083e36c9c9dc187551e820fd6fe275074b6cc382b080c9a1e6',
  'openspec-bulk-archive-change': 'dbee4e7d591c1abc601d44af7e83cded581b7ef8ef19fc0b4436fa3306e95555',
  'openspec-verify-change': '89461b1bb7ccc75b77b1d8a4a17eabbd1832763094c8bf5cdc1759ed331fad8a',
  'openspec-onboard': 'bfc9770068fb8efbbac12aaf042de9d76410160d606dafc1a301ced2e5cebd9e',
  'openspec-propose': 'ceccbc9807b064bba291798fb26e8d7f7e0de98a008ea2ac09af99b798c79bde',
  // Expert skills (inlined; see expert-template-inlining)
  'openspec-benchmark': '83d30852d3e83e8771b93e6514f02cfe16173b265b0c135ac5677f992e9b2b90',
  'openspec-careful': '0a8f29a3a0cfd1407baae86c917a56625494d796969018aa57c21858988c8385',
  'openspec-codebase-design': 'ce4793a4f24f3b52a8a83901cde66bf41c01b104a358f078b1021e82b09ea1ce',
  'openspec-codex': 'dcf19167a7fcfd2384e1cf220240fd72b35baf3f5c8b9413a71c599bf60f6d2b',
  'openspec-cso': '437ea2bdfed7d3ca93f6b59c9a384c821fc26a086250fa5ba3094a22ca53ae98',
  'openspec-design-consultation': '07b11464343464d9428428891301c6d711850faf3cca8927b89d9dceea7254be',
  'openspec-design-review': '4456d88af2a0f82401cf5430eaa7b25a0340b6ce4422d442910ae30c4833c9ff',
  'openspec-freeze': '50d23917fd62c2c5c6467124c92ed58135c167e7daaf3d62ed711ec4c0709ce8',
  'openspec-guard': '8bbdd6d650bd58a27c7c4734ddf4a35fa72518b1fb94e82345cec0ef977ee0b0',
  'openspec-investigate': 'bc2f8b152ce6e0219a0612be87c557d5bad9e9966c5b2b0ad4211be4bec3c5e7',
  'openspec-navigator': '0a8ca938f7daf660bc12ec9b2335797b6c28ed32e7e6819a7d7a3b5873bca026',
  'openspec-office-hours': 'dc76008a38d56c0f99a65951f8905f0272d824acfcc56e0b1841c50777ce75c7',
  'openspec-prototype': '0c7a34e88055cd090a55b2bb7debbc1fb11e40881e83b424606f6fdef6fa6818',
  'openspec-qa': '4b47814def1f4148fe8fc6de67c0d8ea91757fc3322731911da0b4c3f3e2efcd',
  'openspec-qa-only': '0a9019c5b58928a9e680b0276bcd335e2c14548f6b313f9c72045b834377f15e',
  'openspec-review': '863a61e5eb1f101958106b90365e6b9e238813a14b498ba12c894e3074a853bc',
  'openspec-tdd': 'f0a84d941ff8e344e4129c54b3fb69b54513208fe28f7d9072525b0158ce5292',
  'openspec-unfreeze': '3e83ca49f659057407bf1732a15442e960e2bf2b08ab4ecf3031bbb46d1ced9e',
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
    expect(content).toContain('openspec pipeline resume <change> --store <id> --json');
  });
});
