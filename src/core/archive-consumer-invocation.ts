import type {
  ArchiveHandoffDecision,
  ArchiveIntentV1,
  ArchiveProbeDecision,
} from './archive-engine.js';
import { resolveFinalizationOutcomeRequest } from './store/finalization/outcome.js';

export type GeneratedArchiveConsumer = 'single' | 'bulk' | 'in-ship';

/**
 * The Store v2 finalization half of a generated invocation. Present only when
 * the consumer resolved a `store-project` scope; a standalone project and a
 * legacy flat Store carry none and archive exactly as before.
 *
 * Every field is validated through the SAME pure request resolver the CLI runs,
 * so a generated argv array can never express an outcome combination the
 * command would refuse — and there is no second outcome parser.
 */
export interface GeneratedArchiveFinalizationInput {
  outcome: string;
  reason?: string;
  by?: string;
  byTargetLine?: string;
  commit?: string;
}

export interface GeneratedArchiveConsumerArgvInput {
  change: string;
  selector?: readonly string[];
  intentPath?: string;
  planToken: string;
  skipSpecs?: boolean;
  /**
   * Threaded into `savedPreview` only. `apply` consumes the plan token alone,
   * so a stored plan's recorded outcome can never be re-decided at apply time.
   */
  finalization?: GeneratedArchiveFinalizationInput;
}

export interface GeneratedArchiveConsumerArgv {
  consumer: GeneratedArchiveConsumer;
  intentTemplate: string[];
  savedPreview: string[];
  apply: string[];
  abort: string[];
}

export interface GeneratedArchiveIntentInput {
  handoffOutcomes?: Readonly<
    Record<string, ArchiveHandoffDecision['outcome']>
  >;
  probes?: readonly ArchiveProbeDecision[];
}

export const GENERATED_ARCHIVE_COMMAND_EXAMPLES = {
  intentTemplate: 'rasen archive "<name>" --intent-template --json',
  savedPreview:
    'rasen archive "<name>" --intent-file "<intent-path>" --dry-run --save-plan --json',
  apply: 'rasen archive --apply-plan "<planToken>" --json --yes',
  abort: 'rasen archive --abort-plan "<planToken>" --json --yes',
  /** The Store v2 preview, which additionally declares its one terminal state. */
  storeFinalizationPreview:
    'rasen archive "<name>" --intent-file "<intent-path>" --outcome <landed|superseded|cancelled|abandoned> --dry-run --save-plan --json',
} as const;

/**
 * The finalization options in their fixed order, validated first. `--outcome`
 * carries the terminal state; the rest are only ever the reason, the successor,
 * the search filter, or the candidate commit that outcome permits.
 */
function finalizationArgv(
  input: GeneratedArchiveConsumerArgvInput,
  consumer: GeneratedArchiveConsumer
): string[] {
  const finalization = input.finalization;
  if (finalization === undefined) return [];
  // The in-ship archive records that the delivered work LANDED. Delivery is not
  // itself the proof — the CLI still proves reachability — but no other terminal
  // state may be reached from a ship, so a mistyped outcome is refused here
  // rather than filed.
  if (consumer === 'in-ship' && finalization.outcome !== 'landed') {
    throw new Error(
      `The in-ship archive finalizes as 'landed' and nothing else; received '${finalization.outcome}'. Finalize a non-landed outcome with 'rasen archive <change> --outcome ${finalization.outcome} --reason "<why>"' instead of shipping it.`
    );
  }
  // One resolver, shared with the command: an argv array a consumer builds can
  // never express a combination the CLI would refuse.
  const resolved = resolveFinalizationOutcomeRequest({
    outcome: finalization.outcome,
    ...(finalization.reason === undefined ? {} : { reason: finalization.reason }),
    ...(finalization.by === undefined ? {} : { by: finalization.by }),
    ...(finalization.byTargetLine === undefined
      ? {}
      : { byTargetLine: finalization.byTargetLine }),
    ...(finalization.commit === undefined ? {} : { commit: finalization.commit }),
  });
  return [
    '--outcome',
    resolved.outcome,
    ...(resolved.reason === null ? [] : ['--reason', resolved.reason]),
    ...(resolved.supersededBy === null ? [] : ['--by', resolved.supersededBy]),
    ...(resolved.byTargetLine === null
      ? []
      : ['--by-target-line', resolved.byTargetLine]),
    ...(resolved.commit === null ? [] : ['--commit', resolved.commit]),
  ];
}

