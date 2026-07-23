import { join, basename } from 'node:path';
import * as readline from 'node:readline';
import { createReadStream } from 'node:fs';

const base = 'C:/Users/Sayo/.claude/projects/E--AI-ChatAI-Agents-VibeCodingProjects-workflow-Reference-OpenSpec-code';
const sid = 'c4a16986-2b8e-4cac-8833-0e97bfff8eae';
const targets = [
  { file: join(base, sid + '.jsonl'), reqs: [643, 651] },
  { file: join(base, sid, 'subagents', 'agent-aimpl-store-scope-9a1187cbd45c4ed3.jsonl'), reqs: [549, 555] },
];

for (const t of targets) {
  console.log('\n### ' + basename(t.file).slice(0, 40));
  let reqIdx = 0;
  const rl = readline.createInterface({ input: createReadStream(t.file), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.includes('"usage"')) continue;
    let j; try { j = JSON.parse(line); } catch { continue; }
    if (j.type !== 'assistant' || !j.message?.usage) continue;
    const u = j.message.usage;
    if (!(u.cache_creation_input_tokens || u.cache_read_input_tokens || u.input_tokens)) continue;
    reqIdx++;
    if (reqIdx < t.reqs[0] || reqIdx > t.reqs[1]) continue;
    const c = j.message.content;
    const blocks = Array.isArray(c) ? c.map(b => b.type + (b.name ? ':' + b.name : '')).join(',') : typeof c;
    const iters = u.iterations ? u.iterations.length : 0;
    console.log(JSON.stringify({
      req: reqIdx, ts: j.timestamp, msgId: j.message.id, reqId: j.requestId || j.request_id || null,
      uuid: (j.uuid || '').slice(0, 8), parent: (j.parentUuid || '').slice(0, 8),
      stop: j.message.stop_reason, model: j.message.model, iters,
      in: u.input_tokens, cw: u.cache_creation_input_tokens, cr: u.cache_read_input_tokens, out: u.output_tokens,
      blocks: blocks.slice(0, 80),
    }));
  }
}
