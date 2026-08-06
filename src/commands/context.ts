/**
 * `rasen context` (slice 4.1): the working set a root's declarations
 * describe, as an agent brief (JSON), a human listing, or an editor
 * view (`--code-workspace`). Assembly is presentation over the Phase 3
 * relationship data; doctor is the health surface. The only write this
 * command can perform is the explicitly requested workspace file.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Command, Option } from 'commander';

import {
  resolveRootForCommand,
  toRootOutput,
  type ResolvedOpenSpecRoot,
} from '../core/root-selection.js';
import { resolveProjectHome } from '../core/project-home.js';
import { deriveWorkspaceIdentity } from '../core/file-placement.js';
import { inspectRelationships } from '../core/relationship-health.js';
import {
  assembleWorkingSet,
  buildCodeWorkspaceJson,
  isAvailableMember,
  type WorkingSet,
  type WorkingSetMember,
} from '../core/working-set.js';
import { StoreError } from '../core/store/errors.js';
import { emitFailure, printJson } from './shared-output.js';
import { gatherRelationshipData } from './shared-gather.js';

const FAILURE_PAYLOAD = { root: null, members: [] };

/**
 * The aggregate payload must SAY that project content needs project authority
 * (`store-planning-scope-routing`: "Aggregate context has no fabricated project
 * home"). Without it an aggregate read is indistinguishable from a healthy
 * project context that simply declares no references. `doctor` reports the same
 * fact under the same code.
 */
const STORE_AGGREGATE_STATUS = {
  severity: 'info' as const,
  code: 'store_aggregate_scope',
  message:
    'Store aggregate scope: project authority is required for project content. Add --project <project-id> to address a project.',
};

async function gatherWorkingSet(
  root: ResolvedOpenSpecRoot
): Promise<{ workingSet: WorkingSet; declaredReferenceCount: number }> {
  if (root.planningScope?.kind === 'store-aggregate') {
    return {
      workingSet: {
        root: { ...toRootOutput(root), role: 'openspec_root' },
        members: [],
        status: [STORE_AGGREGATE_STATUS],
      },
      declaredReferenceCount: 0,
    };
  }
  const data = await gatherRelationshipData(root);

  // Reuse the 3.6 composition for member classification; the
  // doctor-only wrong-turn detections and store facts are deliberately
  // absent — doctor is the health surface.
  const health = inspectRelationships({
    root,
    rootHealthy: data.rootInspection.healthy,
    rootStatus: data.rootInspection.diagnostics,
    referenceEntries: data.referenceEntries,
    registryUnreadable: data.registrySnapshot.unreadable,
  });

  const workingSet = assembleWorkingSet({
    root,
    referenceEntries: data.referenceEntries,
    topLevelStatus: health.status,
  });

  // Root-scoped, probe-only (design D3 `context/machineHome`): context
  // never mints identity or writes to the repo/registry — an unregistered
  // project simply carries no `machineHome`. The probe itself must never
  // fail the command: a corrupt machine-global registry.json would
  // otherwise throw here and brick `rasen context` (review finding F1).
  const home = await resolveProjectHome(root.path, { ensure: false }).catch(() => null);
  const workingSetWithHome: WorkingSet = home
    ? { ...workingSet, root: { ...workingSet.root, machineHome: home.homeDir } }
    : workingSet;

  // Workspace identity (design `file-placement-collapse-landing`, D5): a pure
  // derivation from the canonicalized root path — distinct per Git worktree,
  // which is what keeps two worktrees of one project from sharing per-change
  // state. Read-only: no `workspaces/` directory is created here or anywhere
  // else until a real coordination writer exists.
  const workspaceIdentity = deriveWorkspaceIdentity(root.path).id;
  const workingSetWithIdentity: WorkingSet = {
    ...workingSetWithHome,
    root: { ...workingSetWithHome.root, workspaceIdentity },
  };

  return {
    workingSet: workingSetWithIdentity,
    declaredReferenceCount: data.projectConfig?.references?.length ?? 0,
  };
}

function memberLine(member: WorkingSetMember): string {
  return `  ${member.id}  ${member.path}`;
}

