import { WORKSPACE_DIR_NAME } from '../core/config.js';
/**
 * The relationship-data gather shared by doctor and context (4.1): one
 * registry snapshot, the health-mode reference index, and the root
 * inspection. Doctor layers its health-only inputs (store facts,
 * wrong-turn detection) on top.
 */
import * as path from 'node:path';

import { readRegistrySnapshot, type RegistrySnapshot } from '../core/store/registry.js';
import {
  readProjectConfig,
  readStorePointer,
  resolveConfigFilePath,
  type ProjectConfig,
} from '../core/project-config.js';
import { assembleReferenceIndex, type ReferenceIndexEntry } from '../core/references.js';
import { inspectOpenSpecRoot, type OpenSpecRootInspection } from '../core/workspace-root.js';
import type { ResolvedOpenSpecRoot } from '../core/root-selection.js';
import { storeBindingDeclarationFrom } from '../core/effective-config.js';
import { resolveStoreBinding } from '../core/store/identity.js';
import type { ResolvedStoreRef } from '../core/store/identity-types.js';
import { inspectProjectMembership } from '../core/store/membership.js';
import { toMembershipHealth, type MembershipHealth } from '../core/relationship-health.js';

export interface RelationshipData {
  registrySnapshot: RegistrySnapshot;
  projectConfig: ProjectConfig | null;
  storeConfigPath: string;
  referenceEntries: ReferenceIndexEntry[];
  rootInspection: OpenSpecRootInspection;
}

export async function gatherRelationshipData(
  root: ResolvedOpenSpecRoot
): Promise<RelationshipData> {
  const registrySnapshot = await readRegistrySnapshot();

  const projectConfig = readProjectConfig(root.path);
  const storeConfigPath =
    resolveConfigFilePath(root.path) ?? path.join(root.path, WORKSPACE_DIR_NAME, 'config.yaml');

  const referenceEntries = await assembleReferenceIndex({
    references: projectConfig?.references ?? [],
    resolvedRoot: root,
    includeSpecs: false,
    registryEntries: registrySnapshot.entries,
  });

  const rootInspection = await inspectOpenSpecRoot(root.path);

  return {
    registrySnapshot,
    projectConfig,
    storeConfigPath,
    referenceEntries,
    rootInspection,
  };
}

/**
 * The Store this project PLANS in, resolved through the one shared resolver
 * from the project's own declaration. Null when it declares none or the
 * declaration cannot be used here — both are legitimate states, not failures.
 *
 * Read-only and best-effort: it registers nothing, clones nothing, and a
 * resolution failure degrades to "no planning Store" rather than breaking the
 * report.
 */
export async function resolveProjectPlanningStore(
  projectRoot: string
): Promise<ResolvedStoreRef | null> {
  try {
    const declaration = storeBindingDeclarationFrom(readStorePointer(projectRoot));
    if (declaration.form === 'absent') return null;
    const binding = await resolveStoreBinding({ declaration, projectRoot });
    return binding.kind === 'resolved' ? binding.store : null;
  } catch {
    return null;
  }
}

/**
 * The membership section BOTH doctors report: the roster and every finding,
 * from the single provider, in the single report shape.
 *
 * Shared because the requirement is per-surface, not per-provider: the
 * provider computing a finding correctly means nothing if the surface never
 * reads the field it lands in. The planning Store is resolved and passed in
 * here, which is what makes `store_project_record_missing` — the only
 * error-severity membership code — reachable at all.
 */
export async function gatherProjectMembership(
  projectRoot: string
): Promise<MembershipHealth | null> {
  const planningStore = await resolveProjectPlanningStore(projectRoot);
  const membership = await inspectProjectMembership({
    projectRoot,
    ...(planningStore ? { planningStore } : {}),
  }).catch(() => null);
  return membership ? toMembershipHealth(membership) : null;
}
