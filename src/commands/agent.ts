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

import { probeAgentContext, type AgentContextResult } from '../core/agent-context.js';

export interface AgentContextOptions {
  transcript?: string;
  latest?: boolean;
  dir?: string;
  limit?: number;
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
    });

    if (options.json) {
      console.log(JSON.stringify(this.toJson(result)));
      return;
    }

    const pctDisplay = (result.pct * 100).toFixed(1);
    console.log(
      `model=${result.model} context=${result.contextTokens}/${result.limit} (${pctDisplay}%) transcript=${result.transcript}`
    );
  }

  private toJson(result: AgentContextResult): {
    model: string;
    contextTokens: number;
    limit: number;
    pct: number;
    transcript: string;
  } {
    return {
      model: result.model,
      contextTokens: result.contextTokens,
      limit: result.limit,
      pct: result.pct,
      transcript: result.transcript,
    };
  }
}
