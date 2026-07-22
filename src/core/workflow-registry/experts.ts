import {
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
  getQaOnlySkillTemplate,
  getQaSkillTemplate,
  getReviewSkillTemplate,
  getTddSkillTemplate,
  getUnfreezeSkillTemplate,
  getWorkflowAuthorSkillTemplate,
  getWorkflowReviewSkillTemplate,
} from '../templates/skill-templates.js';
import type { SkillTemplate } from '../templates/types.js';
import { digestExpert, hashSidecarTree, resolveExpertSidecarDir } from './expert-digest.js';
import type { WorkflowDefinition } from './types.js';

export interface ExpertSkillDefinition {
  id: string;
  dirName: string;
  template: SkillTemplate;
  sidecarSourceId?: string;
}

export function getExpertSkillDefinitions(): ExpertSkillDefinition[] {
  return [
    { id: 'benchmark', dirName: 'rasen-benchmark', template: getBenchmarkSkillTemplate() },
    { id: 'careful', dirName: 'rasen-careful', template: getCarefulSkillTemplate() },
    { id: 'chrome-use', dirName: 'rasen-chrome-use', template: getChromeUseSkillTemplate() },
    { id: 'codebase-design', dirName: 'rasen-codebase-design', template: getCodebaseDesignSkillTemplate() },
    { id: 'codex', dirName: 'rasen-codex', template: getCodexSkillTemplate() },
    { id: 'cso', dirName: 'rasen-cso', template: getCsoSkillTemplate() },
    { id: 'design-consultation', dirName: 'rasen-design-consultation', template: getDesignConsultationSkillTemplate() },
    { id: 'design-review', dirName: 'rasen-design-review', template: getDesignReviewSkillTemplate() },
    { id: 'freeze', dirName: 'rasen-freeze', template: getFreezeSkillTemplate() },
    { id: 'guard', dirName: 'rasen-guard', template: getGuardSkillTemplate() },
    { id: 'investigate', dirName: 'rasen-investigate', template: getInvestigateSkillTemplate() },
    { id: 'navigator', dirName: 'rasen-navigator', template: getNavigatorSkillTemplate() },
    { id: 'office-hours', dirName: 'rasen-office-hours', template: getOfficeHoursSkillTemplate() },
    { id: 'prototype', dirName: 'rasen-prototype', template: getPrototypeSkillTemplate() },
    { id: 'qa', dirName: 'rasen-qa', template: getQaSkillTemplate() },
    { id: 'qa-only', dirName: 'rasen-qa-only', template: getQaOnlySkillTemplate(), sidecarSourceId: 'qa' },
    { id: 'review', dirName: 'rasen-review', template: getReviewSkillTemplate() },
    { id: 'tdd', dirName: 'rasen-tdd', template: getTddSkillTemplate() },
    { id: 'unfreeze', dirName: 'rasen-unfreeze', template: getUnfreezeSkillTemplate() },
    { id: 'workflow-author', dirName: 'rasen-workflow-author', template: getWorkflowAuthorSkillTemplate() },
    { id: 'workflow-review', dirName: 'rasen-workflow-review', template: getWorkflowReviewSkillTemplate() },
  ];
}

export function getExpertSkillNames(): ReadonlySet<string> {
  return new Set(getExpertSkillDefinitions().map((definition) => definition.template.name));
}

/**
 * Experts as unified-catalog units (`kind: 'expert'`, `source: 'built-in'`,
 * no command, empty `files[]` — sidecar reference files stay directory-backed
 * per the hybrid model, see design.md D1). Composed into
 * `loadWorkflowCatalog` in `./registry.ts` alongside the built-in workflows.
 *
 * M2: memoized (module-level cache) — the sidecar tree is packaged and
 * immutable at runtime, so re-hashing all 21 sidecar trees on every
 * `loadWorkflowCatalog` call is wasted work. `getExpertSkillDefinitions`/
 * `getExpertSkillNames` intentionally stay un-memoized pure derivations (they
 * never hash anything).
 */
let cachedBuiltInExpertDefinitions: WorkflowDefinition[] | undefined;

export function getBuiltInExpertDefinitions(): WorkflowDefinition[] {
  if (!cachedBuiltInExpertDefinitions) {
    cachedBuiltInExpertDefinitions = getExpertSkillDefinitions().map((expert) => {
      const sidecars = hashSidecarTree(resolveExpertSidecarDir(expert.sidecarSourceId ?? expert.id));
      return {
        id: expert.id,
        source: 'built-in',
        manifestVersion: 1,
        kind: 'expert',
        skill: { dirName: expert.dirName, template: expert.template },
        requires: { workflows: [], skills: [], pipelines: [], schemas: [] },
        recommends: { workflows: [] },
        files: [],
        digest: digestExpert(expert.id, expert.dirName, expert.template, sidecars),
        sidecarSourceId: expert.sidecarSourceId,
      };
    });
  }
  return cachedBuiltInExpertDefinitions;
}
