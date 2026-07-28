import { readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import * as readline from 'node:readline';
import { createReadStream } from 'node:fs';

const base = 'C:/Users/Sayo/.claude/projects/E--AI-ChatAI-Agents-VibeCodingProjects-workflow-Reference-OpenSpec-code';
const sid = 'c4a16986-2b8e-4cac-8833-0e97bfff8eae';
const K = n => (n / 1000).toFixed(0) + 'k';

for (const f of readdirSync(join(base, sid, 'subagents'))) {
  if (!f.endsWith('.jsonl')) continue;
  const lines = [];
  const rl = readline.createInterface({ input: createReadStream(join(base, sid, 'subagents', f)), crlfDelay: Infinity });
  for await (const l of rl) { try { lines.push(JSON.parse(l)); } catch {} }
  const seen = new Set(); const reqs = [];
  for (let i = 0; i < lines.length; i++) {
    const j = lines[i];
    if (j.type !== 'assistant' || !j.message?.usage) continue;
    const u = j.message.usage;
    if (!(u.cache_creation_input_tokens || u.cache_read_input_tokens || u.input_tokens)) continue;
    const id = j.message.id || j.uuid;
    if (seen.has(id)) { reqs[reqs.length - 1].lastIdx = i; continue; }
    seen.add(id);
    reqs.push({ t: Date.parse(j.timestamp), u, firstIdx: i, lastIdx: i });
  }
  for (let n = 1; n < reqs.length; n++) {
    const p = reqs[n - 1], c = reqs[n];
    const gap = (c.t - p.t) / 60000;
    if (gap < 3) continue;
    const prefix = (p.u.cache_read_input_tokens || 0) + (p.u.cache_creation_input_tokens || 0);
    const hit = (c.u.cache_read_input_tokens || 0) >= prefix * 0.9;
    if (!hit) continue; // only interested in the rare HITs
    const between = [];
    for (let i = p.lastIdx + 1; i < c.firstIdx; i++) {
      const j = lines[i];
      let d = j.type;
      if (j.type === 'user' && Array.isArray(j.message?.content)) {
        const txt = j.message.content.map(b => b.text || '').join(' ').slice(0, 120);
        d += `("${txt.replace(/\s+/g, ' ').trim().slice(0, 100)}")`;
      }
      between.push(d);
    }
    console.log(`${basename(f).slice(6, 30)} gap=${gap.toFixed(1)}m HIT prefix=${K(prefix)} between=[${between.join(' | ')}]`);
  }
}
