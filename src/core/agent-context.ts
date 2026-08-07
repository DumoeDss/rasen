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
  RolloutOccupancyUnavailableError,
  readRolloutSessionMeta,
  listRolloutFiles,
  CODEX_CLI_VERSION_PREMISE,
} from './codex/index.js';
import { findRepoPlanningRootSync } from './planning-home.js';
import {
  requireConfigStoreLayer,
  resolveHandoffThresholdLayers,
  resolveThresholdBindingLayers,
} from './effective-config.js';
import {
  DEFAULT_HANDOFF_CONFIG,
  defaultHandoffThresholdForRuntime,
  type ThresholdValue,
} from './pipeline-registry/types.js';
import { resolveModelPreset } from './model-presets.js';
import {
  PROBE_RUNTIMES,
  SNIFF_FALLBACK_RUNTIME,
  detectHostRuntime,
  hasRuntimeCapability,
  type ContextReader,
  type ProbeRuntime,
  type RuntimeAdapterId,
} from './runtime-adapters.js';
import { CONTEXT_READERS } from './runtimes/context-readers.js';
import { SESSION_STORES, detectSessionOwner } from './runtimes/session-stores.js';
import {
  loadThresholdSchemeSnapshot,
  resolveThreshold,
  type ThresholdBindingMetadata,
  type ThresholdDiagnostic,
} from './threshold-resolver.js';

export interface AgentContextResult {
  runtime: ProbeRuntime;
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
    runtime: 'claude',
    model,
    contextTokens,
    limit,
    pct: roundPct(contextTokens / limit),
    remainingTokens: remainingTokens(limit, contextTokens),
    transcript: transcriptPath,
  };
}

function validateRuntime(runtime: string | undefined): ProbeRuntime | undefined {
  if (runtime === undefined) return undefined;
  if (hasRuntimeCapability(runtime, 'canProbeContext')) return runtime;
  const expected = PROBE_RUNTIMES.map((candidate) => `"${candidate}"`).join(' or ');
  throw new Error(`--runtime must be ${expected} (got "${runtime}").`);
}

/**
 * The context reader for the harness that owns a target, or an actionable
 * refusal naming that harness.
 *
 * Recognizing a session does not grant a reader for it: measuring one
 * harness's file with another harness's field names yields a confident number
 * that describes nothing, which is strictly worse than refusing. Callers that
 * must never fail on a missing probe catch this and report absence.
 */
function contextReaderFor(owner: RuntimeAdapterId, target: string): ContextReader {
  if (hasRuntimeCapability(owner, 'canProbeContext')) return CONTEXT_READERS[owner];
  throw new Error(
    `No context reader exists for the recognized session runtime "${owner}": ${target}. ` +
      `Reading it with another runtime's reader would report a number that describes nothing. ` +
      `Rasen can probe ${PROBE_RUNTIMES.join(' and ')} sessions.`
  );
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
 * `readRolloutOccupancy` (last valid current-context snapshot). A rollout with no
 * `token_count` event yet (`null`) is a normal "zero completed turns" state
 * — a young or just-killed worker, exactly the moment resume tooling probes
 * it — and reports SUCCESS with zero occupancy (design D3), asymmetric with
 * the Claude branch's usage-free-transcript error (that case is malformed
 * input, not a young rollout). `limit` prefers an explicit override, else
 * the rollout's own inline `model_context_window` (exact, provider-sent — no
 * model-map lookup on this branch), else `0` when neither is known (honest:
 * no window was ever reported). Throws when the file cannot be read or its
 * token-count stream has no usable current-context snapshot.
 */
