import { createHash } from 'node:crypto';

import {
  getApplyChangeSkillTemplate,
  getArchiveChangeSkillTemplate,
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
  getOpsxApplyCommandTemplate,
  getOpsxArchiveCommandTemplate,
  getOpsxAutoCommandTemplate,
  getOpsxBulkArchiveCommandTemplate,
  getOpsxContinueCommandTemplate,
  getOpsxExploreCommandTemplate,
  getOpsxGoalCommandTemplate,
  getOpsxHandoffCommandTemplate,
  getOpsxHelpCommandTemplate,
  getOpsxNewCommandTemplate,
  getOpsxOfficeHoursCommandTemplate,
  getOpsxOnboardCommandTemplate,
  getOpsxProposeCommandTemplate,
  getOpsxProposeSkillTemplate,
  getOpsxRetroCommandTemplate,
  getOpsxReviewCycleCommandTemplate,
  getOpsxShipCommandTemplate,
  getOpsxSyncCommandTemplate,
  getOpsxVerifyCommandTemplate,
  getOpsxVerifyEnhancedCommandTemplate,
  getRetroCommandSkillTemplate,
  getReviewCycleSkillTemplate,
  getShipCommandSkillTemplate,
  getSyncSpecsSkillTemplate,
  getVerifyChangeSkillTemplate,
  getVerifyEnhancedSkillTemplate,
  getAutoCommandSkillTemplate,
} from '../templates/skill-templates.js';
import type { CommandTemplate, SkillTemplate } from '../templates/types.js';
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
] as const;

export type BuiltInWorkflowId = (typeof BUILT_IN_WORKFLOW_IDS)[number];

interface BuiltInWorkflowAdapter {
  id: BuiltInWorkflowId;
  dirName: string;
  skill: () => SkillTemplate;
  command?: () => CommandTemplate;
  kind?: WorkflowKind;
  requires?: Partial<WorkflowDependencySet>;
}

const BUILT_IN_ADAPTERS: readonly BuiltInWorkflowAdapter[] = [
  { id: 'propose', dirName: 'rasen-propose', skill: getOpsxProposeSkillTemplate, command: getOpsxProposeCommandTemplate },
  { id: 'explore', dirName: 'rasen-explore', skill: getExploreSkillTemplate, command: getOpsxExploreCommandTemplate },
  { id: 'new', dirName: 'rasen-new-change', skill: getNewChangeSkillTemplate, command: getOpsxNewCommandTemplate },
  { id: 'continue', dirName: 'rasen-continue-change', skill: getContinueChangeSkillTemplate, command: getOpsxContinueCommandTemplate },
  { id: 'apply', dirName: 'rasen-apply-change', skill: getApplyChangeSkillTemplate, command: getOpsxApplyCommandTemplate },
  { id: 'sync', dirName: 'rasen-sync-specs', skill: getSyncSpecsSkillTemplate, command: getOpsxSyncCommandTemplate },
  { id: 'archive', dirName: 'rasen-archive-change', skill: getArchiveChangeSkillTemplate, command: getOpsxArchiveCommandTemplate },
  { id: 'bulk-archive', dirName: 'rasen-bulk-archive-change', skill: getBulkArchiveChangeSkillTemplate, command: getOpsxBulkArchiveCommandTemplate },
  { id: 'verify', dirName: 'rasen-verify-change', skill: getVerifyChangeSkillTemplate, command: getOpsxVerifyCommandTemplate },
  { id: 'onboard', dirName: 'rasen-onboard', skill: getOnboardSkillTemplate, command: getOpsxOnboardCommandTemplate },
  { id: 'help', dirName: 'rasen-help', skill: getHelpSkillTemplate, command: getOpsxHelpCommandTemplate },
  { id: 'office-hours-command', dirName: 'rasen-office-hours-command', skill: getOfficeHoursCommandSkillTemplate, command: getOpsxOfficeHoursCommandTemplate },
  {
    id: 'verify-enhanced-command',
    dirName: 'rasen-verify-enhanced',
    skill: getVerifyEnhancedSkillTemplate,
    command: getOpsxVerifyEnhancedCommandTemplate,
    requires: {
      skills: ['rasen-review', 'rasen-cso', 'rasen-qa', 'rasen-design-review', 'rasen-qa-only'],
    },
  },
  { id: 'ship-command', dirName: 'rasen-ship', skill: getShipCommandSkillTemplate, command: getOpsxShipCommandTemplate },
  { id: 'retro-command', dirName: 'rasen-retro', skill: getRetroCommandSkillTemplate, command: getOpsxRetroCommandTemplate },
  {
    id: 'auto-command',
    dirName: 'rasen-auto',
    skill: getAutoCommandSkillTemplate,
    command: getOpsxAutoCommandTemplate,
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
    command: getOpsxReviewCycleCommandTemplate,
    requires: { skills: ['rasen-review'] },
  },
  { id: 'handoff', dirName: 'rasen-handoff', skill: getHandoffSkillTemplate, command: getOpsxHandoffCommandTemplate },
  { id: 'goal-plan', dirName: 'rasen-goal-plan', skill: getGoalPlanSkillTemplate, kind: 'internal' },
  { id: 'goal-iterate', dirName: 'rasen-goal-iterate', skill: getGoalIterateSkillTemplate, kind: 'internal' },
  { id: 'goal-report', dirName: 'rasen-goal-report', skill: getGoalReportSkillTemplate, kind: 'internal' },
  {
    id: 'goal-command',
    dirName: 'rasen-goal',
    skill: getGoalCommandSkillTemplate,
    command: getOpsxGoalCommandTemplate,
    kind: 'driver',
    requires: {
      pipelines: ['goal-loop-measure', 'goal-loop-evaluate', 'goal-loop-research'],
    },
  },
];

function digestBuiltIn(adapter: BuiltInWorkflowAdapter, skill: SkillTemplate, command?: CommandTemplate): string {
  const preimage = JSON.stringify({
    format: 'rasen-built-in-workflow',
    version: 1,
    id: adapter.id,
    dirName: adapter.dirName,
    skill,
    command: command ?? null,
  });
  return `sha256:${createHash('sha256').update(preimage, 'utf8').digest('hex')}`;
}

export function getBuiltInWorkflowDefinitions(): WorkflowDefinition[] {
  return BUILT_IN_ADAPTERS.map((adapter) => {
    const skill = adapter.skill();
    const command = adapter.command?.();
    return {
      id: adapter.id,
      source: 'built-in',
      manifestVersion: 1,
      kind: adapter.kind ?? 'task',
      skill: { dirName: adapter.dirName, template: skill },
      command: command
        ? {
            content: {
              id: adapter.id,
              name: command.name,
              description: command.description,
              category: command.category,
              tags: [...command.tags],
              body: command.content,
            },
          }
        : undefined,
      requires: {
        workflows: adapter.requires?.workflows ?? [],
        skills: adapter.requires?.skills ?? [],
        pipelines: adapter.requires?.pipelines ?? [],
        schemas: adapter.requires?.schemas ?? [],
      },
      recommends: { workflows: [] },
      files: [],
      digest: digestBuiltIn(adapter, skill, command),
    };
  });
}

