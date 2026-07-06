/**
 * Skill Generation Utilities
 *
 * Shared utilities for generating skill and command files.
 */

import {
  getExploreSkillTemplate,
  getNewChangeSkillTemplate,
  getContinueChangeSkillTemplate,
  getApplyChangeSkillTemplate,
  getFfChangeSkillTemplate,
  getSyncSpecsSkillTemplate,
  getArchiveChangeSkillTemplate,
  getBulkArchiveChangeSkillTemplate,
  getVerifyChangeSkillTemplate,
  getOnboardSkillTemplate,
  getOpsxProposeSkillTemplate,
  getOpsxExploreCommandTemplate,
  getOpsxNewCommandTemplate,
  getOpsxContinueCommandTemplate,
  getOpsxApplyCommandTemplate,
  getOpsxFfCommandTemplate,
  getOpsxSyncCommandTemplate,
  getOpsxArchiveCommandTemplate,
  getOpsxBulkArchiveCommandTemplate,
  getOpsxVerifyCommandTemplate,
  getOpsxOnboardCommandTemplate,
  getOpsxProposeCommandTemplate,
  // OPSX fusion workflow commands
  getOfficeHoursCommandSkillTemplate,
  getOpsxOfficeHoursCommandTemplate,
  getVerifyEnhancedSkillTemplate,
  getOpsxVerifyEnhancedCommandTemplate,
  getShipCommandSkillTemplate,
  getOpsxShipCommandTemplate,
  getRetroCommandSkillTemplate,
  getOpsxRetroCommandTemplate,
  getAutoCommandSkillTemplate,
  getOpsxAutoCommandTemplate,
  getReviewCycleSkillTemplate,
  getOpsxReviewCycleCommandTemplate,
  // Expert skill templates (from gstack)
  getAutoplanSkillTemplate,
  getBenchmarkSkillTemplate,
  getBrowseSkillTemplate,
  getCanarySkillTemplate,
  getCarefulSkillTemplate,
  getCodexSkillTemplate,
  getCsoSkillTemplate,
  getDesignConsultationSkillTemplate,
  getDesignReviewSkillTemplate,
  getDocumentReleaseSkillTemplate,
  getFreezeSkillTemplate,
  getGuardSkillTemplate,
  getInvestigateSkillTemplate,
  getLandAndDeploySkillTemplate,
  getOfficeHoursSkillTemplate,
  getPlanCeoReviewSkillTemplate,
  getPlanDesignReviewSkillTemplate,
  getPlanEngReviewSkillTemplate,
  getQaOnlySkillTemplate,
  getQaSkillTemplate,
  getRetroSkillTemplate,
  getReviewSkillTemplate,
  getSetupDeploySkillTemplate,
  getShipSkillTemplate,
  getUnfreezeSkillTemplate,
  type SkillTemplate,
} from '../templates/skill-templates.js';
import type { CommandContent } from '../command-generation/index.js';
import type { Delivery } from '../global-config.js';

/**
 * Skill template with directory name and workflow ID mapping.
 */
export interface SkillTemplateEntry {
  template: SkillTemplate;
  dirName: string;
  workflowId: string;
}

/**
 * Command template with ID mapping.
 */
export interface CommandTemplateEntry {
  template: ReturnType<typeof getOpsxExploreCommandTemplate>;
  id: string;
}

/**
 * Gets skill templates with their directory names, optionally filtered by workflow IDs.
 *
 * @param workflowFilter - If provided, only return templates whose workflowId is in this array
 */
