import * as path from 'node:path';

import { listSchemas } from '../artifact-graph/resolver.js';
import { resolvePipelinePath } from '../pipeline-registry/resolver.js';
import { computeWorkflowDigest, sha256 } from './digest.js';
import { loadWorkflowSourceTree } from './loader.js';
import { parseSkillDocument, parseWorkflowManifest } from './manifest.js';
import {
  checkPortableRelativePath,
  isPortableSkillReference,
  isPortableWorkflowId,
} from './path-policy.js';
import type { WorkflowDefinition, WorkflowDiagnostic } from './types.js';

export interface WorkflowValidationResult {
  valid: boolean;
  definition?: WorkflowDefinition;
  diagnostics: WorkflowDiagnostic[];
}

function duplicateDiagnostics(
  values: readonly string[],
  logicalPath: string
): WorkflowDiagnostic[] {
  const diagnostics: WorkflowDiagnostic[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      diagnostics.push({
        code: 'duplicate_value',
        severity: 'error',
        message: `Duplicate value "${value}"`,
        path: logicalPath,
      });
    }
    seen.add(value);
  }
  return diagnostics;
}

function unescapeMarkdownDestination(value: string): string {
  return value.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g, '$1');
}

function inlineMarkdownDestinations(instructions: string): string[] {
  const destinations: string[] = [];
  let searchFrom = 0;

  while (true) {
    const linkStart = instructions.indexOf('](', searchFrom);
    if (linkStart < 0) break;
    let cursor = linkStart + 2;
    while (/\s/.test(instructions[cursor] ?? '')) cursor += 1;

    if (instructions[cursor] === '<') {
      cursor += 1;
      const start = cursor;
      let escaped = false;
      while (cursor < instructions.length) {
        const character = instructions[cursor];
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '>') break;
        cursor += 1;
      }
      if (instructions[cursor] === '>') {
        destinations.push(unescapeMarkdownDestination(instructions.slice(start, cursor)));
      }
      searchFrom = cursor + 1;
      continue;
    }

    const start = cursor;
    let depth = 0;
    let escaped = false;
    while (cursor < instructions.length) {
      const character = instructions[cursor];
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '(') {
        depth += 1;
      } else if (character === ')') {
        if (depth === 0) break;
        depth -= 1;
      } else if (/\s/.test(character) && depth === 0) {
        break;
      }
      cursor += 1;
    }
    if (cursor > start) {
      destinations.push(unescapeMarkdownDestination(instructions.slice(start, cursor)));
    }
    searchFrom = cursor + 1;
  }

  return destinations;
}

