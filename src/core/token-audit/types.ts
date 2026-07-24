/**
 * Shared types for the token-audit core module (src/core/token-audit/).
 *
 * Split so classify.ts, parse.ts, parse-codex.ts, discover-codex.ts, and
 * audit.ts can all reference the same shapes without circular imports (the
 * request-classification constants live in classify.ts, not here).
 */

export type AgentKind = 'main' | 'subagent';

export type RequestClass = 'spawn' | 'hit' | 'ttl-expiry' | 'rebase' | 'context-drop' | 'unattributed';

/** Lines accumulated between the previous request and this one (rebase/injection evidence). */
export interface BetweenLines {
  toolResultLines: number;
  userTextLines: number;
  metaLines: number;
  compact: boolean;
}

/** One deduped Claude request record, keyed by message.id (or line uuid fallback). */
export interface ParsedRequest {
  id: string;
  ts: number | null;
  model: string | null;
  in: number;
  cw: number;
  cr: number;
  out: number;
  firstParent: string | null;
  prevLastUuid: string | null;
  between: BetweenLines;
  lastUuid: string;
}

export interface ToolStat {
  calls: number;
  resultChars: number;
}

export interface ParseFileResult {
  requests: ParsedRequest[];
  tools: Record<string, ToolStat>;
}

export interface ChurnEvent {
  agent: number;
  ts: number | null;
  gapMin: number | null;
  cause: RequestClass;
  rewrote: number;
  prevPrefix: number;
  readNow: number;
  forked: boolean;
  injected: boolean;
}

export interface Burst {
  start: number | null;
  end: number | null;
  requests: number;
  resume: 'spawn' | 'HIT' | 'MISS';
  rewrote: number;
}

export interface ClaudeAgentRecord {
  index: number;
  key: string;
  kind: AgentKind;
  label: string;
  roleFamily: string;
  ttlMinutes: number;
  models: Record<string, number>;
  firstTs: number | null;
  lastTs: number | null;
  requests: number;
  outputTokens: number;
  inputRaw: number;
  cacheWrite: number;
  cacheRead: number;
  spawnWrite: number;
  peakContext: number;
  billedInputEq: number;
  churn: { tokens: number; events: number };
  resumes: { hit: number; miss: number; missRewrote: number };
  tools: Record<string, ToolStat>;
  bursts: Burst[];
}

export interface PricingConfig {
  cacheReadX: number;
  cacheWriteMainX: number;
  cacheWriteSubX: number;
}

export interface ClaudeTotals {
  requests: number;
  outputTokens: number;
  inputRaw: number;
  cacheWrite: number;
  cacheRead: number;
  billedInputEq: number;
  churn: { tokens: number; events: number; byCause: Record<string, { tokens: number; events: number }> };
  resumes: { hit: number; miss: number; missRewrote: number };
}

export interface ClaudeAuditResult {
  schema: 'rasen-token-audit/2';
  generatedAt: string;
  session: {
    id: string;
    runtime: 'claude';
    mainTranscript: string;
    start: number | null;
    end: number | null;
    durationMs: number | null;
    agentCount: number;
  };
  pricing: PricingConfig;
  totals: ClaudeTotals;
  byModel: Record<string, { requests: number; outputTokens: number; cacheWrite: number; cacheRead: number }>;
  gapHistogram: Record<string, number>;
  agents: ClaudeAgentRecord[];
  requests: {
    columns: string[];
    classes: readonly string[];
    rows: Array<Array<number | null>>;
  };
  churnEvents: ChurnEvent[];
  /**
   * Human-readable caveats about the report's trustworthiness (additive,
   * schema stays `rasen-token-audit/2` — M1 fix). Absent/empty when there is
   * nothing to flag. Currently populated only on the Codex fork-replay path
   * (see {@link CodexAuditResult.session.forkedFrom}); present here too for
   * schema symmetry across runtimes.
   */
  caveats?: string[];
}

// ---------------------------------------------------------------------------
// Codex runtime shapes (design D5/D6)
// ---------------------------------------------------------------------------

export interface CodexRawTokens {
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
}

