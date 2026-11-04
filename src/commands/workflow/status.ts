/**
 * Status Command
 *
 * Displays artifact completion status for a change.
 */

import ora from 'ora';
import chalk from 'chalk';
import { getChangeDir } from '../../core/planning-home.js';
import { resolveChangeWorkDir, legacyExternalArchiveDir } from '../../core/change-work.js';
import { resolveArchiveTiming } from '../../core/project-config.js';
import {
  resolveRootForCommand,
  readResolvedProjectConfig,
  resolvedExecutionProjectRoot,
  toPlanningHome,
  toRootOutput,
  withStoreFlag,
  isStoreSelectedRoot,
} from '../../core/root-selection.js';
import {
  loadChangeContext,
  formatChangeStatus,
  type ChangeStatus,
} from '../../core/artifact-graph/index.js';
import {
  validateChangeExists,
  validateSchemaExists,
  getAvailableChanges,
  getStatusIndicator,
  getStatusColor,
  resolveChangeLandingDirs,
  resolvePlanningActionContext,
  type ChangeLandingDirs,
} from './shared.js';
import { formatNextWorkflowHint } from '../../core/workflow-chain.js';
import { getCliLocale } from '../../core/cli-locale.js';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface StatusOptions {
  change?: string;
  schema?: string;
  store?: string;
  project?: string;
  targetLine?: string;
  storePath?: string;
  json?: boolean;
}

// -----------------------------------------------------------------------------
// Command Implementation
// -----------------------------------------------------------------------------

export async function statusCommand(options: StatusOptions): Promise<void> {
  // The root resolves (and the store banner prints) before the spinner starts
  // so the two do not fight over stderr.
  const root = await resolveRootForCommand(options, {
    json: options.json,
    ...(options.change === undefined
      ? {}
      : { changeSelector: { changeId: options.change } }),
  });
  if (!root) {
    return;
  }

  const spinner = options.json ? undefined : ora('Loading change status...').start();

  try {
    const planningHome = toPlanningHome(root);
    const projectRoot = root.path;
    const executionRoot = resolvedExecutionProjectRoot(root);
    const projectConfig = readResolvedProjectConfig(root);
    const rootOutput = toRootOutput(root);
    const newChangeHint = withStoreFlag(root, 'rasen new change <name>');

    // Handle no-changes case gracefully — status is informational,
    // so "no changes" is a valid state, not an error.
    if (!options.change) {
      const available = await getAvailableChanges(projectRoot, root.changesDir);
      if (available.length === 0) {
        spinner?.stop();
        if (options.json) {
          console.log(
            JSON.stringify(
              { changes: [], message: 'No active changes.', root: rootOutput },
              null,
              2
            )
          );
          return;
        }
        console.log(`No active changes. Create one with: ${newChangeHint}`);
        return;
      }
      // Changes exist but --change not provided
      spinner?.stop();
      throw new Error(
        `Missing required option --change. Available changes:\n  ${available.join('\n  ')}`
      );
    }

    const changeName = await validateChangeExists(
      options.change,
      projectRoot,
      root.changesDir,
      { newChangeHint }
    );

    // Validate schema if explicitly provided
    if (options.schema) {
      validateSchemaExists(options.schema, projectRoot, root.schemasDir);
    }

    // loadChangeContext will auto-detect schema from metadata if not provided
    const context = loadChangeContext(projectRoot, changeName, options.schema, {
      changeDir: getChangeDir(planningHome, changeName),
      planningHome,
      ...(root.schemasDir === undefined ? {} : { projectSchemasDir: root.schemasDir }),
      projectConfig,
    });
    const status = formatChangeStatus(
      context,
      {
        ...(isStoreSelectedRoot(root)
          ? { storeId: root.storeId, storeType: root.storeType }
          : {}),
        ...(root.planningScope === undefined
          ? {}
          : { followupSelection: root.planningScope.followupSelection }),
      }
    );
    status.actionContext = resolvePlanningActionContext(
      root,
      status.artifacts.map((artifact) => artifact.id)
    );

    // Probe-only (ensure:false): status is a read-only surface and must
    // never mint identity or write to the repo/registry (design D2). A
    // probe miss simply omits `workDir` from the payload — it is a
    // legacy-read location now, not a landing point.
    const workDir = executionRoot === undefined
      ? null
      : await resolveChangeWorkDir(executionRoot, changeName, { ensure: false });

    // Per-class landing directories (`file-placement` capability): always
    // present — they derive from the planning and execution roots alone and
    // need no machine identity.
    const landing = resolveChangeLandingDirs(root, status.changeRoot, changeName);

    // Resolved archive timing (design D2/cli-artifact-workflow spec): a
    // plain config read + resolver, synchronous, no git/gh calls, no
    // writes. Always present — the default always resolves.
    const archiveTiming = resolveArchiveTiming(projectConfig);

    // Archive bookkeeping is always the in-repo location (`archive-
    // destination` capability): the destination axis is retired, so no
    // `destination` field is reported. `legacyArchiveDir` appears only when a
    // machine home resolves by read-only probe AND its archive area exists —
    // discovery for archives written by the retired `external` destination.
    const archiveDir = root.archiveDir;
    const legacyArchiveDir = executionRoot === undefined
      ? null
      : await legacyExternalArchiveDir(executionRoot);

    spinner?.stop();

    if (options.json) {
      console.log(
        JSON.stringify(
          {
            ...status,
            ...landing,
            ...(workDir ? { workDir } : {}),
            archive: {
              timing: archiveTiming,
              archiveDir,
              ...(legacyArchiveDir ? { legacyArchiveDir } : {}),
            },
            root: rootOutput,
          },
          null,
          2
        )
      );
      return;
    }

    printStatusText(status, workDir ?? undefined, archiveTiming, {
      archiveDir,
      legacyArchiveDir,
    }, landing);
  } catch (error) {
    spinner?.stop();
    throw error;
  }
}