export function computeContextFromRollout(
  rolloutPath: string,
  options: { limit?: number } = {}
): AgentContextResult {
  let occupancy: ReturnType<typeof readRolloutOccupancy>;
  try {
    occupancy = readRolloutOccupancy(rolloutPath);
  } catch (error) {
    if (error instanceof RolloutOccupancyUnavailableError) {
      throw error;
    }
    throw new Error(
      `Cannot read Codex rollout: ${rolloutPath}. Pass a readable rollout jsonl with --transcript.`
    );
  }
  const model = readRolloutModel(rolloutPath);

  if (!occupancy) {
    const limit = options.limit ?? 0;
    return {
      runtime: 'codex',
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
    runtime: 'codex',
    model,
    contextTokens: occupancy.contextTokens,
    limit,
    pct: limit > 0 ? roundPct(occupancy.contextTokens / limit) : 0,
    remainingTokens: remainingTokens(limit, occupancy.contextTokens),
    transcript: rolloutPath,
  };
}

/**
 * One Oh My Pi message row's recorded usage. Field names are Oh My Pi's own
 * (live-verified against `OMP_CLI_VERSION_PREMISE`), and they map one-to-one
 * onto the three Claude fields {@link sumUsage} adds.
 *
 * `totalTokens` is deliberately NOT modelled: it is present, tempting, and
 * wrong — it adds the turn's OUTPUT. Live on this machine, a turn recording
 * `input:2, cacheRead:122824, cacheWrite:1275, output:263` also records
 * `totalTokens:124364`, which is the correct occupancy of 124101 plus the 263
 * it produced. Using it would overstate occupancy by one turn's output on
 * every reading and make an Oh My Pi session cross the handoff threshold
 * earlier than a Claude session at the same real occupancy.
 */
interface OmpUsage {
  input?: number;
  cacheRead?: number;
  cacheWrite?: number;
}

interface OmpSessionRow {
  type?: string;
  /** `model_change` carries the id at the row level, provider-prefixed. */
  model?: unknown;
  message?: {
    model?: unknown;
    usage?: OmpUsage;
  };
}

/**
 * Compute context occupancy from an Oh My Pi session journal.
 *
 * Occupancy is `input + cacheRead + cacheWrite` of the LAST `message` row
 * carrying `message.usage` — everything sent to the model for that turn,
 * including cached input, and nothing it produced. That is the same definition
 * {@link sumUsage} applies to a Claude transcript, so the two harnesses' numbers
 * stay directly comparable (design D7).
 *
 * The model comes from that same row's `message.model` (present on every
 * assistant message live), falling back to the last `model_change` row and then
 * `'unknown'` (design D9): the model that produced the measured usage is the one
 * attached to it, while a `model_change` can precede a turn that never
 * completed.
 *
 * `limit` prefers an explicit override, else the model's own preset window, else
 * `0` — deliberately NOT {@link resolveModelLimit}, whose
 * {@link DEFAULT_CONTEXT_LIMIT} fallback is defensible only for a harness
 * running one vendor's models. Oh My Pi routes to dozens of providers whose real
 * windows span a few thousand tokens to over a million, so a substituted 200 000
 * would produce a confident `pct` describing nothing. At `limit === 0` the
 * fraction is reported as `0`, the same honest-unknown branch
 * {@link computeContextFromRollout} already takes for a rollout that never
 * reported a window (design D8).
 *
 * Throws when the file cannot be read, or when it holds no usage-bearing
 * message — matching the Claude reader rather than the Codex young-rollout zero,
 * because an Oh My Pi journal records usage on the first completed turn and its
 * absence means the file is not a measurable session.
 */
export function computeContextFromOmpSession(
  sessionPath: string,
  options: { limit?: number } = {}
): AgentContextResult {
  let content: string;
  try {
    content = fs.readFileSync(sessionPath, 'utf-8');
  } catch {
    throw new Error(
      `Cannot read Oh My Pi session: ${sessionPath}. Pass a readable Oh My Pi session jsonl with --transcript, or use --latest.`
    );
  }

  let last: { usage: OmpUsage; model: string | undefined } | undefined;
  let lastModelChange: string | undefined;
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let row: OmpSessionRow;
    try {
      row = JSON.parse(trimmed) as OmpSessionRow;
    } catch {
      continue; // tolerate partial/corrupt lines, as the Claude reader does
    }
    if (row.type === 'model_change' && typeof row.model === 'string') {
      lastModelChange = row.model;
      continue;
    }
    // The fixed-width `title` row and every non-message row fall through here
    // without a special case: only a `message` carrying `usage` can measure.
    const usage = row.message?.usage;
    if (row.type === 'message' && usage && typeof usage === 'object') {
      last = {
        usage,
        model: typeof row.message?.model === 'string' ? row.message.model : undefined,
      };
    }
  }

  if (!last) {
    throw new Error(
      `No assistant usage found in Oh My Pi session: ${sessionPath}. The file has no message entry carrying message.usage, so context occupancy cannot be measured.`
    );
  }

  const contextTokens =
    (last.usage.input ?? 0) + (last.usage.cacheRead ?? 0) + (last.usage.cacheWrite ?? 0);
  const model = last.model ?? lastModelChange ?? 'unknown';
  const limit = options.limit ?? resolveModelPreset(model)?.contextWindow ?? 0;
  return {
    runtime: 'omp',
    model,
    contextTokens,
    limit,
    pct: limit > 0 ? roundPct(contextTokens / limit) : 0,
    remainingTokens: remainingTokens(limit, contextTokens),
    transcript: sessionPath,
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
    const meta = readRolloutSessionMeta(candidate.path);
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

/**
 * How much of an Oh My Pi session file the header scan may read. The file's
 * first physical row is a fixed-width `title` slot (a ~190-character `pad`
 * field exists so the title can be rewritten in place, which bounds that row)
 * and the `session` header is the second, so 8 KiB is orders of magnitude more
 * than needed and still bounded. Oh My Pi's own recent-session scans read a
 * 4 KiB prefix (`omp://session.md`), so this is the same class of cost.
 */
const OMP_HEADER_READ_BYTES = 8 * 1024;

/**
 * The working directory an Oh My Pi session file records in its `session`
 * header, or `undefined` when the prefix holds no such row.
 *
 * Reads a bounded prefix rather than the file: a long-running session journal
 * reaches tens of megabytes, and the locator may inspect several before it
 * finds a match.
 */
function readOmpSessionCwd(sessionPath: string): string | undefined {
  let prefix: string;
  let handle: number | undefined;
  try {
    handle = fs.openSync(sessionPath, 'r');
    const buffer = Buffer.alloc(OMP_HEADER_READ_BYTES);
    const read = fs.readSync(handle, buffer, 0, OMP_HEADER_READ_BYTES, 0);
    prefix = buffer.subarray(0, read).toString('utf-8');
  } catch {
    return undefined;
  } finally {
    if (handle !== undefined) {
      try {
        fs.closeSync(handle);
      } catch {
        // A close failure cannot change the answer already read.
      }
    }
  }

  for (const line of prefix.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let row: { type?: string; cwd?: unknown };
    try {
      row = JSON.parse(trimmed) as { type?: string; cwd?: unknown };
    } catch {
      // The last line of a bounded prefix is usually truncated mid-object.
      // Anything before the header being unparseable is equally survivable.
      continue;
    }
    if (row.type === 'session') {
      return typeof row.cwd === 'string' ? row.cwd : undefined;
    }
  }
  return undefined;
}

/**
 * Newest Oh My Pi session for `cwd` across EVERY bucket under `sessionsDir`
 * — the Oh My Pi analog of {@link findLatestMainTranscript} and
 * {@link findLatestRollout} (design D6).
 *
 * Oh My Pi buckets a project's sessions under
 * `<scope>-<basename>-<sha256(canonical cwd)>` today, migrating its older
 * home-relative (`-<relative>`), temp-relative and absolute layouts into that
 * name only opportunistically, on access. Deriving one bucket name the way
 * {@link claudeProjectsDir} does is therefore measurably wrong: on the
 * maintainer's machine this repository's sessions live ONLY in the legacy
 * `-SyncLocal-rasen` bucket — including the live one — and the hashed name a
 * derivation would produce does not exist at all, so a derived-name locator
 * reports absence for a session that is running. Enumerating buckets also
 * means a future fourth layout is found with no code change.
 *
 * Every candidate is confirmed against the `cwd` its own `session` header
 * records, because a legacy bucket can hold sessions for more than one
 * directory (Oh My Pi splits colliding legacy buckets by header cwd during
 * migration). Candidates are ordered newest-mtime-first ACROSS all buckets and
 * the walk stops at the first match, so the common case — probing from the
 * directory whose session is the newest on the machine — reads exactly one
 * header. Ordering globally rather than per bucket is what makes a mixed
 * legacy bucket answer correctly: its newest file may belong to another
 * directory while an older one in the same bucket is the requested session.
 *
 * Only files DIRECTLY under a bucket are candidates. Oh My Pi writes each
 * subagent's journal to `<bucket>/<main session basename>/<AgentName>.jsonl`,
 * and those journals record the same `cwd` and the same header shape as their
 * LEAD — they are indistinguishable by content, so depth is the only thing
 * that separates them. Recursing would let a subagent's occupancy be reported
 * as the LEAD's, the same defect {@link findLatestMainTranscript} excludes
 * `agent-*.jsonl` to avoid.
 *
 * Throws {@link AgentContextUnavailableError} when nothing matches —
 * environmental absence, reachable only via `--latest`.
 */
export function findLatestOmpSession(sessionsDir: string, cwd: string): string {
  const resolvedCwd = path.resolve(cwd);

  let buckets: fs.Dirent[];
  try {
    buckets = fs.readdirSync(sessionsDir, { withFileTypes: true });
  } catch {
    throw new AgentContextUnavailableError(
      `No Oh My Pi sessions directory at ${sessionsDir}. Run from the project whose session you want to probe, or pass --transcript / --dir.`
    );
  }

  const candidates: Array<{ path: string; mtimeMs: number }> = [];
  for (const bucket of buckets) {
    if (!bucket.isDirectory()) continue;
    const bucketDir = path.join(sessionsDir, bucket.name);
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(bucketDir, { withFileTypes: true });
    } catch {
      continue; // an unreadable bucket cannot disqualify the others
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
      const full = path.join(bucketDir, entry.name);
      try {
        candidates.push({ path: full, mtimeMs: fs.statSync(full).mtimeMs });
      } catch {
        continue; // raced deletion
      }
    }
  }

  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const candidate of candidates) {
    const headerCwd = readOmpSessionCwd(candidate.path);
    if (headerCwd !== undefined && path.resolve(headerCwd) === resolvedCwd) {
      return candidate.path;
    }
  }

  throw new AgentContextUnavailableError(
    `No Oh My Pi session found under ${sessionsDir} whose session cwd matches ${resolvedCwd}. Run from the project whose session you want to probe, or pass --transcript / --dir.`
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
  /**
   * Environment the implicit-`--latest` host gate reads (defaults to
   * `process.env`). A seam, not a CLI flag: host identity is ambient.
   */
  env?: NodeJS.ProcessEnv;
}

/**
 * Resolve which transcript a probe should read. `--transcript` wins;
 * otherwise `--latest` asks the named runtime's own session store to locate
 * its newest live session, under `--dir` when given. An unnamed runtime falls
 * to {@link SNIFF_FALLBACK_RUNTIME} — the same "nothing named a runtime"
 * decision the recognition pass makes, and the legacy Claude-store behavior
 * every existing caller depends on. `runtime` here is the already-validated
 * value — callers must validate `--runtime` before calling. Throws when
 * neither `--transcript` nor `--latest` is provided.
 */
export function resolveTranscriptPath(options: ProbeOptions, runtime?: ProbeRuntime): string {
  if (options.transcript) return options.transcript;
  if (options.latest) {
    return SESSION_STORES[runtime ?? SNIFF_FALLBACK_RUNTIME].locateLatest({
      cwd: options.cwd ?? process.cwd(),
      ...(options.dir ? { dir: options.dir } : {}),
      ...(options.homeDir ? { homeDir: options.homeDir } : {}),
    });
  }
  throw new Error('Specify a transcript to probe: pass --transcript <path> or --latest.');
}

/**
 * Hosts whose implicit `--latest` keeps resolving through
 * {@link SNIFF_FALLBACK_RUNTIME}'s store instead of their own.
 *
 * A named exception to {@link implicitLatestStoreRuntime}'s derivation, in the
 * spirit of `ROUTE_EXCEPTIONS`: the derivation is what serves, and the pins are
 * stated rather than encoded as a special case in the resolver.
 *
 * `codex` is pinned because `cli-agent-context` requires a Claude or Codex
 * host's implicit discovery to stay byte-identical to its pre-existing
 * behavior, and a Codex host resolves through the Claude projects directory
 * today. Routing it to its own rollout store is a strictly better answer and
 * deliberately out of scope here — it changes a shipped contract, so it needs
 * its own change rather than arriving as a side effect of adding a harness.
 * `claude` needs no pin: its own store IS the fallback.
 */
const LEGACY_LATEST_STORE_HOSTS: readonly RuntimeAdapterId[] = ['codex'];

/**
 * Which store an INFERRED `--latest` should locate through: the detected host's
 * own, so a harness receives a reading of its own session rather than whatever
 * the fallback store happens to hold for the same directory.
 *
 * Returns `undefined` — meaning "fall through to {@link SNIFF_FALLBACK_RUNTIME}"
 * — for a host with no probe capability (`probeAgentContextSafe` refuses that
 * case before it gets here; the throwing entry point keeps the legacy
 * resolution), for an `unknown` host, and for a pinned host.
 *
 * Deliberately does NOT decide which READER measures the located file. The
 * reader stays a recognition decision keyed off the explicit `--runtime` only,
 * so a foreign file that happens to sit in a host's own store is still read by
 * the harness that actually wrote it.
 */
function implicitLatestStoreRuntime(options: ProbeOptions): ProbeRuntime | undefined {
  if (options.transcript || !options.latest) return undefined;
  const { runtime } = detectHostRuntime(options.env);
  if (!hasRuntimeCapability(runtime, 'canProbeContext')) return undefined;
  return LEGACY_LATEST_STORE_HOSTS.includes(runtime) ? undefined : runtime;
}

export type HandoffThresholdSource =
  | 'project-scheme'
  | 'store-scheme'
  | 'global-scheme'
  | 'project'
  | 'store'
  | 'global'
  | 'default';

export interface HandoffThresholdReport {
  threshold: ThresholdValue;
  thresholdSource: HandoffThresholdSource;
  binding?: ThresholdBindingMetadata;
  diagnostics?: ThresholdDiagnostic[];
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
 * Rasen project) else the inherited store config `handoff.threshold` (when the
 * project's configuration inherits from a store — see
 * `store-config-inheritance`) else global config `handoff.threshold` else the
 * built-in default (0.5), and reports whether the probe has crossed it, in
 * either dual-form (D1/D2). Role-agnostic by design — a transcript probe has
 * no stage identity, so pipeline/stage/role overrides (which apply only to
 * `resolveStageHandoffConfig`) do not apply here, and neither does the
 * model-preset layer (that is a stage/role-scoped suggestion, not a bare
 * probe's business). Shares `resolveHandoffThresholdLayers()`
 * (src/core/effective-config.ts) with the pipeline resolver so the two
 * consumers cannot drift on what "the configured threshold" means. Async
 * because resolving the store layer reads the store registry
 * (`resolveConfigStoreLayer`). Remains a probe: callers must not treat
 * `shouldHandoff` as a reason to change the exit code.
 */
export async function resolveHandoffThresholdReport(
  pct: number,
  remainingTokens: number,
  runtimeOrCwd?: ProbeRuntime | string,
  cwdArg?: string
): Promise<HandoffThresholdReport> {
  // A capability test, not an identity check: a runtime with no context
  // probe must not be mistaken for a working directory and leak into the
  // `cwd` argument below.
  const runtime = hasRuntimeCapability(runtimeOrCwd, 'canProbeContext')
    ? runtimeOrCwd
    : undefined;
  const cwd =
    runtime === undefined
      ? runtimeOrCwd ?? process.cwd()
      : cwdArg ?? process.cwd();
  const projectRoot = findRepoPlanningRootSync(cwd);
  const storeLayer = await requireConfigStoreLayer(projectRoot);
  const layers = resolveHandoffThresholdLayers(projectRoot, storeLayer?.storeRoot);

  const selected = resolveThreshold({
    family: 'handoff',
    runtime,
    bindings: resolveThresholdBindingLayers(projectRoot, storeLayer?.storeRoot),
    schemes: loadThresholdSchemeSnapshot(),
    nonBinding: {
      project: { value: layers.projectThreshold, source: 'project' },
      store: { value: layers.storeThreshold, source: 'store' },
      global: { value: layers.globalThreshold, source: 'global' },
      default: { value: defaultHandoffThresholdForRuntime(runtime), source: 'default' },
    },
  });
  const threshold = selected.threshold;
  const thresholdSource = selected.source as HandoffThresholdSource;

  const shouldHandoff =
    typeof threshold === 'number'
      ? pct >= threshold
      : remainingTokens <= threshold.remainingTokens;

  return {
    threshold,
    thresholdSource,
    shouldHandoff,
    ...(selected.binding ? { binding: selected.binding } : {}),
    ...(selected.diagnostics.length > 0 ? { diagnostics: selected.diagnostics } : {}),
  };
}

/**
 * `--limit` is an input error, not a host state: an out-of-range value must
 * throw from every entry point, including the ones that answer environmental
 * absence with a tagged result. Extracted so {@link probeAgentContextSafe}'s
 * host gate cannot return before the check and downgrade a typo into an
 * exit-0 "unavailable".
 */
function validateProbeLimit(limit: number | undefined): void {
  if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
    throw new Error('--limit must be a positive integer (token count of the context window).');
  }
}

/**
 * Full probe: resolve the transcript, recognize the harness that owns it
 * (explicit `--runtime` wins over recognition), then read its context
 * occupancy with that harness's own reader. Throws an actionable error on any
 * unreadable/usage-free/unspecified input, an invalid `--runtime` value, or a
 * recognized harness Rasen ships no reader for.
 *
 * An explicit `--runtime` selects BOTH the locating store and the reader. An
 * inferred `--latest` selects only the store, from the detected host
 * ({@link implicitLatestStoreRuntime}); the reader is still recognized from the
 * located file, so nothing about how a file is measured changes with the host
 * it was found from. Flipping `canProbeContext` alone would not have been
 * enough: without this split an Oh My Pi host's implicit `--latest` still
 * resolves through the fallback Claude store and reports another harness's
 * conversation, which is the defect the capability was added to remove.
 */
export function probeAgentContext(options: ProbeOptions): AgentContextResult {
  const runtime = validateRuntime(options.runtime);
  validateProbeLimit(options.limit);
  const transcriptPath = resolveTranscriptPath(
    options,
    runtime ?? implicitLatestStoreRuntime(options)
  );
  const owner = detectSessionOwner(transcriptPath, runtime);
  return contextReaderFor(owner, transcriptPath).read(transcriptPath, {
    limit: options.limit,
  });
}

/** Tagged result of {@link probeAgentContextSafe} — success or environmental unavailability. */
export type ProbeAgentContextResult =
  | ({ available: true } & AgentContextResult)
  | { available: false; reason: 'no-transcript' | 'unsupported-host'; detail: string };

/**
 * Same resolution as {@link probeAgentContext}, but catches ONLY environmental
 * absence under `--latest` ({@link AgentContextUnavailableError}) and returns it
 * as a tagged `{available:false}` result instead of throwing (design D2). Every
 * other failure (invalid `--runtime`/`--limit`, no source flag, an explicit
 * `--transcript` that is unreadable/usage-free) still throws — those are input
 * errors, not a host's normal state, and must stay hard errors.
 *
 * An *inferred* probe on a harness with no context-probe adapter is refused
 * up front, before any transcript store is touched. Without `--transcript` or
 * `--runtime`, `resolveTranscriptPath` silently assumes Claude, so a harness
 * that sets Claude's own environment values (Oh My Pi) would otherwise return
 * some unrelated Claude session's occupancy — a wrong answer the caller cannot
 * distinguish from a correct one. An `unknown` host is deliberately not gated:
 * it has no adapter to contradict, and its legacy Claude-store resolution is
 * the behavior every existing caller already depends on. `--limit` is
 * validated BEFORE the gate: an out-of-range value is an input error on every
 * host, and returning the refusal first would tell a user with a `--limit`
 * typo that their host is unsupported.
 */
export function probeAgentContextSafe(options: ProbeOptions): ProbeAgentContextResult {
  if (options.latest && !options.transcript && options.runtime === undefined) {
    validateProbeLimit(options.limit);
    const { runtime } = detectHostRuntime(options.env);
    if (runtime !== 'unknown' && !hasRuntimeCapability(runtime, 'canProbeContext')) {
      return {
        available: false,
        reason: 'unsupported-host',
        detail:
          `No context probe exists for the detected host runtime "${runtime}". ` +
          `Pass --transcript <path>, or --runtime ${PROBE_RUNTIMES.join('|')} with --latest, ` +
          'to name what should be read.',
      };
    }
  }
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
 * through the same recognition as {@link probeAgentContext} (no explicit
 * override — callers like `pipeline resume` pass a bare path). Returns the
 * three-field estimate, or `undefined` on any read error — an unreadable
 * Codex rollout, or a transcript belonging to a harness Rasen ships no reader
 * for — because a caller that must never fail needs absence to stay
 * distinguishable from an estimate of zero occupancy.
 */
export function tryContextEstimate(
  transcriptPath: string,
  limit?: number
): ContextEstimate | undefined {
  try {
    const owner = detectSessionOwner(transcriptPath);
    const r = contextReaderFor(owner, transcriptPath).read(transcriptPath, { limit });
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
