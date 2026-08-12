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
import { isIssueId, isProjectId, isTargetLineId } from '../planning-validation.js';
import { assertPortableIssueText } from '../issues/records.js';
import type { StoreLayoutMigrationDependencies } from './dependencies.js';
import { sha256Hex, storeRelative } from './flat-source.js';
import { hasTypicalMojibake } from './strict-text.js';

const V1ItemAssignmentSchema = z
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

const MappingFileV1Schema = z
  .object({
    version: z.literal(1),
    defaultTargetLine: z.string().min(1).optional(),
    targetLines: z.record(z.string(), TargetLineDeclarationSchema).optional(),
    changes: z.record(z.string(), V1ItemAssignmentSchema).optional(),
    archive: z.record(z.string(), V1ItemAssignmentSchema).optional(),
    specs: z.record(z.string(), SpecResolutionSchema).optional(),
    designDocs: z.record(z.string(), z.string().min(1)).optional(),
  })
  .strict();

const ProjectChangeAssignmentSchema = z
  .object({
    kind: z.literal('project-change'),
    project: z.string().min(1),
    targetLine: z.string().min(1).optional(),
  })
  .strict();

const ActiveIssueAssignmentSchema = z
  .object({
    kind: z.literal('store-issue'),
    issueId: z.string().min(1),
    title: z.string().min(1).max(200),
    plan: z.string().min(1).optional(),
  })
  .strict();

const ArchivedIssueAssignmentSchema = z
  .object({
    kind: z.literal('store-issue'),
    issueId: z.string().min(1),
    title: z.string().min(1).max(200),
    plan: z.string().min(1).optional(),
    state: z.enum(['open', 'resolved', 'dropped']),
    reason: z.string().min(1).max(4000).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.state === 'open' && value.reason !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['reason'],
        message: "must be absent when archived state is 'open'",
      });
    }
    if (value.state !== 'open' && value.reason === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['reason'],
        message: `is required when archived state is '${value.state}'`,
      });
    }
  });

const MappingFileV2Schema = z
  .object({
    version: z.literal(2),
    defaultTargetLine: z.string().min(1).optional(),
    targetLines: z.record(z.string(), TargetLineDeclarationSchema).optional(),
    changes: z
      .record(
        z.string(),
        z.discriminatedUnion('kind', [ProjectChangeAssignmentSchema, ActiveIssueAssignmentSchema])
      )
      .optional(),
    archive: z
      .record(z.string(), z.union([ProjectChangeAssignmentSchema, ArchivedIssueAssignmentSchema]))
      .optional(),
    specs: z.record(z.string(), SpecResolutionSchema).optional(),
    designDocs: z.record(z.string(), z.string().min(1)).optional(),
  })
  .strict();

export type MappingSpecResolution =
  | { readonly mode: 'owner'; readonly projects: readonly [string] }
  | { readonly mode: 'split'; readonly projects: readonly string[] };

export interface MappingProjectChangeAssignment {
  readonly kind: 'project-change';
  readonly project: string;
  readonly targetLine?: string;
}

export interface MappingStoreIssueAssignment {
  readonly kind: 'store-issue';
  readonly issueId: string;
  readonly title: string;
  readonly plan?: string;
  readonly state: 'open' | 'resolved' | 'dropped';
  readonly reason: string | null;
}

export type MappingItemAssignment =
  | MappingProjectChangeAssignment
  | MappingStoreIssueAssignment;

