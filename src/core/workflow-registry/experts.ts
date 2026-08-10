import {
  getBenchmarkSkillTemplate,
  getCarefulSkillTemplate,
  getChromeUseSkillTemplate,
  getCodexSkillTemplate,
  getCsoSkillTemplate,
  getDesignConsultationSkillTemplate,
  getDesignReviewSkillTemplate,
  getInvestigateSkillTemplate,
  getOfficeHoursSkillTemplate,
  getQaSkillTemplate,
  getReviewSkillTemplate,
  getTeacherAdvisorSkillTemplate,
  getWorkflowAuthorSkillTemplate,
} from '../templates/skill-templates.js';
import type { SkillTemplate } from '../templates/types.js';
import { digestExpert, readSidecarTree, resolveExpertSidecarDir } from './expert-digest.js';
import type { WorkflowDefinition } from './types.js';

export interface ExpertSkillDefinition {
  id: string;
  dirName: string;
  template: SkillTemplate;
}

export function getExpertSkillDefinitions(): ExpertSkillDefinition[] {
  return [
    { id: 'benchmark', dirName: 'rasen-benchmark', template: getBenchmarkSkillTemplate() },
    { id: 'careful', dirName: 'rasen-careful', template: getCarefulSkillTemplate() },
    { id: 'chrome-use', dirName: 'rasen-chrome-use', template: getChromeUseSkillTemplate() },
    { id: 'codex', dirName: 'rasen-codex', template: getCodexSkillTemplate() },
    { id: 'cso', dirName: 'rasen-cso', template: getCsoSkillTemplate() },
    { id: 'design-consultation', dirName: 'rasen-design-consultation', template: getDesignConsultationSkillTemplate() },
    { id: 'design-review', dirName: 'rasen-design-review', template: getDesignReviewSkillTemplate() },
    { id: 'investigate', dirName: 'rasen-investigate', template: getInvestigateSkillTemplate() },
    { id: 'office-hours', dirName: 'rasen-office-hours', template: getOfficeHoursSkillTemplate() },
    { id: 'qa', dirName: 'rasen-qa', template: getQaSkillTemplate() },
    { id: 'review', dirName: 'rasen-review', template: getReviewSkillTemplate() },
    { id: 'teacher-advisor', dirName: 'rasen-teacher-advisor', template: getTeacherAdvisorSkillTemplate() },
    { id: 'workflow-author', dirName: 'rasen-workflow-author', template: getWorkflowAuthorSkillTemplate() },
  ];
}

export function getExpertSkillNames(): ReadonlySet<string> {
  return new Set(getExpertSkillDefinitions().map((definition) => definition.template.name));
}

/**
 * Experts as unified-catalog units (`kind: 'expert'`, `source: 'built-in'`,
 * no command. Packaged sidecars are represented in `files[]` for digest and
 * installed-artifact freshness while remaining directory-backed at source. Composed into
 * `loadWorkflowCatalog` in `./registry.ts` alongside the built-in workflows.
 *
 * M2: memoized (module-level cache) — the sidecar tree is packaged and
 * immutable at runtime, so re-hashing all sidecar trees on every
 * `loadWorkflowCatalog` call is wasted work. `getExpertSkillDefinitions`/
 * `getExpertSkillNames` intentionally stay un-memoized pure derivations (they
 * never hash anything).
 */
let cachedBuiltInExpertDefinitions: WorkflowDefinition[] | undefined;

export function getBuiltInExpertDefinitions(): WorkflowDefinition[] {
  if (!cachedBuiltInExpertDefinitions) {
    cachedBuiltInExpertDefinitions = getExpertSkillDefinitions().map((expert) => {
      const files = readSidecarTree(resolveExpertSidecarDir(expert.id));
      const sidecars = files.map(({ path, sha256 }) => ({ path, sha256 }));
      return {
        id: expert.id,
        source: 'built-in',
        manifestVersion: 1,
        kind: 'expert',
        skill: { dirName: expert.dirName, template: expert.template },
        requires: { workflows: [], skills: [], pipelines: [], schemas: [] },
        recommends: { workflows: [] },
        files,
        digest: digestExpert(expert.id, expert.dirName, expert.template, sidecars),
      };
    });
  }
  return cachedBuiltInExpertDefinitions;
}
