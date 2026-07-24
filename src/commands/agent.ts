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
 *   - audit   : local, pull-model session token-spend audit (cli-agent-audit
 *               spec) — parses a session's transcript(s), writes a report,
 *               and optionally opens the shipped viewer. Experimental: it
 *               parses an internal, undocumented transcript/rollout format.
 *
 * A thin consumer of `src/core/agent-context.ts`, `src/core/keepalive/`, and
 * `src/core/token-audit/`; all sensing/protocol/parsing logic lives there.
 */

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
  discardStaleSignal,
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
import { runAudit } from '../core/token-audit/audit.js';
import { TranscriptFormatError } from '../core/token-audit/errors.js';
import { isCodexAuditResult, type AuditResult } from '../core/token-audit/types.js';

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

export interface AgentAuditOptions {
  projectsDir?: string;
  out?: string;
  runtime?: string;
  json?: boolean;
  open?: boolean;
}

/**
 * Best-effort default-browser launch, mirroring `src/commands/ui-launch.ts`'s
 * `openInBrowser` (darwin `open` / win32 `cmd /c start` / else `xdg-open`,
 * spawned detached with stdio ignored, unref'd so it never holds the CLI
 * process open; errors swallowed since the URL/path is already printed for
 * manual opening — design D2).
 */
function openInBrowser(url: string): void {
  try {
    let command: string;
    let args: string[];
    if (process.platform === 'darwin') {
      command = 'open';
      args = [url];
    } else if (process.platform === 'win32') {
      command = 'cmd';
      args = ['/c', 'start', '""', url];
    } else {
      command = 'xdg-open';
      args = [url];
    }
    const child = spawn(command, args, { stdio: 'ignore', detached: true, shell: false });
    child.on('error', () => {
      // Best-effort: the path is already printed for manual opening.
    });
    child.unref();
  } catch {
    // Best-effort: the path is already printed for manual opening.
  }
}

/**
 * Resolves the shipped `viewer/audit.html` asset's path relative to this
 * package's own root (design D2), independent of `process.cwd()`. Mirrors
 * the package-relative resolution pattern used elsewhere (e.g.
 * `resolveUiPackageDir` in `src/core/config-api/ui-package.ts`). Returns
 * `undefined` when the asset is not found (never throws — `--open` is
 * best-effort, the report path is always printed regardless).
 */
function resolveAuditViewerPath(): string | undefined {
  const currentFile = fileURLToPath(import.meta.url);
  // dist/commands/agent.js -> dist/commands -> package root (two levels up).
  const packageRoot = path.join(path.dirname(currentFile), '..', '..');
  const viewerPath = path.join(packageRoot, 'viewer', 'audit.html');
  try {
    return fs.statSync(viewerPath).isFile() ? viewerPath : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Opens the shipped viewer pre-loaded with the just-generated report via a
 * `?src=` file reference (design D2). Best-effort: any failure is swallowed
 * since the report path is always printed as a fallback (spec: "Opening the
 * viewer after analysis").
 */
function openAuditViewer(reportPath: string): void {
  const viewerPath = resolveAuditViewerPath();
  if (!viewerPath) return;
  const viewerUrl = pathToFileURL(viewerPath);
  viewerUrl.searchParams.set('src', pathToFileURL(reportPath).toString());
  openInBrowser(viewerUrl.toString());
}

function formatMillions(n: number): string {
  return (n / 1e6).toFixed(2) + 'M';
}

/** One-line totals summary for text mode, shaped per runtime (task 4.1). */
function summarizeAuditResult(result: AuditResult): string {
  if (isCodexAuditResult(result)) {
    const t = result.totals;
    return (
      `requests=${t.requests} input=${formatMillions(t.rawTokens.inputTokens)} ` +
      `cachedInput=${formatMillions(t.rawTokens.cachedInputTokens)} output=${formatMillions(t.rawTokens.outputTokens)} ` +
      `cacheHitRatio=${(t.cacheHitRatio * 100).toFixed(1)}%`
    );
  }
  const t = result.totals;
  return (
    `requests=${t.requests} output=${formatMillions(t.outputTokens)} cacheWrite=${formatMillions(t.cacheWrite)} ` +
    `cacheRead=${formatMillions(t.cacheRead)} billed-input-equivalent=${formatMillions(t.billedInputEq)} ` +
    `churn=${formatMillions(t.churn.tokens)} (${t.churn.events} events)`
  );
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
   * Local, pull-model session token-spend audit (cli-agent-audit spec):
   * parses a Claude Code session transcript (or, with `--runtime codex`, a
   * Codex rollout) plus its subagent transcripts, writes a report under the
   * user's Rasen machine-data directory (or `--out`), prints the resolved
   * path and a one-line summary, and optionally opens the shipped viewer.
   *
   * Only {@link TranscriptFormatError} is caught here and turned into a
   * friendly, non-crashing failure (design D3) — every other thrown error
   * (an ambiguous session id prefix, a missing transcript, an invalid
   * `--runtime`) surfaces normally, for the CLI layer's generic catch to
   * report and exit non-zero, matching `context`'s own error contract.
   */
  async audit(target: string, options: AgentAuditOptions = {}): Promise<void> {
    try {
      const { result, outPath } = await runAudit(target, {
        projectsDir: options.projectsDir,
        outPath: options.out,
        runtime: options.runtime,
      });
      if (options.json) {
        console.log(JSON.stringify(result));
      } else {
        console.log(`wrote ${outPath}`);
        console.log(summarizeAuditResult(result));
        for (const caveat of result.caveats ?? []) {
          console.log(`Caveat: ${caveat}`);
        }
      }
      if (options.open) {
        openAuditViewer(outPath);
      }
    } catch (error) {
      if (error instanceof TranscriptFormatError) {
        const message =
          `rasen agent audit: transcript format not recognized (harness may have updated the session log format). ` +
          `${error.detail} at ${error.filePath}:${error.lineNumber}. This command is experimental; see 'rasen agent audit --help' for details.`;
        if (options.json) {
          console.log(JSON.stringify({ available: false, reason: 'format-drift', detail: message }));
        } else {
          console.log(message);
        }
        process.exitCode = 1;
        return;
      }
      throw error;
    }
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

    // Gate 2: context floor. Only enforced when a floor is configured (>0)
    // AND the caller self-reports size. Default floor is 0 (gate disabled).
    if (
      keepalive.contextFloor > 0 &&
      options.contextTokens !== undefined &&
      options.contextTokens < keepalive.contextFloor
    ) {
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

    // Live beat: poll the signal file until hit or timeout. On the first
    // beat of an episode, discard any signal left over from a PRIOR episode
    // (older than the grace window) — a stale standDown would otherwise
    // insta-kill every new park.
    fs.mkdirSync(signalsDir(changeRoot), { recursive: true });
    if (state.beats === 0) {
      await discardStaleSignal(changeRoot, roleKey);
    }
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
