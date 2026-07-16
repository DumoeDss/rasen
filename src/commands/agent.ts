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
  probeAgentContextSafe,
  resolveHandoffThresholdReport,
  type AgentContextResult,
  type HandoffThresholdReport,
} from '../core/agent-context.js';
import type { ThresholdValue } from '../core/pipeline-registry/types.js';

/** Human-readable rendering of a dual-form threshold for the text-mode verdict line. */
function formatThresholdDisplay(threshold: ThresholdValue): string {
  return typeof threshold === 'number'
    ? `${(threshold * 100).toFixed(0)}%`
    : `${threshold.remainingTokens} remaining`;
}

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
   * caller (CLI) maps a thrown error to a non-zero exit; the surviving failure
   * modes are input errors (invalid `--runtime`/`--limit`, no source flag, an
   * explicit `--transcript` that is missing/unreadable/usage-free).
   *
   * Environmental absence under `--latest` (no Claude projects directory / no
   * main-session transcript — a non-Claude host's normal state, e.g. a Codex
   * CLI LEAD) does NOT throw: it degrades gracefully, exit 0, because the
   * probe is a non-blocking pre-flight for any host (design D2).
   */
  async context(options: AgentContextOptions = {}): Promise<void> {
    const result = probeAgentContextSafe({
      transcript: options.transcript,
      latest: options.latest,
      dir: options.dir,
      limit: options.limit,
      runtime: options.runtime,
    });
    if (!result.available) {
      if (options.json) {
        console.log(JSON.stringify({ available: false, reason: result.reason, detail: result.detail }));
      } else {
        console.log(`context unavailable: ${result.detail}`);
      }
      return;
    }

    const handoff = resolveHandoffThresholdReport(result.pct, result.remainingTokens);

    if (options.json) {
      console.log(JSON.stringify(this.toJson(result, handoff)));
      return;
    }

    const pctDisplay = (result.pct * 100).toFixed(1);
    const thresholdDisplay = formatThresholdDisplay(handoff.threshold);
    const comparator = typeof handoff.threshold === 'number' ? '>=' : 'remaining <=';
    const handoffVerdict = handoff.shouldHandoff
      ? `handoff recommended (${comparator} ${thresholdDisplay}, ${handoff.thresholdSource})`
      : `handoff not yet needed (${comparator} ${thresholdDisplay} not met, ${handoff.thresholdSource})`;
    console.log(
      `model=${result.model} context=${result.contextTokens}/${result.limit} (${pctDisplay}%) remaining=${result.remainingTokens} transcript=${result.transcript} ${handoffVerdict}`
    );
  }

  private toJson(
    result: AgentContextResult,
    handoff: HandoffThresholdReport
  ): {
    available: true;
    model: string;
    contextTokens: number;
    limit: number;
    pct: number;
    remainingTokens: number;
    transcript: string;
    threshold: ThresholdValue;
    thresholdSource: string;
    shouldHandoff: boolean;
  } {
    return {
      available: true,
      model: result.model,
      contextTokens: result.contextTokens,
      limit: result.limit,
      pct: result.pct,
      remainingTokens: result.remainingTokens,
      transcript: result.transcript,
      threshold: handoff.threshold,
      thresholdSource: handoff.thresholdSource,
      shouldHandoff: handoff.shouldHandoff,
    };
  }
}
