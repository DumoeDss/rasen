/**
 * Agent Command
 *
 * Introspect an agent's own runtime state. Currently one subcommand:
 *   - context : report the context-window occupancy of a transcript from its
 *               recorded API usage (no estimation), so an agent can decide when
 *               to hand off before compaction degrades it.
 *
 * A thin consumer of `src/core/agent-context.ts`; all sensing logic lives there.
 */

import {
  probeAgentContext,
  resolveHandoffThresholdReport,
  type AgentContextResult,
  type HandoffThresholdReport,
} from '../core/agent-context.js';

export interface AgentContextOptions {
  transcript?: string;
  latest?: boolean;
  dir?: string;
  limit?: number;
  runtime?: string;
  json?: boolean;
}

export class AgentCommand {
  /**
   * Probe context-window occupancy. Prints a single line (or `--json`) and
   * returns exit 0 even above thresholds — it is a probe, not a gate. The
   * caller (CLI) maps a thrown error to a non-zero exit; the only failure modes
   * are a missing/unreadable/usage-free transcript.
   */
  async context(options: AgentContextOptions = {}): Promise<void> {
    const result = probeAgentContext({
      transcript: options.transcript,
      latest: options.latest,
      dir: options.dir,
      limit: options.limit,
      runtime: options.runtime,
    });
    const handoff = resolveHandoffThresholdReport(result.pct);

    if (options.json) {
      console.log(JSON.stringify(this.toJson(result, handoff)));
      return;
    }

    const pctDisplay = (result.pct * 100).toFixed(1);
    const thresholdDisplay = (handoff.threshold * 100).toFixed(0);
    const handoffVerdict = handoff.shouldHandoff
      ? `handoff recommended (>= ${thresholdDisplay}%, ${handoff.thresholdSource})`
      : `handoff not yet needed (< ${thresholdDisplay}%, ${handoff.thresholdSource})`;
    console.log(
      `model=${result.model} context=${result.contextTokens}/${result.limit} (${pctDisplay}%) transcript=${result.transcript} ${handoffVerdict}`
    );
  }

  private toJson(
    result: AgentContextResult,
    handoff: HandoffThresholdReport
  ): {
    model: string;
    contextTokens: number;
    limit: number;
    pct: number;
    transcript: string;
    threshold: number;
    thresholdSource: string;
    shouldHandoff: boolean;
  } {
    return {
      model: result.model,
      contextTokens: result.contextTokens,
      limit: result.limit,
      pct: result.pct,
      transcript: result.transcript,
      threshold: handoff.threshold,
      thresholdSource: handoff.thresholdSource,
      shouldHandoff: handoff.shouldHandoff,
    };
  }
}