export interface CodexTurn {
  turnId: string | null;
  start: number | null;
  end: number | null;
  requests: number;
  rawTokens: CodexRawTokens;
  cacheHitRatio: number;
  /** Set when the turn ended via `turn_aborted` rather than `task_complete` (design D5). */
  aborted?: boolean;
}

/**
 * One Codex cache-rebuild event (design D3) — a non-hit, non-spawn request
 * whose cached-input reading collapsed. `rewrote` is the request's
 * cache-write cost. `compacted`/`injected`/`rolledBack` record which event
 * evidence was present. A Codex `rebase` cause always means `injected`
 * (chain-fork is never claimed).
 */
export interface CodexRebuildEvent {
  agent: number;
  ts: number | null;
  gapMin: number | null;
  cause: RequestClass;
  rewrote: number;
  prevPrefix: number;
  readNow: number;
  compacted: boolean;
  injected: boolean;
  rolledBack: boolean;
  /**
   * True when `cause` is `ttl-expiry` — an idle-gap APPROXIMATION derived from
   * request spacing, not a confirmed cache-TTL expiry (Codex publishes no TTL).
   * Lets a JSON-only consumer tell an approximated cause from an evidenced one
   * without re-deriving it (spec: "the report ... SHALL present that cause as
   * an approximation"). Additive.
   */
  approximate?: boolean;
}

export interface CodexAgentRecord {
  index: number;
  key: string;
  kind: AgentKind;
  label: string;
  threadId: string;
  parentThreadId: string | null;
  firstTs: number | null;
  lastTs: number | null;
  requests: number;
  rawTokens: CodexRawTokens;
  cacheHitRatio: number;
  turns: CodexTurn[];
  /** Peak per-request context size (design D6). Additive. */
  peakContext?: number;
  /** Model context window for this thread, or null when the rollout did not report one (design D6). Additive. */
  modelContextWindow?: number | null;
  /** Activity bursts split by idle gaps (design D9). Additive. */
  bursts?: Burst[];
  /** Per-agent rebuild rollup (design D3). Additive. */
  rebuilds?: { events: number; rewroteTokens: number; byCause: Record<string, { events: number; rewroteTokens: number }> };
}

export interface CodexAuditResult {
  schema: 'rasen-token-audit/2';
  generatedAt: string;
  session: {
    id: string;
    runtime: 'codex';
    mainTranscript: string;
    start: number | null;
    end: number | null;
    durationMs: number | null;
    agentCount: number;
    /**
     * `session_meta.forked_from_id` of the AUDITED (target) thread, when
     * present — this thread's rollout replays another session's history
     * into its own file (M1 fix). Absent when the target thread is not a
     * fork. Derived request counts/timings from BEFORE this thread's own
     * first local turn are not per-request trustworthy when set; see
     * `caveats`.
     */
    forkedFrom?: string;
  };
  totals: {
    requests: number;
    rawTokens: CodexRawTokens;
    cacheHitRatio: number;
    /** Cache-rebuild rollup across all agents (design D3). Additive; absent on pre-enrichment reports. */
    rebuilds?: { events: number; rewroteTokens: number; byCause: Record<string, { events: number; rewroteTokens: number }> };
  };
  agents: CodexAgentRecord[];
  /**
   * Per-request timeline (design D1), columnar to match the Claude shape and
   * the viewer's column-index plumbing. Additive; absent on pre-enrichment
   * reports. Columns:
   * `['agent','ts','input','cachedInput','cacheWrite','output','reasoningOutput','context','class']`.
   */
  requests?: {
    columns: string[];
    classes: readonly string[];
    rows: Array<Array<number | null>>;
  };
  /** Itemized cache-rebuild events across all agents (design D3). Additive. */
  rebuildEvents?: CodexRebuildEvent[];
  /**
   * Dimensions the Codex rollout data cannot support, each with a reason
   * (design D7). Built from a named constant; rendered as a disclosure panel.
   * Additive.
   */
  unsupportedDimensions?: Array<{ dimension: string; reason: string }>;
  /** See {@link ClaudeAuditResult.caveats} — populated when `session.forkedFrom` is set or the increment cross-check diverges. */
  caveats?: string[];
}

// ---------------------------------------------------------------------------
// Zed runtime shapes (Zed threads.db adapter)
// ---------------------------------------------------------------------------

