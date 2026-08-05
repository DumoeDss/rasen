/**
 * Retain Command — the Rasen-owned transition into a retention run.
 *
 * `rasen retain prepare <change>` closes the gap the standalone `codify` branch
 * used to fall into: standalone retention resolves its mode from the effective
 * profile, while every project- or store-scoped knowledge operation needs a
 * frozen identity loaded from a resolved run-state directory — and a completed
 * change that never ran through a classified pipeline has neither. Preparation
 * is the single operation that gets from the first state to the second, so a
 * retention worker never has to hand-write durable state or synthesize an owner.
 *
 * It resolves the EFFECTIVE retention mode (the same resolution the project
 * apply gate uses, so the mode a run is told is the mode that governs it),
 * freezes durable knowledge identity when none is recorded, reuses a recorded
 * identity of any version verbatim, and reports the directory later knowledge
 * commands read.
 *
 * Freezing is a WRITE, and only the `codify` branch ever reads what it writes:
 * `report` writes a retrospective, and `off` is a successful no-op that changes
 * no learning state. So preparation writes only when a mode it is about to
 * report can reach that branch — the effective mode for a standalone
 * invocation, or a mode already frozen in run-state for a canonical `retain`
 * stage. It cannot see which caller it has, so either one being `codify` opens
 * the write and neither being it closes it entirely: nothing is resolved,
 * nothing is validated, nothing is written. Otherwise a change that never ran
 * would be left holding run-state no run produced — reported as present by
 * `pipeline resume` and the board — and an identity frozen permanently, at the
 * version of the day it was frozen, for a branch that never reads it.
 *
 * Two independent selectors, because they answer two different questions and
 * they are not the same namespace (ADR-2):
 *   - `--store`/`--project` select the PLANNING ROOT, exactly like `rasen
 *     pipeline resume`, so the store-threading guidance the retention workflow
 *     already documents works verbatim. `--project` there names a project
 *     registered via `store add-project`.
 *   - `--owner-store`/`--owner-project` select the KNOWLEDGE OWNER, exactly like
 *     the `rasen knowledge` group — independently from the planning root, and
 *     addressable for any project identity. An owner selector that disagrees
 *     with an already-frozen identity is refused rather than retargeting the
 *     record.
 *
 * Every refusal carries both an English message and the catalog key that renders
 * it: `--json` reports the English string, because a caller parses that payload,
 * and the human line is rendered in the caller's locale at report time.
 */

import * as path from 'node:path';

import { Command, Option } from 'commander';

import { getGlobalConfig } from '../core/global-config.js';
import {
  freezeKnowledgeContext,
  isKnowledgeContextError,
  resolveLearnedSkillExecutionContext,
  type FrozenKnowledgeContext,
  type LearnedSkillExecutionContext,
} from '../core/learned-skills/index.js';
import { describeDurableOwner } from '../core/learned-skills/owner-identity.js';
import {
  RUN_STATE_FILENAME,
  createRunStateExclusive,
  readRunStateDetailed,
  resolveRunStateLocation,
  runStatePath,
  updateRunStateKnowledgeContext,
  type RunStateContextUpdateResult,
} from '../core/pipeline-registry/index.js';
import { resolveChangeWorkDir } from '../core/change-work.js';
import { ephemeraDir, resolveExecutionRoot } from '../core/file-placement.js';
import {
  isRootSelectionError,
  isStoreSelectedRoot,
  resolveRootForCommand,
  type ResolvedOpenSpecRoot,
} from '../core/root-selection.js';
import {
  isSessionContextError,
  requireSessionRuntimeContext,
} from '../core/session-runtime-context.js';
import { pathsEqualForPlatform } from '../core/work-migration.js';
import { FileSystemUtils } from '../utils/file-system.js';
import { formatPipelineRootSelectionNotice } from './pipeline-messages.js';
import { resolveCurrentProfileState } from './profile-editor.js';
import { getRetainMessages, type RetainMessages } from './retain-messages.js';
import { asErrorMessage, printJson } from './shared-output.js';
import { validateChangeExists } from './workflow/shared.js';

export interface RetainPrepareOptions {
  json?: boolean;
  /** Planning-root selector (lifecycle namespace), as on `pipeline resume`. */
  store?: string;
  project?: string;
  storePath?: string;
  /** Knowledge-owner selector (knowledge namespace), independent of the above. */
  ownerStore?: string;
  ownerProject?: string;
}

/** Preparation refusals Rasen owns, distinct from a knowledge diagnostic. */
type RetainPrepareErrorCode =
  | 'retention_run_state_invalid'
  | 'retention_planning_root_mismatch'
  | 'retention_context_write_failed'
  | 'retention_owner_selector_conflict';

