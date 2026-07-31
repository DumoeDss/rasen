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
  getRetainCommandSkillTemplate,
  getRetroCommandSkillTemplate,
  getAutoCommandSkillTemplate,
  getReviewCycleSkillTemplate,
  getHandoffSkillTemplate,
  getGoalPlanSkillTemplate,
  getGoalIterateSkillTemplate,
  getGoalReportSkillTemplate,
  getGoalCommandSkillTemplate,
  getHelpSkillTemplate,
  getDirectionSkillTemplate,
  // Expert skill templates
  getBenchmarkSkillTemplate,
  getCarefulSkillTemplate,
  getChromeUseSkillTemplate,
  getCodebaseDesignSkillTemplate,
  getCodexSkillTemplate,
  getCsoSkillTemplate,
  getDesignConsultationSkillTemplate,
  getDesignReviewSkillTemplate,
  getInvestigateSkillTemplate,
  getNavigatorSkillTemplate,
  getOfficeHoursSkillTemplate,
  getPrototypeSkillTemplate,
  getQaSkillTemplate,
  getQaOnlySkillTemplate,
  getReviewSkillTemplate,
  getTddSkillTemplate,
  getWorkflowAuthorSkillTemplate,
  getWorkflowReviewSkillTemplate,
} from '../../../src/core/templates/skill-templates.js';
import {
  generateSkillContent,
  getSkillTemplates,
} from '../../../src/core/shared/skill-generation.js';
import { STORE_SELECTION_GUIDANCE } from '../../../src/core/templates/workflows/store-selection.js';

