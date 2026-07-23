import { WORKSPACE_DIR_NAME } from '../core/config.js';
/**
 * `rasen doctor` (slice 3.6): the root-scoped relationship-health
 * report. Read-only — it answers "are the roots this work relates to
 * available on this machine?" and never clones, syncs, or repairs.
 */
import { Command, Option } from 'commander';

import {
  resolveRootForCommand,
  type ResolvedOpenSpecRoot,
} from '../core/root-selection.js';
import { readOptionalStoreMetadataState } from '../core/store/foundation.js';
import { gitOriginUrl, isGitRepositoryAtRoot } from '../core/store/git.js';
import {
  classifyOpenSpecDir,
  readProjectConfig,
  resolveConfigFilePath,
} from '../core/project-config.js';
import {
  findDanglingProjectEntries,
  findProjectRegistryEntry,
  findWorktreeDuplicateEntries,
  gcProjectRegistry,
  type GcProjectRegistryResult,
} from '../core/project-registry.js';
import { findRepoPlanningRootSync } from '../core/planning-home.js';
import { countMigratableEphemera } from '../core/work-migration.js';
import { checkMachineRootRelocation } from '../core/global-config.js';
import { StoreError } from '../core/store/errors.js';
import { gatherRelationshipData } from './shared-gather.js';
import {
  inspectRelationships,
  type InspectRelationshipsInput,
  type RelationshipHealth,
} from '../core/relationship-health.js';
import { COMMAND_REGISTRY } from '../core/completions/command-registry.js';
import { COMMON_FLAGS } from '../core/completions/shared-flags.js';
import { emitFailure, printJson } from './shared-output.js';
import { getAllToolVersionStatus } from '../core/shared/index.js';
import * as path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { version: OPENSPEC_VERSION } = require('../../package.json');

const FAILURE_PAYLOAD = { root: null, store: null, references: [] };

async function gatherHealth(
  root: ResolvedOpenSpecRoot
): Promise<{ health: RelationshipHealth; declaredReferenceCount: number }> {
  const data = await gatherRelationshipData(root);
  const {
    registrySnapshot,
    projectConfig,
    referenceEntries,
    rootInspection,
  } = data;
  const registryUnreadable = registrySnapshot.unreadable;

  const input: InspectRelationshipsInput = {
    root,
    rootHealthy: rootInspection.healthy,
    rootStatus: rootInspection.diagnostics,
    referenceEntries,
    registryUnreadable,
  };

  // Store facts for store-backed roots (explicit --store or declared).
  // Missing/invalid metadata never reaches here: store resolution
  // verifies identity first and fails with the existing taxonomy
  // (recorded amendment - corrupt store.yaml is an exit-1 resolution
  // failure, not a health finding).
  if (root.storeId) {
    const metadata = await readOptionalStoreMetadataState(root.path).catch(() => null);
    // git -C walks UP the tree: probing a non-repo store nested inside
    // another repo would record the ENCLOSING repo's origin.
    const originUrl = (await isGitRepositoryAtRoot(root.path)) ? await gitOriginUrl(root.path) : null;
    input.storeFacts = {
      id: root.storeId,
      metadataPresent: metadata !== null,
      metadataValid: metadata !== null,
      ...(metadata?.remote ? { canonicalRemote: metadata.remote } : {}),
      ...(originUrl ? { originUrl } : {}),
    };
  }

  // The 3.2 both-shapes wrong turn, structured — including a malformed
  // pointer value, which the resolver is silent about on planning-shaped
  // roots.
  if (root.source === 'nearest') {
    const { hasPlanningShape, pointer } = classifyOpenSpecDir(root.path);
    if (hasPlanningShape && pointer.filePath) {
      if (pointer.value !== undefined) {
        input.bothShapesPointer = { value: pointer.value, filePath: pointer.filePath };
      } else if (pointer.malformed) {
        input.malformedPointer = { filePath: pointer.filePath, reason: pointer.malformed };
      }
    }
  }

  // The 3.4-recorded inert-pointer wrong turn: the resolved root is the
  // STORE; re-walk to the pointer directory and read ITS config.
  if (root.source === 'declared') {
    const pointerRoot = findRepoPlanningRootSync(process.cwd());
    if (pointerRoot) {
      const pointerConfig = readProjectConfig(pointerRoot);
      const fields: string[] = [];
      if (pointerConfig?.references?.length) fields.push('references');
      if (fields.length > 0) {
        const filePath =
          resolveConfigFilePath(pointerRoot) ??
          path.join(pointerRoot, WORKSPACE_DIR_NAME, 'config.yaml');
        input.inertPointerDeclarations = { filePath, fields };
      }
    }
  }

  // Machine home (task 6.1): probe-only lookup, never mints or registers.
  // A corrupt/unreadable registry.json must surface as a diagnostic here
  // (MAJOR-2) - doctor IS the registry's reporting surface - rather than
  // silently defaulting to "not registered" with zero dangling entries,
  // which would actively mislead the one command whose job is to say so.
  try {
    const machineHomeEntry = await findProjectRegistryEntry(root.path);
    if (machineHomeEntry) {
      input.machineHomeEntry = {
        path: machineHomeEntry.canonicalPath,
        projectId: machineHomeEntry.entry.projectId,
        home: machineHomeEntry.entry.home,
        lastSeen: machineHomeEntry.entry.lastSeen,
      };

      // Migration-hint detection (task 3.1, review m1): count-only,
      // read-only — never resolves or mints a home (the tracked/untracked
      // split reuses read-only git queries only). Best-effort: a scan
      // failure must never break doctor over an advisory hint.
      try {
        input.migratableEphemera = await countMigratableEphemera(root.path, root.changesDir);
      } catch {
        // Swallowed; the hint is simply omitted.
      }
    }
    const danglingProjectEntries = await findDanglingProjectEntries();
    input.danglingProjectEntries = danglingProjectEntries.map((dangling) => ({
      path: dangling.path,
      home: dangling.entry.home,
    }));
    // Worktree-duplicate reporting (worktree-aware-spaces D5): read-only, the
    // registry section names legacy per-worktree entries and hints `--gc`.
    const worktreeDuplicateEntries = await findWorktreeDuplicateEntries();
    input.worktreeDuplicateEntries = worktreeDuplicateEntries.map((duplicate) => ({
      path: duplicate.path,
      home: duplicate.entry.home,
      mainRoot: duplicate.mainRoot,
    }));
  } catch (error) {
    input.machineHomeError =
      error instanceof StoreError
        ? { message: error.message, ...(error.diagnostic.fix ? { fix: error.diagnostic.fix } : {}) }
        : { message: error instanceof Error ? error.message : String(error) };
  }

  // Machine-root relocation state (relocate-machine-home D4): read-only
  // probe, machine-wide (not tied to this project's registry entry).
  // Best-effort: a scan failure must never break doctor.
  try {
    input.machineRootRelocation = checkMachineRootRelocation();
  } catch {
    // Swallowed; the relocation note is simply omitted.
  }

  // Skill/CLI version mismatch (delivery-reliability-version-guard):
  // doctor is an explicit, on-demand health check, so it re-derives this
  // directly from getAllToolVersionStatus rather than reading the ambient
  // warning's debounce marker — it must report the finding even when that
  // warning already fired and was suppressed earlier in the same session.
  // Best-effort: a lookup failure must never break doctor.
  try {
    const versionStatuses = getAllToolVersionStatus(root.path, OPENSPEC_VERSION);
    const mismatched = versionStatuses.find((status) => status.needsUpdate);
    if (mismatched) {
      input.skillVersionMismatch = {
        stampVersion: mismatched.generatedByVersion ?? 'unknown',
        cliVersion: OPENSPEC_VERSION,
      };
    }
  } catch {
    // Swallowed; the finding is simply omitted.
  }

  return {
    health: inspectRelationships(input),
    declaredReferenceCount: projectConfig?.references?.length ?? 0,
  };
}