/**
 * The localizable rendering of a refusal: a catalog key plus its format values.
 * Carried alongside the pre-formatted English `message` so the two surfaces can
 * diverge — the JSON payload reports the English string (a machine contract must
 * not shift with the caller's locale), the human line is rendered on demand.
 */
type RetainRefusalMessage =
  | { key: 'invalidRunState'; values: { path: string; reason: string } }
  | { key: 'planningRootMismatch'; values: { changeRoot: string; identityRoot: string } }
  | { key: 'writeRefused'; values: { path: string; reason: string } }
  | { key: 'ownerSelectorConflict' };

class RetainPrepareError extends Error {
  constructor(
    readonly code: RetainPrepareErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {},
    /**
     * Absent for a refusal whose wording is a literal rather than a catalog
     * entry; `reportRetainError` then falls back to the English `message`.
     */
    readonly refusal?: RetainRefusalMessage
  ) {
    super(message);
    this.name = 'RetainPrepareError';
  }
}

/** Renders a refusal from one locale's catalog. */
function formatRefusal(refusal: RetainRefusalMessage, messages: RetainMessages): string {
  switch (refusal.key) {
    case 'invalidRunState':
      return messages.format('invalidRunState', refusal.values);
    case 'planningRootMismatch':
      return messages.format('planningRootMismatch', refusal.values);
    case 'writeRefused':
      return messages.format('writeRefused', refusal.values);
    case 'ownerSelectorConflict':
      return messages.format('ownerSelectorConflict');
  }
}

/**
 * Builds a refusal whose English message and localizable payload are rendered
 * from the same catalog entry, so the JSON and human surfaces can never drift.
 */
function retainRefusal(
  code: RetainPrepareErrorCode,
  refusal: RetainRefusalMessage,
  details: Record<string, unknown> = {}
): RetainPrepareError {
  return new RetainPrepareError(
    code,
    formatRefusal(refusal, getRetainMessages('en')),
    details,
    refusal
  );
}

/**
 * One refusal for every way recording a knowledge context can fail: a run-state
 * the updater declined to touch and a filesystem that rejected the write alike.
 * A retention worker is instructed to report the condition preparation named, so
 * an EACCES or ENOSPC has to arrive as `retention_context_write_failed` with the
 * path it failed at — not as a bare errno under the generic `retain_error`.
 */
function contextWriteFailed(runStateFile: string, reason: string): RetainPrepareError {
  return retainRefusal(
    'retention_context_write_failed',
    { key: 'writeRefused', values: { path: runStateFile, reason } },
    { runStatePath: runStateFile, reason }
  );
}

/**
 * Records the frozen context into an existing run-state. The updater reports a
 * refusal as a result and propagates a filesystem failure as a thrown error, so
 * both are funnelled into the one refusal a retention worker can act on.
 */
function updateRecordedContext(
  runStateDir: string,
  runStateFile: string,
  knowledgeContext: FrozenKnowledgeContext
): RunStateContextUpdateResult {
  try {
    return updateRunStateKnowledgeContext(runStateDir, knowledgeContext);
  } catch (error) {
    throw contextWriteFailed(runStateFile, asErrorMessage(error));
  }
}

/**
 * This command's knowledge-owner selectors, and the shared resolver's wording
 * for them.
 *
 * The resolver tells a caller to `Pass --project <id> or --store <id>`, which is
 * right for `rasen knowledge` — there those ARE the owner selectors. Here they
 * are not: `--store`/`--project` select the planning root (ADR-2), so a user who
 * follows that wording verbatim cannot resolve an ownership refusal with it.
 * Preparation is required to report the condition that blocked it, so its
 * remediation is retargeted at `--owner-project`/`--owner-store` on the way out.
 */
const OWNER_SELECTOR_GUIDANCE = ['--owner-project <id>', '--owner-store <id>'];
const RESOLVER_SELECTOR_WORDING = /--project <id> or --store <id>/g;

/**
 * Canonicalizes a root for comparison, falling back to a plain resolve for a
 * path that does not exist on disk — the same tolerance the knowledge context
 * resolver applies, so the two never disagree about whether two roots are one.
 */
function canonical(target: string): string {
  try {
    return FileSystemUtils.canonicalizeExistingPath(target);
  } catch {
    return path.resolve(target);
  }
}

