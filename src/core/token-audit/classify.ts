/**
 * Cache-churn classification and burst clustering — ported near-verbatim
 * from `scripts/token-audit/audit.mjs` (design D1). Same math, typed.
 *
 * Measurement discipline (do not change without re-reading
 * rasen/office-hours/token-cost-audit.md): a resumed request whose
 * cache_read collapses below `HIT_PREFIX_RATIO` of the previous cached
 * prefix is a MISS, classified by cause — context-drop (context shrank
 * below `DROP_CTX_RATIO`: compaction/rewind), ttl-expiry (idle gap >= the
 * tier's TTL), rebase (gap under TTL but the parentUuid chain forked or a
 * non-tool user message was injected), else unattributed.
 */
import type { CodexDeltaRequest } from './parse-codex.js';
import type { Burst, ChurnEvent, CodexRebuildEvent, ParsedRequest, PricingConfig, RequestClass } from './types.js';

export const PRICING: PricingConfig = { cacheReadX: 0.1, cacheWriteMainX: 2, cacheWriteSubX: 1.25 };
/** cache_read >= 90% of prev prefix => warm continuation. */
export const HIT_PREFIX_RATIO = 0.9;
/** context shrank below 70% of prev => compaction/rewind. */
export const DROP_CTX_RATIO = 0.7;
/** >3min silence splits bursts (resume boundary). */
export const BURST_GAP_MS = 3 * 60_000;
/**
 * Codex idle-gap threshold (minutes) — the interval heuristic for a Codex
 * cache rebuild the runtime did not evidence directly. Codex publishes NO
 * cache TTL, so this is an APPROXIMATION derived from request spacing only,
 * presented as such (design D2). Event-evidenced causes are checked first.
 */
export const CODEX_IDLE_GAP_MIN = 5;
export const TTL_MIN: Record<'main' | 'subagent', number> = { main: 60, subagent: 5 };
export const REQUEST_CLASSES: readonly RequestClass[] = [
  'spawn',
  'hit',
  'ttl-expiry',
  'rebase',
  'context-drop',
  'unattributed',
];

export interface ClassifyResult {
  classes: RequestClass[];
  /** Churn events without the `agent` index — the caller (audit.ts) attaches it. */
  churnEvents: Array<Omit<ChurnEvent, 'agent'>>;
}

export function classify(requests: ParsedRequest[], ttlMin: number): ClassifyResult {
  const classes: RequestClass[] = [];
  const churnEvents: Array<Omit<ChurnEvent, 'agent'>> = [];
  let prev: ParsedRequest | null = null;
  for (const req of requests) {
    let cls: RequestClass;
    if (!prev) {
      cls = 'spawn';
    } else {
      const prevPrefix = prev.cr + prev.cw;
      const prevCtx = prev.in + prev.cw + prev.cr;
      const ctx = req.in + req.cw + req.cr;
      const gapMin = req.ts !== null && prev.ts !== null ? (req.ts - prev.ts) / 60_000 : null;
      if (req.cr >= prevPrefix * HIT_PREFIX_RATIO) {
        cls = 'hit';
      } else {
        const forked = req.firstParent !== null && req.prevLastUuid !== null && req.firstParent !== req.prevLastUuid;
        const injected = req.between.userTextLines > 0;
        if (req.between.compact || ctx < prevCtx * DROP_CTX_RATIO) cls = 'context-drop';
        else if (gapMin !== null && gapMin >= ttlMin) cls = 'ttl-expiry';
        else if (forked || injected) cls = 'rebase';
        else cls = 'unattributed';
        churnEvents.push({
          ts: req.ts,
          gapMin: gapMin === null ? null : Math.round(gapMin * 10) / 10,
          cause: cls,
          rewrote: req.cw,
          prevPrefix,
          readNow: req.cr,
          forked,
          injected,
        });
      }
    }
    classes.push(cls);
    prev = req;
  }
  return { classes, churnEvents };
}

/** Minimal per-request shape burst clustering needs (design D9): a timestamp, the
 *  cache-write cost to attribute to a MISS resume, and whether the request was a hit. */
interface BurstPoint {
  ts: number | null;
  rewrote: number;
  isHit: boolean;
}