/**
 * The honest subset of token figures Zed's `cumulative_token_usage` actually
 * stores. Reasoning-output and cache-write totals are deliberately ABSENT
 * (not zero-valued) — Zed does not record them, and a zero field would read as
 * observed zero usage. See {@link ZedAuditResult.caveats}.
 */
export interface ZedRawTokens {
  /** Uncached input (`cumulative_token_usage.input_tokens`). */
  inputTokens: number;
  /** Cache-read input (`cumulative_token_usage.cache_read_input_tokens`). */
  cachedInputTokens: number;
  outputTokens: number;
}

/**
 * One Zed thread (the audited root or one of its `parent_id`-linked
 * descendants), represented as a single aggregate entry — Zed does not retain
 * enough per-request detail to reconstruct a per-request or per-turn timeline.
 * `cacheHitRatio` is `cachedInputTokens / (inputTokens + cachedInputTokens)`
 * (differs from the Codex `cached/input` definition, because the Zed subset
 * keeps uncached and cached input distinct rather than folded).
 */
export interface ZedThreadRecord {
  index: number;
  /** Thread id (parity with the other runtimes' `key`). */
  key: string;
  threadId: string;
  parentThreadId: string | null;
  kind: AgentKind;
  title: string | null;
  /** Working directory from the `folder_paths` column, when present. */
  workingDir?: string | null;
  /** Model from the decoded payload, when present. */
  model?: string | null;
  /** The thread's first user message (`messages[0].User.content`), when present. */
  firstUserCommand?: string | null;
  firstTs: number | null;
  lastTs: number | null;
  /**
   * Count of retained `request_token_usage` entries — NOT a complete API
   * request count; Zed prunes older entries, so this can undercount after a
   * compaction. Disclosed in {@link ZedAuditResult.caveats}.
   */
  retainedRequests: number;
  rawTokens: ZedRawTokens;
  cacheHitRatio: number;
}

/**
 * A first-class Zed report (`session.runtime === 'zed'`), not the Codex
 * impersonation the older external adapter used. Shares the schema tag with
 * the other runtimes (`rasen-token-audit/2`, viewer dispatches on
 * `session.runtime`) but omits every Claude/Codex-only structure (pricing,
 * churn/rebuild, per-request timeline, unsupported-dimensions) since Zed's
 * stored data cannot support them.
 */
export interface ZedAuditResult {
  schema: 'rasen-token-audit/2';
  generatedAt: string;
  session: {
    id: string;
    runtime: 'zed';
    /** Resolved `threads.db` path (kept under `mainTranscript` for cross-runtime symmetry). */
    mainTranscript: string;
    title?: string | null;
    workingDir?: string | null;
    firstUserCommand?: string | null;
    start: number | null;
    end: number | null;
    durationMs: number | null;
    /** Thread count (named `agentCount` for parity with the other runtimes). */
    agentCount: number;
  };
  totals: {
    retainedRequests: number;
    rawTokens: ZedRawTokens;
    cacheHitRatio: number;
  };
  threads: ZedThreadRecord[];
  source: { adapter: 'zed-threads-db'; dataVersion: string | null };
  /** Always populated: the Zed data-limit disclosures (see the "Zed data limits are disclosed" requirement). */
  caveats: string[];
}

export type AuditResult = ClaudeAuditResult | CodexAuditResult | ZedAuditResult;

export const SCHEMA_VERSION = 'rasen-token-audit/2' as const;

/**
 * Narrows {@link AuditResult} on `session.runtime`. Plain `result.session.runtime
 * === 'codex'` does not narrow `result` itself — TypeScript's control-flow
 * analysis only narrows a discriminated union on a property checked directly
 * on the union member, not one nested under an intermediate property — so
 * callers that need `result.totals`/`result.agents` typed per-runtime should
 * use this guard instead.
 */
export function isCodexAuditResult(result: AuditResult): result is CodexAuditResult {
  return result.session.runtime === 'codex';
}

/**
 * Narrows {@link AuditResult} to a Zed report on `session.runtime` — the same
 * intermediate-property narrowing limitation that motivates
 * {@link isCodexAuditResult} applies here.
 */
export function isZedAuditResult(result: AuditResult): result is ZedAuditResult {
  return result.session.runtime === 'zed';
}
