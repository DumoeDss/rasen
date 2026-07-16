/**
 * Agent context sensing.
 *
 * Claude Code persists every session as a JSONL transcript whose assistant
 * entries carry the exact per-turn API `usage`. The context-window occupancy of
 * an agent at any point is therefore not an estimate: it is the sum of
 * `input_tokens + cache_read_input_tokens + cache_creation_input_tokens` from
 * the LAST assistant entry that reports usage. This module turns a transcript
 * path (or the current main session, resolved via the Claude projects
 * directory) into that number plus the model's context-window `limit`, so any
 * agent or the `rasen agent context` command can decide whether to hand off.
 *
 * Pure core: it reads the filesystem but never writes, prints, or exits. The
 * command layer owns output formatting and process exit codes.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  readRolloutOccupancy,
  listRolloutFiles,
  resolveCodexHome,
  CODEX_CLI_VERSION_PREMISE,
} from './codex/index.js';
import { findRepoPlanningRootSync } from './planning-home.js';
import { resolveHandoffThresholdLayers } from './effective-config.js';
import { DEFAULT_HANDOFF_CONFIG, type ThresholdValue } from './pipeline-registry/types.js';
import { resolveModelPreset } from './model-presets.js';

export interface AgentContextResult {
  model: string;
  contextTokens: number;
  limit: number;
  /** contextTokens / limit, rounded to 6 decimals (0–1). */
  pct: number;
  /** max(0, limit - contextTokens) — 0 when no limit is known. */
  remainingTokens: number;
  transcript: string;
}

/** The three-field occupancy estimate, without model/transcript metadata. */
export interface ContextEstimate {
  contextTokens: number;
  limit: number;
  pct: number;
  remainingTokens: number;
}

/** Conservative fallback window for unknown models. */
export const DEFAULT_CONTEXT_LIMIT = 200_000;

/**
 * Resolve a model id to its context-window size via the built-in
 * {@link resolveModelPreset} registry, falling back to the conservative
 * default for unknown models. One source of truth for context-window sizes;
 * identical resolutions to the previous ad-hoc map for every id it resolved
 * before.
 */
export function resolveModelLimit(model: string | undefined | null): number {
  return resolveModelPreset(model)?.contextWindow ?? DEFAULT_CONTEXT_LIMIT;
}

function remainingTokens(limit: number, contextTokens: number): number {
  return Math.max(0, limit - contextTokens);
}

function roundPct(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

interface TranscriptUsage {
  input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

interface TranscriptMessage {
  role?: string;
  model?: string;
  usage?: TranscriptUsage;
}

interface TranscriptEntry {
  type?: string;
  message?: TranscriptMessage;
}

function sumUsage(usage: TranscriptUsage): number {
  return (
    (usage.input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0)
  );
}

/**
 * Scan a transcript's JSONL for the last entry that carries `message.usage` and
 * compute its context occupancy. Malformed/blank lines are skipped. Throws an
 * actionable error when the file is missing/unreadable or has no usage entry.
 */
export function computeContextFromTranscript(
  transcriptPath: string,
  options: { limit?: number } = {}
): AgentContextResult {
  let content: string;
  try {
    content = fs.readFileSync(transcriptPath, 'utf-8');
  } catch {
    throw new Error(
      `Cannot read transcript: ${transcriptPath}. Pass a readable Claude Code transcript jsonl with --transcript, or use --latest.`
    );
  }

  let last: { message: TranscriptMessage; usage: TranscriptUsage } | undefined;
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let entry: TranscriptEntry;
    try {
      entry = JSON.parse(trimmed) as TranscriptEntry;
    } catch {
      continue; // tolerate partial/corrupt lines
    }
    const message = entry.message;
    const usage = message?.usage;
    if (message && usage && typeof usage === 'object') {
      last = { message, usage };
    }
  }

  if (!last) {
    throw new Error(
      `No assistant usage found in transcript: ${transcriptPath}. The file has no entry carrying message.usage, so context occupancy cannot be measured.`
    );
  }

  const contextTokens = sumUsage(last.usage);
  const model = last.message.model ?? 'unknown';
  const limit = options.limit ?? resolveModelLimit(model);
  return {
    model,
    contextTokens,
    limit,
    pct: roundPct(contextTokens / limit),
    remainingTokens: remainingTokens(limit, contextTokens),
    transcript: transcriptPath,
  };
}

export type TranscriptKind = 'claude' | 'codex';

/** codex-cli's own rollout filename convention — the same one `findRolloutPath` builds paths from. */
const CODEX_ROLLOUT_BASENAME = /^rollout-.*\.jsonl$/;

function validateRuntime(runtime: string | undefined): TranscriptKind | undefined {
  if (runtime === undefined) return undefined;
  if (runtime === 'claude' || runtime === 'codex') return runtime;
  throw new Error(`--runtime must be "claude" or "codex" (got "${runtime}").`);
}

/**
 * First-non-empty-line sniff for a renamed/copied file whose basename doesn't
 * match the `rollout-*.jsonl` convention. A real rollout's first row is
 * always `session_meta` (live-verified against ~40 rollouts on this
 * machine); a `payload` envelope with no Claude-style `message` field is
 * accepted defensively for any other Codex row shape. Anything else,
 * including an unreadable file, defaults to claude — the safe default,
 * since the claude branch's own read produces an actionable error rather
 * than silently misrouting. Pinned to {@link CODEX_CLI_VERSION_PREMISE}.
 */
function sniffTranscriptKind(transcriptPath: string): TranscriptKind {
  let content: string;
  try {
    content = fs.readFileSync(transcriptPath, 'utf-8');
  } catch {
    return 'claude';
  }
  let firstLine: string | undefined;
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed) {
      firstLine = trimmed;
      break;
    }
  }
  if (!firstLine) return 'claude';
  let row: Record<string, unknown>;
  try {
    row = JSON.parse(firstLine) as Record<string, unknown>;
  } catch {
    return 'claude';
  }
  if (row.type === 'session_meta') return 'codex';
  if ('payload' in row && row.message === undefined) return 'codex';
  return 'claude';
}

