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
  };
  agents: CodexAgentRecord[];
  /** See {@link ClaudeAuditResult.caveats} — populated when `session.forkedFrom` is set. */
  caveats?: string[];
}

export type AuditResult = ClaudeAuditResult | CodexAuditResult;

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
