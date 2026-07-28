/**
 * Durable bundle-declaration path resolution and deterministic action planning.
 *
 * This module decides only which declared files are safe to offer. It does not
 * parse a bundle, decide conflicts, or write knowledge; F3's importer remains
 * the sole authority for those decisions.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { canonicalPathsEqual } from '../learned-skills/stores.js';
import { findAbsoluteMachinePath } from './schema.js';

export type DeclaredKnowledgeBundleAvailability =
  | 'usable'
  | 'missing'
  | 'unreadable'
  | 'unsafe';

export type DeclaredKnowledgeBundleRepair =
  | { kind: 'restore-file'; path: string }
  | { kind: 'edit-declaration'; path: string }
  | { kind: 'repair-permissions'; path: string }
  | { kind: 'obtain-project'; projectId: string };

export type DeclaredKnowledgeBundleSource =
  | {
      kind: 'project-config';
      declarationPath: string;
      ownerRoot: string;
      locator: string;
    }
  | {
      kind: 'store-record';
      declarationPath: string;
      ownerRoot: string;
      locator: string;
      storeId: string;
      storeUid?: string;
    };

export interface DeclaredKnowledgeBundleResolution {
  locator: string;
  ownerRoot: string;
  availability: DeclaredKnowledgeBundleAvailability;
  /** Absolute lexical path. Absent only for an absolute/empty unsafe locator. */
  resolvedPath?: string;
  /** Real path for an existing target; resolved path for a missing target. */
  canonicalPath?: string;
  reason?: string;
  repair: DeclaredKnowledgeBundleRepair;
}

export interface DeclaredKnowledgeBundleInput {
  projectId: string;
  /** Permanent local checkout, when this project is available on the machine. */
  projectRoot?: string;
  source: DeclaredKnowledgeBundleSource;
  /** The durable field existed but was not a valid non-empty string. */
  invalidLocator?: boolean;
  /** Existing obtain repair when the target project is not local yet. */
  projectRepair?: DeclaredKnowledgeBundleRepair;
}

export interface DeclaredKnowledgeBundleAction {
  actionKey: string;
  projectId: string;
  projectRoot?: string;
  locator: string;
  resolvedPath?: string;
  canonicalPath?: string;
  sources: DeclaredKnowledgeBundleSource[];
  trust: 'project-config' | 'store-record-only';
  availability: DeclaredKnowledgeBundleAvailability | 'project-unavailable';
  reason?: string;
  repair: DeclaredKnowledgeBundleRepair[];
}

function codePointCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isPortableAbsolute(locator: string): boolean {
  return (
    findAbsoluteMachinePath(locator) !== null ||
    path.posix.isAbsolute(locator) ||
    path.win32.isAbsolute(locator) ||
    locator.startsWith('\\\\') ||
    locator.startsWith('//')
  );
}

function isContained(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== '..' &&
      !path.isAbsolute(relative))
  );
}

function nativeRealPath(target: string): string {
  try {
    return fs.realpathSync.native(target);
  } catch {
    return fs.realpathSync(target);
  }
}

/**
 * Resolve one durable locator under its owning repository.
 *
 * All absolute syntaxes are rejected on every host. Lexical containment is
 * proved before touching the target; an existing target is then canonicalized
 * so a symlink cannot escape the declaring repository.
 */