/**
 * Detect whether a path is a Codex rollout or a Claude Code transcript
 * (design D1). Order: explicit override wins outright; then the filename
 * convention (zero extra I/O, covers every rollout in situ); then a
 * first-line content sniff for a renamed/copied file; default claude.
 */
export function detectTranscriptKind(
  transcriptPath: string,
  runtimeOverride?: string
): TranscriptKind {
  const override = validateRuntime(runtimeOverride);
  if (override) return override;
  if (CODEX_ROLLOUT_BASENAME.test(path.basename(transcriptPath))) return 'codex';
  return sniffTranscriptKind(transcriptPath);
}

/**
 * Best-effort model id for a rollout. The model id does NOT live in
 * `session_meta` (its payload never carries a `model` field, live-verified
 * against every rollout on this machine as of {@link CODEX_CLI_VERSION_PREMISE})
 * — it lives in each `turn_context` row's `payload.model`. Last `turn_context`
 * wins, matching the "latest state" convention `readRolloutOccupancy` already
 * uses for `token_count`. Falls back to `'unknown'` (same fallback the Claude
 * branch uses for a usage entry without a model) since nothing downstream
 * keys on this field.
 */
function readRolloutModel(rolloutPath: string): string {
  let content: string;
  try {
    content = fs.readFileSync(rolloutPath, 'utf-8');
  } catch {
    return 'unknown';
  }
  let model: string | undefined;
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let row: { type?: string; payload?: Record<string, unknown> };
    try {
      row = JSON.parse(trimmed) as { type?: string; payload?: Record<string, unknown> };
    } catch {
      continue;
    }
    if (row.type === 'turn_context' && typeof row.payload?.model === 'string') {
      model = row.payload.model;
    }
  }
  return model ?? 'unknown';
}

/**
 * Compute context occupancy from a Codex rollout via exec-core's
 * `readRolloutOccupancy` (last `token_count` event). A rollout with no
 * `token_count` event yet (`null`) is a normal "zero completed turns" state
 * — a young or just-killed worker, exactly the moment resume tooling probes
 * it — and reports SUCCESS with zero occupancy (design D3), asymmetric with
 * the Claude branch's usage-free-transcript error (that case is malformed
 * input, not a young rollout). `limit` prefers an explicit override, else
 * the rollout's own inline `model_context_window` (exact, provider-sent — no
 * model-map lookup on this branch), else `0` when neither is known (honest:
 * no window was ever reported). Throws only when the file itself cannot be
 * read, matching the Claude branch's own unreadable-file behavior.
 */
