/**
 * Zed thread-payload decode (the Zed analog of `parse-codex.ts`). Turns one
 * `threads` row into the fields the report needs: it branches on `data_type`
 * (`zstd` → `fzstd` decompress; `json` → as-is; anything else → fail-soft),
 * parses the JSON payload, and extracts token totals, the retained-request
 * count, the first user command, the model, the data version, the working
 * directory, and thread timestamps — omitting (never guessing) anything the
 * data does not provide.
 *
 * A shape the decoder does not recognize raises {@link TranscriptFormatError},
 * the one error the CLI layer renders as the friendly experimental-format
 * failure rather than crashing.
 */
import { decompress } from 'fzstd';

import { TranscriptFormatError } from '../errors.js';
import type { ZedThreadRow } from './database.js';

/** Per-thread fields extracted from a row + its decoded payload. */
export interface DecodedZedThread {
  threadId: string;
  parentThreadId: string | null;
  title: string | null;
  workingDir: string | null;
  model: string | null;
  dataVersion: string | null;
  firstUserCommand: string | null;
  firstTs: number | null;
  lastTs: number | null;
  retainedRequests: number;
  /** Uncached input (`cumulative_token_usage.input_tokens`). */
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function readString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function firstNonEmpty(...vals: Array<string | null>): string | null {
  for (const v of vals) if (v) return v;
  return null;
}

/** ISO-8601 (`Z`, offset, or fractional seconds) → epoch ms, or null. */
function parseZedTs(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/** Primary path from the `folder_paths` JSON array, or null. */
function primaryFolderPath(folderPaths: string | null): string | null {
  if (!folderPaths) return null;
  try {
    const parsed: unknown = JSON.parse(folderPaths);
    if (Array.isArray(parsed)) {
      const first = parsed.find((p) => typeof p === 'string' && p.length > 0);
      return typeof first === 'string' ? first : null;
    }
    return readString(parsed);
  } catch {
    return null;
  }
}

/** First user message text (`messages[i].User.content`), or null. */
function extractFirstUserCommand(payload: Record<string, unknown>): string | null {
  const messages = payload.messages;
  if (!Array.isArray(messages)) return null;
  for (const m of messages) {
    const rec = asRecord(m);
    const user = rec ? asRecord(rec.User) : null;
    if (!user) continue;
    const content = readString(user.content);
    if (content && content.trim()) return content;
  }
  return null;
}

function decodePayloadBytes(row: ZedThreadRow): unknown {
  const marker = `zed:${row.id}`;
  let jsonBytes: Uint8Array;
  if (row.dataType === 'zstd') {
    try {
      jsonBytes = decompress(row.data);
    } catch (err) {
      throw new TranscriptFormatError('failed to zstd-decompress a Zed thread payload', marker, 0, (err as Error).message);
    }
  } else if (row.dataType === 'json') {
    jsonBytes = row.data;
  } else {
    throw new TranscriptFormatError(
      `unrecognized Zed thread data_type '${row.dataType}'`,
      marker,
      0,
      "expected data_type 'zstd' or 'json'"
    );
  }
  try {
    return JSON.parse(Buffer.from(jsonBytes).toString('utf-8'));
  } catch (err) {
    throw new TranscriptFormatError('Zed thread payload is not valid JSON', marker, 0, (err as Error).message);
  }
}

/**
 * Decodes one Zed thread row into {@link DecodedZedThread}. Throws
 * {@link TranscriptFormatError} when the payload is not a recognizable Zed
 * thread object (no `cumulative_token_usage`), so a targeted thread fails soft
 * rather than producing guessed numbers.
 */
export function decodeZedThread(row: ZedThreadRow): DecodedZedThread {
  const marker = `zed:${row.id}`;
  const payload = asRecord(decodePayloadBytes(row));
  if (!payload) {
    throw new TranscriptFormatError('Zed thread payload is not a JSON object', marker, 0, 'expected a top-level object');
  }
  const usage = asRecord(payload.cumulative_token_usage);
  if (!usage) {
    throw new TranscriptFormatError(
      'Zed thread payload has no cumulative_token_usage object',
      marker,
      0,
      'expected .cumulative_token_usage'
    );
  }

  const requestUsage = payload.request_token_usage;
  const retainedRequests = Array.isArray(requestUsage)
    ? requestUsage.length
    : asRecord(requestUsage)
      ? Object.keys(asRecord(requestUsage)!).length
      : 0;

  return {
    threadId: row.id,
    parentThreadId: row.parentId,
    title: firstNonEmpty(readString(payload.title), readString(row.summary)),
    workingDir: primaryFolderPath(row.folderPaths),
    model: readString(payload.model),
    dataVersion: readString(payload.version),
    firstUserCommand: extractFirstUserCommand(payload),
    firstTs: parseZedTs(row.createdAt),
    lastTs: parseZedTs(row.updatedAt),
    retainedRequests,
    inputTokens: num(usage.input_tokens),
    cachedInputTokens: num(usage.cache_read_input_tokens),
    outputTokens: num(usage.output_tokens),
  };
}
