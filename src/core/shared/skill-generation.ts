/**
 * Skill Generation Utilities
 *
 * Shared utilities for generating skill and command files.
 */

import { readdirSync, existsSync, mkdirSync, copyFileSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
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
  // Rasen fusion workflow commands
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
  getHandoffSkillTemplate,
  getOpsxHandoffCommandTemplate,
  // Goal-loop workflow skills + command
  getGoalPlanSkillTemplate,
  getGoalIterateSkillTemplate,
  getGoalReportSkillTemplate,
  getGoalCommandSkillTemplate,
  getOpsxGoalCommandTemplate,
  // Expert skill templates (from gstack)
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * A sidecar is a reference file or executable helper script that lives beside a
 * skill's `SKILL.md` and is read or launched by relative path from the skill
 * body (e.g. `checklist.md`, `references/issue-taxonomy.md`,
 * `scripts/hitl-loop.template.sh`, `scripts/cdp-proxy.mjs`). Documentation
 * (`.md` except `SKILL.md`), shell scripts (`.sh`), and executable Node scripts
 * (`.mjs`/`.js`) qualify; `.tmpl` sources are excluded (build-only).
 */
function isSidecarFile(fileName: string): boolean {
  if (fileName === 'SKILL.md') return false;
  if (fileName.endsWith('.tmpl')) return false;
  return (
    fileName.endsWith('.md') ||
    fileName.endsWith('.sh') ||
    fileName.endsWith('.mjs') ||
    fileName.endsWith('.js')
  );
}

function copySidecarTree(sourceDir: string, targetDir: string): void {
  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = join(sourceDir, entry.name);
    if (entry.isDirectory()) {
      // Recurse to preserve subdir structure (references/ templates/ scripts/ bin/).
      // Target subdirs are created lazily on first sidecar copy, so an all-filtered
      // subtree (e.g. a skill's .ts src/) leaves no empty target directory behind.
      copySidecarTree(sourcePath, join(targetDir, entry.name));
      continue;
    }
    if (!entry.isFile() || !isSidecarFile(entry.name)) continue;
    mkdirSync(targetDir, { recursive: true });
    copyFileSync(sourcePath, join(targetDir, entry.name));
  }
}

/**
 * Copies a skill's sidecar reference files (see {@link isSidecarFile}) from the
 * packaged source skill dir into the installed skill directory, preserving
 * subdirectory structure. Called by `init`/`update` after writing each `SKILL.md`.
 *
 * - The source dir is resolved relative to the package root, at
 *   `skills/experts/<workflowId>` (sidecar reference files only; expert prompts
 *   are inline TypeScript in `src/core/templates/experts/<name>.ts`).
 * - No-ops gracefully if the source dir is absent (e.g. a published npm package
 *   that does not bundle `skills/`), matching the expert-template `readFileSync`
 *   try/catch behavior. Re-running overwrites in place (idempotent).
 */
export function copySkillSidecars(workflowId: string, targetSkillDir: string): void {
  const sourceDir = resolve(__dirname, '..', '..', '..', 'skills', 'experts', workflowId);
  if (!existsSync(sourceDir)) return;

  copySidecarTree(sourceDir, targetSkillDir);
}

/**
 * Gets skill templates with their directory names, optionally filtered by workflow IDs.
 *
 * @param workflowFilter - If provided, only return templates whose workflowId is in this array
 */
