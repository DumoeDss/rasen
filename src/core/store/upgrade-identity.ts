/**
 * `rasen store upgrade-identity` (design D2 step 3, tasks 4.4–4.8).
 *
 * The ONLY command that adds a permanent identity to a Store that predates
 * them. It is explicit, previewable, and never runs implicitly: no read path
 * upgrades anything on disk.
 *
 * It touches two repositories (the Store and, when addressable, the project),
 * so it does not claim strong atomicity. Instead it is plan + ordered apply:
 * the Store's own metadata is written and verified FIRST — it is legitimate on
 * its own — then the machine registry, then the project's declaration. On a
 * partial failure the Store metadata stands and the output names the write
 * that still needs doing. Every file is written atomically (temp + rename) and
 * nothing is ever committed or pushed.
 */
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { parseDocument } from 'yaml';

import { WORKSPACE_DIR_NAME } from '../config.js';
import { writeFileAtomically } from '../file-state.js';
import {
  classifyOpenSpecDir,
  resolveConfigFilePath,
} from '../project-config.js';
import { StoreError, type StoreDiagnostic } from './errors.js';
import {
  getStoreMetadataPath,
  listStoreRegistryEntries,
  readOptionalStoreMetadataState,
  readStoreRegistryState,
  storeMetadataUid,
  updateStoreRegistryState,
  upgradeStoreRegistryToV2,
  validateStoreSelector,
  writeStoreMetadataState,
  type StorePathOptions,
  type StoreRegistryEntry,
} from './foundation.js';
import { storeAliasNumeric } from './identity-diagnostics.js';
import {
  isAllDigitAlias,
  isValidStoreUid,
  mintStoreUid,
  normalizeStoreUid,
  storeUidsMatch,
} from './identity-types.js';
import { assertCredentialFreeRemote } from './remote.js';
import { getStoreRootForBackend } from './registry.js';

export interface UpgradeStoreIdentityInput extends StorePathOptions {
  /** The Store's display name. */
  id: string;
  /** Disambiguates a name that matches more than one registered Store. */
  uid?: string;
  /** Apply the plan; omitted or false previews it and changes nothing. */
  apply?: boolean;
  /**
   * The project whose Store declaration should be upgraded too. Defaults to
   * the current working directory's planning root when it declares this Store.
   */
  projectRoot?: string;
}

export interface UpgradeStoreIdentityStep {
  /** What this step writes. */
  target: 'store-metadata' | 'registry' | 'project-pointer';
  path: string;
  /** False when the step is already satisfied (the idempotent second run). */
  needed: boolean;
  description: string;
  /** Set when the step cannot be performed and why. */
  blocked?: string;
}

export interface UpgradeStoreIdentityResult {
  store: { id: string; root: string; uid: string };
  applied: boolean;
  steps: UpgradeStoreIdentityStep[];
  /** Files the user still needs to commit; this command never commits. */
  filesToCommit: string[];
  /** Steps that still need doing after a partial apply. */
  repairNeeded: string[];
  diagnostics: StoreDiagnostic[];
}

function storeEntriesFor(entries: StoreRegistryEntry[], id: string): StoreRegistryEntry[] {
  return entries.filter((entry) => entry.type === 'store' && entry.id === id);
}

/** Drops one occurrence — two entries may legitimately share a display name. */
function withoutFirst(values: string[], value: string): string[] {
  const index = values.indexOf(value);
  return index === -1 ? values : [...values.slice(0, index), ...values.slice(index + 1)];
}

/**
 * The one sentence both the plan and the apply use for a registry that stays
 * alias-keyed, so a preview and the run that follows it cannot word the same
 * fact two ways (task 5.10).
 */
function blockedRegistryNote(blockedBy: string[]): string {
  return `The machine store registry keeps its display-name keys; these stores need rasen store upgrade-identity first: ${blockedBy.join(', ')}.`;
}