function formatGcResult(result: GcProjectRegistryResult) {
  return {
    removed_entries: result.removedEntries.map((removed) => ({
      path: removed.path,
      home: removed.entry.home,
    })),
    removed_homes: result.removedHomes,
  };
}

function printGcSummary(result: GcProjectRegistryResult): void {
  console.log('');
  console.log('Machine home GC');
  if (result.removedEntries.length === 0) {
    console.log('  Nothing to remove.');
    return;
  }
  for (const removed of result.removedEntries) {
    console.log(`  - Removed entry: ${removed.path} (home: ${removed.entry.home})`);
  }
  for (const home of result.removedHomes) {
    console.log(`  - Deleted orphaned home: ${home} (including any external archives it held — git history remains the durable record)`);
  }
}

function printDiagnosticLines(prefix: string, status: { message: string; fix?: string }[]): void {
  for (const entry of status) {
    console.log(`${prefix}- ${entry.message}`);
    if (entry.fix) {
      console.log(`${prefix}  Fix: ${entry.fix}`);
    }
  }
}

function printEntrySection<T extends { status: { message: string; fix?: string }[] }>(
  title: string,
  entries: T[],
  emptyLine: string,
  okLine: (entry: T) => string,
  idOf: (entry: T) => string
): void {
  console.log('');
  console.log(title);
  if (entries.length === 0) {
    console.log(`  ${emptyLine}`);
    return;
  }
  for (const entry of entries) {
    if (entry.status.length === 0) {
      console.log(`  - ${okLine(entry)}`);
      continue;
    }
    for (const diagnostic of entry.status) {
      console.log(`  - ${idOf(entry)}: ${diagnostic.message}`);
      if (diagnostic.fix) {
        console.log(`    Fix: ${diagnostic.fix}`);
      }
    }
  }
}