export function resolveDeclaredKnowledgeBundle(
  ownerRoot: string,
  locator: string
): DeclaredKnowledgeBundleResolution {
  const resolvedOwner = path.resolve(ownerRoot);
  const trimmed = locator.trim();
  const declarationRepair: DeclaredKnowledgeBundleRepair = {
    kind: 'edit-declaration',
    path: resolvedOwner,
  };

  if (trimmed.length === 0 || isPortableAbsolute(trimmed)) {
    return {
      locator,
      ownerRoot: resolvedOwner,
      availability: 'unsafe',
      reason:
        trimmed.length === 0
          ? 'empty-locator'
          : 'absolute-locator',
      repair: declarationRepair,
    };
  }

  const resolvedPath = path.resolve(resolvedOwner, trimmed);
  if (!isContained(resolvedOwner, resolvedPath)) {
    return {
      locator,
      ownerRoot: resolvedOwner,
      availability: 'unsafe',
      resolvedPath,
      reason: 'parent-escape',
      repair: declarationRepair,
    };
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolvedPath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return {
        locator,
        ownerRoot: resolvedOwner,
        availability: 'missing',
        resolvedPath,
        canonicalPath: resolvedPath,
        reason: 'missing',
        repair: { kind: 'restore-file', path: resolvedPath },
      };
    }
    return {
      locator,
      ownerRoot: resolvedOwner,
      availability: 'unreadable',
      resolvedPath,
      canonicalPath: resolvedPath,
      reason: code ?? (error instanceof Error ? error.message : String(error)),
      repair: { kind: 'repair-permissions', path: resolvedPath },
    };
  }

  let canonicalRoot: string;
  let canonicalTarget: string;
  try {
    canonicalRoot = nativeRealPath(resolvedOwner);
    canonicalTarget = nativeRealPath(resolvedPath);
  } catch (error) {
    return {
      locator,
      ownerRoot: resolvedOwner,
      availability: 'unreadable',
      resolvedPath,
      canonicalPath: resolvedPath,
      reason: error instanceof Error ? error.message : String(error),
      repair: { kind: 'repair-permissions', path: resolvedPath },
    };
  }

  if (!isContained(canonicalRoot, canonicalTarget)) {
    return {
      locator,
      ownerRoot: resolvedOwner,
      availability: 'unsafe',
      resolvedPath,
      canonicalPath: canonicalTarget,
      reason: 'symlink-escape',
      repair: declarationRepair,
    };
  }

  if (!stat.isFile()) {
    return {
      locator,
      ownerRoot: resolvedOwner,
      availability: 'unreadable',
      resolvedPath,
      canonicalPath: canonicalTarget,
      reason: 'not-a-file',
      repair: { kind: 'edit-declaration', path: resolvedPath },
    };
  }

  try {
    fs.accessSync(resolvedPath, fs.constants.R_OK);
  } catch (error) {
    return {
      locator,
      ownerRoot: resolvedOwner,
      availability: 'unreadable',
      resolvedPath,
      canonicalPath: canonicalTarget,
      reason: (error as NodeJS.ErrnoException).code ?? 'not-readable',
      repair: { kind: 'repair-permissions', path: resolvedPath },
    };
  }

  return {
    locator,
    ownerRoot: resolvedOwner,
    availability: 'usable',
    resolvedPath,
    canonicalPath: canonicalTarget,
    repair: { kind: 'restore-file', path: resolvedPath },
  };
}

function sameResolvedAction(
  left: DeclaredKnowledgeBundleAction,
  projectId: string,
  resolution: DeclaredKnowledgeBundleResolution
): boolean {
  if (left.projectId !== projectId) return false;
  if (left.canonicalPath !== undefined && resolution.canonicalPath !== undefined) {
    return canonicalPathsEqual(left.canonicalPath, resolution.canonicalPath);
  }
  return (
    left.resolvedPath === resolution.resolvedPath &&
    left.locator === resolution.locator &&
    left.sources[0]?.ownerRoot === resolution.ownerRoot
  );
}

function sourceCompare(
  left: DeclaredKnowledgeBundleSource,
  right: DeclaredKnowledgeBundleSource
): number {
  if (left.kind !== right.kind) return left.kind === 'project-config' ? -1 : 1;
  if (left.kind === 'store-record' && right.kind === 'store-record') {
    const store = codePointCompare(left.storeUid ?? left.storeId, right.storeUid ?? right.storeId);
    if (store !== 0) return store;
  }
  return codePointCompare(left.declarationPath, right.declarationPath);
}

function actionSortPath(action: DeclaredKnowledgeBundleAction): string {
  return action.canonicalPath ?? action.resolvedPath ?? `${action.sources[0]?.ownerRoot}/${action.locator}`;
}