async function selectStore(
  input: UpgradeStoreIdentityInput,
  pathOptions: StorePathOptions
): Promise<StoreRegistryEntry> {
  const registry = await readStoreRegistryState(pathOptions);
  const entries = registry ? listStoreRegistryEntries(registry) : [];

  // The operand may itself be a permanent identity. `--uid` stays the way to
  // disambiguate a NAME; this is the same identity form every other lookup
  // surface accepts, so a store cannot be reported "unknown" when the user
  // named it by the one thing that identifies it exactly.
  if (isValidStoreUid(input.id)) {
    const byUid = entries.find(
      (entry) => entry.type === 'store' && storeUidsMatch(entry.uid, input.id)
    );
    if (!byUid) {
      throw new StoreError(`Unknown store '${input.id}'.`, 'store_not_found', {
        target: 'store.id',
        fix: 'Run rasen store list to see the registered stores and their permanent identities.',
      });
    }
    return byUid;
  }

  const matches = storeEntriesFor(entries, input.id);

  if (matches.length === 0) {
    throw new StoreError(`Unknown store '${input.id}'.`, 'store_not_found', {
      target: 'store.id',
      fix: 'Run rasen store list to see registered stores.',
    });
  }

  if (matches.length === 1) return matches[0] as StoreRegistryEntry;

  if (input.uid === undefined) {
    const rendered = matches
      .map((entry) => `${entry.uid ?? '(no identity)'} at ${getStoreRootForBackend(entry.backend)}`)
      .join('; ');
    throw new StoreError(
      `The name '${input.id}' matches ${matches.length} registered stores: ${rendered}.`,
      'store_alias_ambiguous',
      {
        target: 'store.id',
        fix: `Rerun naming the identity you mean: rasen store upgrade-identity ${input.id} --uid <identity> --apply.`,
      }
    );
  }

  const chosen = matches.find((entry) => storeUidsMatch(entry.uid, input.uid));
  if (!chosen) {
    throw new StoreError(
      `No store named '${input.id}' carries identity ${input.uid}.`,
      'store_not_found',
      { target: 'store.id', fix: 'Run rasen store doctor to list the candidates.' }
    );
  }
  return chosen;
}

/**
 * The project whose declaration names this Store, when one is addressable.
 * Never guesses: a project that declares a DIFFERENT Store is left alone.
 */
function resolveUpgradableProject(
  projectRoot: string | undefined,
  storeId: string
): { root: string; configPath: string } | null {
  if (!projectRoot) return null;
  const { pointer } = classifyOpenSpecDir(projectRoot);
  if (pointer.filePath === null) return null;
  if (pointer.shape === 'durable') return null;
  if (pointer.shape !== 'alias' || pointer.value !== storeId) return null;
  const configPath = resolveConfigFilePath(projectRoot);
  if (configPath === null) return null;
  return { root: projectRoot, configPath };
}

/**
 * Rewrites the project's `store:` declaration to the durable form, preserving
 * every other line and comment in the file. Nothing machine-specific is ever
 * written: only the permanent identity, the display alias, and a
 * credential-free remote.
 *
 * THE single writer of a durable declaration — `store adopt` shares it rather
 * than assembling the object a second way. A display name alone cannot say
 * WHICH Store was meant once two share it, so any command that records a Store
 * durably records the identity through here.
 */
export async function writeDurablePointer(
  configPath: string,
  declaration: { uid: string; id: string; remote?: string }
): Promise<void> {
  assertCredentialFreeRemote(declaration.remote, 'store.pointer');
  const doc = parseDocument(readFileSync(configPath, 'utf-8'));
  doc.setIn(
    ['store'],
    {
      uid: declaration.uid,
      id: declaration.id,
      ...(declaration.remote !== undefined ? { remote: declaration.remote } : {}),
    }
  );
  await writeFileAtomically(configPath, String(doc));
}