export function computeContextFromRollout(
  rolloutPath: string,
  options: { limit?: number } = {}
): AgentContextResult {
  let occupancy: ReturnType<typeof readRolloutOccupancy>;
  try {
    occupancy = readRolloutOccupancy(rolloutPath);
  } catch {
    throw new Error(
      `Cannot read Codex rollout: ${rolloutPath}. Pass a readable rollout jsonl with --transcript.`
    );
  }
  const model = readRolloutModel(rolloutPath);

  if (!occupancy) {
    const limit = options.limit ?? 0;
    return {
      model,
      contextTokens: 0,
      limit,
      pct: 0,
      remainingTokens: remainingTokens(limit, 0),
      transcript: rolloutPath,
    };
  }

  const limit = options.limit ?? occupancy.modelContextWindow;
  return {
    model,
    contextTokens: occupancy.totalTokens,
    limit,
    pct: limit > 0 ? roundPct(occupancy.totalTokens / limit) : 0,
    remainingTokens: remainingTokens(limit, occupancy.totalTokens),
    transcript: rolloutPath,
  };
}

/**
 * The Claude Code transcript directory for a working directory. The slug is the
 * absolute cwd with every ':', path separator, and '.' replaced by '-' (e.g.
 * `E:\a\b.app` → `E--a-b-app`), matching Claude Code's project-dir convention.
 * `homeDir` is injectable for testing.
 */
export function claudeProjectsDir(cwd: string, homeDir: string = os.homedir()): string {
  const slug = cwd.replace(/[:\\/.]/g, '-');
  return path.join(homeDir, '.claude', 'projects', slug);
}

/**
 * Environmental absence of a Claude transcript under `--latest`: the derived
 * projects directory does not exist, or exists but holds no main-session
 * transcript (design D2). This is NOT an error on a non-Claude host (e.g. a
 * Codex CLI session as the LEAD) — it is that host's normal state, and the
 * probe is contractually a non-blocking pre-flight. Distinguished by type
 * (not message matching) so the command layer can catch ONLY this case and
 * degrade gracefully, while every other throw (including an explicit
 * `--transcript` failure) stays a hard error.
 */
export class AgentContextUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentContextUnavailableError';
  }
}

/**
 * Newest MAIN-session transcript (`*.jsonl`, excluding `agent-*.jsonl` subagent
 * files) directly under `baseDir`, by mtime. Throws {@link AgentContextUnavailableError}
 * when the directory is absent or holds no main-session transcript — both are
 * environmental-absence cases, reachable only via `--latest` (design D2).
 */
export function findLatestMainTranscript(baseDir: string): string {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(baseDir, { withFileTypes: true });
  } catch {
    throw new AgentContextUnavailableError(
      `No Claude transcript directory at ${baseDir}. Run from the project whose session you want to probe, or pass --transcript / --dir. On a Codex host, pass --runtime codex with --latest.`
    );
  }

  let newest: string | undefined;
  let newestMtime = -Infinity;
  for (const e of entries) {
    if (!e.isFile()) continue;
    if (!e.name.endsWith('.jsonl')) continue;
    if (e.name.startsWith('agent-')) continue; // exclude subagent transcripts
    const full = path.join(baseDir, e.name);
    const mtime = fs.statSync(full).mtimeMs;
    if (mtime > newestMtime) {
      newest = full;
      newestMtime = mtime;
    }
  }

  if (!newest) {
    throw new AgentContextUnavailableError(
      `No main-session transcript (*.jsonl) found in ${baseDir}. It holds only subagent files or is empty. On a Codex host, pass --runtime codex with --latest.`
    );
  }
  return newest;
}

/** Parsed first line of a candidate rollout, or `undefined` when unreadable/malformed/not `session_meta`. */
function readSessionMeta(rolloutPath: string): Record<string, unknown> | undefined {
  let content: string;
  try {
    content = fs.readFileSync(rolloutPath, 'utf-8');
  } catch {
    return undefined;
  }
  let firstLine: string | undefined;
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed) {
      firstLine = trimmed;
      break;
    }
  }
  if (!firstLine) return undefined;
  let row: Record<string, unknown>;
  try {
    row = JSON.parse(firstLine) as Record<string, unknown>;
  } catch {
    return undefined;
  }
  if (row.type !== 'session_meta') return undefined;
  const payload = row.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
  return payload as Record<string, unknown>;
}