const EXPECTED_FUNCTION_HASHES: Record<string, string> = {
  getExploreSkillTemplate: '397e1e71b7c03f779588793f535d332b2ff577d76ade9fde7b4346ba631c9e35',
  getNewChangeSkillTemplate: 'ae5e1798fa0e495f209434d44f3e6043354224d210734eda9928fcbd9a6dc852',
  getContinueChangeSkillTemplate: '63192938a238bbb815f4ee840838948b12e9c3dd95c8a8a6bfbda9ecbf1b1c00',
  getApplyChangeSkillTemplate: '733f4ce38f48726bbcf431f0974f6641534fdef962dfe52a30b6e3e45ec8a626',
  getSyncSpecsSkillTemplate: '8177beb0cf664241cdf3e6016c8cf7a75b4331c64c9804e7178d1ba1566c8334',
  getOnboardSkillTemplate: '91da611a43f5630412f2101e6a3ed562b9f4f637c2bb144d5818e6f7449b9340',
  getArchiveChangeSkillTemplate: 'dc231c00b87e8f6a1abc9751c63cd8b35629e64bf840f0374ea6be7e7ed20144',
  getBulkArchiveChangeSkillTemplate: '7b6ee6b2e84f6e2216d49e84dfeaab2c062c1191668edcbd59b0cf20b08bfa72',
  getVerifyChangeSkillTemplate: '17211af68f0988d341320f52dc14c3c04829e6b6ebe606700eeb42ee4fdb60da',
  getOpsxProposeSkillTemplate: 'dfbc338b397844d689e021fb576980bfb561e268c579476310945699ae3bbcb0',
  getFeedbackSkillTemplate: '6bfb7caffad631f807678c2b5d194fb0eb2ed0bc4cbb4bf432b5a3c160c6cc87',
  // Workflow/orchestration templates (workflow-template-parity)
  getOfficeHoursCommandSkillTemplate: 'abc86fb00aaac2c269009aa48a64984481de22d93447696b0574c7fe0eebcb0f',
  getVerifyEnhancedSkillTemplate: '9f218d45a648022086a9b084359a64c44723a18584cd0d0b08655bf9ad89e73d',
  getShipCommandSkillTemplate: '5a3e577b04e1eb755434ee9f6328299adb05099741a9ba8518f19049ed6995e0',
  getRetainCommandSkillTemplate: '982277f7e373fe12f1a513402cd036be25d311e56bf009b630781aab1dd33b22',
  getRetroCommandSkillTemplate: '64725c0d0c2d5ee285de0186c62e9bb9cfc6b2ddc95eabd408e089ff1d00c6db',
  getAutoCommandSkillTemplate: '4fc9fb51cb7779b2834d92099120296f31b98dd5d4c0f98689571739d306913e',
  getReviewCycleSkillTemplate: 'eb6a8d4aa59a0ec7298f91e11b0e0be711c0615e34204d7664f32581a1458c10',
  getHandoffSkillTemplate: 'ec3ed31ca2444ec5fe701eadecd670b5cce55608fe06297ef6d7aeae06d0cbb4',
  getGoalPlanSkillTemplate: 'ef4208ba6a42fee7fd0139d3e26768a988155cc73d82e611e2877e7ef2cda898',
  getGoalIterateSkillTemplate: '4869cfd9df2f55ecad5aad1f4ad5bf3ecad04ed39fb761656867176db295ee8f',
  getGoalReportSkillTemplate: 'f4f7e8dc08c6324ebddf066adb3b6d4649683a0508b712c7585f75b9d37586b0',
  getGoalCommandSkillTemplate: '9def2323c9e4c23696c7eebf27c25f32316c2d80f78c878598886e864140d1d3',
  getHelpSkillTemplate: '8d3f74dd7d11dc15a6d27ab7d52804e3917c0ffceaf77808d85e3a3a56f8d5e7',
  getDirectionSkillTemplate: '02bf07737760f788d668e29008c1276069eebc364e3b210b259b65e05980867b',
  // Expert skill templates (inlined; see expert-template-inlining)
  getBenchmarkSkillTemplate: '3c276eeaeb2caacaca393b8e1a36ebdaccd53a772adcfa8d24496eafbcc53da2',
  getCarefulSkillTemplate: 'e1d464d2b51dda32c0ef37f7e9346ed41dbfec15f5ba56e3f3ecf2dd2045bbec',
  getChromeUseSkillTemplate: '887f74bc1c0d2c1a38f685352d0dd7a26182ca0f88705581f139f676499914a9',
  getCodebaseDesignSkillTemplate: 'c0459451628588b196d05aba88e9c94e02123cc1d30693795ff9acd8b39b5730',
  getCodexSkillTemplate: '87613dc7f7fb3402e9ec18045c42d6ecbd2d5113616fe8e36c6d1b914d46751d',
  getCsoSkillTemplate: 'bab537b039494c66e0122bb4152c144c4e4c93349699fce5a81c1e15e0840a81',
  getDesignConsultationSkillTemplate: 'df9041a73b44b6ff22d508a284ac2213ab9f2d037f7e3dfa3cfdb8df49b2a15a',
  getDesignReviewSkillTemplate: '9f68dee5a32de426aa9f45e85993d3790fbe7aac50d04b17f866e9ae9765f847',
  getInvestigateSkillTemplate: 'b28cdf2ca673221760c12e4488de2ab473dc605f36388457b23beadcc87e9c5c',
  getNavigatorSkillTemplate: '37724dc8810ce1e1078c464bdf05edbc6be2d8e54e758ecb361eddc35cef720a',
  getOfficeHoursSkillTemplate: 'f39588d9870ef21c0b6fd3b17bc8ec3bbcaaddd7886cde15252b726fbb356ea5',
  getPrototypeSkillTemplate: '8facd4d3ceee866941949d5001b12298ca2ca2c599b848bdf693ddbecebcbebf',
  getQaSkillTemplate: '21934de61b3ab3a9e71f68c6018ff585706f5d2509b31c02867be7ae96fb9a5f',
  getQaOnlySkillTemplate: '16b045b1a6b0d059c678a7d03938cb86894b73f967107328b32f8c62c9861968',
  getReviewSkillTemplate: '1de7a818a85c4cd272406938dfaa9cf9c983fc8f932a6a4114b0890cfd94dd90',
  getTddSkillTemplate: '5ee24e317b5f1a1ab114153212a72ed633a40e1f1268c34b31102d9be9607701',
  getWorkflowAuthorSkillTemplate: '7493fb63c5361b40f1de2cc7ff7521fc83cd581707e82886f353285fa9781059',
  getWorkflowReviewSkillTemplate: 'af745dd997e44a1a758a59b6873cf86a8cc1304d3b70fa00cd920b9ad6f0e504',
};

