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
import {
  readOptionalStoreMetadataState,
  storeMetadataUid,
} from '../core/store/foundation.js';
import { resolveStoreBinding, type StoreUnavailableReason } from '../core/store/identity.js';
import { storeBindingDeclarationFrom } from '../core/effective-config.js';
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
import { diagnoseMigrationDrift } from '../core/store/migration-ops.js';
import { gatherProjectMembership, gatherRelationshipData } from './shared-gather.js';
import {
  inspectRelationships,
  membershipHumanLines,
  type InspectRelationshipsInput,
  type RelationshipHealth,
} from '../core/relationship-health.js';
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

  // Bootstrap-readiness facts (design D4): hoisted so the gather at the end of
  // this function can compose them without re-reading the declaration.
  let planningStoreResolved = false;
  let planningStoreReason: StoreUnavailableReason | undefined;
  let planningStoreHasRemote = false;

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
    const uid = storeMetadataUid(metadata);
    // git -C walks UP the tree: probing a non-repo store nested inside
    // another repo would record the ENCLOSING repo's origin.
    const originUrl = (await isGitRepositoryAtRoot(root.path)) ? await gitOriginUrl(root.path) : null;
    input.storeFacts = {
      id: root.storeId,
      ...(uid ? { uid } : {}),
      metadataPresent: metadata !== null,
      metadataValid: metadata !== null,
      ...(metadata !== null && uid === undefined ? { metadataLegacy: true } : {}),
      ...(metadata?.remote ? { canonicalRemote: metadata.remote } : {}),
      ...(originUrl ? { originUrl } : {}),
    };
  }

  // Store identity diagnosis (design D4's read-only carve-out): doctor keeps
  // working precisely in the states that stop every other command — it is how
  // a user finds out what is wrong. The SHARED resolver answers, so doctor
  // can never disagree with the commands it diagnoses, and it writes nothing,
  // clones nothing, and registers nothing.
  if (root.source === 'nearest') {
    const { hasPlanningShape, pointer } = classifyOpenSpecDir(root.path);
    if (hasPlanningShape && pointer.filePath) {
      if (pointer.malformed) {
        input.malformedPointer = { filePath: pointer.filePath, reason: pointer.malformed };
      }

      const declaration = storeBindingDeclarationFrom(pointer);
      if (declaration.form !== 'absent') {
        const binding = await resolveStoreBinding({ declaration, projectRoot: root.path });
        // Record the facts the bootstrap-readiness composer needs (design D4).
        planningStoreResolved = binding.kind === 'resolved';
        if (binding.kind === 'unavailable') {
          planningStoreReason = binding.reason;
        }
        if (declaration.form === 'durable' && declaration.remote !== undefined) {
          planningStoreHasRemote = true;
        }
        input.storeBinding = {
          shape: pointer.shape,
          filePath: pointer.filePath,
          ...(pointer.value !== undefined ? { declaredId: pointer.value } : {}),
          ...(pointer.durable?.uid ? { declaredUid: pointer.durable.uid } : {}),
          ...(binding.kind === 'resolved'
            ? {
                resolvedBy: binding.resolvedBy,
                resolvedId: binding.store.id,
                ...(binding.store.uid ? { resolvedUid: binding.store.uid } : {}),
                diagnostics: binding.diagnostics,
              }
            : {}),
          ...(binding.kind === 'unavailable'
            ? { reason: binding.reason, repair: binding.repair, diagnostics: binding.diagnostics }
            : {}),
        };

        if (binding.kind === 'resolved') {
          const storeMetadata = await readOptionalStoreMetadataState(binding.store.root).catch(
            () => null
          );
          input.storeFacts = {
            id: binding.store.id,
            ...(binding.store.uid ? { uid: binding.store.uid } : {}),
            metadataPresent: storeMetadata !== null,
            metadataValid: storeMetadata !== null,
            ...(binding.store.uid ? {} : { metadataLegacy: true }),
            ...(storeMetadata?.remote ? { canonicalRemote: storeMetadata.remote } : {}),
          };
        }
      }
    }
  }

  // Membership: the roster relation AND its findings, gathered read-only from
  // the single provider and composed into the report. Reported for the
  // resolved planning root — never for a store root, which is the other side
  // of the relation.
  if (root.source !== 'store') {
    const membershipRoot = root.source === 'declared'
      ? (findRepoPlanningRootSync(process.cwd()) ?? root.path)
      : root.path;
    // The planning Store is resolved and handed in by the shared gather, or
    // the "your planning Store has no record for this project" finding — the
    // only error-severity one — could never be produced.
    const membership = await gatherProjectMembership(membershipRoot);
    if (membership) {
      input.membership = membership;
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

      // Cache-vs-config drift advisory (project-install-manifest spec):
      // compare the project's authoritative `tools:` manifest in config.yaml
      // against the registry entry's cached `tools` mirror. When they
      // disagree, surface an advisory — never rewrite either side from
      // doctor. Re-running `rasen init` or `rasen update` in the drifted
      // project resyncs the cache.
      try {
        const projectConfig = readProjectConfig(root.path);
        if (projectConfig?.tools && machineHomeEntry.entry.tools) {
          const configTools = [...projectConfig.tools].sort();
          const cacheTools = [...machineHomeEntry.entry.tools].sort();
          const drift = JSON.stringify(configTools) !== JSON.stringify(cacheTools);
          if (drift) {
            input.cacheDrift = {
              configTools: projectConfig.tools,
              cacheTools: machineHomeEntry.entry.tools,
            };
          }
        }
        // Surface a missing installedVersion as "version unknown" (advisory).
        if (machineHomeEntry.entry.installedVersion === undefined) {
          input.cacheVersionUnknown = true;
        }
      } catch {
        // Swallowed; the advisory is simply omitted.
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

  // Bootstrap readiness (design D4): composed from the facts gathered above —
  // no new reads. The planning Store's resolution, the membership roster, and
  // the machine-home entry are all present by now. Only populated when a
  // planning Store was probed (root.source === 'nearest' with a declaration);
  // otherwise the readiness defaults to `complete`.
  if (root.source === 'nearest') {
    const membershipConfirmed =
      input.membership?.stores.some((store) => store.roles?.planning === true) ?? false;
    input.bootstrapReadiness = {
      storeBinding: {
        resolved: planningStoreResolved,
        ...(planningStoreReason !== undefined ? { reason: planningStoreReason } : {}),
        ...(planningStoreHasRemote ? { hasRemote: true } : {}),
      },
      membership: { confirmed: membershipConfirmed },
      machineHomeRegistered: input.machineHomeEntry !== undefined,
    };
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
    // A declared store that could not be resolved has no metadata to judge and
    // no identity to read: saying "metadata invalid" and "none yet (legacy
    // metadata)" about it would report two things that were never looked at.
    if (health.store.unavailable) {
      console.log(`  Store: ${health.store.id} (declared, not available on this machine)`);
      console.log(
        `  Store identity: ${health.store.uid ?? 'not recorded in the declaration'}`
      );
    } else {
      const metadataNote = health.store.metadata.valid ? 'metadata ok' : 'metadata invalid';
      console.log(`  Store: ${health.store.id} (${metadataNote})`);
      console.log(
        `  Store identity: ${health.store.uid ?? 'none yet (legacy metadata)'}`
      );
    }
    if (health.store.pointer) {
      const resolvedBy =
        health.store.pointer.resolved_by === 'uid'
          ? 'resolved by permanent identity'
          : health.store.pointer.resolved_by === 'alias'
            ? 'resolved by display name'
            : 'not resolved';
      console.log(
        `  Declaration: ${health.store.pointer.shape} (${resolvedBy})`
      );
    }
    if (health.store.unavailable) {
      console.log(`  Declared store unavailable: ${health.store.unavailable.reason}`);
      for (const repair of health.store.unavailable.repair) {
        console.log(`    Next: ${repair}`);
      }
    }
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

  // Membership: roster and eligibility only. The wording says so on every run,
  // because the whole point of separating it from the planning binding above
  // is that a reader must not take one for the other.
  console.log('');
  console.log('Store membership (roster and eligibility only; it does not decide where work is done)');
  // Rendered from the SAME structure the `--json` payload carries, through the
  // shared line builder, so the two modes cannot report different codes or
  // different repairs.
  for (const line of membershipHumanLines(health.membership)) {
    console.log(line);
  }

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

  // Bootstrap readiness (design D4): one read-only answer to "is this machine
  // ready, and if not, what does it need?" Composed from the same facts
  // `rasen bootstrap --check` reports, so the two agree by construction.
  // Rendered after the sections it composes FROM (Store, membership, machine
  // home) so a reader sees the underlying facts before the summary.
  console.log('');
  console.log('Bootstrap readiness');
  const readiness = health.bootstrapReadiness;
  console.log(`  State: ${readiness.state}`);
  if (readiness.findings.length === 0) {
    if (readiness.state === 'complete') {
      console.log('  This machine is ready. No bootstrap action needed.');
    } else {
      // Degraded/blocked with zero bootstrap findings: the gap is not one
      // bootstrap closes (e.g. an identity-level failure). The Store section
      // above carries the detail.
      console.log('  The gap is not one bootstrap can close; see the Store section above.');
    }
  } else {
    for (const finding of readiness.findings) {
      console.log(`  - [${finding.severity}] ${finding.message}`);
      console.log(`    Repair: ${finding.repair}`);
    }
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
  program
    .command('doctor')
    .description('')
    .option('--store <id>', '')
    .option('--project <id>', '')
    .addOption(
      new Option('--store-path <path>', '').hideHelp()
    )
    .option('--json', '')
    .option(
      '--gc',
      ''
    )
    .action(async (options: { store?: string; project?: string; storePath?: string; json?: boolean; gc?: boolean }) => {
      try {
        const root = await resolveRootForCommand(
          { store: options.store, project: options.project, storePath: options.storePath },
          {
            json: options.json,
            failurePayload: FAILURE_PAYLOAD,
            allowImplicitRoot: false,
            // Doctor is the surface that REPORTS a broken store declaration,
            // so it must not be stopped by one (design D4).
            allowUnavailableStore: true,
          }
        );
        if (!root) {
          return;
        }

        // --gc is the explicit opt-in write path (task 6.2); doctor stays
        // read-only by default. Runs before gathering health so the report
        // reflects the post-GC registry state.
        const gcResult = options.gc ? await gcProjectRegistry() : null;

        const { health, declaredReferenceCount } = await gatherHealth(root);

        // Migration drift (store-migration-commands D7): pointer to an
        // unregistered store, ambiguous shape+pointer, manifest/store
        // mismatch. Surfaced here so top-level doctor aggregates the same
        // checks `store doctor` reports. Best-effort — never breaks doctor.
        const migrationDrift = await diagnoseMigrationDrift(root.path).catch(() => []);

        // Doctor keeps RUNNING on a broken store declaration (design D4's
        // carve-out) but must not report success: a wrapper or CI step gating
        // on this exit status would otherwise read "healthy" in exactly the
        // state this command exists to make loud. Set before either output
        // mode, so human and --json agree.
        if (health.store?.unavailable) {
          process.exitCode = 1;
        }

        if (options.json) {
          const base = gcResult ? { ...health, gc: formatGcResult(gcResult) } : { ...health };
          printJson({ ...base, migrationDrift });
          return;
        }
        printHumanHealth(health, declaredReferenceCount);
        if (migrationDrift.length > 0) {
          console.log('');
          console.log('Migration drift:');
          for (const status of migrationDrift) {
            console.log(`  - [${status.severity}] ${status.message}`);
            if (status.fix) console.log(`    Fix: ${status.fix}`);
          }
        }
        if (gcResult) {
          printGcSummary(gcResult);
        }
      } catch (error) {
        emitFailure(options.json, FAILURE_PAYLOAD, error, 'doctor_failed');
      }
    });
}
