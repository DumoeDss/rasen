import { createHash } from 'node:crypto';

import {
  getApplyChangeSkillTemplate,
  getArchiveChangeSkillTemplate,
  getAuditSkillTemplate,
  getBulkArchiveChangeSkillTemplate,
  getContinueChangeSkillTemplate,
  getExploreSkillTemplate,
  getGoalCommandSkillTemplate,
  getGoalIterateSkillTemplate,
  getGoalPlanSkillTemplate,
  getGoalReportSkillTemplate,
  getHandoffSkillTemplate,
  getHelpSkillTemplate,
  getNewChangeSkillTemplate,
  getOfficeHoursCommandSkillTemplate,
  getOnboardSkillTemplate,
  getOpsxProposeSkillTemplate,
  getRetroCommandSkillTemplate,
  getReviewCycleSkillTemplate,
  getShipCommandSkillTemplate,
  getSyncSpecsSkillTemplate,
  getVerifyChangeSkillTemplate,
  getVerifyEnhancedSkillTemplate,
  getAutoCommandSkillTemplate,
} from '../templates/skill-templates.js';
import type { SkillTemplate } from '../templates/types.js';
import type { WorkflowDefinition, WorkflowDependencySet, WorkflowKind } from './types.js';

export const CORE_WORKFLOW_IDS = [
  'propose',
  'explore',
  'apply',
  'sync',
  'archive',
  'auto-command',
  'help',
] as const;

export const BUILT_IN_WORKFLOW_IDS = [
  'propose',
  'explore',
  'new',
  'continue',
  'apply',
  'sync',
  'archive',
  'bulk-archive',
  'verify',
  'onboard',
  'help',
  'office-hours-command',
  'verify-enhanced-command',
  'ship-command',
  'retro-command',
  'auto-command',
  'review-cycle',
  'handoff',
  'goal-plan',
  'goal-iterate',
  'goal-report',
  'goal-command',
  'audit',
] as const;

export type BuiltInWorkflowId = (typeof BUILT_IN_WORKFLOW_IDS)[number];

interface BuiltInWorkflowAdapter {
  id: BuiltInWorkflowId;
  dirName: string;
  skill: () => SkillTemplate;
  kind?: WorkflowKind;
  requires?: Partial<WorkflowDependencySet>;
}

const BUILT_IN_ADAPTERS: readonly BuiltInWorkflowAdapter[] = [
  { id: 'propose', dirName: 'rasen-propose', skill: getOpsxProposeSkillTemplate },
  { id: 'explore', dirName: 'rasen-explore', skill: getExploreSkillTemplate },
  { id: 'new', dirName: 'rasen-new-change', skill: getNewChangeSkillTemplate },
  { id: 'continue', dirName: 'rasen-continue-change', skill: getContinueChangeSkillTemplate },
  { id: 'apply', dirName: 'rasen-apply-change', skill: getApplyChangeSkillTemplate },
  { id: 'sync', dirName: 'rasen-sync-specs', skill: getSyncSpecsSkillTemplate },
  { id: 'archive', dirName: 'rasen-archive-change', skill: getArchiveChangeSkillTemplate },
  { id: 'bulk-archive', dirName: 'rasen-bulk-archive-change', skill: getBulkArchiveChangeSkillTemplate },
  { id: 'verify', dirName: 'rasen-verify-change', skill: getVerifyChangeSkillTemplate },
  { id: 'onboard', dirName: 'rasen-onboard', skill: getOnboardSkillTemplate },
  { id: 'help', dirName: 'rasen-help', skill: getHelpSkillTemplate },
  { id: 'office-hours-command', dirName: 'rasen-office-hours-command', skill: getOfficeHoursCommandSkillTemplate },
  {
    id: 'verify-enhanced-command',
    dirName: 'rasen-verify-enhanced',
    skill: getVerifyEnhancedSkillTemplate,
    requires: {
      skills: ['rasen-review', 'rasen-cso', 'rasen-qa', 'rasen-design-review', 'rasen-qa-only'],
    },
  },
  { id: 'ship-command', dirName: 'rasen-ship', skill: getShipCommandSkillTemplate },
  { id: 'retro-command', dirName: 'rasen-retro', skill: getRetroCommandSkillTemplate },
  {
    id: 'auto-command',
    dirName: 'rasen-auto',
    skill: getAutoCommandSkillTemplate,
    kind: 'driver',
    requires: {
      skills: ['rasen-review'],
      pipelines: ['small-feature', 'full-feature', 'bug-fix', 'auto-decompose'],
    },
  },
  {
    id: 'review-cycle',
    dirName: 'rasen-review-cycle',
    skill: getReviewCycleSkillTemplate,
    requires: { skills: ['rasen-review'] },
  },
  { id: 'handoff', dirName: 'rasen-handoff', skill: getHandoffSkillTemplate },
  { id: 'goal-plan', dirName: 'rasen-goal-plan', skill: getGoalPlanSkillTemplate, kind: 'internal' },
  { id: 'goal-iterate', dirName: 'rasen-goal-iterate', skill: getGoalIterateSkillTemplate, kind: 'internal' },
  { id: 'goal-report', dirName: 'rasen-goal-report', skill: getGoalReportSkillTemplate, kind: 'internal' },
  {
    id: 'goal-command',
    dirName: 'rasen-goal',
    skill: getGoalCommandSkillTemplate,
    kind: 'driver',
    requires: {
      pipelines: ['goal-loop-measure', 'goal-loop-evaluate', 'goal-loop-research'],
    },
  },
  { id: 'audit', dirName: 'rasen-audit', skill: getAuditSkillTemplate },
];

function digestBuiltIn(adapter: BuiltInWorkflowAdapter, skill: SkillTemplate): string {
  const preimage = JSON.stringify({
    format: 'rasen-built-in-workflow',
    version: 1,
    id: adapter.id,
    dirName: adapter.dirName,
    skill,
  });
  return `sha256:${createHash('sha256').update(preimage, 'utf8').digest('hex')}`;
}

export function getBuiltInWorkflowDefinitions(): WorkflowDefinition[] {
  return BUILT_IN_ADAPTERS.map((adapter) => {
    const skill = adapter.skill();
    return {
      id: adapter.id,
      source: 'built-in',
      manifestVersion: 1,
      kind: adapter.kind ?? 'task',
      skill: { dirName: adapter.dirName, template: skill },
      requires: {
        workflows: adapter.requires?.workflows ?? [],
        skills: adapter.requires?.skills ?? [],
        pipelines: adapter.requires?.pipelines ?? [],
        schemas: adapter.requires?.schemas ?? [],
      },
      recommends: { workflows: [] },
      files: [],
      digest: digestBuiltIn(adapter, skill),
    };
  });
}