/**
 * Executable generated-consumer boundary. Templates render the command examples
 * above, while integration tests execute these exact machine argv arrays
 * through the real Commander program.
 */
export function createGeneratedArchiveConsumerArgv(
  consumer: GeneratedArchiveConsumer,
  input: GeneratedArchiveConsumerArgvInput
): GeneratedArchiveConsumerArgv {
  const selector = [...(input.selector ?? [])];
  const finalization = finalizationArgv(input, consumer);
  return {
    consumer,
    intentTemplate: [
      'archive',
      input.change,
      ...selector,
      '--intent-template',
      '--json',
    ],
    savedPreview: [
      'archive',
      input.change,
      ...selector,
      ...(input.intentPath ? ['--intent-file', input.intentPath] : []),
      ...(input.skipSpecs ? ['--skip-specs'] : []),
      ...finalization,
      '--dry-run',
      '--save-plan',
      '--json',
    ],
    // Deliberately unchanged: the token alone. The stored plan already carries
    // the recorded outcome, so apply cannot re-decide it.
    apply: [
      'archive',
      '--apply-plan',
      input.planToken,
      '--json',
      '--yes',
    ],
    abort: [
      'archive',
      '--abort-plan',
      input.planToken,
      '--json',
      '--yes',
    ],
  };
}

export interface GeneratedArchiveBatchMember {
  change: string;
  selector?: readonly string[];
  intentPath?: string;
  planToken: string;
  skipSpecs?: boolean;
  finalization?: GeneratedArchiveFinalizationInput;
}

/**
 * The bulk consumer's whole-batch boundary. In a Store v2 project scope every
 * member carries its OWN declared outcome: nothing is inferred from a sibling,
 * nothing is reused, and nothing is defaulted. A batch with any member missing
 * one is refused AS A WHOLE, naming every such member, so a partial batch can
 * never be filed and the operator sees the complete list in one pass.
 */
export function createGeneratedArchiveBatchArgv(
  members: readonly GeneratedArchiveBatchMember[],
  options: { readonly requireFinalization: boolean }
): GeneratedArchiveConsumerArgv[] {
  if (options.requireFinalization) {
    const undeclared = members
      .filter(member => member.finalization === undefined)
      .map(member => member.change);
    if (undeclared.length > 0) {
      throw new Error(
        `A Store v2 bulk archive finalizes every change in the batch, and each one declares its own outcome. ${undeclared.length} of ${members.length} declare none: ${undeclared.join(', ')}. The whole batch is refused; an outcome is never inferred from a sibling, reused, or defaulted.`
      );
    }
  }
  return members.map(member =>
    createGeneratedArchiveConsumerArgv('bulk', {
      change: member.change,
      ...(member.selector === undefined ? {} : { selector: member.selector }),
      ...(member.intentPath === undefined ? {} : { intentPath: member.intentPath }),
      planToken: member.planToken,
      ...(member.skipSpecs === undefined ? {} : { skipSpecs: member.skipSpecs }),
      ...(member.finalization === undefined
        ? {}
        : { finalization: member.finalization }),
    })
  );
}

/**
 * Consumer-owned completion seam for the intent emitted by
 * `--intent-template`. It preserves the exact discovered inventory and only
 * supplies explicit outcomes and probe facts.
 */
export function completeGeneratedArchiveIntent(
  template: ArchiveIntentV1,
  input: GeneratedArchiveIntentInput = {}
): ArchiveIntentV1 {
  const inventory = new Set(
    template.handoff.decisions.map(decision => decision.path)
  );
  for (const candidate of Object.keys(input.handoffOutcomes ?? {})) {
    if (!inventory.has(candidate)) {
      throw new Error(
        `Generated archive intent outcome is outside the handoff inventory: ${candidate}`
      );
    }
  }
  return {
    schemaVersion: 1,
    change: template.change,
    handoff: {
      complete: true,
      decisions: template.handoff.decisions.map(decision => ({
        path: decision.path,
        outcome:
          input.handoffOutcomes?.[decision.path] ?? decision.outcome,
      })),
    },
    probes: (input.probes ?? []).map(probe => ({ ...probe })),
  };
}