export interface LoadedMappingFile {
  readonly version: 1 | 2;
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
  let canonicalRoot: string;
  let canonicalMapping: string;
  try {
    canonicalRoot = await dependencies.fs.canonicalizeExistingPath(storeRoot);
    canonicalMapping = await dependencies.fs.canonicalizeExistingPath(resolved);
  } catch (error) {
    throw mappingError(
      `Mapping file ${resolved} cannot be resolved: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  const containment = path.relative(canonicalRoot, canonicalMapping);
  if (
    containment.length === 0 ||
    containment === '..' ||
    containment.startsWith(`..${path.sep}`) ||
    path.isAbsolute(containment)
  ) {
    throw new StoreError(
      `Mapping file ${resolved} resolves outside the Store worktree ${storeRoot}.`,
      'migration_mapping_outside_store',
      {
        target: 'migration.mapping',
        fix: 'Move the mapping file into the Store worktree without an escaping symlink or junction.',
      }
    );
  }
  const bytes = await dependencies.fs.readBytes(resolved);
  if (bytes === null) {
    throw mappingError(`Mapping file ${resolved} does not exist.`);
  }
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    throw mappingError(`Mapping file ${resolved} has a UTF-8 BOM.`);
  }
  const text = bytes.toString('utf8');
  if (text.includes('\ufffd') || !Buffer.from(text, 'utf8').equals(bytes)) {
    throw mappingError(`Mapping file ${resolved} is not strict UTF-8.`);
  }
  if (hasTypicalMojibake(text)) {
    throw mappingError(`Mapping file ${resolved} contains a mojibake sentinel.`);
  }

  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (error) {
    throw mappingError(
      `Mapping file ${resolved} is not valid YAML: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  const version =
    typeof raw === 'object' && raw !== null && 'version' in raw
      ? (raw as { version?: unknown }).version
      : undefined;
  const parsed =
    version === 1
      ? MappingFileV1Schema.safeParse(raw)
      : version === 2
        ? MappingFileV2Schema.safeParse(raw)
        : MappingFileV1Schema.safeParse(raw);
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

  const v1Assignments = (
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
        kind: 'project-change',
        project: value.project,
        ...(value.targetLine === undefined ? {} : { targetLine: value.targetLine }),
      });
    }
    return result;
  };

  const v2Assignments = (
    section:
      | Record<
          string,
          | { kind: 'project-change'; project: string; targetLine?: string }
          | {
              kind: 'store-issue';
              issueId: string;
              title: string;
              plan?: string;
              state?: 'open' | 'resolved' | 'dropped';
              reason?: string;
            }
        >
      | undefined,
    label: 'changes' | 'archive'
  ): Map<string, MappingItemAssignment> => {
    const result = new Map<string, MappingItemAssignment>();
    for (const [name, value] of Object.entries(section ?? {})) {
      if (value.kind === 'project-change') {
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
          kind: 'project-change',
          project: value.project,
          ...(value.targetLine === undefined ? {} : { targetLine: value.targetLine }),
        });
        continue;
      }
      if (!isIssueId(value.issueId)) {
        throw mappingError(
          `Mapping ${label}.${name}.issueId '${value.issueId}' is not a portable Issue id.`
        );
      }
      try {
        assertPortableIssueText(value.title, `${label}.${name}.title`);
        if (value.reason !== undefined) {
          assertPortableIssueText(value.reason, `${label}.${name}.reason`);
        }
      } catch (error) {
        throw mappingError(error instanceof Error ? error.message : String(error));
      }
      result.set(name, {
        kind: 'store-issue',
        issueId: value.issueId,
        title: value.title,
        ...(value.plan === undefined ? {} : { plan: value.plan }),
        state: label === 'changes' ? 'open' : (value.state as 'open' | 'resolved' | 'dropped'),
        reason: label === 'changes' || value.state === 'open' ? null : (value.reason as string),
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
    version: data.version,
    path: resolved,
    relative: storeRelative(storeRoot, resolved),
    digest: sha256Hex(bytes),
    ...(data.defaultTargetLine === undefined
      ? {}
      : { defaultTargetLine: data.defaultTargetLine }),
    targetLines,
    changes:
      data.version === 1
        ? v1Assignments(data.changes, 'changes')
        : v2Assignments(data.changes, 'changes'),
    archive:
      data.version === 1
        ? v1Assignments(data.archive, 'archive')
        : v2Assignments(data.archive, 'archive'),
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
    const recorded = input.recordedIdentity.get(`change:${name}`);
    if (assignment.kind === 'store-issue') {
      if (recorded !== undefined) {
        problems.push(
          `changes.${name} declares a Store Issue but the Change records identity '${recorded}' (mapping-contradicts-recorded-identity)`
        );
      }
      continue;
    }
    checkProject(`changes.${name}`, assignment.project);
    if (recorded !== undefined && recorded !== assignment.project) {
      problems.push(
        `changes.${name} assigns '${assignment.project}' but the Change records identity '${recorded}' (mapping-contradicts-recorded-identity)`
      );
    }
  }

  for (const [name, assignment] of input.mapping.archive) {
    checkKnown('archive', name, input.knownArchiveEntries);
    const recorded = input.recordedIdentity.get(`archive-entry:${name}`);
    if (assignment.kind === 'store-issue') {
      if (recorded !== undefined) {
        problems.push(
          `archive.${name} declares a Store Issue but the entry records identity '${recorded}' (mapping-contradicts-recorded-identity)`
        );
      }
      continue;
    }
    checkProject(`archive.${name}`, assignment.project);
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

  const issueNames = [
    ...[...input.mapping.changes.entries()].filter(([, value]) => value.kind === 'store-issue'),
    ...[...input.mapping.archive.entries()].filter(([, value]) => value.kind === 'store-issue'),
  ] as readonly (readonly [string, MappingItemAssignment])[];
  const issueIds = new Map<string, string>();
  for (const [name, assignment] of issueNames) {
    if (assignment.kind !== 'store-issue') continue;
    const folded = assignment.issueId.normalize('NFC').toLowerCase();
    const previous = issueIds.get(folded);
    if (previous !== undefined) {
      problems.push(
        `Issue id '${assignment.issueId}' for '${name}' collides with '${previous}' after case folding`
      );
    } else {
      issueIds.set(folded, name);
    }
  }

  if (problems.length > 0) {
    throw mappingError(
      `Mapping file ${input.mapping.relative} cannot be applied:\n  - ${problems.join('\n  - ')}`
    );
  }
}