const EXPECTED_GENERATED_SKILL_CONTENT_HASHES: Record<string, string> = {
  'rasen-explore': '7797aadbad172b8531600caf4a09bf040659102fad47e06638848bd7aaad21f0',
  'rasen-new-change': '41e6ffdd565be0b3bd023ab7375f90cbc9bdf02f2810e9f539cfaa3c42b5b43a',
  'rasen-continue-change': 'ed54c7e07126b0c87ab6f1ccc4c0717044004b92c2625382df9f7007293d97c7',
  'rasen-apply-change': '5d7aeda3ce17ba15eddf2b9938c0f2efddf9d38366005b011d6ab8ee7cf479da',
  'rasen-sync-specs': 'b55134399a8d19e7581ff0a517c49445d6e6c77c50df8605f33eaa33623cabc6',
  'rasen-archive-change': 'f89a419cd77d0501f07e9955e3fcf8e451e1f6c86c5a3d2211dbb5bbd38366eb',
  'rasen-bulk-archive-change': 'd8602075663a3ee72a2b9b106c8d83db22f75a9f78a1719d26efa98d099e6fd0',
  'rasen-verify-change': 'aaf1fbaacbfa91ea0e1bfe7f8adaa6b3b13b9fdcbe0eddf4398d56630948c4c6',
  'rasen-onboard': 'ca929a0dfa8785bc945302d14f14d3f8da0cdde97ff87528c8e845a7021f730f',
  'rasen-propose': '776ccd915e68cafec095eeb50289e6004ef8ee095a28f8d86f6e8fa98182e6b0',
  // Workflow/orchestration templates (workflow-template-parity)
  'rasen-office-hours-command': '952a4f8d2f489d599edce569990d1a110157d287d9da464a9c67c35f5404f688',
  'rasen-verify-enhanced': 'dd0dbab3b802adefe7e19a10084acbb687ee33b22e52f7be381c1aa59f0cd910',
  'rasen-ship': '72d3e8f4cf9253fe4b81a060d2110d4e626846826fda0b45ca51f85f2208ed40',
  'rasen-retain': 'f1f20248542b4b40f29cef17cd4bb3ff39a39818d0fdc79541ae8db93c1723da',
  'rasen-retro': 'af377d3849b0cbd34d1362044cc1be6f440a4fb93a3c1001dd5d64e7a58da008',
  'rasen-auto': 'bcfd6a142a3c5fa61ae3153da2ff65a4d5cfa913f2a45976c8475ef1ac02e9d5',
  'rasen-review-cycle': '96bb07eb9fbf2d074c6805d6bfa97e0ad37933daa3795cb8b484222b3fe2ed12',
  'rasen-handoff': '41814abc10493e5da7c53953abcb596b556b4352b27595e359765f391d495c7c',
  'rasen-goal-plan': '675ecc645213d6615d470b7c5f811ec8321012644e36e48532b63a482c6b4401',
  'rasen-goal-iterate': '760ec4dc6f7b0fdaee4767740223349510e50f36d31134c55ab32f4a662711ba',
  'rasen-goal-report': '7d9fb1e446cd6bb55fae6edeec045d70d6c1b8d160001edc301a64a0c57d204f',
  'rasen-goal': 'f476b90c4719701542980d0fe3206889228a594417cc8e43910d80f4685c266f',
  'rasen-help': 'e514db4dbd494106eeebdad39d2eb2c8e1d52159f4916405e8919c047397952c',
  'rasen-direction': '5054415a3954571bd711e4ca93d57a14ee5c662ea078c965c9d6216d550f6c2a',
  // Expert skills (inlined; see expert-template-inlining)
  'rasen-benchmark': '9f6f4439b01c0d8641ffb95c961aaaffa13b2d259005e7746fb6b191833f52d4',
  'rasen-careful': 'b3f81a672fe3f110fb21574aefe5f4a908fb888ad090901291d83dc542f4ebd8',
  'rasen-chrome-use': 'eaf2f68497a641d62dc3916893c9e8789a9aced243ad7914499a1162465a051e',
  'rasen-codebase-design': 'd84f401fddbab582447df483858e021ab6b859516bc021ed1f2ca8134ba0bd28',
  'rasen-codex': 'c5e56492cab6e5b469004cf20641b2d4e8a3563fcefe37ab9f00c3095f0e40d6',
  'rasen-cso': '7ff00cdd4dcb987e492335215df5d34cf32729f9cb8087eea5651bfcd8882e69',
  'rasen-design-consultation': '3011777ddadd0003f22c09162d7776a3fcff5688f95d8d734694169e659072df',
  'rasen-design-review': '92bd9f97630d49d2998ca2bca56b79942f01a193e7089f391e3b0ed494ed24d3',
  'rasen-investigate': 'be38359e01936a0db78f5f3f8996f248b8c5861b48e2693a3dfcc82352a405cf',
  'rasen-navigator': '028840a14af753389c7b700f1636eb0a85d025d3e337a46a2ff4e59203db35f3',
  'rasen-office-hours': 'b20c7a85ba84ed292849efa7ec6e7a2b6c38a8f7817ebf0cc914072ff6b0fc17',
  'rasen-prototype': '03ddcdcd930cec2f530a27f23785c1481f494c7951e34af3be9604a28b9771b2',
  'rasen-qa': '378752081eaad96a788de6fc90d497137c5d3943823bade040752bee29cd6008',
  'rasen-qa-only': '5984164625faa219a29c98849b8208b7bd576efa9b30b4bce27702a41ed2075e',
  'rasen-review': 'b7426969d90e46f55f4dc0723f9e8dde2a743ca270c5e64b83fcafced5d83eae',
  'rasen-tdd': 'fe0fead48016db070ad3b55b9cd6c0bc45fd7b220ba410373d4fc6b71d21eefe',
  'rasen-workflow-author': '89669aca08003a6a61861e4cb4192f66e5d40aec10cfe10e5d550b46ac124599',
  'rasen-workflow-review': '42ae9b2f1dc938b83b9380a0867a6fde99bbcba87af8617c464ee431b5f0837f',
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
  ['rasen-retain', getRetainCommandSkillTemplate],
  ['rasen-retro', getRetroCommandSkillTemplate],
  ['rasen-auto', getAutoCommandSkillTemplate],
  ['rasen-review-cycle', getReviewCycleSkillTemplate],
  ['rasen-handoff', getHandoffSkillTemplate],
  ['rasen-goal-plan', getGoalPlanSkillTemplate],
  ['rasen-goal-iterate', getGoalIterateSkillTemplate],
  ['rasen-goal-report', getGoalReportSkillTemplate],
  ['rasen-goal', getGoalCommandSkillTemplate],
  ['rasen-help', getHelpSkillTemplate],
  ['rasen-direction', getDirectionSkillTemplate],
  ['rasen-benchmark', getBenchmarkSkillTemplate],
  ['rasen-careful', getCarefulSkillTemplate],
  ['rasen-chrome-use', getChromeUseSkillTemplate],
  ['rasen-codebase-design', getCodebaseDesignSkillTemplate],
  ['rasen-codex', getCodexSkillTemplate],
  ['rasen-cso', getCsoSkillTemplate],
  ['rasen-design-consultation', getDesignConsultationSkillTemplate],
  ['rasen-design-review', getDesignReviewSkillTemplate],
  ['rasen-investigate', getInvestigateSkillTemplate],
  ['rasen-navigator', getNavigatorSkillTemplate],
  ['rasen-office-hours', getOfficeHoursSkillTemplate],
  ['rasen-prototype', getPrototypeSkillTemplate],
  ['rasen-qa', getQaSkillTemplate],
  ['rasen-qa-only', getQaOnlySkillTemplate],
  ['rasen-review', getReviewSkillTemplate],
  ['rasen-tdd', getTddSkillTemplate],
  ['rasen-workflow-author', getWorkflowAuthorSkillTemplate],
  ['rasen-workflow-review', getWorkflowReviewSkillTemplate],
];

