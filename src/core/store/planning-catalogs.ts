import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';

import { formatZodIssues } from '../zod-issues.js';
import { remoteCarriesCredentials } from './remote.js';
import {
  StorePlanningValidationError,
  isCanonicalIsoTimestamp,
  parseFullGitRef,
  parsePortableRelativePath,
  parseProjectId,
  parseTargetLineId,
  type FullGitRef,
  type PortableRelativePath,
  type ProjectId,
  type StorePlanningValidationErrorCode,
  type TargetLineId,
} from './planning-validation.js';

export interface StoreProjectCatalogRolesV2 {
  readonly planning: boolean;
  readonly knowledge: boolean;
}

export type StoreProjectPlanningBindingV2 =
  | { readonly state: 'unbound' }
  | { readonly state: 'bound'; readonly boundAt: string };

export interface StoreProjectCatalogV2 {
  readonly version: 2;
  readonly projectId: ProjectId;
  /**
   * Human display name, for reading only — never an identifier, never a path
   * segment. `projectId` is the identity. Accepts exactly what the v1
   * membership record accepts, so migration cannot block on it.
   */
  readonly id?: string;
  readonly remote?: string;
  readonly knowledgeBundle?: PortableRelativePath;
  readonly roles: StoreProjectCatalogRolesV2;
  readonly planningBinding: StoreProjectPlanningBindingV2;
}

export interface TargetLineProjectLocatorV1 {
  readonly codeRef: FullGitRef;
}

export interface StoreTargetLineCatalogV1 {
  readonly version: 1;
  readonly id: TargetLineId;
  readonly storeRef: FullGitRef;
  readonly projects: Readonly<Record<string, TargetLineProjectLocatorV1>>;
}

const RolesSchema = z
  .object({
    planning: z.boolean(),
    knowledge: z.boolean(),
  })
  .strict();

const PlanningBindingSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('unbound') }).strict(),
  z
    .object({
      state: z.literal('bound'),
      boundAt: z.string().refine(isCanonicalIsoTimestamp, {
        message: 'boundAt must be a canonical ISO-8601 UTC timestamp',
      }),
    })
    .strict(),
]);

const ProjectCatalogSchema = z
  .object({
    version: z.literal(2),
    projectId: z.string(),
    id: z.string().min(1).optional(),
    remote: z.string().min(1).optional(),
    knowledgeBundle: z.string().min(1).optional(),
    roles: RolesSchema,
    planningBinding: PlanningBindingSchema,
  })
  .strict();

const TargetLineCatalogSchema = z
  .object({
    version: z.literal(1),
    id: z.string(),
    storeRef: z.string(),
    projects: z.record(
      z.string(),
      z.object({ codeRef: z.string() }).strict()
    ),
  })
  .strict();

