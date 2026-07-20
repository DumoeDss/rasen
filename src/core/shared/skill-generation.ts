/**
 * Skill Generation Utilities
 *
 * Shared utilities for generating skill and command files.
 */

import { readdirSync, existsSync, mkdirSync, copyFileSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import type { SkillTemplate } from '../templates/skill-templates.js';
import type { CommandContent } from '../command-generation/index.js';
import {
  getBuiltInWorkflowDefinitions,
  getExpertSkillDefinitions,
} from '../workflow-registry/index.js';

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
  template: {
    name: string;
    description: string;
    category: string;
    tags: string[];
    content: string;
  };
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
/**
 * Skills that ship no sidecar directory of their own but whose body references
 * another skill's sidecars (qa-only shares the QA_METHODOLOGY block with qa,
 * which points at `templates/` and `references/` beside the SKILL.md).
 */
export function copySkillSidecars(workflowId: string, targetSkillDir: string): void {
  const sourceId =
    getExpertSkillDefinitions().find((definition) => definition.id === workflowId)
      ?.sidecarSourceId ?? workflowId;
  const sourceDir = resolve(__dirname, '..', '..', '..', 'skills', 'experts', sourceId);
  if (!existsSync(sourceDir)) return;

  copySidecarTree(sourceDir, targetSkillDir);
}

/**
 * Gets skill templates with their directory names, optionally filtered by workflow IDs.
 *
 * @param workflowFilter - If provided, only return templates whose workflowId is in this array
 */
export function getSkillTemplates(workflowFilter?: readonly string[]): SkillTemplateEntry[] {
  const workflowSkills: SkillTemplateEntry[] = getBuiltInWorkflowDefinitions().map(
    (definition) => ({
      template: definition.skill.template,
      dirName: definition.skill.dirName,
      workflowId: definition.id,
    })
  );

  // Expert skills are always installed regardless of workflowFilter
  const expertSkills: SkillTemplateEntry[] = getExpertSkillDefinitions().map(
    (definition) => ({
      template: definition.template,
      dirName: definition.dirName,
      workflowId: definition.id,
    })
  );

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
  const all: CommandTemplateEntry[] = getBuiltInWorkflowDefinitions()
    .filter((definition) => definition.command)
    .map((definition) => {
      const command = definition.command!.content;
      return {
        id: definition.id,
        template: {
          name: command.name,
          description: command.description,
          category: command.category,
          tags: [...command.tags],
          content: command.body,
        },
      };
    });

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
