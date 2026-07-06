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
 * agent or the `openspec agent context` command can decide whether to hand off.
 *
 * Pure core: it reads the filesystem but never writes, prints, or exits. The
 * command layer owns output formatting and process exit codes.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

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
 * Newest MAIN-session transcript (`*.jsonl`, excluding `agent-*.jsonl` subagent
 * files) directly under `baseDir`, by mtime. Throws an actionable error when the
 * directory is absent or holds no main-session transcript.
 */
export function findLatestMainTranscript(baseDir: string): string {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(baseDir, { withFileTypes: true });
  } catch {
    throw new Error(
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
    throw new Error(
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
 * Full probe: resolve the transcript then compute its context occupancy.
 * Throws an actionable error on any unreadable/usage-free/unspecified input.
 */
export function probeAgentContext(options: ProbeOptions): AgentContextResult {
  if (
    options.limit !== undefined &&
    (!Number.isInteger(options.limit) || options.limit <= 0)
  ) {
    throw new Error('--limit must be a positive integer (token count of the context window).');
  }
  const transcriptPath = resolveTranscriptPath(options);
  return computeContextFromTranscript(transcriptPath, { limit: options.limit });
}

/**
 * Best-effort context estimate for an already-known transcript path. Returns
 * the three-field estimate, or `undefined` on any read error — for callers like
 * `pipeline resume` that must never fail because a probe could not be taken.
 */
export function tryContextEstimate(
  transcriptPath: string,
  limit?: number
): ContextEstimate | undefined {
  try {
    const r = computeContextFromTranscript(transcriptPath, { limit });
    return { contextTokens: r.contextTokens, limit: r.limit, pct: r.pct };
  } catch {
    return undefined;
  }
}