/**
 * Newest Codex rollout under `sessionsDir` whose recorded session `cwd`
 * (`session_meta.payload.cwd`, resolved) equals the resolved probe `cwd`,
 * excluding forked-child (subagent) rollouts — the Codex analog of
 * {@link findLatestMainTranscript} (design D2). Candidates are ordered
 * newest-mtime-first and inspected candidate-lazily (each candidate's file is
 * read whole, `readJsonlLines`-style, to get its `session_meta` first line —
 * the laziness is that the walk stops early, not a partial file read): the walk stops at the
 * first match, so in practice only the LEAD's own recent rollout (or a
 * handful of misses) pay the read. Throws {@link AgentContextUnavailableError}
 * naming the sessions root and the cwd filter when nothing matches
 * (environmental absence, reachable only via `--latest`).
 */
export function findLatestRollout(sessionsDir: string, cwd: string): string {
  const resolvedCwd = path.resolve(cwd);
  const candidates = listRolloutFiles(sessionsDir).sort((a, b) => b.mtimeMs - a.mtimeMs);

  for (const candidate of candidates) {
    const meta = readSessionMeta(candidate.path);
    if (!meta) continue;
    if (meta.forked_from_id !== undefined || meta.parent_thread_id !== undefined) continue;
    const metaCwd = meta.cwd;
    if (typeof metaCwd !== 'string') continue;
    if (path.resolve(metaCwd) === resolvedCwd) return candidate.path;
  }

  throw new AgentContextUnavailableError(
    `No Codex rollout found in ${sessionsDir} whose session cwd matches ${resolvedCwd}. Run from the project whose session you want to probe, or pass --transcript / --dir.`
  );
}

export interface ProbeOptions {
  /** Explicit transcript path. Takes precedence over `latest`. */
  transcript?: string;
  /** Resolve the newest main-session transcript for `cwd`/`dir`. */
  latest?: boolean;
  /** Override the Claude projects base dir used by `latest`. */
  dir?: string;
  /** Override the resolved context-window limit. */
  limit?: number;
  /** Working directory used to derive the projects dir (defaults to process.cwd()). */
  cwd?: string;
  /** Home directory used to derive the projects dir (defaults to os.homedir()). */
  homeDir?: string;
  /** Force detection to `'claude'` or `'codex'` instead of sniffing the file. */
  runtime?: string;
}

/**
 * Resolve which transcript a probe should read. `--transcript` wins; otherwise
 * `--latest` resolves the newest main-session transcript — the Claude-side
 * path under `--dir` (or the cwd-derived Claude projects dir) when `runtime`
 * is absent/`'claude'`, or the newest cwd-matching Codex rollout under `--dir`
 * (or the default Codex sessions root) when `runtime` is `'codex'` (design
 * D1/D3). `runtime` here is the already-validated value — callers must
 * validate `--runtime` before calling. Throws when neither `--transcript` nor
 * `--latest` is provided.
 */
export function resolveTranscriptPath(options: ProbeOptions, runtime?: TranscriptKind): string {
  if (options.transcript) return options.transcript;
  if (options.latest) {
    if (runtime === 'codex') {
      const sessionsDir = options.dir ?? path.join(resolveCodexHome(), 'sessions');
      return findLatestRollout(sessionsDir, options.cwd ?? process.cwd());
    }
    const baseDir =
      options.dir ?? claudeProjectsDir(options.cwd ?? process.cwd(), options.homeDir);
    return findLatestMainTranscript(baseDir);
  }
  throw new Error('Specify a transcript to probe: pass --transcript <path> or --latest.');
}

export type HandoffThresholdSource = 'project' | 'global' | 'default';

export interface HandoffThresholdReport {
  threshold: ThresholdValue;
  thresholdSource: HandoffThresholdSource;
  /**
   * True when the probe has crossed `threshold`: for a fraction, `pct >=
   * threshold`; for the absolute `{ remainingTokens }` form, `remainingTokens
   * <= threshold.remainingTokens` (design D2, same direction as
   * `resolveStageHandoffConfig`'s handoff comparison).
   */
  shouldHandoff: boolean;
}

