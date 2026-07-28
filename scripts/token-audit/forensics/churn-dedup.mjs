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

const B = { spawn: 0, incremental: 0, ttl60: 0, gap30to60: 0, gap5to30: 0, gapUnder5: 0 };
const E = { ttl60: 0, gap30to60: 0, gap5to30: 0, gapUnder5: 0 };
const missGaps = [];
const T = { reqs: 0, out: 0, inRaw: 0, cw: 0, cr: 0 };
const roleAgg = {};
const role = n => {
  if (!n.startsWith('agent-')) return 'MAIN(LEAD)';
  const m = n.match(/^agent-a(planner|impl|rev|ship|archiver|fix|qa)/);
  return m ? 'sub:' + m[1] : 'sub:other';
};

async function collect(file) {
  // dedupe by message id, keep the max-output_tokens usage per id, preserve order
  const seen = new Map(); const order = [];
  const rl = readline.createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.includes('"usage"')) continue;
    let j; try { j = JSON.parse(line); } catch { continue; }
    if (j.type !== 'assistant' || !j.message?.usage) continue;
    const u = j.message.usage;
    if (!(u.cache_creation_input_tokens || u.cache_read_input_tokens || u.input_tokens)) continue;
    const id = j.message.id || j.uuid;
    if (!seen.has(id)) { seen.set(id, { u, ts: j.timestamp }); order.push(id); }
    else if ((u.output_tokens || 0) > (seen.get(id).u.output_tokens || 0)) seen.get(id).u = u;
  }
  return order.map(id => seen.get(id));
}

for (const file of files) {
  const reqs = await collect(file);
  const name = basename(file, '.jsonl');
  const r0 = role(name);
  roleAgg[r0] ??= { n: 0, reqs: 0, out: 0, cw: 0, cr: 0 };
  roleAgg[r0].n++;
  let prev = null;
  for (const { u, ts } of reqs) {
    const w = u.cache_creation_input_tokens || 0, r = u.cache_read_input_tokens || 0,
      inp = u.input_tokens || 0, out = u.output_tokens || 0;
    T.reqs++; T.out += out; T.inRaw += inp; T.cw += w; T.cr += r;
    roleAgg[r0].reqs++; roleAgg[r0].out += out; roleAgg[r0].cw += w; roleAgg[r0].cr += r;
    const t = ts ? Date.parse(ts) : null;
    if (!prev) B.spawn += w;
    else {
      const gapMin = t && prev.t ? (t - prev.t) / 60000 : null;
      if (r >= prev.prefix * 0.9) B.incremental += w;
      else {
        const cause = gapMin === null ? 'gapUnder5' : gapMin >= 60 ? 'ttl60' : gapMin >= 30 ? 'gap30to60' : gapMin >= 5 ? 'gap5to30' : 'gapUnder5';
        B[cause] += w; E[cause]++;
        if (w > 50000) missGaps.push({ file: name.slice(0, 30), gapMin: gapMin?.toFixed(1), rewrote: w, prevPrefix: prev.prefix, readNow: r });
      }
    }
    prev = { t, prefix: r + w };
  }
}

console.log('=== DEDUPED TOTALS (unique API messages) ===');
console.log(`requests: ${T.reqs}  output: ${K(T.out)}  input: ${K(T.inRaw)}  cacheW: ${M(T.cw)}  cacheR: ${M(T.cr)}`);
console.log(`billed-input-equivalent: ${M(T.inRaw + 2 * T.cw + 0.1 * T.cr)}`);

console.log('\n=== BY ROLE (deduped) ===');
for (const [r, v] of Object.entries(roleAgg).sort((a, b) => b[1].cr - a[1].cr))
  console.log(`${r.padEnd(14)} files=${v.n} reqs=${v.reqs} out=${K(v.out)} cacheW=${M(v.cw)} cacheR=${M(v.cr)}`);

const total = Object.values(B).reduce((a, b) => a + b, 0);
console.log('\n=== cacheW attribution (deduped) ===');
for (const [k, v] of Object.entries(B).sort((a, b) => b[1] - a[1]))
  console.log(`${k.padEnd(12)} ${M(v).padStart(9)}  ${(100 * v / total).toFixed(1).padStart(5)}%  ${E[k] !== undefined ? E[k] + ' events' : ''}`);
console.log(`TOTAL        ${M(total).padStart(9)}`);

console.log('\n=== all miss events >50k rewrote (sorted by gap) ===');
missGaps.sort((a, b) => (b.rewrote - a.rewrote));
console.log('file                            gap(min)  rewrote  prevPrefix  readNow');
for (const e of missGaps.slice(0, 30))
  console.log(`${e.file.padEnd(30)} ${String(e.gapMin).padStart(8)} ${K(e.rewrote).padStart(8)} ${K(e.prevPrefix).padStart(10)} ${K(e.readNow).padStart(8)}`);
console.log(`(${missGaps.length} events >50k)`);