export function getSkillTemplates(workflowFilter?: readonly string[]): SkillTemplateEntry[] {
  const workflowSkills: SkillTemplateEntry[] = [
    { template: getExploreSkillTemplate(), dirName: 'openspec-explore', workflowId: 'explore' },
    { template: getNewChangeSkillTemplate(), dirName: 'openspec-new-change', workflowId: 'new' },
    { template: getContinueChangeSkillTemplate(), dirName: 'openspec-continue-change', workflowId: 'continue' },
    { template: getApplyChangeSkillTemplate(), dirName: 'openspec-apply-change', workflowId: 'apply' },
    { template: getFfChangeSkillTemplate(), dirName: 'openspec-ff-change', workflowId: 'ff' },
    { template: getSyncSpecsSkillTemplate(), dirName: 'openspec-sync-specs', workflowId: 'sync' },
    { template: getArchiveChangeSkillTemplate(), dirName: 'openspec-archive-change', workflowId: 'archive' },
    { template: getBulkArchiveChangeSkillTemplate(), dirName: 'openspec-bulk-archive-change', workflowId: 'bulk-archive' },
    { template: getVerifyChangeSkillTemplate(), dirName: 'openspec-verify-change', workflowId: 'verify' },
    { template: getOnboardSkillTemplate(), dirName: 'openspec-onboard', workflowId: 'onboard' },
    { template: getOpsxProposeSkillTemplate(), dirName: 'openspec-propose', workflowId: 'propose' },
    // OPSX fusion workflow commands
    { template: getOfficeHoursCommandSkillTemplate(), dirName: 'openspec-opsx-office-hours', workflowId: 'office-hours-command' },
    { template: getVerifyEnhancedSkillTemplate(), dirName: 'openspec-verify-enhanced', workflowId: 'verify-enhanced-command' },
    { template: getShipCommandSkillTemplate(), dirName: 'openspec-opsx-ship', workflowId: 'ship-command' },
    { template: getRetroCommandSkillTemplate(), dirName: 'openspec-opsx-retro', workflowId: 'retro-command' },
    { template: getAutoCommandSkillTemplate(), dirName: 'openspec-opsx-auto', workflowId: 'auto-command' },
    { template: getReviewCycleSkillTemplate(), dirName: 'openspec-review-cycle', workflowId: 'review-cycle' },
  ];

  // Expert skills are always installed regardless of workflowFilter
  const expertSkills: SkillTemplateEntry[] = [
    { template: getAutoplanSkillTemplate(), dirName: 'openspec-gstack-autoplan', workflowId: 'autoplan' },
    { template: getBenchmarkSkillTemplate(), dirName: 'openspec-gstack-benchmark', workflowId: 'benchmark' },
    { template: getBrowseSkillTemplate(), dirName: 'openspec-gstack-browse', workflowId: 'browse' },
    { template: getCanarySkillTemplate(), dirName: 'openspec-gstack-canary', workflowId: 'canary' },
    { template: getCarefulSkillTemplate(), dirName: 'openspec-gstack-careful', workflowId: 'careful' },
    { template: getCodexSkillTemplate(), dirName: 'openspec-gstack-codex', workflowId: 'codex' },
    { template: getCsoSkillTemplate(), dirName: 'openspec-gstack-cso', workflowId: 'cso' },
    { template: getDesignConsultationSkillTemplate(), dirName: 'openspec-gstack-design-consultation', workflowId: 'design-consultation' },
    { template: getDesignReviewSkillTemplate(), dirName: 'openspec-gstack-design-review', workflowId: 'design-review' },
    { template: getDocumentReleaseSkillTemplate(), dirName: 'openspec-gstack-document-release', workflowId: 'document-release' },
    { template: getFreezeSkillTemplate(), dirName: 'openspec-gstack-freeze', workflowId: 'freeze' },
    { template: getGuardSkillTemplate(), dirName: 'openspec-gstack-guard', workflowId: 'guard' },
    { template: getInvestigateSkillTemplate(), dirName: 'openspec-gstack-investigate', workflowId: 'investigate' },
    { template: getLandAndDeploySkillTemplate(), dirName: 'openspec-gstack-land-and-deploy', workflowId: 'land-and-deploy' },
    { template: getOfficeHoursSkillTemplate(), dirName: 'openspec-gstack-office-hours', workflowId: 'office-hours' },
    { template: getPlanCeoReviewSkillTemplate(), dirName: 'openspec-gstack-plan-ceo-review', workflowId: 'plan-ceo-review' },
    { template: getPlanDesignReviewSkillTemplate(), dirName: 'openspec-gstack-plan-design-review', workflowId: 'plan-design-review' },
    { template: getPlanEngReviewSkillTemplate(), dirName: 'openspec-gstack-plan-eng-review', workflowId: 'plan-eng-review' },
    { template: getQaSkillTemplate(), dirName: 'openspec-gstack-qa', workflowId: 'qa' },
    { template: getQaOnlySkillTemplate(), dirName: 'openspec-gstack-qa-only', workflowId: 'qa-only' },
    { template: getRetroSkillTemplate(), dirName: 'openspec-gstack-retro', workflowId: 'retro' },
    { template: getReviewSkillTemplate(), dirName: 'openspec-gstack-review', workflowId: 'review' },
    { template: getSetupDeploySkillTemplate(), dirName: 'openspec-gstack-setup-deploy', workflowId: 'setup-deploy' },
    { template: getShipSkillTemplate(), dirName: 'openspec-gstack-ship', workflowId: 'ship' },
    { template: getUnfreezeSkillTemplate(), dirName: 'openspec-gstack-unfreeze', workflowId: 'unfreeze' },
  ];

  if (!workflowFilter) return [...workflowSkills, ...expertSkills];

  // Only filter workflow skills; expert skills are always included
  const filterSet = new Set(workflowFilter);
  const filteredWorkflows = workflowSkills.filter(entry => filterSet.has(entry.workflowId));
  return [...filteredWorkflows, ...expertSkills];
}