/** A frozen owner and planning root as readable tokens, for any record version. */
function describeFrozen(frozen: FrozenKnowledgeContext): { owner: string; planningRoot: string } {
  if (frozen.version === 3) {
    return {
      owner: describeDurableOwner(frozen.owner),
      planningRoot: describeDurableOwner(frozen.planningRoot),
    };
  }
  const owner = frozen.owner;
  return {
    owner: owner.type === 'global' ? 'global' : `${owner.type}:${owner.id}`,
    planningRoot: `${frozen.planningRoot.type}:${frozen.planningRoot.id}`,
  };
}

/**
 * The lines every successful preparation reports: the change, the mode(s) that
 * govern it, and the pipeline. What follows them differs — a frozen identity,
 * or the statement that none was frozen — so only the shared head lives here.
 */
function reportPreparationPreamble(
  messages: RetainMessages,
  base: {
    change: string;
    retention: string;
    frozenRetention?: string;
    pipeline: string | null;
  }
): void {
  console.log(messages.format('changeLabel', { change: base.change }));
  console.log(messages.format('retentionMode', { mode: base.retention }));
  if (base.frozenRetention) {
    console.log(messages.format('frozenRetentionMode', { mode: base.frozenRetention }));
  }
  console.log(
    base.pipeline
      ? messages.format('pipelineLabel', { pipeline: base.pipeline })
      : messages.format('noPipeline')
  );
}

