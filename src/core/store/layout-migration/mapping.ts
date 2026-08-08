/**
 * The explicit mapping file: the operator's one reviewable, committed statement
 * about facts the old layout never recorded (design D3 E4 and D6).
 *
 * Everything declared here is recorded as an ASSERTION, never as derived
 * evidence, and an assertion may never contradict a recorded identity — the
 * mapping file resolves unknowns, it does not relabel recorded history.
 */
import * as path from 'node:path';

import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

import { formatZodIssues } from '../../zod-issues.js';
import { StoreError } from '../errors.js';
import {
  validateStoreTargetLineCatalogV1,
  type StoreTargetLineCatalogV1,
} from '../planning-catalogs.js';
import { isProjectId, isTargetLineId } from '../planning-validation.js';
import type { StoreLayoutMigrationDependencies } from './dependencies.js';
import { sha256Hex, storeRelative } from './flat-source.js';

const ItemAssignmentSchema = z
  .object({
    project: z.string().min(1),
    targetLine: z.string().min(1).optional(),
  })
  .strict();

const SpecResolutionSchema = z
  .union([
    z.object({ owner: z.string().min(1) }).strict(),
    z.object({ split: z.array(z.string().min(1)).min(2) }).strict(),
  ]);

const TargetLineDeclarationSchema = z
  .object({
    storeRef: z.string().min(1),
    projects: z.record(z.string(), z.object({ codeRef: z.string().min(1) }).strict()),
  })
  .strict();

const MappingFileSchema = z
  .object({
    version: z.literal(1),
    defaultTargetLine: z.string().min(1).optional(),
    targetLines: z.record(z.string(), TargetLineDeclarationSchema).optional(),
    changes: z.record(z.string(), ItemAssignmentSchema).optional(),
    archive: z.record(z.string(), ItemAssignmentSchema).optional(),
    specs: z.record(z.string(), SpecResolutionSchema).optional(),
    designDocs: z.record(z.string(), z.string().min(1)).optional(),
  })
  .strict();

export type MappingSpecResolution =
  | { readonly mode: 'owner'; readonly projects: readonly [string] }
  | { readonly mode: 'split'; readonly projects: readonly string[] };

export interface MappingItemAssignment {
  readonly project: string;
  readonly targetLine?: string;
}

export interface LoadedMappingFile {
  readonly path: string;
  readonly relative: string;
  readonly digest: string;
  readonly defaultTargetLine?: string;
  readonly targetLines: ReadonlyMap<string, StoreTargetLineCatalogV1>;
  readonly changes: ReadonlyMap<string, MappingItemAssignment>;
  readonly archive: ReadonlyMap<string, MappingItemAssignment>;
  readonly specs: ReadonlyMap<string, MappingSpecResolution>;
  readonly designDocs: ReadonlyMap<string, string>;
}

function mappingError(message: string, code = 'migration_mapping_invalid'): StoreError {
  return new StoreError(message, code, {
    target: 'migration.mapping',
    fix: 'Correct the mapping file inside the Store worktree and re-run the plan.',
  });
}

/**
 * The mapping file must live inside the Store worktree so it can be committed
 * beside the receipt that cites it. An absolute path outside the Store is
 * refused rather than silently read: a plan bound to a file nobody else can see
 * is not reviewable.
 */
export function resolveMappingPath(storeRoot: string, mappingPath: string): string {
  const resolved = path.isAbsolute(mappingPath)
    ? path.resolve(mappingPath)
    : path.resolve(storeRoot, mappingPath);
  const relative = path.relative(path.resolve(storeRoot), resolved);
  if (relative.length === 0 || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new StoreError(
      `Mapping file ${resolved} is outside the Store worktree ${storeRoot}.`,
      'migration_mapping_outside_store',
      {
        target: 'migration.mapping',
        fix: 'Move the mapping file into the Store worktree so it can be committed with the receipt.',
      }
    );
  }
  return resolved;
}