// C4 grep-guard scope (design D3): generated workflow skill bodies plus the
// navigator router body (a pure cross-reference map). Expert skills that
// carry frozen `_shared.ts` dispatched-contract content (review, cso, qa,
// qa-only, benchmark, design-review, codex, ...) are excluded from this
// guard 鈥?their colon references live in `_shared.ts`'s `PLAN_STATUS_FOOTER`,
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
  'rasen-retain',
  'rasen-retro',
  'rasen-auto',
  'rasen-review-cycle',
  'rasen-handoff',
  'rasen-goal-plan',
  'rasen-goal-iterate',
  'rasen-goal-report',
  'rasen-goal',
  'rasen-help',
  'rasen-direction',
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
      getRetainCommandSkillTemplate,
      getRetroCommandSkillTemplate,
      getAutoCommandSkillTemplate,
      getReviewCycleSkillTemplate,
      getHandoffSkillTemplate,
      getGoalPlanSkillTemplate,
      getGoalIterateSkillTemplate,
      getGoalReportSkillTemplate,
      getGoalCommandSkillTemplate,
      getHelpSkillTemplate,
      getDirectionSkillTemplate,
      getBenchmarkSkillTemplate,
      getCarefulSkillTemplate,
      getChromeUseSkillTemplate,
      getCodebaseDesignSkillTemplate,
      getCodexSkillTemplate,
      getCsoSkillTemplate,
      getDesignConsultationSkillTemplate,
      getDesignReviewSkillTemplate,
      getInvestigateSkillTemplate,
      getNavigatorSkillTemplate,
      getOfficeHoursSkillTemplate,
      getPrototypeSkillTemplate,
      getQaSkillTemplate,
      getQaOnlySkillTemplate,
      getReviewSkillTemplate,
      getTddSkillTemplate,
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

  // The /rasen-auto skill embeds the orchestration playbook; its changeRoot
  // blackboard teaching (tasks 3.1/3.2) and store-scoped resume teaching (M1)
  // are otherwise unpinned by any hash (auto is not in the golden-master map),
  // so a regression that dropped either would pass silently. Pin them here.
  it('teaches changeRoot blackboard resolution and store-scoped resume in the generated rasen-auto skill', () => {
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
