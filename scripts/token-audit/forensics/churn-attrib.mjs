import { readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import * as readline from 'node:readline';
import { createReadStream } from 'node:fs';

const base = 'C:/Users/Sayo/.claude/projects/E--AI-ChatAI-Agents-VibeCodingProjects-workflow-Reference-OpenSpec-code';
const sid = 'c4a16986-2b8e-4cac-8833-0e97bfff8eae';
const files = [join(base, sid + '.jsonl')];
const subDir = join(base, sid, 'subagents');
try { for (const f of readdirSync(subDir)) if (f.endsWith('.jsonl')) files.push(join(subDir, f)); } catch {}

const M = n => (n / 1e6).toFixed(2) + 'M';
const K = n => (n / 1000).toFixed(0) + 'k';

// global buckets (token amounts of cacheW attributed to each cause)
const B = { spawn: 0, incremental: 0, ttl60: 0, gap5to60: 0, gapUnder5: 0, afterDrop: 0 };
const E = { ttl60: 0, gap5to60: 0, gapUnder5: 0, afterDrop: 0, drops: 0 }; // event counts
const events = []; // notable miss events
const gapHist = {}; // idle-gap histogram (all consecutive request pairs)

async function analyze(file) {
  const name = basename(file, '.jsonl');
  let prev = null; // {ts, cachedPrefix, ctx}
  let reqIdx = 0;
  const rl = readline.createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.includes('"usage"')) continue;
    let j; try { j = JSON.parse(line); } catch { continue; }
    if (j.type !== 'assistant' || !j.message?.usage) continue;
    const u = j.message.usage;
    const w = u.cache_creation_input_tokens || 0, r = u.cache_read_input_tokens || 0, inp = u.input_tokens || 0;
    if (!w && !r && !inp) continue;
    reqIdx++;
    const ts = j.timestamp ? Date.parse(j.timestamp) : null;
    const ctx = inp + w + r;
    if (!prev) {
      B.spawn += w;
    } else {
      const gapMin = ts && prev.ts ? (ts - prev.ts) / 60000 : null;
      if (gapMin !== null) {
        const bucket = gapMin < 1 ? '<1m' : gapMin < 5 ? '1-5m' : gapMin < 15 ? '5-15m' : gapMin < 60 ? '15-60m' : '>60m';
        gapHist[bucket] = (gapHist[bucket] || 0) + 1;
      }
      const reused = r >= prev.cachedPrefix * 0.9; // prefix cache hit
      const dropped = ctx < prev.ctx * 0.7; // context shrank >30% => truncation/compact/rewind
      if (reused) {
        B.incremental += w;
      } else {
        let cause;
        if (dropped) { cause = 'afterDrop'; E.drops++; }
        else if (gapMin !== null && gapMin >= 60) cause = 'ttl60';
        else if (gapMin !== null && gapMin >= 5) cause = 'gap5to60';
        else cause = 'gapUnder5';
        B[cause] += w; E[cause]++;
        if (w > 100000) events.push({ file: name.slice(0, 34), req: reqIdx, gapMin: gapMin?.toFixed(1), cause, rewrote: w, prevPrefix: prev.cachedPrefix, readNow: r, prevCtx: prev.ctx, ctxNow: ctx });
      }
    }
    prev = { ts, cachedPrefix: r + w, ctx };
  }
}

for (const f of files) await analyze(f);

const total = Object.values(B).reduce((a, b) => a + b, 0);
console.log('=== cacheW attribution (tokens) ===');
for (const [k, v] of Object.entries(B).sort((a, b) => b[1] - a[1]))
  console.log(`${k.padEnd(12)} ${M(v).padStart(9)}  ${(100 * v / total).toFixed(1).padStart(5)}%  ${E[k] !== undefined ? E[k] + ' events' : ''}`);
console.log(`TOTAL        ${M(total).padStart(9)}   (cross-check vs 62.8M expected)`);
console.log(`context-drop events (>30% shrink): ${E.drops}`);

console.log('\n=== idle-gap histogram (consecutive requests, same agent) ===');
for (const k of ['<1m', '1-5m', '5-15m', '15-60m', '>60m']) console.log(`${k.padEnd(7)} ${gapHist[k] || 0}`);

console.log('\n=== top miss events (rewrote >100k) ===');
events.sort((a, b) => b.rewrote - a.rewrote);
console.log('file                                req   gap(min) cause      rewrote  prevPrefix  readNow  prevCtx->ctx');
for (const e of events.slice(0, 25))
  console.log(`${e.file.padEnd(34)} ${String(e.req).padStart(4)} ${String(e.gapMin).padStart(9)} ${e.cause.padEnd(9)} ${K(e.rewrote).padStart(8)} ${K(e.prevPrefix).padStart(10)} ${K(e.readNow).padStart(8)}  ${K(e.prevCtx)}->${K(e.ctxNow)}`);
console.log(`\n(${events.length} events total >100k rewrote)`);
