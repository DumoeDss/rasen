import type {
  ArchiveHandoffDecision,
  ArchiveIntentV1,
  ArchiveProbeDecision,
} from './archive-engine.js';

export type GeneratedArchiveConsumer = 'single' | 'bulk' | 'in-ship';

export interface GeneratedArchiveConsumerArgvInput {
  change: string;
  selector?: readonly string[];
  intentPath?: string;
  planToken: string;
  skipSpecs?: boolean;
}

export interface GeneratedArchiveConsumerArgv {
  consumer: GeneratedArchiveConsumer;
  intentTemplate: string[];
  savedPreview: string[];
  apply: string[];
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
} as const;

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
      '--dry-run',
      '--save-plan',
      '--json',
    ],
    apply: [
      'archive',
      '--apply-plan',
      input.planToken,
      '--json',
      '--yes',
    ],
  };
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
