/**
 * Agent Command
 *
 * Introspect an agent's own runtime state. Subcommands:
 *   - context : report the context-window occupancy of a transcript from its
 *               recorded API usage (no estimation), so an agent can decide when
 *               to hand off before compaction degrades it.
 *   - wait    : one cache-keepalive beat for a parked pipeline worker — a
 *               bounded blocking poll of the change's role signal file, with
 *               a persistent beat cap and runtime gating (cli-agent-wait spec).
 *
 * A thin consumer of `src/core/agent-context.ts` and `src/core/keepalive/`;
 * all sensing/protocol logic lives there.
 */

import * as fs from 'fs';

import {
  probeAgentContextSafe,
  resolveHandoffThresholdReport,
  type AgentContextResult,
  type HandoffThresholdReport,
} from '../core/agent-context.js';
import {
  DEFAULT_BEAT_SECONDS,
  MAX_BEAT_SECONDS,
  POLL_INTERVAL_MS,
  clearBeatState,
  consumeSignal,
  detectAgentRuntime,
  isRuntimeGated,
  isValidRoleKey,
  loadBeatState,
  readSignal,
  resolveKeepaliveConfig,
  resolveRoleCap,
  saveBeatState,
  signalsDir,
  type KeepaliveConfigInput,
} from '../core/keepalive/index.js';
import { getGlobalConfig } from '../core/global-config.js';
import { getChangeDir, resolveCurrentPlanningHomeSync } from '../core/planning-home.js';
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

export interface AgentWaitOptions {
  change: string;
  role: string;
  maxBeats?: number;
  contextTokens?: number;
  beatSeconds?: number;
}

/** Every wait outcome is a single JSON object on stdout, exit 0 (design D-4). */
type AgentWaitOutcome =
  | { beat: number; remaining: number }
  | { resumed: true; instruction?: string }
  | { standDown: true; reason: 'runtime-not-gated' | 'context-below-floor' | 'beat-cap' | 'lead-stand-down' };

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

    const handoff = await resolveHandoffThresholdReport(result.pct, result.remainingTokens);

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

  /**
   * One keepalive beat (cli-agent-wait spec). Gate checks run first and
   * return immediately without blocking or touching beat state; a live beat
   * polls the role's signal file until hit or timeout. Every outcome exits 0
   * with one JSON object on stdout — only input errors (bad flags, missing
   * change) throw, which the CLI maps to exit 1.
   */
  async wait(options: AgentWaitOptions): Promise<void> {
    if (!options.change?.trim()) throw new Error('--change is required');
    const roleKey = options.role?.trim() ?? '';
    if (!isValidRoleKey(roleKey)) {
      throw new Error('--role must be a short identifier (letters, digits, hyphen, underscore)');
    }
    if (options.maxBeats !== undefined && (!Number.isInteger(options.maxBeats) || options.maxBeats < 1)) {
      throw new Error('--max-beats must be a positive integer');
    }
    const beatSeconds = Math.min(
      Math.max(options.beatSeconds ?? DEFAULT_BEAT_SECONDS, 1),
      MAX_BEAT_SECONDS
    );

    const planningHome = resolveCurrentPlanningHomeSync();
    const changeRoot = getChangeDir(planningHome, options.change.trim());
    if (!fs.existsSync(changeRoot)) {
      throw new Error(`Change '${options.change}' not found at ${changeRoot}`);
    }

    const keepalive = resolveKeepaliveConfig(
      (getGlobalConfig() as { keepalive?: KeepaliveConfigInput }).keepalive
    );

    // Gate 1: runtime. Closed or unknown → immediate stand-down, no state mutation.
    const runtime = detectAgentRuntime();
    if (!isRuntimeGated(runtime, keepalive)) {
      this.emitWait({ standDown: true, reason: 'runtime-not-gated' });
      return;
    }

    // Gate 2: context floor. Only enforced when the caller self-reports size.
    if (options.contextTokens !== undefined && options.contextTokens < keepalive.contextFloor) {
      this.emitWait({ standDown: true, reason: 'context-below-floor' });
      return;
    }

    // Gate 3: persistent beat cap — returns without blocking.
    const cap = options.maxBeats ?? resolveRoleCap(roleKey);
    const state = loadBeatState(changeRoot, roleKey, cap);
    if (state.beats >= cap) {
      clearBeatState(changeRoot, roleKey);
      this.emitWait({ standDown: true, reason: 'beat-cap' });
      return;
    }

    // Live beat: poll the signal file until hit or timeout.
    fs.mkdirSync(signalsDir(changeRoot), { recursive: true });
    const deadline = Date.now() + beatSeconds * 1000;
    for (;;) {
      const signal = readSignal(changeRoot, roleKey);
      if (signal) {
        await consumeSignal(changeRoot, roleKey);
        clearBeatState(changeRoot, roleKey);
        if (signal.kind === 'resume') {
          this.emitWait({ resumed: true, instruction: signal.instruction });
        } else {
          this.emitWait({ standDown: true, reason: 'lead-stand-down' });
        }
        return;
      }
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) break;
      await new Promise((resolve) => setTimeout(resolve, Math.min(POLL_INTERVAL_MS, remainingMs)));
    }

    const beats = state.beats + 1;
    saveBeatState(changeRoot, roleKey, { beats, startedAt: state.startedAt, maxBeats: cap });
    this.emitWait({ beat: beats, remaining: cap - beats });
  }

  private emitWait(outcome: AgentWaitOutcome): void {
    console.log(JSON.stringify(outcome));
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