function repairsForDeclaration(
  declaration: DeclaredKnowledgeBundleInput,
  resolution: DeclaredKnowledgeBundleResolution,
  availability: DeclaredKnowledgeBundleAction['availability']
): DeclaredKnowledgeBundleRepair[] {
  if (availability === 'project-unavailable') {
    return [
      declaration.projectRepair ?? {
        kind: 'obtain-project',
        projectId: declaration.projectId,
      },
    ];
  }
  if (availability === 'usable') return [];
  if (resolution.repair.kind === 'edit-declaration') {
    return [{
      kind: 'edit-declaration',
      path: declaration.source.declarationPath,
    }];
  }
  return [resolution.repair];
}

function appendUniqueRepairs(
  target: DeclaredKnowledgeBundleRepair[],
  candidates: readonly DeclaredKnowledgeBundleRepair[]
): void {
  for (const candidate of candidates) {
    if (
      !target.some((repair) =>
        repair.kind === candidate.kind &&
        ('path' in repair
          ? 'path' in candidate && repair.path === candidate.path
          : 'projectId' in candidate && repair.projectId === candidate.projectId)
      )
    ) {
      target.push(candidate);
    }
  }
}

/**
 * Resolve and de-duplicate durable declarations per permanent project.
 * Different paths stay independent. The same canonical path retains every
 * source, and any project-config source gives the combined action project
 * trust.
 */
export function planDeclaredKnowledgeBundles(
  declarations: readonly DeclaredKnowledgeBundleInput[]
): DeclaredKnowledgeBundleAction[] {
  const actions: DeclaredKnowledgeBundleAction[] = [];

  for (const declaration of declarations) {
    const resolution: DeclaredKnowledgeBundleResolution =
      declaration.invalidLocator === true
        ? {
            locator: declaration.source.locator,
            ownerRoot: path.resolve(declaration.source.ownerRoot),
            availability: 'unsafe',
            reason: 'invalid-declaration',
            repair: {
              kind: 'edit-declaration',
              path: declaration.source.declarationPath,
            },
          }
        : resolveDeclaredKnowledgeBundle(
            declaration.source.ownerRoot,
            declaration.source.locator
          );
    const existing = actions.find((action) =>
      sameResolvedAction(action, declaration.projectId, resolution)
    );
    if (existing) {
      existing.sources.push(declaration.source);
      existing.sources.sort(sourceCompare);
      if (declaration.projectRoot !== undefined) {
        existing.projectRoot = declaration.projectRoot;
        if (existing.availability === 'project-unavailable') {
          existing.availability = resolution.availability;
          existing.repair = [];
        }
      }
      if (declaration.source.kind === 'project-config') existing.trust = 'project-config';
      appendUniqueRepairs(
        existing.repair,
        repairsForDeclaration(declaration, resolution, existing.availability)
      );
      continue;
    }

    const availability =
      declaration.projectRoot === undefined
        ? 'project-unavailable'
        : resolution.availability;
    const repair = repairsForDeclaration(declaration, resolution, availability);
    const stablePath =
      resolution.canonicalPath ??
      resolution.resolvedPath ??
      `${resolution.ownerRoot}/${resolution.locator}`;
    actions.push({
      actionKey: `import-bundle:${encodeURIComponent(declaration.projectId)}:${encodeURIComponent(stablePath)}`,
      projectId: declaration.projectId,
      ...(declaration.projectRoot !== undefined ? { projectRoot: declaration.projectRoot } : {}),
      locator: resolution.locator,
      ...(resolution.resolvedPath !== undefined
        ? { resolvedPath: resolution.resolvedPath }
        : {}),
      ...(resolution.canonicalPath !== undefined
        ? { canonicalPath: resolution.canonicalPath }
        : {}),
      sources: [declaration.source],
      trust:
        declaration.source.kind === 'project-config'
          ? 'project-config'
          : 'store-record-only',
      availability,
      ...(resolution.reason !== undefined ? { reason: resolution.reason } : {}),
      repair,
    });
  }

  actions.sort((left, right) => {
    if (left.trust !== right.trust) return left.trust === 'project-config' ? -1 : 1;
    const project = codePointCompare(left.projectId, right.projectId);
    return project !== 0
      ? project
      : codePointCompare(actionSortPath(left), actionSortPath(right));
  });
  return actions;
}
