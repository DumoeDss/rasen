import { readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import * as readline from 'node:readline';
import { createReadStream } from 'node:fs';

const base = 'C:/Users/Sayo/.claude/projects/E--AI-ChatAI-Agents-VibeCodingProjects-workflow-Reference-OpenSpec-code';
const sid = '46f078c9-6666-45f6-af3a-322f901454a2';
const files = [join(base, sid + '.jsonl')];
try { for (const f of readdirSync(join(base, sid, 'subagents'))) if (f.endsWith('.jsonl')) files.push(join(base, sid, 'subagents', f)); } catch {}

const K = n => (n / 1000).toFixed(1) + 'k';

for (const file of files) {
  const name = basename(file, '.jsonl').slice(0, 40);
  const seen = new Set(); const reqs = [];
  const rl = readline.createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const l of rl) {
    if (!l.includes('"usage"')) continue;
    let j; try { j = JSON.parse(l); } catch { continue; }
    if (j.type !== 'assistant' || !j.message?.usage) continue;
    const u = j.message.usage;
    if (!(u.cache_creation_input_tokens || u.cache_read_input_tokens || u.input_tokens)) continue;
    const id = j.message.id || j.uuid;
    if (seen.has(id)) continue;
    seen.add(id);
    reqs.push({ ts: Date.parse(j.timestamp), u });
  }
  console.log(`\n### ${name} (${reqs.length} reqs)`);
  for (let i = 1; i < reqs.length; i++) {
    const p = reqs[i - 1], c = reqs[i];
    const prefix = (p.u.cache_read_input_tokens || 0) + (p.u.cache_creation_input_tokens || 0);
    const gapMin = (c.ts - p.ts) / 60000;
    const r = c.u.cache_read_input_tokens || 0, w = c.u.cache_creation_input_tokens || 0;
    // report every gap >= 1min: did the resume hit the cache?
    if (gapMin >= 1) {
      const hit = r >= prefix * 0.9 ? 'HIT ' : 'MISS';
      console.log(`gap=${gapMin.toFixed(1).padStart(6)}m ${hit} prevPrefix=${K(prefix).padStart(8)} read=${K(r).padStart(8)} wrote=${K(w).padStart(8)}`);
    }
  }
}