function clusterBurstsGeneric(points: BurstPoint[]): Burst[] {
  const bursts: Burst[] = [];
  let cur: Burst | null = null;
  for (const p of points) {
    if (!cur || (p.ts !== null && cur.end !== null && p.ts - cur.end > BURST_GAP_MS)) {
      if (cur) bursts.push(cur);
      cur = {
        start: p.ts,
        end: p.ts,
        requests: 0,
        resume: bursts.length === 0 ? 'spawn' : p.isHit ? 'HIT' : 'MISS',
        rewrote: bursts.length === 0 ? p.rewrote : p.isHit ? 0 : p.rewrote,
      };
    }
    cur.end = p.ts ?? cur.end;
    cur.requests++;
  }
  if (cur) bursts.push(cur);
  return bursts;
}

export function clusterBursts(requests: ParsedRequest[], classes: RequestClass[]): Burst[] {
  return clusterBurstsGeneric(requests.map((r, i) => ({ ts: r.ts, rewrote: r.cw, isHit: classes[i] === 'hit' })));
}

export function clusterCodexBursts(requests: CodexDeltaRequest[], classes: RequestClass[]): Burst[] {
  return clusterBurstsGeneric(
    requests.map((r, i) => ({ ts: r.ts, rewrote: r.cacheWriteInputTokens, isHit: classes[i] === 'hit' }))
  );
}

export interface ClassifyCodexResult {
  classes: RequestClass[];
  /** Rebuild events without the `agent` index — the caller (audit.ts) attaches it. */
  rebuildEvents: Array<Omit<CodexRebuildEvent, 'agent'>>;
}

/**
 * Codex cache-rebuild classification (design D2). Emits the shared
 * `RequestClass` values EXCEPT that a Codex `rebase` always means an injected
 * user message — Codex rollouts carry no parentUuid-style message chain, so
 * chain-fork is never claimed. A rebuild's cause is decided by event evidence
 * FIRST (compaction/rollback => context-drop, injection => rebase), and only
 * then the idle-gap approximation ({@link CODEX_IDLE_GAP_MIN}); everything
 * else is `unattributed`.
 */
export function classifyCodex(requests: CodexDeltaRequest[]): ClassifyCodexResult {
  const classes: RequestClass[] = [];
  const rebuildEvents: Array<Omit<CodexRebuildEvent, 'agent'>> = [];
  let prev: CodexDeltaRequest | null = null;
  for (const req of requests) {
    let cls: RequestClass;
    if (!prev) {
      cls = 'spawn';
    } else {
      const prevPrefix = prev.cachedInputTokens + prev.cacheWriteInputTokens;
      const prevCtx = prev.contextEstimate;
      const ctx = req.contextEstimate;
      const gapMin = req.ts !== null && prev.ts !== null ? (req.ts - prev.ts) / 60_000 : null;
      if (req.cachedInputTokens >= prevPrefix * HIT_PREFIX_RATIO) {
        cls = 'hit';
      } else {
        const compacted = req.markers.compacted > 0;
        const rolledBack = req.markers.rolledBack > 0;
        const injected = req.markers.userMessage > 0;
        // Event-evidenced causes FIRST (design D2 "event-evidenced causes are
        // checked before the interval heuristic"): a recorded compaction/rollback
        // or an injected user message is direct evidence and outranks the
        // ratio-inferred context shrink, which is itself an inference — so a
        // ratio-only drop must not demote a genuine injection to context-drop.
        if (compacted || rolledBack) cls = 'context-drop';
        else if (injected) cls = 'rebase';
        else if (ctx < prevCtx * DROP_CTX_RATIO) cls = 'context-drop'; // inference, not an event
        else if (gapMin !== null && gapMin >= CODEX_IDLE_GAP_MIN) cls = 'ttl-expiry';
        else cls = 'unattributed';
        rebuildEvents.push({
          ts: req.ts,
          gapMin: gapMin === null ? null : Math.round(gapMin * 10) / 10,
          cause: cls,
          rewrote: req.cacheWriteInputTokens,
          prevPrefix,
          readNow: req.cachedInputTokens,
          compacted,
          injected,
          rolledBack,
          // ttl-expiry is an idle-gap APPROXIMATION (Codex publishes no TTL) —
          // marked so a JSON-only consumer can tell it from a confirmed cause.
          approximate: cls === 'ttl-expiry',
        });
      }
    }
    classes.push(cls);
    prev = req;
  }
  return { classes, rebuildEvents };
}