/**
 * Gets command templates with their IDs, optionally filtered by workflow IDs.
 *
 * @param workflowFilter - If provided, only return templates whose id is in this array
 */
export function getCommandTemplates(workflowFilter?: readonly string[]): CommandTemplateEntry[] {
  const all: CommandTemplateEntry[] = [
    { template: getOpsxExploreCommandTemplate(), id: 'explore' },
    { template: getOpsxNewCommandTemplate(), id: 'new' },
    { template: getOpsxContinueCommandTemplate(), id: 'continue' },
    { template: getOpsxApplyCommandTemplate(), id: 'apply' },
    { template: getOpsxFfCommandTemplate(), id: 'ff' },
    { template: getOpsxSyncCommandTemplate(), id: 'sync' },
    { template: getOpsxArchiveCommandTemplate(), id: 'archive' },
    { template: getOpsxBulkArchiveCommandTemplate(), id: 'bulk-archive' },
    { template: getOpsxVerifyCommandTemplate(), id: 'verify' },
    { template: getOpsxOnboardCommandTemplate(), id: 'onboard' },
    { template: getOpsxProposeCommandTemplate(), id: 'propose' },
    // OPSX fusion workflow commands
    { template: getOpsxOfficeHoursCommandTemplate(), id: 'office-hours-command' },
    { template: getOpsxVerifyEnhancedCommandTemplate(), id: 'verify-enhanced-command' },
    { template: getOpsxShipCommandTemplate(), id: 'ship-command' },
    { template: getOpsxRetroCommandTemplate(), id: 'retro-command' },
    { template: getOpsxAutoCommandTemplate(), id: 'auto-command' },
    { template: getOpsxReviewCycleCommandTemplate(), id: 'review-cycle' },
  ];

  if (!workflowFilter) return all;

  const filterSet = new Set(workflowFilter);
  return all.filter(entry => filterSet.has(entry.id));
}

/**
 * Converts command templates to CommandContent array, optionally filtered by workflow IDs.
 *
 * @param workflowFilter - If provided, only return contents whose id is in this array
 */
export function getCommandContents(workflowFilter?: readonly string[]): CommandContent[] {
  const commandTemplates = getCommandTemplates(workflowFilter);
  return commandTemplates.map(({ template, id }) => ({
    id,
    name: template.name,
    description: template.description,
    category: template.category,
    tags: template.tags,
    body: template.content,
  }));
}

/**
 * Applies deduplication for *-first delivery modes.
 *
 * - skills-first: keep all skills, remove commands that have a skill counterpart
 * - commands-first: keep all commands, remove skills that have a command counterpart
 * - other modes: no change
 */
export function deduplicateForDelivery(
  delivery: Delivery,
  skills: SkillTemplateEntry[],
  commands: CommandContent[]
): { skills: SkillTemplateEntry[]; commands: CommandContent[] } {
  if (delivery === 'commands-first') {
    const commandIds = new Set(commands.map(c => c.id));
    return { skills: skills.filter(s => !commandIds.has(s.workflowId)), commands };
  }
  if (delivery === 'skills-first') {
    const skillIds = new Set(skills.map(s => s.workflowId));
    return { skills, commands: commands.filter(c => !skillIds.has(c.id)) };
  }
  return { skills, commands };
}

/**
 * Generates skill file content with YAML frontmatter.
 *
 * @param template - The skill template
 * @param generatedByVersion - The OpenSpec version to embed in the file
 * @param transformInstructions - Optional callback to transform the instructions content
 */
export function generateSkillContent(
  template: SkillTemplate,
  generatedByVersion: string,
  transformInstructions?: (instructions: string) => string
): string {
  const instructions = transformInstructions
    ? transformInstructions(template.instructions)
    : template.instructions;

  return `---
name: ${template.name}
description: ${template.description}
license: ${template.license || 'MIT'}
compatibility: ${template.compatibility || 'Requires openspec CLI.'}
metadata:
  author: ${template.metadata?.author || 'openspec'}
  version: "${template.metadata?.version || '1.0'}"
  generatedBy: "${generatedByVersion}"
---

${instructions}
`;
}