/**
 * Resolves the configured context-handoff threshold for `rasen agent
 * context`: project config `handoff.threshold` (when `cwd` resolves inside a
 * Rasen project) else global config `handoff.threshold` else the built-in
 * default (0.5), and reports whether the probe has crossed it, in either
 * dual-form (D1/D2). Role-agnostic by design — a transcript probe has no
 * stage identity, so pipeline/stage/role overrides (which apply only to
 * `resolveStageHandoffConfig`) do not apply here, and neither does the
 * model-preset layer (that is a stage/role-scoped suggestion, not a bare
 * probe's business). Shares `resolveHandoffThresholdLayers()`
 * (src/core/effective-config.ts) with the pipeline resolver so the two
 * consumers cannot drift on what "the configured threshold" means. Remains a
 * probe: callers must not treat `shouldHandoff` as a reason to change the
 * exit code.
 */
export function resolveHandoffThresholdReport(
  pct: number,
  remainingTokens: number,
  cwd: string = process.cwd()
): HandoffThresholdReport {
  const projectRoot = findRepoPlanningRootSync(cwd);
  const layers = resolveHandoffThresholdLayers(projectRoot);

  let threshold: ThresholdValue;
  let thresholdSource: HandoffThresholdSource;
  if (layers.projectThreshold !== undefined) {
    threshold = layers.projectThreshold;
    thresholdSource = 'project';
  } else if (layers.globalThreshold !== undefined) {
    threshold = layers.globalThreshold;
    thresholdSource = 'global';
  } else {
    threshold = DEFAULT_HANDOFF_CONFIG.threshold;
    thresholdSource = 'default';
  }

  const shouldHandoff =
    typeof threshold === 'number'
      ? pct >= threshold
      : remainingTokens <= threshold.remainingTokens;

  return { threshold, thresholdSource, shouldHandoff };
}

/**
 * Full probe: resolve the transcript, detect its kind (Codex rollout vs
 * Claude transcript — explicit `--runtime` wins over detection), then
 * compute its context occupancy. Throws an actionable error on any
 * unreadable/usage-free/unspecified input, or an invalid `--runtime` value.
 */
export function probeAgentContext(options: ProbeOptions): AgentContextResult {
  const runtime = validateRuntime(options.runtime);
  if (
    options.limit !== undefined &&
    (!Number.isInteger(options.limit) || options.limit <= 0)
  ) {
    throw new Error('--limit must be a positive integer (token count of the context window).');
  }
  const transcriptPath = resolveTranscriptPath(options, runtime);
  const kind = detectTranscriptKind(transcriptPath, runtime);
  return kind === 'codex'
    ? computeContextFromRollout(transcriptPath, { limit: options.limit })
    : computeContextFromTranscript(transcriptPath, { limit: options.limit });
}

/** Tagged result of {@link probeAgentContextSafe} — success or environmental unavailability. */
export type ProbeAgentContextResult =
  | ({ available: true } & AgentContextResult)
  | { available: false; reason: 'no-transcript'; detail: string };

/**
 * Same resolution as {@link probeAgentContext}, but catches ONLY environmental
 * absence under `--latest` ({@link AgentContextUnavailableError}) and returns it
 * as a tagged `{available:false}` result instead of throwing (design D2). Every
 * other failure (invalid `--runtime`/`--limit`, no source flag, an explicit
 * `--transcript` that is unreadable/usage-free) still throws — those are input
 * errors, not a host's normal state, and must stay hard errors.
 */
export function probeAgentContextSafe(options: ProbeOptions): ProbeAgentContextResult {
  try {
    const result = probeAgentContext(options);
    return { available: true, ...result };
  } catch (err) {
    if (err instanceof AgentContextUnavailableError) {
      return { available: false, reason: 'no-transcript', detail: err.message };
    }
    throw err;
  }
}

/**
 * Best-effort context estimate for an already-known transcript path. Routes
 * through the same kind detection as {@link probeAgentContext} (no explicit
 * override — callers like `pipeline resume` pass a bare path). Returns the
 * three-field estimate, or `undefined` on any read error — including an
 * unreadable Codex rollout — for callers that must never fail because a
 * probe could not be taken.
 */
export function tryContextEstimate(
  transcriptPath: string,
  limit?: number
): ContextEstimate | undefined {
  try {
    const kind = detectTranscriptKind(transcriptPath);
    const r =
      kind === 'codex'
        ? computeContextFromRollout(transcriptPath, { limit })
        : computeContextFromTranscript(transcriptPath, { limit });
    return {
      contextTokens: r.contextTokens,
      limit: r.limit,
      pct: r.pct,
      remainingTokens: r.remainingTokens,
    };
  } catch {
    return undefined;
  }
}