export class RetainCommand {
  /**
   * Prepare one change for a retention run: report the effective retention
   * mode, freeze or reuse durable knowledge identity, and report the run-state
   * directory later knowledge commands read it from.
   */
  async prepare(change: string, options: RetainPrepareOptions = {}): Promise<void> {
    if (options.ownerStore !== undefined && options.ownerProject !== undefined) {
      throw retainRefusal(
        'retention_owner_selector_conflict',
        { key: 'ownerSelectorConflict' },
        { selectorGuidance: ['--owner-project <id>', '--owner-store <id>'] }
      );
    }
    const root = await this.resolveRoot(options);
    if (!root) return;
    const projectRoot = root.path;
    const changeName = await validateChangeExists(change, projectRoot, root.changesDir);
    const changeDir = path.join(root.changesDir, changeName);

    // Probe-only: locating existing state must not mint a work directory for a
    // change that has none (the same contract `pipeline resume` holds).
    const workDir = await resolveChangeWorkDir(projectRoot, changeName, { ensure: false });
    const executionRoot = resolveExecutionRoot(projectRoot, {
      storeSelected: isStoreSelectedRoot(root),
    });
    const deterministicDir = ephemeraDir(executionRoot, changeName);

    // Sticky-legacy (`file-placement`): state that already lives at a legacy
    // location keeps living there; new state is born in the ephemera directory.
    const existingLocation = resolveRunStateLocation(changeDir, {
      ephemeraDir: deterministicDir,
      workDir,
    });
    const runStateDir = existingLocation?.dir ?? deterministicDir;

    const existingRead = existingLocation
      ? readRunStateDetailed(existingLocation.dir)
      : ({ kind: 'absent' } as const);
    if (existingRead.kind === 'invalid') {
      // Fail closed: an unreadable run-state cannot be trusted to say whether
      // identity is already frozen, and overwriting it would destroy a record
      // this command is supposed to preserve.
      throw retainRefusal(
        'retention_run_state_invalid',
        {
          key: 'invalidRunState',
          values: { path: existingLocation!.path, reason: existingRead.reason },
        },
        { runStatePath: existingLocation!.path, reason: existingRead.reason }
      );
    }

    const recorded = existingRead.kind === 'ok' ? existingRead.state.knowledgeContext : undefined;
    const pipeline = existingRead.kind === 'ok' ? existingRead.state.pipeline : undefined;
    const frozenRetention = existingRead.kind === 'ok' ? existingRead.state.retention : undefined;

    // The effective mode — the same resolution `knowledge apply` authorizes a
    // project-scoped lesson with — never the raw stored value, which reports
    // nothing at all when no `retention` key was ever written.
    const retention = resolveCurrentProfileState(getGlobalConfig()).retention;

    // Everything reportable before identity is resolved. The skip branch below
    // reports exactly this and nothing more, because it resolves nothing.
    const base = {
      ok: true as const,
      change: changeName,
      retention,
      ...(frozenRetention ? { frozenRetention } : {}),
      runStateDir,
      runStatePath: runStatePath(runStateDir),
      pipeline: pipeline ?? null,
    };

    // Only `codify` reads a frozen identity, so only `codify` is worth writing
    // one for. `frozenRetention` counts too: a worker dispatched for a canonical
    // `retain` stage uses the mode the LEAD froze rather than the current
    // profile, and preparation cannot tell that caller from a standalone one —
    // so either mode being `codify` opens the write, and neither being it makes
    // this command inert. `runStateDir` is still reported: it is where durable
    // state WOULD live (design D2), not a claim that anything lives there.
    if (retention !== 'codify' && frozenRetention !== 'codify') {
      if (options.json) {
        printJson({ ...base, contextSource: 'skipped' as const });
        return;
      }
      const skippedMessages = getRetainMessages();
      reportPreparationPreamble(skippedMessages, base);
      console.log(skippedMessages.format('contextSkipped', { mode: retention }));
      console.log(skippedMessages.format('runStateDir', { path: runStateDir }));
      return;
    }

    const sessionContext = requireSessionRuntimeContext();
    const selector = {
      ...(options.ownerProject !== undefined ? { project: options.ownerProject } : {}),
      ...(options.ownerStore !== undefined ? { store: options.ownerStore } : {}),
    };
    // Resolved from the working directory, exactly like every `rasen knowledge`
    // command — NOT from the selected planning root. The resolver derives BOTH
    // "where does planning live" and "whose knowledge is this" from one
    // directory, so handing it a store root would answer the second question
    // with "launched directly from a store", which identifies no member project
    // and refuses a case that resolves correctly from the member's own checkout.
    //
    // A recorded context is passed as `frozen`: it makes the resolution
    // revalidate the identity already on record (and refuse an owner selector
    // that disagrees with it) instead of resolving a second, possibly different
    // one.
    const context = await resolveLearnedSkillExecutionContext({
      launchDirectory: process.cwd(),
      selector,
      requestedScope: 'mixed',
      // Threaded rather than left to the resolver's own read: it would otherwise
      // read the session context a second time, and a relay that rewrote the
      // file in between would freeze an execution ref from one session beside an
      // owner resolved from another.
      sessionContext: sessionContext ?? null,
      ...(recorded ? { frozen: recorded } : {}),
    });

    const identityRoot = context.planningRoot?.root;
    if (
      identityRoot !== undefined &&
      !pathsEqualForPlatform(canonical(identityRoot), canonical(projectRoot))
    ) {
      // The change was read from one planning root and identity resolves to
      // another. Freezing that identity is the exact misroute this capability
      // exists to prevent, so it stops here — before any candidate, before any
      // write — rather than silently preferring one of the two roots.
      throw retainRefusal(
        'retention_planning_root_mismatch',
        { key: 'planningRootMismatch', values: { changeRoot: projectRoot, identityRoot } },
        { changeRoot: projectRoot, identityRoot }
      );
    }

    let knowledgeContext: FrozenKnowledgeContext;
    let contextSource: 'recorded' | 'prepared';
    if (recorded) {
      // Authoritative as written, at ANY version: reported back unchanged and
      // never upgraded in place, so a repeated run is a no-op on disk.
      knowledgeContext = recorded;
      contextSource = 'recorded';
    } else {
      knowledgeContext = freezeKnowledgeContext(
        context,
        sessionContext ? sessionContext.execution : undefined
      );
      contextSource = 'prepared';

      // Where the context is recorded, or `undefined` once it has been written
      // into a record this call created.
      let mergeInto = existingLocation?.path;
      if (mergeInto === undefined) {
        // A change with no run-state at all gets a minimal record that names no
        // pipeline: it never ran one, and claiming one would freeze a pipeline
        // that was not active during the original run.
        //
        // The create is EXCLUSIVE because identity resolution above is async: a
        // LEAD's first hand-write, or a second preparation, can seed this exact
        // path inside that window. Replacing it would destroy that run's
        // pipeline name and every stage record, and leave a file no reader could
        // tell apart from a legitimately retention-only one — so a record that
        // appeared meanwhile is merged into, exactly like one found up front.
        let created;
        try {
          created = createRunStateExclusive(runStateDir, { knowledgeContext });
        } catch (error) {
          throw contextWriteFailed(runStatePath(runStateDir), asErrorMessage(error));
        }
        if (created.kind === 'exists') mergeInto = created.path;
      }
      if (mergeInto !== undefined) {
        const update = updateRecordedContext(runStateDir, mergeInto, knowledgeContext);
        if (update.kind === 'already-recorded') {
          knowledgeContext = update.context;
          contextSource = 'recorded';
        } else if (update.kind !== 'written') {
          const reason =
            update.kind === 'invalid' ? update.reason : `no ${RUN_STATE_FILENAME} found`;
          throw contextWriteFailed(mergeInto, reason);
        }
      }
    }

    const described = describeFrozen(knowledgeContext);
    const result = {
      ...base,
      contextSource,
      knowledgeContext,
      owner: described.owner,
      planningRoot: described.planningRoot,
    };

    if (options.json) {
      printJson(result);
      return;
    }

    const messages = getRetainMessages();
    reportPreparationPreamble(messages, base);
    console.log(messages.format('ownerLabel', { owner: described.owner }));
    console.log(messages.format('planningRootLabel', { planningRoot: described.planningRoot }));
    console.log(
      contextSource === 'recorded'
        ? messages.format('contextReused', { version: knowledgeContext.version })
        : messages.format('contextPrepared', { version: knowledgeContext.version })
    );
    console.log(messages.format('runStateDir', { path: runStateDir }));
    console.log(messages.format('nextApply', { path: runStateDir }));
  }

