/**
 * Skill Generation Utilities
 *
 * Shared utilities for generating skill and command files.
 */

import { readdirSync, existsSync, mkdirSync, copyFileSync, writeFileSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import type { SkillTemplate } from '../templates/skill-templates.js';
import { quoteYamlValue, yamlScalar } from './yaml.js';
import {
  getExpertSkillDefinitions,
  loadWorkflowCatalog,
  resolveWorkflowSelection,
} from '../workflow-registry/index.js';

/**
 * Skill template with directory name and workflow ID mapping.
 */
export interface SkillTemplateEntry {
  template: SkillTemplate;
  dirName: string;
  workflowId: string;
  /** User-authored frontmatter must be emitted as quoted YAML scalars. */
  escapeFrontmatter: boolean;
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
  const userDefinition = loadWorkflowCatalog().get(workflowId);
  if (userDefinition?.source === 'user') {
    for (const file of userDefinition.files) {
      if (file.path === 'SKILL.md' || file.path === 'workflow.yaml') continue;
      const target = join(targetSkillDir, ...file.path.split('/'));
      mkdirSync(dirname(target), { recursive: true });
      const executable = /^(?:scripts|bin)\//.test(file.path) || /\.(?:sh|mjs|js)$/.test(file.path);
      writeFileSync(target, file.content, { encoding: 'utf8', mode: executable ? 0o700 : 0o600 });
    }
    return;
  }
  const sourceId =
    getExpertSkillDefinitions().find((definition) => definition.id === workflowId)
      ?.sidecarSourceId ?? workflowId;
  const sourceDir = resolve(__dirname, '..', '..', '..', 'skills', 'experts', sourceId);
  if (!existsSync(sourceDir)) return;

  copySidecarTree(sourceDir, targetSkillDir);
}

/**
 * Gets skill templates with their directory names, optionally filtered by
 * workflow/expert IDs.
 *
 * Experts are catalog units like workflows (`kind: 'expert'`) and install
 * according to the SAME filter — there is no more unconditional "always
 * install every expert" branch (that was the pre-6b behavior). Callers that
 * need experts installed (profile defaults, dependency closure) must include
 * those expert ids in `workflowFilter` themselves — see the single
 * desired-set resolver in `init.ts`/`update.ts`, which passes
 * `resolveWorkflowSelection(..., { includeSkillDependencies: true })`'s
 * result here.
 *
 * @param workflowFilter - If provided, only return templates whose workflowId is in this array
 */
export function getSkillTemplates(workflowFilter?: readonly string[]): SkillTemplateEntry[] {
  const catalog = loadWorkflowCatalog();
  const definitions = workflowFilter
    ? resolveWorkflowSelection(catalog, workflowFilter.filter((workflow) => catalog.has(workflow)))
    : catalog.definitions;
  return definitions.map((definition) => ({
    template: definition.skill.template,
    dirName: definition.skill.dirName,
    workflowId: definition.id,
    escapeFrontmatter: definition.source === 'user',
  }));
}

/**
 * Generates skill file content with YAML frontmatter.
 *
 * @param template - The skill template
 * @param generatedByVersion - The Rasen version to embed in the file; this overrides any authored metadata.generatedBy value
 * @param transformInstructions - Optional callback to transform the instructions content
 * @param escapeFrontmatter - Quote user-authored frontmatter scalars when true
 */
export function generateSkillContent(
  template: SkillTemplate,
  generatedByVersion: string,
  transformInstructions?: (instructions: string) => string,
  escapeFrontmatter = false
): string {
  const instructions = transformInstructions
    ? transformInstructions(template.instructions)
    : template.instructions;

  const disableModelInvocationLine = template.disableModelInvocation
    ? 'disable-model-invocation: true\n'
    : '';
  // User-authored frontmatter is always quoted (trusted-input policy for
  // imported skills); built-in frontmatter is quoted only when a value is
  // unsafe as a YAML plain scalar (e.g. contains a ": " sequence), keeping the
  // common case unquoted and the output always valid YAML.
  const scalar = (value: string): string => escapeFrontmatter ? quoteYamlValue(value) : yamlScalar(value);
  const version = template.metadata?.version || '1.0';
  const customMetadataLines = Object.entries(template.metadata ?? {})
    .filter(([key]) => key !== 'author' && key !== 'version' && key !== 'generatedBy')
    .sort(([left], [right]) => {
      if (left < right) return -1;
      if (left > right) return 1;
      return 0;
    })
    .map(([key, value]) => {
      const renderedKey = escapeFrontmatter ? quoteYamlValue(key) : key;
      return `  ${renderedKey}: ${scalar(value)}`;
    });
  const customMetadataBlock = customMetadataLines.length > 0
    ? `${customMetadataLines.join('\n')}\n`
    : '';

  return `---
name: ${scalar(template.name)}
description: ${scalar(template.description)}
${disableModelInvocationLine}license: ${scalar(template.license || 'MIT')}
compatibility: ${scalar(template.compatibility || 'Requires rasen CLI.')}
metadata:
  author: ${scalar(template.metadata?.author || 'rasen')}
  version: ${escapeFrontmatter ? quoteYamlValue(version) : `"${version}"`}
${customMetadataBlock}  generatedBy: ${escapeFrontmatter ? quoteYamlValue(generatedByVersion) : `"${generatedByVersion}"`}
---

${instructions}
`;
}
