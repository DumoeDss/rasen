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
} from '../templates/skill-templates.js';
import type { SkillTemplate } from '../templates/types.js';

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
  ];
}

export function getExpertSkillNames(): ReadonlySet<string> {
  return new Set(getExpertSkillDefinitions().map((definition) => definition.template.name));
}

