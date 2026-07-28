import { join } from 'node:path';
import * as readline from 'node:readline';
import { createReadStream } from 'node:fs';

const base = 'C:/Users/Sayo/.claude/projects/E--AI-ChatAI-Agents-VibeCodingProjects-workflow-Reference-OpenSpec-code';
const sid = 'c4a16986-2b8e-4cac-8833-0e97bfff8eae';

// scan a file; find deduped-miss events with gap<5min; show the surrounding line types
// and whether the parentUuid chain forked (parent of miss-request's first line != uuid of previous request's last line)
async function scan(file, label) {
  const lines = [];
  const rl = readline.createInterface({ input: createReadStream(join(base, file)), crlfDelay: Infinity });
  for await (const l of rl) {
    let j; try { j = JSON.parse(l); } catch { continue; }
    lines.push(j);
  }
  // build deduped request list with line indices
  const reqs = []; const seen = new Set();
  for (let i = 0; i < lines.length; i++) {
    const j = lines[i];
    if (j.type !== 'assistant' || !j.message?.usage) continue;
    const u = j.message.usage;
    if (!(u.cache_creation_input_tokens || u.cache_read_input_tokens || u.input_tokens)) continue;
    const id = j.message.id || j.uuid;
    if (seen.has(id)) { reqs[reqs.length - 1].lastIdx = i; reqs[reqs.length - 1].lastUuid = j.uuid; continue; }
    seen.add(id);
    reqs.push({ id, firstIdx: i, lastIdx: i, ts: j.timestamp, u, firstParent: j.parentUuid, lastUuid: j.uuid });
  }
  console.log(`\n### ${label}: ${reqs.length} unique requests`);
  for (let n = 1; n < reqs.length; n++) {
    const p = reqs[n - 1], c = reqs[n];
    const pu = p.u, cu = c.u;
    const prevPrefix = (pu.cache_read_input_tokens || 0) + (pu.cache_creation_input_tokens || 0);
    const miss = (cu.cache_read_input_tokens || 0) < prevPrefix * 0.9 && (cu.cache_creation_input_tokens || 0) > 50000;
    if (!miss) continue;
    const gap = (Date.parse(c.ts) - Date.parse(p.ts)) / 60000;
    if (gap >= 5) continue;
    // what lies between prev request's last line and this request's first line?
    const between = [];
    for (let i = p.lastIdx + 1; i < c.firstIdx; i++) {
      const j = lines[i];
      let d = j.type;
      if (j.type === 'user' && Array.isArray(j.message?.content)) {
        const kinds = j.message.content.map(b => b.type).join('+');
        let chars = 0; for (const b of j.message.content) { if (typeof b.content === 'string') chars += b.content.length; if (Array.isArray(b.content)) for (const q of b.content) chars += (q.text || '').length; if (b.text) chars += b.text.length; }
        d += `(${kinds},${(chars / 1024).toFixed(0)}kB)`;
      }
      if (j.isMeta) d += '[meta]';
      if (j.isCompactSummary) d += '[COMPACT]';
      between.push(d);
    }
    const forked = c.firstParent !== p.lastUuid;
    console.log(`gap=${gap.toFixed(1)}m rewrote=${((cu.cache_creation_input_tokens || 0) / 1000).toFixed(0)}k forked=${forked} between=[${between.slice(0, 12).join(' | ')}]${between.length > 12 ? ' …+' + (between.length - 12) : ''}`);
  }
}

await scan(sid + '/subagents/agent-aplanner-1-6827e4905f02e08d.jsonl', 'planner-1');
await scan(sid + '/subagents/agent-aimpl-spaces-5394b5f352e2e9c0.jsonl', 'impl-spaces');
await scan(sid + '/subagents/agent-aimpl-store-scope-9a1187cbd45c4ed3.jsonl', 'impl-store-scope');
