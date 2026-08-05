import * as path from 'node:path';

import {
  changeInstanceDigestPrefix,
  parseChangeInstanceId,
  type VerifiedChangeInstanceId,
} from './planning-identity.js';
import {
  StorePlanningValidationError,
  parseChangeId,
  parseProjectId,
  parseTargetLineId,
  type ChangeId,
  type ProjectId,
  type TargetLineId,
} from './planning-validation.js';

declare const storePlanningPathBrand: unique symbol;
export type StorePlanningPath = string & { readonly [storePlanningPathBrand]: true };

export type StorePlanningPathFlavor = 'native' | 'win32' | 'posix';

export type StorePlanningLayoutV2Address =
  | { readonly kind: 'store-metadata' }
  | { readonly kind: 'project-catalog'; readonly projectId: string | ProjectId }
  | { readonly kind: 'target-line-catalog'; readonly targetLineId: string | TargetLineId }
  | { readonly kind: 'project-home'; readonly projectId: string | ProjectId }
  | { readonly kind: 'project-specs'; readonly projectId: string | ProjectId }
  | { readonly kind: 'store-design-docs' }
  | { readonly kind: 'project-design-docs'; readonly projectId: string | ProjectId }
  | {
      readonly kind: 'active-change';
      readonly projectId: string | ProjectId;
      readonly changeId: string | ChangeId;
    }
  | {
      readonly kind: 'archive-line';
      readonly projectId: string | ProjectId;
      readonly targetLineId: string | TargetLineId;
    }
  | {
      readonly kind: 'archive-entry';
      readonly projectId: string | ProjectId;
      readonly targetLineId: string | TargetLineId;
      readonly changeId: string | ChangeId;
      readonly archiveDate: string;
      readonly changeInstanceId: VerifiedChangeInstanceId;
    };

export interface StorePlanningLayoutV2 {
  readonly storeRoot: StorePlanningPath;
  readonly storeMetadata: StorePlanningPath;
  readonly projectCatalog: StorePlanningPath;
  readonly targetLineCatalog: StorePlanningPath;
  readonly projectHome: StorePlanningPath;
  readonly projectSpecs: StorePlanningPath;
  readonly storeDesignDocs: StorePlanningPath;
  readonly projectDesignDocs: StorePlanningPath;
  readonly activeChange: StorePlanningPath;
  readonly archiveLine: StorePlanningPath;
  readonly archiveEntry: StorePlanningPath;
}

export interface ComputeStorePlanningLayoutV2Input {
  readonly storeRoot: string;
  readonly projectId: string | ProjectId;
  readonly targetLineId: string | TargetLineId;
  readonly changeId: string | ChangeId;
  readonly archiveDate: string;
  readonly changeInstanceId: VerifiedChangeInstanceId;
  readonly flavor?: StorePlanningPathFlavor;
}

function pathApi(flavor: StorePlanningPathFlavor): path.PlatformPath {
  if (flavor === 'win32') return path.win32;
  if (flavor === 'posix') return path.posix;
  return path;
}

function pathError(
  code: 'invalid_store_layout_v2' | 'planning_path_escape',
  field: string,
  message: string,
  cause?: unknown
): StorePlanningValidationError {
  return new StorePlanningValidationError(code, field, message, cause);
}

function validateArchiveDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw pathError('invalid_store_layout_v2', 'archiveDate', 'must use YYYY-MM-DD');
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) {
    throw pathError('invalid_store_layout_v2', 'archiveDate', 'must be a real calendar date');
  }
  return value;
}

function containedPath(
  api: path.PlatformPath,
  root: string,
  segments: readonly string[],
  field: string
): StorePlanningPath {
  const resolvedRoot = api.resolve(root);
  const candidate = api.resolve(resolvedRoot, ...segments);
  const relative = api.relative(resolvedRoot, candidate);
  if (
    relative === '..' ||
    relative.startsWith(`..${api.sep}`) ||
    api.isAbsolute(relative)
  ) {
    throw pathError(
      'planning_path_escape',
      field,
      `resolved path escapes its intended root '${resolvedRoot}'`
    );
  }
  return candidate as StorePlanningPath;
}

function validatedProjectId(address: { readonly projectId: string | ProjectId }): ProjectId {
  return parseProjectId(address.projectId);
}

