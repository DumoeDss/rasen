/**
 * Where each registered runtime keeps its sessions, and how a target is
 * recognized as belonging to one.
 *
 * One of four sibling implementation registries under `src/core/runtimes/`
 * (`session-stores`, `context-readers`, `audit-readers`,
 * `dispatch-adapters`). Each declares one `satisfies`-checked map against the
 * capability-derived union `src/core/runtime-adapters.ts` exports, so a
 * declared capability with no implementation and an implementation with no
 * declared capability are both build failures (design D2).
 *
 * They are four modules rather than one barrel because their dependencies
 * differ by an order of magnitude: `audit-readers` reaches the Zed reader's
 * WASM SQLite engine (measured +7 ms and +10 MB RSS at import), which has no
 * business loading on the `rasen agent context` pre-flight path. A consumer
 * imports the registry its operation needs and nothing else.
 *
 * Every adapter member is an arrow that calls its implementation, never a
 * bare re-export of it. These registries import provider modules that import
 * them back (`agent-context.ts` both provides the Claude locator and consumes
 * `SESSION_STORES`); deferring the dereference to call time makes those
 * cycles inert regardless of module evaluation order. Do not "simplify" a
 * wrapper into a bare function reference.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  claudeProjectsDir,
  findLatestMainTranscript,
  findLatestRollout,
} from '../agent-context.js';
import { resolveCodexHome } from '../codex/index.js';
import {
  SNIFF_FALLBACK_RUNTIME,
  type RuntimeAdapterId,
  type SessionStore,
  type SessionTarget,
} from '../runtime-adapters.js';

/** codex-cli's own rollout filename convention — the same one `findRolloutPath` builds paths from. */
const CODEX_ROLLOUT_BASENAME = /^rollout-.*\.jsonl$/;
/**
 * Claude Code's line-level row types. A transcript whose first row carries no
 * `message` (a `summary` header, most often) is still recognizably Claude's.
 */
const CLAUDE_ROW_TYPES: Record<string, true> = {
  summary: true,
  user: true,
  assistant: true,
  system: true,
};

function firstRow(target: SessionTarget): Record<string, unknown> | undefined {
  if (target.firstLine === undefined) return undefined;
  try {
    const row: unknown = JSON.parse(target.firstLine);
    return typeof row === 'object' && row !== null && !Array.isArray(row)
      ? (row as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

export const SESSION_STORES = {
  claude: {
    id: 'claude',
    recognizes: (target) => {
      const row = firstRow(target);
      if (!row) return false;
      if (typeof row.message === 'object' && row.message !== null) return true;
      return typeof row.type === 'string' && CLAUDE_ROW_TYPES[row.type] === true;
    },
    locateLatest: (options) =>
      findLatestMainTranscript(
        options.dir ?? claudeProjectsDir(options.cwd, options.homeDir)
      ),
  },
  codex: {
    id: 'codex',
    /**
     * The filename convention first (zero I/O, covers every rollout in situ),
     * then a first-line signature for a renamed or copied file. A real
     * rollout's first row is always `session_meta` (live-verified against ~40
     * rollouts on this machine); a `payload` envelope with no Claude-style
     * `message` field is accepted defensively for any other Codex row shape.
     */
    recognizes: (target) => {
      if (CODEX_ROLLOUT_BASENAME.test(path.basename(target.path))) return true;
      const row = firstRow(target);
      if (!row) return false;
      return row.type === 'session_meta' || ('payload' in row && row.message === undefined);
    },
    locateLatest: (options) =>
      findLatestRollout(
        options.dir ?? path.join(resolveCodexHome(), 'sessions'),
        options.cwd
      ),
  },
  zed: {
    id: 'zed',
    /** A thread database, recognized by path alone — it has no first line to read. */
    recognizes: (target) =>
      target.path.endsWith('.db') ||
      target.path.endsWith('.sqlite') ||
      path.basename(target.path) === 'threads.db',
  },
  omp: {
    id: 'omp',
    /**
     * Oh My Pi reserves a fixed-width `title` row at file creation — its `pad`
     * field exists so the title can be rewritten in place — so that row is
     * first in every session file on disk (verified against all 19 on this
     * machine). The `session` row is accepted too, for a file whose title row
     * was never reserved.
     *
     * No `locateLatest`, no reader: recognition alone is what turns an Oh My
     * Pi target from a fabricated Claude zero into an honest refusal
     * (design D8). Locating the live session is genuine domain work and
     * belongs with the reader that needs it.
     */
    recognizes: (target) => {
      const row = firstRow(target);
      if (!row) return false;
      if (row.type === 'title') return true;
      return row.type === 'session' && typeof row.version === 'number';
    },
  },
} satisfies { [Id in RuntimeAdapterId]: SessionStore<Id> };

/**
 * Recognition order. Zed leads because it recognizes by path alone: behind a
 * content check, a multi-megabyte thread database would be read into a string
 * to sniff a line it does not have. Claude trails because its shape is also
 * {@link SNIFF_FALLBACK_RUNTIME}, so its position cannot change any outcome.
 */
const RECOGNITION_ORDER = ['zed', 'codex', 'omp', 'claude'] as const;

export const SESSION_STORE_LIST: readonly SessionStore[] = Object.freeze(
  RECOGNITION_ORDER.map((id) => SESSION_STORES[id] as SessionStore)
);

function readFirstNonEmptyLine(target: string): string | undefined {
  let content: string;
  try {
    content = fs.readFileSync(target, 'utf-8');
  } catch {
    return undefined;
  }
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

/**
 * Which harness owns a session target (design D4).
 *
 * An explicit override wins outright; otherwise the first store that claims
 * the target wins, and an unclaimed target resolves to the declared
 * {@link SNIFF_FALLBACK_RUNTIME} rather than to the trailing branch of a
 * chain. The target's first line is read at most once for the whole pass, and
 * only if a store actually asks for it.
 */
export function detectSessionOwner(
  target: string,
  override?: RuntimeAdapterId
): RuntimeAdapterId {
  if (override) return override;
  let firstLine: string | undefined;
  let read = false;
  const candidate: SessionTarget = {
    path: target,
    get firstLine(): string | undefined {
      if (!read) {
        read = true;
        firstLine = readFirstNonEmptyLine(target);
      }
      return firstLine;
    },
  };
  for (const store of SESSION_STORE_LIST) {
    if (store.recognizes(candidate)) return store.id;
  }
  return SNIFF_FALLBACK_RUNTIME;
}