export async function loadMappingFile(
  dependencies: StoreLayoutMigrationDependencies,
  storeRoot: string,
  mappingPath: string
): Promise<LoadedMappingFile> {
  const resolved = resolveMappingPath(storeRoot, mappingPath);
  const text = await dependencies.fs.readText(resolved);
  if (text === null) {
    throw mappingError(`Mapping file ${resolved} does not exist.`);
  }

  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (error) {
    throw mappingError(
      `Mapping file ${resolved} is not valid YAML: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  const parsed = MappingFileSchema.safeParse(raw);
  if (!parsed.success) {
    throw mappingError(`Mapping file ${resolved} is invalid: ${formatZodIssues(parsed.error)}`);
  }

  const data = parsed.data;
  if (data.defaultTargetLine !== undefined && !isTargetLineId(data.defaultTargetLine)) {
    throw mappingError(
      `Mapping defaultTargetLine '${data.defaultTargetLine}' is not a portable target-line id.`
    );
  }

  const targetLines = new Map<string, StoreTargetLineCatalogV1>();
  for (const [targetLineId, declaration] of Object.entries(data.targetLines ?? {})) {
    let catalog: StoreTargetLineCatalogV1;
    try {
      catalog = validateStoreTargetLineCatalogV1({
        version: 1,
        id: targetLineId,
        storeRef: declaration.storeRef,
        projects: declaration.projects,
      });
    } catch (error) {
      throw mappingError(
        `Mapping targetLines.${targetLineId} is not a valid target-line catalog: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
    targetLines.set(targetLineId, catalog);
  }

  const assignments = (
    section: Record<string, { project: string; targetLine?: string }> | undefined,
    label: string
  ): Map<string, MappingItemAssignment> => {
    const result = new Map<string, MappingItemAssignment>();
    for (const [name, value] of Object.entries(section ?? {})) {
      if (!isProjectId(value.project)) {
        throw mappingError(
          `Mapping ${label}.${name}.project '${value.project}' is not a portable project id.`
        );
      }
      if (value.targetLine !== undefined && !isTargetLineId(value.targetLine)) {
        throw mappingError(
          `Mapping ${label}.${name}.targetLine '${value.targetLine}' is not a portable target-line id.`
        );
      }
      result.set(name, {
        project: value.project,
        ...(value.targetLine === undefined ? {} : { targetLine: value.targetLine }),
      });
    }
    return result;
  };

  const specs = new Map<string, MappingSpecResolution>();
  for (const [capability, value] of Object.entries(data.specs ?? {})) {
    if ('owner' in value) {
      if (!isProjectId(value.owner)) {
        throw mappingError(
          `Mapping specs.${capability}.owner '${value.owner}' is not a portable project id.`
        );
      }
      specs.set(capability, { mode: 'owner', projects: [value.owner] });
      continue;
    }
    const unique = [...new Set(value.split)];
    if (unique.length !== value.split.length) {
      throw mappingError(`Mapping specs.${capability}.split repeats a project id.`);
    }
    for (const projectId of unique) {
      if (!isProjectId(projectId)) {
        throw mappingError(
          `Mapping specs.${capability}.split entry '${projectId}' is not a portable project id.`
        );
      }
    }
    specs.set(capability, { mode: 'split', projects: unique.slice().sort() });
  }

  const designDocs = new Map<string, string>();
  for (const [name, projectId] of Object.entries(data.designDocs ?? {})) {
    if (!isProjectId(projectId)) {
      throw mappingError(
        `Mapping designDocs.${name} '${projectId}' is not a portable project id.`
      );
    }
    designDocs.set(name, projectId);
  }

  return Object.freeze({
    path: resolved,
    relative: storeRelative(storeRoot, resolved),
    digest: sha256Hex(text),
    ...(data.defaultTargetLine === undefined
      ? {}
      : { defaultTargetLine: data.defaultTargetLine }),
    targetLines,
    changes: assignments(data.changes, 'changes'),
    archive: assignments(data.archive, 'archive'),
    specs,
    designDocs,
  });
}

export interface MappingValidationInput {
  readonly mapping: LoadedMappingFile;
  readonly members: readonly string[];
  readonly knownChanges: readonly string[];
  readonly knownArchiveEntries: readonly string[];
  readonly knownSpecs: readonly string[];
  readonly knownDesignDocs: readonly string[];
  /** Recorded identities (E1) keyed as `${kind}:${name}`. */
  readonly recordedIdentity: ReadonlyMap<string, string>;
}

/**
 * Whole-file validation against the inventory. A mapping entry that names an
 * unknown item, a non-member project, or contradicts a recorded identity is an
 * error in the FILE, not an unresolved item — the operator has stated something
 * false, and quietly ignoring it would leave the receipt claiming an assertion
 * migration never honored.
 */
export function validateMappingAgainstInventory(input: MappingValidationInput): void {
  const problems: string[] = [];
  const members = new Set(input.members);

  const checkProject = (label: string, projectId: string): void => {
    if (!members.has(projectId)) {
      problems.push(
        `${label} names project '${projectId}', which is not a member of this Store`
      );
    }
  };

  const checkKnown = (
    label: string,
    name: string,
    known: readonly string[]
  ): void => {
    if (!known.includes(name)) {
      problems.push(`${label} names '${name}', which the inventory does not contain`);
    }
  };

  for (const [name, assignment] of input.mapping.changes) {
    checkKnown('changes', name, input.knownChanges);
    checkProject(`changes.${name}`, assignment.project);
    const recorded = input.recordedIdentity.get(`change:${name}`);
    if (recorded !== undefined && recorded !== assignment.project) {
      problems.push(
        `changes.${name} assigns '${assignment.project}' but the Change records identity '${recorded}' (mapping-contradicts-recorded-identity)`
      );
    }
  }

  for (const [name, assignment] of input.mapping.archive) {
    checkKnown('archive', name, input.knownArchiveEntries);
    checkProject(`archive.${name}`, assignment.project);
    const recorded = input.recordedIdentity.get(`archive-entry:${name}`);
    if (recorded !== undefined && recorded !== assignment.project) {
      problems.push(
        `archive.${name} assigns '${assignment.project}' but the entry records identity '${recorded}' (mapping-contradicts-recorded-identity)`
      );
    }
  }

  for (const [capability, resolution] of input.mapping.specs) {
    checkKnown('specs', capability, input.knownSpecs);
    for (const projectId of resolution.projects) {
      checkProject(`specs.${capability}`, projectId);
    }
  }

  for (const [name, projectId] of input.mapping.designDocs) {
    checkKnown('designDocs', name, input.knownDesignDocs);
    checkProject(`designDocs.${name}`, projectId);
  }

  for (const [targetLineId, catalog] of input.mapping.targetLines) {
    for (const projectId of Object.keys(catalog.projects)) {
      checkProject(`targetLines.${targetLineId}.projects.${projectId}`, projectId);
    }
  }

  if (problems.length > 0) {
    throw mappingError(
      `Mapping file ${input.mapping.relative} cannot be applied:\n  - ${problems.join('\n  - ')}`
    );
  }
}