export function resolveStorePlanningLayoutV2Path(
  storeRoot: string,
  address: StorePlanningLayoutV2Address,
  flavor: StorePlanningPathFlavor = 'native'
): StorePlanningPath {
  const api = pathApi(flavor);
  if (storeRoot.length === 0 || !api.isAbsolute(storeRoot)) {
    throw pathError(
      'invalid_store_layout_v2',
      'storeRoot',
      `must be an absolute ${flavor} path so resolution never depends on cwd`
    );
  }
  const root = api.resolve(storeRoot);

  switch (address.kind) {
    case 'store-metadata':
      return containedPath(api, root, ['.rasen-store', 'store.yaml'], address.kind);
    case 'project-catalog': {
      const projectId = validatedProjectId(address);
      return containedPath(
        api,
        root,
        ['.rasen-store', 'projects', `${projectId}.yaml`],
        address.kind
      );
    }
    case 'target-line-catalog': {
      const targetLineId = parseTargetLineId(address.targetLineId);
      return containedPath(
        api,
        root,
        ['.rasen-store', 'target-lines', `${targetLineId}.yaml`],
        address.kind
      );
    }
    case 'store-design-docs':
      return containedPath(api, root, ['rasen', 'design-docs'], address.kind);
    case 'project-home': {
      const projectId = validatedProjectId(address);
      return containedPath(api, root, ['rasen', 'projects', projectId], address.kind);
    }
    case 'project-specs': {
      const projectId = validatedProjectId(address);
      return containedPath(
        api,
        root,
        ['rasen', 'projects', projectId, 'specs'],
        address.kind
      );
    }
    case 'project-design-docs': {
      const projectId = validatedProjectId(address);
      return containedPath(
        api,
        root,
        ['rasen', 'projects', projectId, 'design-docs'],
        address.kind
      );
    }
    case 'active-change': {
      const projectId = validatedProjectId(address);
      const changeId = parseChangeId(address.changeId);
      return containedPath(
        api,
        root,
        ['rasen', 'projects', projectId, 'changes', changeId],
        address.kind
      );
    }
    case 'archive-line': {
      const projectId = validatedProjectId(address);
      const targetLineId = parseTargetLineId(address.targetLineId);
      return containedPath(
        api,
        root,
        ['rasen', 'projects', projectId, 'changes', 'archive', targetLineId],
        address.kind
      );
    }
    case 'archive-entry': {
      const projectId = validatedProjectId(address);
      const targetLineId = parseTargetLineId(address.targetLineId);
      const changeId = parseChangeId(address.changeId);
      const archiveDate = validateArchiveDate(address.archiveDate);
      const changeInstanceId = parseChangeInstanceId(address.changeInstanceId);
      const entryName = `${archiveDate}-${changeId}--${changeInstanceDigestPrefix(
        changeInstanceId
      )}`;
      return containedPath(
        api,
        root,
        [
          'rasen',
          'projects',
          projectId,
          'changes',
          'archive',
          targetLineId,
          entryName,
        ],
        address.kind
      );
    }
  }
}

export function computeStorePlanningLayoutV2(
  input: ComputeStorePlanningLayoutV2Input
): StorePlanningLayoutV2 {
  const flavor = input.flavor ?? 'native';
  const api = pathApi(flavor);
  if (!api.isAbsolute(input.storeRoot)) {
    throw pathError('invalid_store_layout_v2', 'storeRoot', 'must be absolute');
  }
  const storeRoot = api.resolve(input.storeRoot) as StorePlanningPath;
  return Object.freeze({
    storeRoot,
    storeMetadata: resolveStorePlanningLayoutV2Path(storeRoot, { kind: 'store-metadata' }, flavor),
    projectCatalog: resolveStorePlanningLayoutV2Path(
      storeRoot,
      { kind: 'project-catalog', projectId: input.projectId },
      flavor
    ),
    targetLineCatalog: resolveStorePlanningLayoutV2Path(
      storeRoot,
      { kind: 'target-line-catalog', targetLineId: input.targetLineId },
      flavor
    ),
    projectHome: resolveStorePlanningLayoutV2Path(
      storeRoot,
      { kind: 'project-home', projectId: input.projectId },
      flavor
    ),
    projectSpecs: resolveStorePlanningLayoutV2Path(
      storeRoot,
      { kind: 'project-specs', projectId: input.projectId },
      flavor
    ),
    storeDesignDocs: resolveStorePlanningLayoutV2Path(
      storeRoot,
      { kind: 'store-design-docs' },
      flavor
    ),
    projectDesignDocs: resolveStorePlanningLayoutV2Path(
      storeRoot,
      { kind: 'project-design-docs', projectId: input.projectId },
      flavor
    ),
    activeChange: resolveStorePlanningLayoutV2Path(
      storeRoot,
      { kind: 'active-change', projectId: input.projectId, changeId: input.changeId },
      flavor
    ),
    archiveLine: resolveStorePlanningLayoutV2Path(
      storeRoot,
      {
        kind: 'archive-line',
        projectId: input.projectId,
        targetLineId: input.targetLineId,
      },
      flavor
    ),
    archiveEntry: resolveStorePlanningLayoutV2Path(
      storeRoot,
      {
        kind: 'archive-entry',
        projectId: input.projectId,
        targetLineId: input.targetLineId,
        changeId: input.changeId,
        archiveDate: input.archiveDate,
        changeInstanceId: input.changeInstanceId,
      },
      flavor
    ),
  });
}