  private async resolveRoot(
    options: RetainPrepareOptions
  ): Promise<ResolvedOpenSpecRoot | null> {
    if (options.json) {
      // A root-selection refusal keeps the `status: [diagnostic]` shape every
      // store-aware command emits, so a caller reads one form of it everywhere —
      // but it carries `ok: false` too, because a retain refusal is otherwise
      // always `{ ok: false, error: … }` and `--store-path` is registered here
      // precisely to be refused. Without it a worker parsing this command's
      // output would find neither `ok` nor `error` on a rejection path the
      // command deliberately owns.
      return resolveRootForCommand(options, {
        json: true,
        reporter: false,
        failurePayload: { ok: false },
      });
    }
    return resolveRootForCommand(options, {
      reporter: (notice) => console.error(formatPipelineRootSelectionNotice(notice)),
    });
  }
}

/**
 * Runs a retain action, mapping every refusal to one machine-readable shape.
 * A knowledge diagnostic keeps its own code and detail so the caller sees which
 * ownership condition blocked preparation, not a generic failure.
 *
 * The two surfaces are deliberately split, as in the pipeline group: the JSON
 * payload always reports the English message, because it is a machine contract,
 * while the human line is rendered in the caller's locale from the message key a
 * refusal carries.
 */
export async function runRetainAction(
  action: () => Promise<void>,
  json?: boolean
): Promise<void> {
  try {
    await action();
  } catch (error) {
    if (error instanceof RetainPrepareError) {
      reportRetainError(json, error.message, error.code, error.details, error.refusal);
      return;
    }
    if (isKnowledgeContextError(error)) {
      const { code, message, ...details } = error.diagnostic;
      // Ownership remediation names THIS command's owner flags, not the planning
      // ones the shared resolver's wording carries (ADR-2).
      reportRetainError(
        json,
        message.replace(
          RESOLVER_SELECTOR_WORDING,
          `${OWNER_SELECTOR_GUIDANCE[0]} or ${OWNER_SELECTOR_GUIDANCE[1]}`
        ),
        code,
        details.selectorGuidance === undefined
          ? details
          : { ...details, selectorGuidance: [...OWNER_SELECTOR_GUIDANCE] }
      );
      return;
    }
    if (isRootSelectionError(error)) {
      const { code, message, ...details } = error.diagnostic;
      reportRetainError(json, message, code, details);
      return;
    }
    if (isSessionContextError(error)) {
      reportRetainError(json, asErrorMessage(error), 'session_context_broken');
      return;
    }
    reportRetainError(json, asErrorMessage(error), 'retain_error');
  }
}

function reportRetainError(
  json: boolean | undefined,
  message: string,
  code: string,
  details: Record<string, unknown> = {},
  refusal?: RetainRefusalMessage
): void {
  if (json) {
    printJson({ ok: false, error: { code, message, ...details } });
  } else {
    // A refusal without a catalog key (a literal, or a core diagnostic passed
    // through as data) falls back to the message it already carries.
    console.error(
      `Error: ${refusal ? formatRefusal(refusal, getRetainMessages()) : message}`
    );
  }
  process.exitCode = 1;
}

export function registerRetainCommand(program: Command): void {
  const retain = program.command('retain').description('');

  retain
    .command('prepare <change>')
    .description('')
    .option('--json', '')
    .option('--store <id>', '')
    .option('--project <id>', '')
    .option('--owner-store <id>', '')
    .option('--owner-project <id>', '')
    // Deliberate rejection path, matching the pipeline group: --store-path stays
    // registered (hidden) so the resolver can explain that registering the path
    // is the supported route, instead of a generic unknown-option error.
    .addOption(new Option('--store-path <path>', '').hideHelp())
    .action(async (change: string, options: RetainPrepareOptions = {}) => {
      await runRetainAction(() => new RetainCommand().prepare(change, options), options.json);
    });
}
