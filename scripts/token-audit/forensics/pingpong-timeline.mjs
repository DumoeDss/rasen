import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as readline from 'node:readline';
import { createReadStream } from 'node:fs';

const base = 'C:/Users/Sayo/.claude/projects/E--AI-ChatAI-Agents-VibeCodingProjects-workflow-Reference-OpenSpec-code';
const sid = 'c4a16986-2b8e-4cac-8833-0e97bfff8eae';
const K = n => (n / 1000).toFixed(0) + 'k';

async function bursts(file, label) {
  const seen = new Set(); const reqs = [];
  const rl = readline.createInterface({ input: createReadStream(join(base, sid, 'subagents', file)), crlfDelay: Infinity });
  for await (const l of rl) {
    if (!l.includes('"usage"')) continue;
    let j; try { j = JSON.parse(l); } catch { continue; }
    if (j.type !== 'assistant' || !j.message?.usage) continue;
    const u = j.message.usage;
    if (!(u.cache_creation_input_tokens || u.cache_read_input_tokens || u.input_tokens)) continue;
    const id = j.message.id || j.uuid;
    if (seen.has(id)) continue;
    seen.add(id);
    reqs.push({ t: Date.parse(j.timestamp), r: u.cache_read_input_tokens || 0, w: u.cache_creation_input_tokens || 0 });
  }
  // cluster into bursts: gap > 3min starts a new burst
  const out = [];
  let cur = null; let prevPrefix = 0;
  for (const q of reqs) {
    if (!cur || q.t - cur.end > 3 * 60000) {
      if (cur) out.push(cur);
      cur = { label, start: q.t, end: q.t, reqs: 0, firstHit: cur === null ? 'spawn' : (q.r >= prevPrefix * 0.9 ? 'HIT' : 'MISS'), rewrote: cur === null ? q.w : (q.r >= prevPrefix * 0.9 ? 0 : q.w), totW: 0 };
    }
    cur.end = q.t; cur.reqs++; cur.totW += q.w;
    prevPrefix = q.r + q.w;
    if (out.length || cur.reqs > 1) {} // noop
  }
  if (cur) out.push(cur);
  return out;
}

const pairs = [
  ['agent-aimpl-workflows-7a4876f6e2312aa3.jsonl', 'IMPL', 'agent-arev-workflows-bb0b6bf3ac64bde6.jsonl', 'REV '],
];
for (const [fi, li, fr, lr] of pairs) {
  const a = await bursts(fi, li), b = await bursts(fr, lr);
  const all = [...a, ...b].sort((x, y) => x.start - y.start);
  console.log('=== workflows child: impl vs rev burst timeline ===');
  console.log('who   start(UTC)        dur(min) reqs  resume    rewrote-on-resume');
  for (const x of all) {
    const t = new Date(x.start).toISOString().slice(11, 19);
    console.log(`${x.label} ${t} ${String(((x.end - x.start) / 60000).toFixed(1)).padStart(9)}m ${String(x.reqs).padStart(4)}  ${x.firstHit.padEnd(6)} ${x.rewrote ? K(x.rewrote) : ''}`);
  }
  const missSum = all.filter(x => x.firstHit === 'MISS').reduce((s, x) => s + x.rewrote, 0);
  console.log(`resume MISS count: ${all.filter(x => x.firstHit === 'MISS').length}, ping-pong rewrite tax: ${K(missSum)} tokens`);
}

// aggregate across ALL impl/rev/planner agents: resume events after >3min idle, hit vs miss
console.log('\n=== ALL agents: resumes after >3min idle ===');
let hits = 0, misses = 0, missTok = 0;
for (const f of readdirSync(join(base, sid, 'subagents'))) {
  if (!f.endsWith('.jsonl')) continue;
  const bs = await bursts(f, f.slice(6, 20));
  for (const x of bs) {
    if (x.firstHit === 'HIT') hits++;
    else if (x.firstHit === 'MISS') { misses++; missTok += x.rewrote; }
  }
}
console.log(`resumes: HIT=${hits} MISS=${misses}  miss-rewrite total=${K(missTok)} tokens (5m-TTL tax on role switching)`);