function printHumanHealth(health: RelationshipHealth, declaredReferenceCount: number): void {
  console.log('Doctor');
  console.log('');
  console.log('Root');
  console.log(`  Location: ${health.root.path}`);
  console.log(`  Rasen root: ${health.root.healthy ? 'ok' : 'unhealthy'}`);
  if (health.store) {
    const metadataNote = health.store.metadata.valid ? 'metadata ok' : 'metadata invalid';
    console.log(`  Store: ${health.store.id} (${metadataNote})`);
  }
  printDiagnosticLines('  ', [...health.root.status, ...(health.store?.status ?? [])]);

  // "(none declared)" must never lie: self-references are omitted from
  // the index, so an emptied-by-omission list gets its own line.
  const referencesEmptyLine =
    health.references.length === 0 && declaredReferenceCount > 0
      ? '(declared references all resolve to this root)'
      : '(none declared)';
  printEntrySection(
    'References',
    health.references,
    referencesEmptyLine,
    (entry) => `${entry.store_id}: ok${entry.root ? ` (${entry.root})` : ''}`,
    (entry) => entry.store_id
  );

  console.log('');
  console.log('Machine home');
  if (health.machineHome.error) {
    console.log(`  Error: ${health.machineHome.error.message}`);
    if (health.machineHome.error.fix) {
      console.log(`  Fix: ${health.machineHome.error.fix}`);
    }
  } else if (health.machineHome.registered && health.machineHome.entry) {
    console.log(`  Home: ${health.machineHome.entry.home}`);
    console.log(`  Project id: ${health.machineHome.entry.project_id}`);
    console.log(`  Last seen: ${health.machineHome.entry.last_seen}`);
  } else {
    console.log('  Not registered');
  }
  if (health.machineHome.dangling.length > 0) {
    console.log(`  Dangling entries: ${health.machineHome.dangling.length}`);
    for (const dangling of health.machineHome.dangling) {
      console.log(`    - ${dangling.path} (home: ${dangling.home})`);
    }
    console.log('    Fix: rasen doctor --gc');
  }
  if (health.machineHome.worktreeDuplicates.length > 0) {
    console.log(`  Worktree-duplicate entries: ${health.machineHome.worktreeDuplicates.length}`);
    for (const duplicate of health.machineHome.worktreeDuplicates) {
      console.log(`    - ${duplicate.path} (worktree of ${duplicate.mainRoot}, home: ${duplicate.home})`);
    }
    console.log('    Fix: rasen doctor --gc');
  }
  if (health.machineHome.migratableEphemera) {
    const m = health.machineHome.migratableEphemera;
    const detail = m.splitUnavailable
      ? `${m.total} (tracked/untracked split unavailable)`
      : m.tracked > 0
        ? `${m.untracked} untracked (+${m.tracked} tracked, needs --include-tracked)`
        : `${m.untracked} untracked`;
    console.log(`  Migratable legacy ephemera: ${detail} (run \`${m.hint}\`)`);
  }
  for (const lingering of health.machineHome.relocation.lingering) {
    console.log(`  Legacy data dir at ${lingering.path}; contents were copied to ${lingering.target}; safe to delete after verifying.`);
  }
  for (const pending of health.machineHome.relocation.pendingOrFailed) {
    console.log(`  Relocation pending: ${pending.path} has not been adopted into ${pending.target}.`);
    console.log(`    Fix: run the CLI again to retry automatically, or copy manually: cp -r "${pending.path}" "${pending.target}"`);
  }

  for (const entry of health.status) {
    console.log('');
    console.log(`Note: ${entry.message}`);
    if (entry.fix) {
      console.log(`Fix: ${entry.fix}`);
    }
  }
}

export function registerDoctorCommand(program: Command): void {
  const description =
    COMMAND_REGISTRY.find((entry) => entry.name === 'doctor')?.description ??
    'Report relationship health for the resolved Rasen root';

  program
    .command('doctor')
    .description(description)
    .option('--store <id>', COMMON_FLAGS.store.description)
    .option('--project <id>', COMMON_FLAGS.project.description)
    .addOption(
      new Option('--store-path <path>', 'Removed; register the store and use --store').hideHelp()
    )
    .option('--json', 'Output as JSON')
    .option(
      '--gc',
      "Remove dangling machine-home registry entries and their orphaned home directories — this deletes ANY external archives inside those homes too (archive-destination's 'external' archives share the home's lifecycle; git history remains the durable record)"
    )
    .action(async (options: { store?: string; project?: string; storePath?: string; json?: boolean; gc?: boolean }) => {
      try {
        const root = await resolveRootForCommand(
          { store: options.store, project: options.project, storePath: options.storePath },
          { json: options.json, failurePayload: FAILURE_PAYLOAD, allowImplicitRoot: false }
        );
        if (!root) {
          return;
        }

        // --gc is the explicit opt-in write path (task 6.2); doctor stays
        // read-only by default. Runs before gathering health so the report
        // reflects the post-GC registry state.
        const gcResult = options.gc ? await gcProjectRegistry() : null;

        const { health, declaredReferenceCount } = await gatherHealth(root);

        if (options.json) {
          printJson(gcResult ? { ...health, gc: formatGcResult(gcResult) } : health);
          return;
        }
        printHumanHealth(health, declaredReferenceCount);
        if (gcResult) {
          printGcSummary(gcResult);
        }
      } catch (error) {
        emitFailure(options.json, FAILURE_PAYLOAD, error, 'doctor_failed');
      }
    });
}