export function printStatusText(
  status: ChangeStatus,
  workDir?: string,
  archiveTiming?: string,
  archiveLocation?: { archiveDir: string; legacyArchiveDir: string | null },
  landing?: ChangeLandingDirs
): void {
  const doneCount = status.artifacts.filter((a) => a.status === 'done').length;
  const total = status.artifacts.length;

  console.log(`Change: ${status.changeName}`);
  console.log(`Schema: ${status.schemaName}`);
  if (status.changeRoot) {
    console.log(`Change root: ${status.changeRoot}`);
  }
  if (landing) {
    console.log(`Evidence dir: ${landing.evidenceDir}`);
    console.log(`Handoff dir: ${landing.handoffDir}`);
    if (landing.ephemeraDir) {
      console.log(`Ephemera dir: ${landing.ephemeraDir}`);
    }
  }
  if (workDir) {
    console.log(`Work dir (legacy): ${workDir}`);
  }
  if (archiveTiming) {
    console.log(`Archive timing: ${archiveTiming}`);
  }
  if (archiveLocation) {
    console.log(`Archive dir: ${archiveLocation.archiveDir}`);
    if (archiveLocation.legacyArchiveDir) {
      console.log(`Legacy archive dir: ${archiveLocation.legacyArchiveDir}`);
    }
  }
  console.log(`Progress: ${doneCount}/${total} artifacts complete`);
  console.log();

  for (const artifact of status.artifacts) {
    const indicator = getStatusIndicator(artifact.status);
    const color = getStatusColor(artifact.status);
    let line = `${indicator} ${artifact.id}`;

    if (artifact.status === 'blocked' && artifact.missingDeps && artifact.missingDeps.length > 0) {
      line += color(` (blocked by: ${artifact.missingDeps.join(', ')})`);
    }

    console.log(line);
  }

  if (status.isComplete) {
    console.log();
    console.log(chalk.green('All artifacts complete!'));
  }

  if (status.nextWorkflows.length > 0) {
    console.log();
    for (const step of status.nextWorkflows) {
      console.log(formatNextWorkflowHint(step, getCliLocale()));
    }
  }
}
