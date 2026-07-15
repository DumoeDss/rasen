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
import { readRolloutOccupancy, CODEX_CLI_VERSION_PREMISE } from './codex/index.js';

export interface AgentContextResult {
  model: string;
  contextTokens: number;
  limit: number;
  /** contextTokens / limit, rounded to 6 decimals (0–1). */
  pct: number;
  transcript: string;
}

/** The three-field occupancy estimate, without model/transcript metadata. */
export interface ContextEstimate {
  contextTokens: number;
  limit: number;
  pct: number;
}

/** Conservative fallback window for unknown models. */
export const DEFAULT_CONTEXT_LIMIT = 200_000;
const HAIKU_LIMIT = 200_000;
const LARGE_LIMIT = 1_000_000;

/**
 * Resolve a model id to its context-window size via a built-in prefix map.
 *
 *  - ids containing `haiku` → 200k;
 *  - current large-context generations (`opus-4`, `sonnet-5`, `sonnet-4-6`,
 *    `fable`, `mythos`) → 1M;
 *  - everything else → the conservative 200k default.
 *
 * Matching is case-insensitive and substring-based so provider-prefixed ids
 * (e.g. `claude-opus-4-8`, `us.anthropic.claude-...`) resolve correctly.
 */
export function resolveModelLimit(model: string | undefined | null): number {
  if (!model) return DEFAULT_CONTEXT_LIMIT;
  const id = model.toLowerCase();
  if (id.includes('haiku')) return HAIKU_LIMIT;
  if (
    id.includes('opus-4') ||
    id.includes('sonnet-5') ||
    id.includes('sonnet-4-6') ||
    id.includes('fable') ||
    id.includes('mythos')
  ) {
    return LARGE_LIMIT;
  }
  return DEFAULT_CONTEXT_LIMIT;
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
    return { model, contextTokens: 0, limit, pct: 0, transcript: rolloutPath };
  }

  const limit = options.limit ?? occupancy.modelContextWindow;
  return {
    model,
    contextTokens: occupancy.totalTokens,
    limit,
    pct: limit > 0 ? roundPct(occupancy.totalTokens / limit) : 0,
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
      `No Claude transcript directory at ${baseDir}. Run from the project whose session you want to probe, or pass --transcript / --dir.`
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
      `No main-session transcript (*.jsonl) found in ${baseDir}. It holds only subagent files or is empty.`
    );
  }
  return newest;
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
 * `--latest` resolves the newest main-session transcript under `--dir` (or the
 * cwd-derived Claude projects dir). Throws when neither is provided.
 */
export function resolveTranscriptPath(options: ProbeOptions): string {
  if (options.transcript) return options.transcript;
  if (options.latest) {
    const baseDir =
      options.dir ?? claudeProjectsDir(options.cwd ?? process.cwd(), options.homeDir);
    return findLatestMainTranscript(baseDir);
  }
  throw new Error('Specify a transcript to probe: pass --transcript <path> or --latest.');
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
  const transcriptPath = resolveTranscriptPath(options);
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
    return { contextTokens: r.contextTokens, limit: r.limit, pct: r.pct };
  } catch {
    return undefined;
  }
}