export async function upgradeStoreIdentity(
  input: UpgradeStoreIdentityInput
): Promise<UpgradeStoreIdentityResult> {
  const selector = validateStoreSelector(input.id);
  const pathOptions: StorePathOptions =
    input.globalDataDir !== undefined ? { globalDataDir: input.globalDataDir } : {};

  const entry = await selectStore({ ...input, id: selector }, pathOptions);
  // The RESOLVED display name from here on: every step description, the
  // numeric-alias check, the project-declaration match, and the reported store
  // all mean the store's name — never the identity the user may have typed.
  const id = entry.id;
  const storeRoot = getStoreRootForBackend(entry.backend);
  const metadataPath = getStoreMetadataPath(storeRoot);
  const metadata = await readOptionalStoreMetadataState(storeRoot);

  if (!metadata) {
    throw new StoreError(
      `Store '${id}' has no identity metadata at ${metadataPath}.`,
      'store_metadata_missing',
      {
        target: 'store.metadata',
        fix: `Run rasen store register ${storeRoot} first.`,
      }
    );
  }

  const existingUid = storeMetadataUid(metadata);
  // Idempotent: a second run mints nothing and re-reports the same plan.
  const uid = existingUid ?? mintStoreUid();

  const project = resolveUpgradableProject(input.projectRoot, id);
  const steps: UpgradeStoreIdentityStep[] = [];
  const diagnostics: StoreDiagnostic[] = [];

  if (isAllDigitAlias(id)) {
    diagnostics.push(storeAliasNumeric({ id }));
  }

  steps.push({
    target: 'store-metadata',
    path: metadataPath,
    needed: existingUid === undefined,
    description:
      existingUid === undefined
        ? `Record permanent identity ${uid} in the store's own metadata.`
        : `Store already carries permanent identity ${existingUid}.`,
  });

  const registryBefore = await readStoreRegistryState(pathOptions);
  const registryPlan =
    registryBefore === null ? null : await upgradeStoreRegistryToV2(registryBefore);
  // Model the metadata write that has not happened yet: THIS store carries an
  // identity by the time the registry step runs, so it is not one of the
  // entries still blocking the re-key. Without the model the preview would
  // both name the store the user is fixing and — because the note used to be
  // suppressed on a first run — stay silent about the OTHER entries that
  // really do block it, which is exactly what `--apply` then reports (5.10).
  const pendingBlockers =
    registryPlan === null
      ? []
      : existingUid === undefined
        ? withoutFirst(registryPlan.blockedBy, id)
        : registryPlan.blockedBy;

  steps.push({
    target: 'registry',
    path: 'the machine store registry',
    needed: registryBefore !== null && registryBefore.version !== 2,
    description:
      registryBefore === null
        ? 'No machine store registry exists yet.'
        : registryBefore.version === 2
          ? 'The machine store registry is already keyed by permanent identity.'
          : 'Re-key the machine store registry by permanent identity.',
    ...(pendingBlockers.length > 0 ? { blocked: blockedRegistryNote(pendingBlockers) } : {}),
  });

  if (project) {
    steps.push({
      target: 'project-pointer',
      path: project.configPath,
      needed: true,
      description: `Rewrite the project's store: declaration to name identity ${uid}.`,
    });
  }

  if (input.apply !== true) {
    return {
      store: { id, root: storeRoot, uid },
      applied: false,
      steps,
      filesToCommit: [],
      repairNeeded: [],
      diagnostics,
    };
  }

  const filesToCommit: string[] = [];
  const repairNeeded: string[] = [];

  // 1. The Store's own metadata, written and verified first.
  if (existingUid === undefined) {
    await writeStoreMetadataState(storeRoot, {
      version: 2,
      uid,
      id: metadata.id,
      ...(metadata.remote !== undefined ? { remote: metadata.remote } : {}),
    });
    const verify = await readOptionalStoreMetadataState(storeRoot);
    if (!storeUidsMatch(storeMetadataUid(verify), uid)) {
      throw new StoreError(
        `The identity written to ${metadataPath} did not read back as ${uid}.`,
        'store_uid_mismatch',
        { target: 'store.metadata', fix: `Inspect ${metadataPath}.` }
      );
    }
    filesToCommit.push(path.relative(storeRoot, metadataPath) || metadataPath);
  }

  // 2. The machine registry. Machine-local, so it is never committed.
  try {
    if (registryBefore !== null) {
      // A no-op mutation through the one write seam, which is where the
      // identity-keyed form is adopted. A machine with no registry yet has
      // nothing to re-key, and this command never creates one.
      await updateStoreRegistryState((current) => current ?? registryBefore, pathOptions);
    }
    const after = await readStoreRegistryState(pathOptions);
    if (after !== null && after.version !== 2) {
      const plan = await upgradeStoreRegistryToV2(after);
      if (!plan.upgraded) {
        // The same sentence the plan printed, over the same entries: this
        // store now carries an identity, so it is gone from `blockedBy`.
        repairNeeded.push(blockedRegistryNote(plan.blockedBy));
      }
    }
  } catch (error) {
    repairNeeded.push(
      `The machine store registry could not be updated (${error instanceof Error ? error.message : String(error)}); rerun this command.`
    );
  }

  // 3. The project's declaration, when one is addressable.
  if (project) {
    try {
      await writeDurablePointer(project.configPath, {
        uid,
        id: metadata.id,
        ...(metadata.remote !== undefined ? { remote: metadata.remote } : {}),
      });
      filesToCommit.push(
        path.relative(project.root, project.configPath) ||
          path.join(WORKSPACE_DIR_NAME, 'config.yaml')
      );
    } catch (error) {
      repairNeeded.push(
        `The project's store: declaration in ${project.configPath} still needs rewriting (${error instanceof Error ? error.message : String(error)}).`
      );
    }
  }

  return {
    store: { id, root: storeRoot, uid: normalizeStoreUid(uid) },
    applied: true,
    steps,
    filesToCommit,
    repairNeeded,
    diagnostics,
  };
}
