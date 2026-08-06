/**
 * New Change Command
 *
 * Creates a new change directory with optional description and schema in the
 * resolved Rasen root. `--store <id>` selects a registered store's
 * root; initiative linking and workspace affected areas are no longer part of
 * this command.
 */

import ora from 'ora';
import { validateChangeName } from '../../utils/change-utils.js';
import { formatChangeLocation } from '../../core/planning-home.js';
import { ephemeraDir } from '../../core/file-placement.js';
import {
  initializeRunState,
  loadPipelineByName,
  type PipelineYaml,
} from '../../core/pipeline-registry/index.js';
import {
  resolveChangeCreationForCommand,
  resolvedExecutionProjectRoot,
  RootSelectionError,
  toPlanningHome,
  toRootOutput,
  withStoreFlag,
  type ResolvedOpenSpecRoot,
  type RootOutput,
  isStoreSelectedRoot,
} from '../../core/root-selection.js';
import { printJson, statusFromError } from './shared.js';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface NewChangeOptions {
  description?: string;
  proposal?: string;
  goal?: string;
  schema?: string;
  store?: string;
  project?: string;
  targetLine?: string;
  storePath?: string;
  initiative?: string;
  areas?: string;
  pipeline?: string;
  json?: boolean;
}

interface NewChangeOutput {
  change: {
    id: string;
    path: string;
    metadataPath: string;
    schema: string;
    pipeline?: string;
    runStatePath?: string;
  };
  root: RootOutput;
}

// -----------------------------------------------------------------------------
// Command Implementation
// -----------------------------------------------------------------------------

function assertRemovedOptionsAbsent(options: NewChangeOptions): void {
  if (options.initiative !== undefined) {
    throw new RootSelectionError(
      '--initiative is no longer supported. Normal changes no longer attach to initiatives; --store <id> selects the Rasen root.',
      'initiative_option_removed',
      { target: 'change.options' }
    );
  }

  if (options.areas !== undefined) {
    throw new RootSelectionError(
      '--areas is no longer supported. Workspace affected areas are not part of the normal Rasen root path.',
      'areas_option_removed',
      { target: 'change.options' }
    );
  }
}

function printCreatedChangeHuman(
  payload: NewChangeOutput,
  root: ResolvedOpenSpecRoot
): void {
  // A relative path is only honest when the root is where the user
  // stands; a distant ancestor root gets the absolute path.
  const location =
    !isStoreSelectedRoot(root) && root.path === process.cwd()
      ? formatChangeLocation(toPlanningHome(root), payload.change.id)
      : payload.change.path;
  console.log(`Created change '${payload.change.id}' at ${location}/`);
  console.log(`Schema: ${payload.change.schema}`);
  if (payload.change.pipeline && payload.change.runStatePath) {
    console.log(`Pipeline: ${payload.change.pipeline}`);
    console.log(`Run-state: ${payload.change.runStatePath}`);
  }
  console.log(`Next: ${withStoreFlag(root, `rasen status --change ${payload.change.id}`)}`);
}

export async function newChangeCommand(name: string | undefined, options: NewChangeOptions): Promise<void> {
  const spinner = options.json ? undefined : ora();

  try {
    if (!name) {
      throw new Error('Missing required argument <name>');
    }

    const validation = validateChangeName(name);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    assertRemovedOptionsAbsent(options);

    // An explicit but empty/whitespace-only --proposal is a user mistake,
    // not "no proposal requested" (that's simply omitting the flag) — fail
    // loudly rather than silently skipping proposal.md seeding, consistent
    // with the server bridge's 400 on an empty description (review m2).
    if (options.proposal !== undefined && options.proposal.trim().length === 0) {
      throw new Error('--proposal must not be empty or whitespace-only.');
    }

    const resolved = await resolveChangeCreationForCommand(options, {
      json: options.json,
      failurePayload: { change: null },
    });
    if (!resolved) {
      return;
    }
    const { root, scope } = resolved;

    // Resolve before creating anything so an invalid assignment is atomic:
    // no orphan child directory is left behind on an unknown pipeline.
    const executionRoot = resolvedExecutionProjectRoot(root);
    if (options.pipeline && executionRoot === undefined) {
      throw new RootSelectionError(
        'Pipeline initialization requires a verified execution project; the Store planning checkout is not an execution fallback.',
        'execution_authority_unavailable',
        { target: 'execution.root' }
      );
    }
    const pipeline: PipelineYaml | null = options.pipeline
      ? loadPipelineByName(options.pipeline, executionRoot)
      : null;

    const resolvedSchema = options.schema ?? root.defaultSchema;
    if (spinner) {
      spinner.start(`Creating change '${name}' with schema '${resolvedSchema}'...`);
    }

    const authored = await scope.createChange({
      changeId: name,
      schema: options.schema,
      defaultSchema: root.defaultSchema,
      ...(options.description === undefined ? {} : { description: options.description }),
      ...(options.proposal === undefined ? {} : { proposal: options.proposal }),
      ...(options.goal === undefined ? {} : { goal: options.goal }),
    });

    // Run-state is ephemera: it lands in the EXECUTION root (design D3), which
    // is per-worktree by construction. The previous machine-home mint made two
    // worktrees of one project share a run-state path, so the second worktree
    // failed with "Run-state already exists" for a change it had never created.
    const initialized = pipeline
      ? initializeRunState(
          ephemeraDir(executionRoot as string, name),
          pipeline
        )
      : null;

    const payload: NewChangeOutput = {
      change: {
        id: name,
        path: authored.location.absolutePath,
        metadataPath: authored.metadataPath,
        schema: authored.schema,
        ...(pipeline && initialized
          ? { pipeline: pipeline.name, runStatePath: initialized.path }
          : {}),
      },
      root: toRootOutput(root),
    };

    if (options.json) {
      printJson(payload);
      return;
    }

    spinner?.stop();
    printCreatedChangeHuman(payload, root);
  } catch (error) {
    spinner?.stop();
    if (options.json) {
      printJson({
        change: null,
        status: [statusFromError(error)],
      });
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}
