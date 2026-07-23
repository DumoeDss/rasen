/**
 * Per-file streaming parse of a Claude Code transcript — ported near-verbatim
 * from `scripts/token-audit/audit.mjs`'s `parseFile` (design D1), typed, with
 * `TranscriptFormatError` thrown at the points where the original script
 * silently assumed shape.
 *
 * Measurement discipline: a transcript writes one line PER CONTENT BLOCK and
 * copies the full usage object onto every line, so usage is deduped by
 * `message.id` (max output_tokens wins across duplicates), order preserved.
 *
 * Fail-soft boundary (design D3, corrected post-review — see M2 in
 * rasen/changes/agent-audit-command/work/review-report.md): a line that
 * fails to parse as JSON is skipped, same as before — that is NOT format
 * drift. An assistant entry whose `message.usage` is entirely absent (or
 * not an object) is ALSO silently skipped, matching the original script's
 * `if (u && sum > 0)` guard byte-for-byte (`git show
 * 2e8639ee:scripts/token-audit/audit.mjs`) — this is a benign, observed-in-
 * the-wild shape, not drift, and must not abort the file. The ONLY format-
 * drift throw in this module is a `message.usage` object that IS present
 * but carries a non-numeric value for one of the token fields the pricing
 * math reads — that is the one shape violation that would silently corrupt
 * accounting rather than just under-report a request with all-zero usage.
 * A field that is simply absent (undefined) still defaults to 0, matching
 * the original script's `|| 0` fallback.
 */
import { createReadStream } from 'node:fs';
import * as readline from 'node:readline';

import { TranscriptFormatError } from './errors.js';
import type { BetweenLines, ParseFileResult, ParsedRequest, ToolStat } from './types.js';

export interface TranscriptFile {
  path: string;
  kind: 'main' | 'subagent';
}

function freshBetween(): BetweenLines {
  return { toolResultLines: 0, userTextLines: 0, metaLines: 0, compact: false };
}

/** A present-but-non-numeric usage field is format drift; an absent one defaults to 0. */
function readNumericUsageField(
  usage: Record<string, unknown>,
  key: string,
  filePath: string,
  lineNumber: number
): number {
  const v = usage[key];
  if (v === undefined || v === null) return 0;
  if (typeof v !== 'number') {
    throw new TranscriptFormatError(
      `assistant message.usage.${key} is not a number`,
      filePath,
      lineNumber,
      `expected a number, got ${typeof v}`
    );
  }
  return v;
}

/**
 * One streaming pass over a transcript file. Produces the deduped request
 * list (order preserved, usage keyed by message.id) plus tool statistics.
 * Each request carries the parent-chain and between-lines evidence needed
 * for rebase attribution.
 */
export async function parseTranscriptFile(file: TranscriptFile): Promise<ParseFileResult> {
  const requests: ParsedRequest[] = [];
  const seen = new Map<string, ParsedRequest>();
  const tools: Record<string, ToolStat> = {};
  const pendingTool = new Map<string, string>();
  let current: ParsedRequest | null = null;
  let between: BetweenLines = freshBetween();

  const rl = readline.createInterface({ input: createReadStream(file.path), crlfDelay: Infinity });
  let lineNumber = 0;
  for await (const line of rl) {
    lineNumber++;
    let j: Record<string, unknown>;
    try {
      j = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue; // a single unparseable line is skipped — not format drift (design D3)
    }
    if (j.isCompactSummary) between.compact = true;
    if (j.isMeta) between.metaLines++;

    if (j.type === 'assistant' && j.message) {
      const m = j.message as Record<string, unknown>;
      if (Array.isArray(m.content)) {
        for (const c of m.content as Array<Record<string, unknown>>) {
          if (c.type === 'tool_use' && typeof c.id === 'string' && typeof c.name === 'string') {
            (tools[c.name] ??= { calls: 0, resultChars: 0 }).calls++;
            pendingTool.set(c.id, c.name);
          }
        }
      }
      // A missing/non-object usage is a benign skip (original script parity,
      // M2) — NOT format drift. Coercing to `{}` lets every field below
      // default to 0 via readNumericUsageField's own undefined->0 fallback,
      // so this line simply contributes no request (same as the original
      // `if (u && sum > 0)` guard falling through). Only a present field
      // with a non-numeric VALUE is real drift, thrown below.
      const u = m.usage;
      const usage: Record<string, unknown> =
        u !== undefined && u !== null && typeof u === 'object' && !Array.isArray(u)
          ? (u as Record<string, unknown>)
          : {};
      const inTok = readNumericUsageField(usage, 'input_tokens', file.path, lineNumber);
      const cw = readNumericUsageField(usage, 'cache_creation_input_tokens', file.path, lineNumber);
      const cr = readNumericUsageField(usage, 'cache_read_input_tokens', file.path, lineNumber);
      const out = readNumericUsageField(usage, 'output_tokens', file.path, lineNumber);
      if (inTok + cw + cr + out > 0) {
        const uuid = typeof j.uuid === 'string' ? j.uuid : undefined;
        const id = (typeof m.id === 'string' && m.id) || uuid;
        if (!id) {
          throw new TranscriptFormatError(
            'usage-bearing assistant entry has no message id or line uuid to dedupe by',
            file.path,
            lineNumber,
            'expected message.id or a line-level uuid'
          );
        }
        if (current && current.id === id) {
          if (uuid) current.lastUuid = uuid;
          if (out > current.out) current.out = out;
        } else if (seen.has(id)) {
          // late duplicate of an older message id — refresh output ceiling only
          const r = seen.get(id)!;
          if (out > r.out) r.out = out;
        } else {
          const req: ParsedRequest = {
            id,
            ts: typeof j.timestamp === 'string' ? Date.parse(j.timestamp) : null,
            model: typeof m.model === 'string' ? m.model : null,
            in: inTok,
            cw,
            cr,
            out,
            firstParent: typeof j.parentUuid === 'string' ? j.parentUuid : null,
            prevLastUuid: current ? current.lastUuid : null,
            between,
            lastUuid: uuid ?? '',
          };
          seen.set(id, req);
          requests.push(req);
          current = req;
          between = freshBetween();
        }
      }
    } else if (j.type === 'user' && j.message && Array.isArray((j.message as Record<string, unknown>).content)) {
      let sawToolResult = false;
      const content = (j.message as Record<string, unknown>).content as Array<Record<string, unknown>>;
      for (const c of content) {
        if (c.type === 'tool_result') {
          sawToolResult = true;
          const toolUseId = typeof c.tool_use_id === 'string' ? c.tool_use_id : undefined;
          const name = (toolUseId && pendingTool.get(toolUseId)) || '?';
          let chars = 0;
          if (typeof c.content === 'string') chars = c.content.length;
          else if (Array.isArray(c.content)) {
            for (const p of c.content as Array<Record<string, unknown>>) {
              chars += typeof p.text === 'string' ? p.text.length : 0;
            }
          }
          (tools[name] ??= { calls: 0, resultChars: 0 }).resultChars += chars;
        }
      }
      if (sawToolResult) between.toolResultLines++;
      else between.userTextLines++;
    }
  }
  return { requests, tools };
}