function referencedSidecarPaths(instructions: string): string[] {
  const references = new Set<string>();
  const addIfRelativeSidecar = (value: string): void => {
    const normalized = value.replace(/^\.\//, '').split('#', 1)[0];
    if (/^(references|scripts|templates|bin)\//.test(normalized)) references.add(normalized);
  };
  for (const destination of inlineMarkdownDestinations(instructions)) {
    addIfRelativeSidecar(destination);
  }
  for (const match of instructions.matchAll(/`((?:\.\/)?(?:references|scripts|templates|bin)\/[^`]+)`/g)) {
    addIfRelativeSidecar(match[1]);
  }
  return [...references];
}

export interface ValidateWorkflowDirectoryOptions {
  /**
   * Repo/project root used to resolve project-layer `requires.pipelines` /
   * `requires.schemas` referents. Omitting it keeps directory-time validation
   * scoped to built-in + user resolution only (no regression).
   */
  projectRoot?: string;
}

export function validateWorkflowDirectory(
  sourcePath: string,
  options: ValidateWorkflowDirectoryOptions = {}
): WorkflowValidationResult {
  const tree = loadWorkflowSourceTree(sourcePath);
  const diagnostics = [...tree.diagnostics];
  const byPath = new Map(tree.files.map((file) => [file.path, file] as const));
  const manifestFile = byPath.get('workflow.yaml');
  const skillFile = byPath.get('SKILL.md');

  if (!manifestFile) {
    diagnostics.push({
      code: 'manifest_missing',
      severity: 'error',
      message: 'workflow.yaml is required',
      path: 'workflow.yaml',
      sourcePath,
    });
  }
  if (!skillFile) {
    diagnostics.push({
      code: 'skill_missing',
      severity: 'error',
      message: 'SKILL.md is required',
      path: 'SKILL.md',
      sourcePath,
    });
  }
  if (!manifestFile || !skillFile) return { valid: false, diagnostics };

  const manifestResult = parseWorkflowManifest(manifestFile.content);
  const skillResult = parseSkillDocument(skillFile.content);
  diagnostics.push(...manifestResult.diagnostics, ...skillResult.diagnostics);
  if (!manifestResult.manifest || !skillResult.skill) {
    return { valid: false, diagnostics };
  }
  const manifest = manifestResult.manifest;
  const parsedSkill = skillResult.skill;

  if (!isPortableWorkflowId(manifest.id)) {
    diagnostics.push({
      code: 'workflow_id_invalid',
      severity: 'error',
      message: `Workflow ID "${manifest.id}" is not portable`,
      path: 'id',
      sourcePath,
    });
  }
  const directoryName = path.basename(path.resolve(sourcePath));
  if (directoryName !== manifest.id) {
    diagnostics.push({
      code: 'workflow_id_mismatch',
      severity: 'error',
      message: `Directory name "${directoryName}" does not match workflow ID "${manifest.id}"`,
      path: 'id',
      sourcePath,
      details: { directoryName, manifestId: manifest.id },
    });
  }
  if (!isPortableWorkflowId(parsedSkill.frontmatter.name)) {
    diagnostics.push({
      code: 'skill_name_invalid',
      severity: 'error',
      message: `Skill name "${parsedSkill.frontmatter.name}" is not portable`,
      path: 'SKILL.md.name',
      sourcePath,
    });
  }

  const declaredSidecars = manifest.files.sidecars;
  const declaredScripts = manifest.files.scripts;
  diagnostics.push(
    ...duplicateDiagnostics(declaredSidecars, 'files.sidecars'),
    ...duplicateDiagnostics(declaredScripts, 'files.scripts'),
    ...duplicateDiagnostics(manifest.requires.workflows, 'requires.workflows'),
    ...duplicateDiagnostics(manifest.requires.skills, 'requires.skills'),
    ...duplicateDiagnostics(manifest.requires.pipelines, 'requires.pipelines'),
    ...duplicateDiagnostics(manifest.requires.schemas, 'requires.schemas'),
    ...duplicateDiagnostics(manifest.recommends.workflows, 'recommends.workflows')
  );

  const declared = new Set<string>();
  for (const [kind, values] of [
    ['sidecar', declaredSidecars],
    ['script', declaredScripts],
  ] as const) {
    for (const value of values) {
      const check = checkPortableRelativePath(value);
      if (!check.valid) {
        diagnostics.push({
          code: check.code!,
          severity: 'error',
          message: check.message!,
          path: `files.${kind === 'sidecar' ? 'sidecars' : 'scripts'}`,
          sourcePath,
          details: { value },
        });
        continue;
      }
      if (value === 'workflow.yaml' || value === 'SKILL.md') {
        diagnostics.push({
          code: 'reserved_file_declaration',
          severity: 'error',
          message: `${value} must not be declared as a sidecar or script`,
          path: `files.${kind === 'sidecar' ? 'sidecars' : 'scripts'}`,
          sourcePath,
        });
      }
      if (declared.has(value)) {
        diagnostics.push({
          code: 'file_declared_twice',
          severity: 'error',
          message: `File "${value}" is declared more than once`,
          path: 'files',
          sourcePath,
        });
      }
      declared.add(value);
      if (!byPath.has(value)) {
        diagnostics.push({
          code: 'declared_file_missing',
          severity: 'error',
          message: `Declared ${kind} "${value}" does not exist`,
          path: value,
          sourcePath,
        });
      }
    }
  }

  for (const file of tree.files) {
    if (file.path === 'workflow.yaml' || file.path === 'SKILL.md') continue;
    if (!declared.has(file.path)) {
      diagnostics.push({
        code: 'file_not_declared',
        severity: 'error',
        message: `File "${file.path}" is not declared in workflow.yaml`,
        path: file.path,
        sourcePath,
      });
    }
  }

  for (const reference of referencedSidecarPaths(parsedSkill.instructions)) {
    if (!declared.has(reference) || !byPath.has(reference)) {
      diagnostics.push({
        code: 'sidecar_reference_unresolved',
        severity: 'error',
        message: `Referenced sidecar "${reference}" is not declared and present`,
        path: 'SKILL.md',
        sourcePath,
        details: { reference },
      });
    }
  }
  if (/__[A-Z][A-Z0-9_]*__/.test(parsedSkill.instructions)) {
    diagnostics.push({
      code: 'placeholder_forbidden',
      severity: 'error',
      message: 'Unresolved template placeholders are not allowed in user workflow instructions',
      path: 'SKILL.md',
      sourcePath,
    });
  }
  if (/\bopenspec(?::|-)/i.test(parsedSkill.instructions)) {
    diagnostics.push({
      code: 'legacy_namespace_reference',
      severity: 'warning',
      message: 'Workflow instructions reference the legacy OpenSpec namespace',
      path: 'SKILL.md',
      sourcePath,
    });
  }
  if (/(?:\/Users\/[^\s`]+|\/home\/[^\s`]+|[A-Za-z]:\\Users\\[^\s`]+)/.test(parsedSkill.instructions)) {
    diagnostics.push({
      code: 'absolute_machine_path',
      severity: 'warning',
      message: 'Workflow instructions contain an absolute machine-specific path',
      path: 'SKILL.md',
      sourcePath,
    });
  }

  for (const dependency of [
    ...manifest.requires.workflows,
    ...manifest.recommends.workflows,
  ]) {
    if (!isPortableWorkflowId(dependency)) {
      diagnostics.push({
        code: 'workflow_dependency_invalid',
        severity: 'error',
        message: `Workflow dependency "${dependency}" is not portable`,
        path: 'requires.workflows',
        sourcePath,
      });
    }
  }
  for (const skill of manifest.requires.skills) {
    if (!isPortableSkillReference(skill)) {
      diagnostics.push({
        code: 'skill_dependency_invalid',
        severity: 'error',
        message: `Skill dependency "${skill}" is not portable`,
        path: 'requires.skills',
        sourcePath,
      });
    }
  }
  for (const pipeline of manifest.requires.pipelines) {
    if (!isPortableWorkflowId(pipeline)) {
      diagnostics.push({
        code: 'pipeline_dependency_invalid',
        severity: 'error',
        message: `Pipeline dependency "${pipeline}" is not portable`,
        path: 'requires.pipelines',
        sourcePath,
      });
      continue;
    }
    if (!resolvePipelinePath(pipeline, options.projectRoot)) {
      diagnostics.push({
        code: 'pipeline_dependency_missing',
        severity: 'error',
        message: `Required pipeline "${pipeline}" was not found`,
        path: 'requires.pipelines',
        sourcePath,
        details: { dependency: pipeline },
      });
    }
  }
  const knownSchemas = new Set(listSchemas(options.projectRoot));
  for (const schema of manifest.requires.schemas) {
    if (!isPortableWorkflowId(schema)) {
      diagnostics.push({
        code: 'schema_dependency_invalid',
        severity: 'error',
        message: `Schema dependency "${schema}" is not portable`,
        path: 'requires.schemas',
        sourcePath,
      });
      continue;
    }
    if (!knownSchemas.has(schema)) {
      diagnostics.push({
        code: 'schema_dependency_missing',
        severity: 'error',
        message: `Required schema "${schema}" was not found`,
        path: 'requires.schemas',
        sourcePath,
        details: { dependency: schema },
      });
    }
  }
  // The command surface is retired (skills are the only delivery format
  // now). A manifest may still declare `command:` (an older user package),
  // but it is silently ignored rather than rejected — no command file is
  // ever generated from it. Noted at warning severity so it stays visible
  // without failing validation.
  if (manifest.command?.enabled) {
    diagnostics.push({
      code: 'command_field_ignored',
      severity: 'warning',
      message: `Workflow "${manifest.id}" declares a "command:" block; the command surface is retired and this is ignored (skills are the only delivery format).`,
      path: 'command',
      sourcePath,
    });
  }

  if (diagnostics.some((item) => item.severity === 'error')) {
    return { valid: false, diagnostics };
  }

  const files = tree.files.map((file) => ({
    path: file.path,
    content: file.content,
    sha256: sha256(file.bytes),
  }));
  const definition: WorkflowDefinition = {
    id: manifest.id,
    source: 'user',
    sourcePath: path.resolve(sourcePath),
    manifestVersion: manifest.version,
    kind: manifest.kind,
    skill: {
      dirName: parsedSkill.frontmatter.name,
      template: {
        name: parsedSkill.frontmatter.name,
        description: parsedSkill.frontmatter.description,
        instructions: parsedSkill.instructions,
        license: parsedSkill.frontmatter.license,
        compatibility: parsedSkill.frontmatter.compatibility,
        metadata: parsedSkill.frontmatter.metadata,
      },
    },
    requires: {
      workflows: [...manifest.requires.workflows],
      skills: [...manifest.requires.skills],
      pipelines: [...manifest.requires.pipelines],
      schemas: [...manifest.requires.schemas],
    },
    recommends: { workflows: [...manifest.recommends.workflows] },
    files,
    digest: computeWorkflowDigest(manifest.id, files),
  };
  return { valid: true, definition, diagnostics };
}
