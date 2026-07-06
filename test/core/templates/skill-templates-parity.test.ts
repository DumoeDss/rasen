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
} from '../../../src/core/templates/skill-templates.js';
import {
  generateSkillContent,
  getCommandContents,
  getSkillTemplates,
} from '../../../src/core/shared/skill-generation.js';
import { STORE_SELECTION_GUIDANCE } from '../../../src/core/templates/workflows/store-selection.js';

const EXPECTED_FUNCTION_HASHES: Record<string, string> = {
  getExploreSkillTemplate: '8bb26001aae6e3c9ff3b7b4096a8004019b8906f080ac5b3755f5cc8bde41396',
  getNewChangeSkillTemplate: 'e14a9cb7c7f990ed624086f3ce6547f9a7bce3e4f5bdf00e89676d82a37c349c',
  getContinueChangeSkillTemplate: '03e05717ddd9d920c97fc3bd0a3342008ad66b4b9c581361fdc9dc9417e281f3',
  getApplyChangeSkillTemplate: 'eca56e513a1478952a04ee0c281046bd5b1039f70c7e63ca993ddd3150de7bc3',
  getFfChangeSkillTemplate: 'd4c2746c4f3bafc85fa924409b5ef1af1d364fd3e0f7dfc7479905994dd5fc30',
  getSyncSpecsSkillTemplate: 'c58cd827c529bdb5f7aa4e528bcf3958feff9787546c932fbb476c55dce30785',
  getOnboardSkillTemplate: '4cf45e460c725597ae71701eb753744eabeaa28a03e41fc19fa73c6613f759ba',
  getOpsxExploreCommandTemplate: 'c121374e97c340efd35c6ea6ea5feb17a68157fa665de028ffa110cc9f9092c9',
  getOpsxNewCommandTemplate: '1fb261c018eb7998dec9d5ed2208709ecf9ec73543c5cc719ab70f341207445b',
  getOpsxContinueCommandTemplate: 'bebada98b3c6cc12af3df2d666f12b68ef28b043352cac8e77f2a60a2bc1d2ba',
  getOpsxApplyCommandTemplate: 'f0484009088742ca1f1641177e3d683373297c5eb758ebb005a169ba45f3e65c',
  getOpsxFfCommandTemplate: '0ffd348e0334d8ac09c2efb5df519d353a9d98ecdf54719693c3702dec7d7806',
  getArchiveChangeSkillTemplate: '5df8da8228c8326d122c2d85f1690bc5ecb15a2a499e24a188a99162fdaa3c51',
  getBulkArchiveChangeSkillTemplate: 'af53b3871db899f4839abfefb619a366e8a5d2b579c699424f562d0b0f0fdd11',
  getOpsxSyncCommandTemplate: '75f4558c97e82ef1aac397b55a264ce37e713c24d5eb77b508683f5941c12495',
  getVerifyChangeSkillTemplate: 'de76503551851541dabcf4363ea4f80e7ab6ec136bd1327039a57d3e2a49e1e8',
  getOpsxArchiveCommandTemplate: '3a787bf6926eec692c8bef77650fe627df87e381cbd4c5d37be760130af29d74',
  getOpsxOnboardCommandTemplate: '3b914879fd21b5a8627bf68bff5e328c5fdee6a6757fedd8fa244aca97f4a683',
  getOpsxBulkArchiveCommandTemplate: '576bdb58fe5e63ad2dea4ad762ad60b3f7149c2cc5c342a65627d6963063911b',
  getOpsxVerifyCommandTemplate: '70c8a55c185fe661d64500549ab5049dc775e484c7b48a5eaa93b0ff58549692',
  getOpsxProposeSkillTemplate: 'e5ab3d5627266aceeae6c29b9f4601c3e6a87b64c58e5604183a633f2c940f79',
  getOpsxProposeCommandTemplate: 'd9ae70e86a5e9c76a372c7e6ee47197fd6951ac4af6ce06373551ebb737dac2e',
  getFeedbackSkillTemplate: 'd7d83c5f7fc2b92fe8f4588a5bf2d9cb315e4c73ec19bcd5ef28270906319a0d',
};

const EXPECTED_GENERATED_SKILL_CONTENT_HASHES: Record<string, string> = {
  'openspec-explore': 'abdc6049dace1dc3f30f35a9be5a34f3c46b0d1b130c43b8f57845dda40a2506',
  'openspec-new-change': 'd5940b3b0d7a5371fe2524003925d7c8cd886fc7839cf280c6fd14984aa3e149',
  'openspec-continue-change': '614ce8bd6c122224cda932905635687d51fb0384a2c909ed558a874fbf79505d',
  'openspec-apply-change': 'c8b1ca1bc86f39443a609e21aa8ca483f205febdac39c81587a5e935e5560205',
  'openspec-ff-change': 'eef07229a7ef768c19e809d30be176c8e2f55e662b2d88ab380081258e224406',
  'openspec-sync-specs': '39b8666ce58527c1a483252839e906c5c79f7149ecc001d062739a872f4f375b',
  'openspec-archive-change': 'b73ad9ed46a752083e36c9c9dc187551e820fd6fe275074b6cc382b080c9a1e6',
  'openspec-bulk-archive-change': 'dbee4e7d591c1abc601d44af7e83cded581b7ef8ef19fc0b4436fa3306e95555',
  'openspec-verify-change': '89461b1bb7ccc75b77b1d8a4a17eabbd1832763094c8bf5cdc1759ed331fad8a',
  'openspec-onboard': 'bfc9770068fb8efbbac12aaf042de9d76410160d606dafc1a301ced2e5cebd9e',
  'openspec-propose': '0023a05ed3b313bde959c1bd55903b8a0160812281599cc7d42572bde6460551',
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
