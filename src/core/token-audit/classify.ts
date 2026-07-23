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
import type { Burst, ChurnEvent, ParsedRequest, PricingConfig, RequestClass } from './types.js';

export const PRICING: PricingConfig = { cacheReadX: 0.1, cacheWriteMainX: 2, cacheWriteSubX: 1.25 };
/** cache_read >= 90% of prev prefix => warm continuation. */
export const HIT_PREFIX_RATIO = 0.9;
/** context shrank below 70% of prev => compaction/rewind. */
export const DROP_CTX_RATIO = 0.7;
/** >3min silence splits bursts (resume boundary). */
export const BURST_GAP_MS = 3 * 60_000;
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

export function clusterBursts(requests: ParsedRequest[], classes: RequestClass[]): Burst[] {
  const bursts: Burst[] = [];
  let cur: Burst | null = null;
  for (let i = 0; i < requests.length; i++) {
    const req = requests[i];
    if (!cur || (req.ts !== null && cur.end !== null && req.ts - cur.end > BURST_GAP_MS)) {
      if (cur) bursts.push(cur);
      cur = {
        start: req.ts,
        end: req.ts,
        requests: 0,
        resume: bursts.length === 0 ? 'spawn' : classes[i] === 'hit' ? 'HIT' : 'MISS',
        rewrote: bursts.length === 0 ? req.cw : classes[i] === 'hit' ? 0 : req.cw,
      };
    }
    cur.end = req.ts ?? cur.end;
    cur.requests++;
  }
  if (cur) bursts.push(cur);
  return bursts;
}