const PORTABLE_REMOTE_URL_PROTOCOLS = new Set(['https:', 'ssh:', 'git:', 'git+ssh:']);
const URL_REMOTE_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//iu;
const WINDOWS_DRIVE_REMOTE_PATTERN = /^[a-z]:/iu;
const SCP_LIKE_REMOTE_PATTERN =
  /^(?:[a-z0-9._+-]+@)?[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?:[^\\:?#\s]+$/iu;

function catalogError(
  code: StorePlanningValidationErrorCode,
  field: string,
  message: string,
  cause?: unknown
): StorePlanningValidationError {
  return new StorePlanningValidationError(code, field, message, cause);
}

function parseYamlValue(
  content: string,
  code: 'invalid_project_catalog' | 'invalid_target_line_catalog'
): unknown {
  try {
    return parseYaml(content);
  } catch (error) {
    throw catalogError(code, 'catalog', 'contains invalid YAML', error);
  }
}

function fileStem(
  filePath: string,
  code: 'invalid_project_catalog' | 'invalid_target_line_catalog'
): string {
  const name = filePath.replace(/\\/gu, '/').split('/').at(-1) ?? '';
  if (!name.endsWith('.yaml') || name.length === '.yaml'.length) {
    throw catalogError(code, 'filename', 'must use a non-empty .yaml filename');
  }
  return name.slice(0, -'.yaml'.length);
}

function rethrowCatalogValidation(
  code: 'invalid_project_catalog' | 'invalid_target_line_catalog',
  field: string,
  action: () => void
): void {
  try {
    action();
  } catch (error) {
    if (error instanceof StorePlanningValidationError) {
      throw catalogError(code, field, error.message, error);
    }
    throw error;
  }
}

function validatePortableProjectRemote(remote: string): void {
  if (remote !== remote.trim() || /[\x00-\x1f\x7f]/u.test(remote)) {
    throw catalogError(
      'invalid_project_catalog',
      'remote',
      'must be a canonical clone locator without surrounding space or control characters'
    );
  }
  if (remoteCarriesCredentials(remote)) {
    throw catalogError(
      'invalid_project_catalog',
      'remote',
      'must not embed credentials, query parameters, or fragments'
    );
  }
  if (
    WINDOWS_DRIVE_REMOTE_PATTERN.test(remote) ||
    remote.startsWith('/') ||
    remote.startsWith('\\') ||
    remote.includes('\\')
  ) {
    throw catalogError(
      'invalid_project_catalog',
      'remote',
      'must be a portable clone locator rather than a local, drive-relative, UNC, or device path'
    );
  }

  if (URL_REMOTE_PATTERN.test(remote)) {
    let url: URL;
    try {
      url = new URL(remote);
    } catch (error) {
      throw catalogError(
        'invalid_project_catalog',
        'remote',
        'must be a well-formed portable clone URL',
        error
      );
    }
    if (!PORTABLE_REMOTE_URL_PROTOCOLS.has(url.protocol)) {
      throw catalogError(
        'invalid_project_catalog',
        'remote',
        `uses unsupported clone URL scheme '${url.protocol}'`
      );
    }
    if (
      url.hostname.length === 0 ||
      url.pathname.length <= 1 ||
      url.search !== '' ||
      url.hash !== ''
    ) {
      throw catalogError(
        'invalid_project_catalog',
        'remote',
        'must contain a host and repository path without query parameters or fragments'
      );
    }
    return;
  }

  if (SCP_LIKE_REMOTE_PATTERN.test(remote)) return;

  throw catalogError(
    'invalid_project_catalog',
    'remote',
    'must use an allowed HTTPS, SSH, Git, or SCP-like portable clone locator'
  );
}

export function validateProjectCatalogFilename(
  projectId: ProjectId,
  filePath: string
): void {
  const stem = fileStem(filePath, 'invalid_project_catalog');
  if (stem !== projectId) {
    throw catalogError(
      'invalid_project_catalog',
      'filename',
      `stem '${stem}' must equal projectId '${projectId}'`
    );
  }
}

export function validateTargetLineCatalogFilename(
  targetLineId: TargetLineId,
  filePath: string
): void {
  const stem = fileStem(filePath, 'invalid_target_line_catalog');
  if (stem !== targetLineId) {
    throw catalogError(
      'invalid_target_line_catalog',
      'filename',
      `stem '${stem}' must equal id '${targetLineId}'`
    );
  }
}

export function validateStoreProjectCatalogV2(
  value: unknown,
  filePath?: string
): StoreProjectCatalogV2 {
  const result = ProjectCatalogSchema.safeParse(value);
  if (!result.success) {
    throw catalogError(
      'invalid_project_catalog',
      'catalog',
      formatZodIssues(result.error),
      result.error
    );
  }

  let projectId!: ProjectId;
  rethrowCatalogValidation('invalid_project_catalog', 'projectId', () => {
    projectId = parseProjectId(result.data.projectId);
  });
  if (filePath !== undefined) validateProjectCatalogFilename(projectId, filePath);

  // `id` is NOT validated as an identifier, deliberately.
  //
  // It is the project's human display name — that is what `StoreProjectRecord`,
  // `StoreMembershipRecord` and `MembershipMutationInput.projectDisplayId` all
  // document it as, and what every consumer does with it (a rendered name, or an
  // exact-match selector alongside `projectId`). `projectId` above is the
  // identity, and it alone names the file.
  //
  // It used to be run through `parseChangeId` — the CHANGE id validator, the
  // only place in the tree that function was applied to something that is not a
  // change, capability or node id. That made the v2 catalog reject values the v1
  // record accepts (`Elftia`, `my app`), and since `catalog-upgrade.ts` carries
  // `record.id` forward verbatim, any Store whose membership record held what
  // the field is documented to hold could not be migrated at all until someone
  // hand-edited the YAML. A migration must never block on data the schema it
  // migrates FROM accepted; `layout-migration-catalog-receipt.test.ts` pins that
  // as an invariant over the v1 schema's own accepted set.

  if (result.data.remote !== undefined) validatePortableProjectRemote(result.data.remote);
  if (
    result.data.planningBinding.state === 'bound' &&
    result.data.roles.planning !== true
  ) {
    throw catalogError(
      'invalid_project_catalog',
      'planningBinding',
      'a bound project must have roles.planning: true'
    );
  }

  let knowledgeBundle: PortableRelativePath | undefined;
  if (result.data.knowledgeBundle !== undefined) {
    rethrowCatalogValidation('invalid_project_catalog', 'knowledgeBundle', () => {
      knowledgeBundle = parsePortableRelativePath(
        result.data.knowledgeBundle as string,
        'knowledgeBundle'
      );
    });
  }

  return Object.freeze({
    version: 2 as const,
    projectId,
    ...(result.data.id !== undefined ? { id: result.data.id } : {}),
    ...(result.data.remote !== undefined ? { remote: result.data.remote } : {}),
    ...(knowledgeBundle !== undefined ? { knowledgeBundle } : {}),
    roles: Object.freeze({ ...result.data.roles }),
    planningBinding: Object.freeze({ ...result.data.planningBinding }),
  });
}

export function parseStoreProjectCatalogV2(
  content: string,
  filePath: string
): StoreProjectCatalogV2 {
  return validateStoreProjectCatalogV2(
    parseYamlValue(content, 'invalid_project_catalog'),
    filePath
  );
}

export function serializeStoreProjectCatalogV2(value: StoreProjectCatalogV2): string {
  const catalog = validateStoreProjectCatalogV2(value);
  return stringifyYaml({
    version: 2,
    projectId: catalog.projectId,
    ...(catalog.id !== undefined ? { id: catalog.id } : {}),
    ...(catalog.remote !== undefined ? { remote: catalog.remote } : {}),
    ...(catalog.knowledgeBundle !== undefined
      ? { knowledgeBundle: catalog.knowledgeBundle }
      : {}),
    roles: { ...catalog.roles },
    planningBinding: { ...catalog.planningBinding },
  });
}

export function validateStoreTargetLineCatalogV1(
  value: unknown,
  filePath?: string
): StoreTargetLineCatalogV1 {
  const result = TargetLineCatalogSchema.safeParse(value);
  if (!result.success) {
    throw catalogError(
      'invalid_target_line_catalog',
      'catalog',
      formatZodIssues(result.error),
      result.error
    );
  }

  let id!: TargetLineId;
  let storeRef!: FullGitRef;
  rethrowCatalogValidation('invalid_target_line_catalog', 'id', () => {
    id = parseTargetLineId(result.data.id);
  });
  rethrowCatalogValidation('invalid_target_line_catalog', 'storeRef', () => {
    storeRef = parseFullGitRef(result.data.storeRef, 'storeRef');
  });
  if (filePath !== undefined) validateTargetLineCatalogFilename(id, filePath);

  const projects: Record<string, TargetLineProjectLocatorV1> = {};
  for (const [rawProjectId, rawLocator] of Object.entries(result.data.projects).sort(
    ([left], [right]) => left.localeCompare(right)
  )) {
    let projectId!: ProjectId;
    let codeRef!: FullGitRef;
    rethrowCatalogValidation(
      'invalid_target_line_catalog',
      `projects.${rawProjectId}`,
      () => {
        projectId = parseProjectId(rawProjectId, `projects.${rawProjectId}`);
        codeRef = parseFullGitRef(
          rawLocator.codeRef,
          `projects.${rawProjectId}.codeRef`
        );
      }
    );
    projects[projectId] = Object.freeze({ codeRef });
  }

  return Object.freeze({
    version: 1 as const,
    id,
    storeRef,
    projects: Object.freeze(projects),
  });
}

export function parseStoreTargetLineCatalogV1(
  content: string,
  filePath: string
): StoreTargetLineCatalogV1 {
  return validateStoreTargetLineCatalogV1(
    parseYamlValue(content, 'invalid_target_line_catalog'),
    filePath
  );
}

export function serializeStoreTargetLineCatalogV1(
  value: StoreTargetLineCatalogV1
): string {
  const catalog = validateStoreTargetLineCatalogV1(value);
  const projects: Record<string, { codeRef: string }> = {};
  for (const projectId of Object.keys(catalog.projects).sort()) {
    projects[projectId] = { codeRef: catalog.projects[projectId]!.codeRef };
  }
  return stringifyYaml({
    version: 1,
    id: catalog.id,
    storeRef: catalog.storeRef,
    projects,
  });
}