function printHumanWorkingSet(workingSet: WorkingSet, declaredReferenceCount: number): void {
  const rootLabel = workingSet.root.store_id ?? path.basename(workingSet.root.path);
  console.log(`Working context for ${rootLabel} (${workingSet.root.path})`);
  console.log('');
  console.log('Rasen root');
  console.log(`  ${rootLabel}  ${workingSet.root.path}`);
  if (workingSet.root.machineHome) {
    console.log(`  Machine home: ${workingSet.root.machineHome}`);
  }
  if (workingSet.root.workspaceIdentity) {
    console.log(`  Workspace identity: ${workingSet.root.workspaceIdentity}`);
  }

  if (workingSet.root.scope?.kind === 'store-aggregate') {
    // An aggregate read has no project working set to list; the human form must
    // still state the authority requirement rather than reading as an empty
    // but healthy project context.
    console.log('');
    console.log('Store aggregate');
    console.log(`  ${STORE_AGGREGATE_STATUS.message}`);
    return;
  }

  const availableStores = workingSet.members.filter(
    (member) => member.role === 'referenced_store' && isAvailableMember(member)
  );
  const unavailable = workingSet.members.filter((member) => !isAvailableMember(member));

  if (availableStores.length > 0) {
    console.log('');
    console.log('Referenced stores');
    for (const member of availableStores) {
      console.log(memberLine(member));
      if (member.fetch) {
        console.log(`    Fetch: ${member.fetch}`);
      }
    }
  }

  if (workingSet.members.length === 0) {
    console.log('');
    // Self-references are silently omitted from the index; an
    // emptied-by-omission set must not claim nothing was declared.
    console.log(
      declaredReferenceCount > 0
        ? 'Declared references all resolve to this root; the working set is this root alone.'
        : 'No references declared; the working set is this root alone.'
    );
  }

  if (unavailable.length > 0 || workingSet.status.length > 0) {
    console.log('');
    console.log('Not available on this machine');
    for (const member of unavailable) {
      if (member.status.length === 0) {
        console.log(`  - ${member.id}`);
        continue;
      }
      for (const diagnostic of member.status) {
        console.log(`  - ${member.id}: ${diagnostic.message}`);
        if (diagnostic.fix) {
          console.log(`    Fix: ${diagnostic.fix}`);
        }
      }
    }
    for (const diagnostic of workingSet.status) {
      console.log(`  Note: ${diagnostic.message}`);
      if (diagnostic.fix) {
        console.log(`  Fix: ${diagnostic.fix}`);
      }
    }
  }
}

function writeCodeWorkspace(
  workingSet: WorkingSet,
  outputPath: string,
  force: boolean
): void {
  const resolved = path.resolve(outputPath);
  if (fs.existsSync(resolved) && !force) {
    throw new StoreError(
      `Refusing to overwrite ${resolved}.`,
      'context_file_exists',
      {
        target: 'context.output',
        fix: `Pass --force to overwrite, or choose a different path.`,
      }
    );
  }
  const parent = path.dirname(resolved);
  if (!fs.existsSync(parent)) {
    throw new StoreError(
      `Output directory does not exist: ${parent}.`,
      'context_output_dir_missing',
      { target: 'context.output', fix: 'Create the directory first, or choose another path.' }
    );
  }

  const rootName = workingSet.root.store_id ?? path.basename(workingSet.root.path);
  fs.writeFileSync(resolved, buildCodeWorkspaceJson(workingSet, rootName));

  const available = workingSet.members.filter(isAvailableMember).length;
  const skipped = workingSet.members
    .filter((member) => !isAvailableMember(member))
    .map((member) => member.id);
  const summary =
    skipped.length > 0
      ? `Wrote ${resolved} (${available + 1} folders; not available: ${skipped.join(', ')})`
      : `Wrote ${resolved} (${available + 1} folders)`;
  // stderr keeps JSON stdout pure; for humans it reads inline.
  console.error(summary);
}

export function registerContextCommand(program: Command): void {
  program
    .command('context')
    .description('')
    .option('--store <id>', '')
    .option('--project <id>', '')
    .option('--target-line <id>', '')
    .addOption(
      new Option('--store-path <path>', '').hideHelp()
    )
    .option('--json', '')
    .option('--code-workspace <path>', '')
    .option('--force', '')
    .action(
      async (options: {
        store?: string;
        project?: string;
        targetLine?: string;
        storePath?: string;
        json?: boolean;
        codeWorkspace?: string;
        force?: boolean;
      }) => {
        try {
          const root = await resolveRootForCommand(
            {
              store: options.store,
              project: options.project,
              targetLine: options.targetLine,
              storePath: options.storePath,
            },
            {
              json: options.json,
              failurePayload: FAILURE_PAYLOAD,
              allowImplicitRoot: false,
              ...(options.store !== undefined && options.project === undefined
                ? { intent: 'store-read' as const }
                : {}),
            }
          );
          if (!root) {
            return;
          }

          const { workingSet, declaredReferenceCount } = await gatherWorkingSet(root);

          if (options.json) {
            // The write runs FIRST: a write failure must leave stdout
            // holding exactly one JSON document (the failure payload).
            if (options.codeWorkspace) {
              writeCodeWorkspace(workingSet, options.codeWorkspace, options.force === true);
            }
            printJson(workingSet);
          } else {
            printHumanWorkingSet(workingSet, declaredReferenceCount);
            if (options.codeWorkspace) {
              writeCodeWorkspace(workingSet, options.codeWorkspace, options.force === true);
            }
          }
        } catch (error) {
          emitFailure(options.json, FAILURE_PAYLOAD, error, 'context_failed');
        }
      }
    );
}