export function getSkillTemplates(workflowFilter?: readonly string[]): SkillTemplateEntry[] {
  const workflowSkills: SkillTemplateEntry[] = [
    { template: getExploreSkillTemplate(), dirName: 'rasen-explore', workflowId: 'explore' },
    { template: getNewChangeSkillTemplate(), dirName: 'rasen-new-change', workflowId: 'new' },
    { template: getContinueChangeSkillTemplate(), dirName: 'rasen-continue-change', workflowId: 'continue' },
    { template: getApplyChangeSkillTemplate(), dirName: 'rasen-apply-change', workflowId: 'apply' },
    { template: getFfChangeSkillTemplate(), dirName: 'rasen-ff-change', workflowId: 'ff' },
    { template: getSyncSpecsSkillTemplate(), dirName: 'rasen-sync-specs', workflowId: 'sync' },
    { template: getArchiveChangeSkillTemplate(), dirName: 'rasen-archive-change', workflowId: 'archive' },
    { template: getBulkArchiveChangeSkillTemplate(), dirName: 'rasen-bulk-archive-change', workflowId: 'bulk-archive' },
    { template: getVerifyChangeSkillTemplate(), dirName: 'rasen-verify-change', workflowId: 'verify' },
    { template: getOnboardSkillTemplate(), dirName: 'rasen-onboard', workflowId: 'onboard' },
    { template: getOpsxProposeSkillTemplate(), dirName: 'rasen-propose', workflowId: 'propose' },
    // Rasen fusion workflow commands
    { template: getOfficeHoursCommandSkillTemplate(), dirName: 'rasen-office-hours-command', workflowId: 'office-hours-command' },
    { template: getVerifyEnhancedSkillTemplate(), dirName: 'rasen-verify-enhanced', workflowId: 'verify-enhanced-command' },
    { template: getShipCommandSkillTemplate(), dirName: 'rasen-ship', workflowId: 'ship-command' },
    { template: getRetroCommandSkillTemplate(), dirName: 'rasen-retro', workflowId: 'retro-command' },
    { template: getAutoCommandSkillTemplate(), dirName: 'rasen-auto', workflowId: 'auto-command' },
    { template: getReviewCycleSkillTemplate(), dirName: 'rasen-review-cycle', workflowId: 'review-cycle' },
    { template: getHandoffSkillTemplate(), dirName: 'rasen-handoff', workflowId: 'handoff' },
    // Goal-loop workflow skills (stage skills + entry command)
    { template: getGoalPlanSkillTemplate(), dirName: 'rasen-goal-plan', workflowId: 'goal-plan' },
    { template: getGoalIterateSkillTemplate(), dirName: 'rasen-goal-iterate', workflowId: 'goal-iterate' },
    { template: getGoalReportSkillTemplate(), dirName: 'rasen-goal-report', workflowId: 'goal-report' },
    { template: getGoalCommandSkillTemplate(), dirName: 'rasen-goal', workflowId: 'goal-command' },
  ];

  // Expert skills are always installed regardless of workflowFilter
  const expertSkills: SkillTemplateEntry[] = [
    { template: getBenchmarkSkillTemplate(), dirName: 'rasen-benchmark', workflowId: 'benchmark' },
    { template: getCarefulSkillTemplate(), dirName: 'rasen-careful', workflowId: 'careful' },
    { template: getChromeUseSkillTemplate(), dirName: 'rasen-chrome-use', workflowId: 'chrome-use' },
    { template: getCodebaseDesignSkillTemplate(), dirName: 'rasen-codebase-design', workflowId: 'codebase-design' },
    { template: getCodexSkillTemplate(), dirName: 'rasen-codex', workflowId: 'codex' },
    { template: getCsoSkillTemplate(), dirName: 'rasen-cso', workflowId: 'cso' },
    { template: getDesignConsultationSkillTemplate(), dirName: 'rasen-design-consultation', workflowId: 'design-consultation' },
    { template: getDesignReviewSkillTemplate(), dirName: 'rasen-design-review', workflowId: 'design-review' },
    { template: getFreezeSkillTemplate(), dirName: 'rasen-freeze', workflowId: 'freeze' },
    { template: getGuardSkillTemplate(), dirName: 'rasen-guard', workflowId: 'guard' },
    { template: getInvestigateSkillTemplate(), dirName: 'rasen-investigate', workflowId: 'investigate' },
    { template: getNavigatorSkillTemplate(), dirName: 'rasen-navigator', workflowId: 'navigator' },
    { template: getOfficeHoursSkillTemplate(), dirName: 'rasen-office-hours', workflowId: 'office-hours' },
    { template: getPrototypeSkillTemplate(), dirName: 'rasen-prototype', workflowId: 'prototype' },
    { template: getQaSkillTemplate(), dirName: 'rasen-qa', workflowId: 'qa' },
    { template: getQaOnlySkillTemplate(), dirName: 'rasen-qa-only', workflowId: 'qa-only' },
    { template: getReviewSkillTemplate(), dirName: 'rasen-review', workflowId: 'review' },
    { template: getTddSkillTemplate(), dirName: 'rasen-tdd', workflowId: 'tdd' },
    { template: getUnfreezeSkillTemplate(), dirName: 'rasen-unfreeze', workflowId: 'unfreeze' },
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
    // Rasen fusion workflow commands
    { template: getOpsxOfficeHoursCommandTemplate(), id: 'office-hours-command' },
    { template: getOpsxVerifyEnhancedCommandTemplate(), id: 'verify-enhanced-command' },
    { template: getOpsxShipCommandTemplate(), id: 'ship-command' },
    { template: getOpsxRetroCommandTemplate(), id: 'retro-command' },
    { template: getOpsxAutoCommandTemplate(), id: 'auto-command' },
    { template: getOpsxReviewCycleCommandTemplate(), id: 'review-cycle' },
    { template: getOpsxHandoffCommandTemplate(), id: 'handoff' },
    { template: getOpsxGoalCommandTemplate(), id: 'goal-command' },
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
 * @param generatedByVersion - The Rasen version to embed in the file
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

  const disableModelInvocationLine = template.disableModelInvocation
    ? 'disable-model-invocation: true\n'
    : '';

  return `---
name: ${template.name}
description: ${template.description}
${disableModelInvocationLine}license: ${template.license || 'MIT'}
compatibility: ${template.compatibility || 'Requires rasen CLI.'}
metadata:
  author: ${template.metadata?.author || 'rasen'}
  version: "${template.metadata?.version || '1.0'}"
  generatedBy: "${generatedByVersion}"
---

${instructions}
`;
}
