import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import * as readline from 'node:readline';
import { createReadStream } from 'node:fs';

const base = 'C:/Users/Sayo/.claude/projects/E--AI-ChatAI-Agents-VibeCodingProjects-workflow-Reference-OpenSpec-code';
const sid = 'c4a16986-2b8e-4cac-8833-0e97bfff8eae';
const files = [join(base, sid + '.jsonl')];
const subDir = join(base, sid, 'subagents');
try { for (const f of readdirSync(subDir)) if (f.endsWith('.jsonl')) files.push(join(subDir, f)); } catch {}

const K = n => (n / 1000).toFixed(1) + 'k';

async function analyze(file) {
  const s = {
    name: basename(file, '.jsonl'), requests: 0, out: 0, inRaw: 0, cacheW: 0, cacheR: 0,
    firstCacheW: null, maxCtx: 0, tools: {}, toolResultChars: {}, skills: [], agents: [],
    biggest: [], models: {},
  };
  const pendingTool = new Map(); // tool_use_id -> name
  const rl = readline.createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    let j; try { j = JSON.parse(line); } catch { continue; }
    const m = j.message;
    if (j.type === 'assistant' && m) {
      const u = m.usage;
      if (u && (u.output_tokens || u.input_tokens)) {
        s.requests++;
        s.out += u.output_tokens || 0;
        s.inRaw += u.input_tokens || 0;
        s.cacheW += u.cache_creation_input_tokens || 0;
        s.cacheR += u.cache_read_input_tokens || 0;
        const ctx = (u.input_tokens||0) + (u.cache_creation_input_tokens||0) + (u.cache_read_input_tokens||0);
        if (ctx > s.maxCtx) s.maxCtx = ctx;
        if (s.firstCacheW === null) s.firstCacheW = u.cache_creation_input_tokens || 0;
        if (m.model) s.models[m.model] = (s.models[m.model] || 0) + 1;
      }
      for (const c of Array.isArray(m.content) ? m.content : []) {
        if (c.type === 'tool_use') {
          s.tools[c.name] = (s.tools[c.name] || 0) + 1;
          pendingTool.set(c.id, c.name);
          if (c.name === 'Skill') s.skills.push(c.input?.skill || '?');
          if (c.name === 'Agent') s.agents.push(c.input?.name || c.input?.subagent_type || '?');
        }
      }
    }
    if (j.type === 'user' && m && Array.isArray(m.content)) {
      for (const c of m.content) {
        if (c.type === 'tool_result') {
          const name = pendingTool.get(c.tool_use_id) || '?';
          let chars = 0;
          if (typeof c.content === 'string') chars = c.content.length;
          else if (Array.isArray(c.content)) for (const p of c.content) chars += (p.text || '').length;
          s.toolResultChars[name] = (s.toolResultChars[name] || 0) + chars;
          s.biggest.push([chars, name]);
        }
      }
    }
  }
  s.biggest.sort((a, b) => b[0] - a[0]); s.biggest = s.biggest.slice(0, 3);
  return s;
}

const all = [];
for (const f of files) all.push(await analyze(f));

// role grouping by filename pattern
const role = n => {
  if (!n.startsWith('agent-')) return 'MAIN(LEAD)';
  const m = n.match(/^agent-a(planner|impl|rev|ship|archiver|fix|qa)/);
  return m ? 'sub:' + m[1] : 'sub:other';
};

const T = { requests: 0, out: 0, inRaw: 0, cacheW: 0, cacheR: 0 };
const byRole = {};
for (const s of all) {
  for (const k of Object.keys(T)) T[k] += s[k];
  const r = role(s.name);
  byRole[r] ??= { n: 0, requests: 0, out: 0, cacheW: 0, cacheR: 0, firstW: [] };
  byRole[r].n++; byRole[r].requests += s.requests; byRole[r].out += s.out;
  byRole[r].cacheW += s.cacheW; byRole[r].cacheR += s.cacheR;
  if (s.firstCacheW !== null) byRole[r].firstW.push(s.firstCacheW);
}

console.log('=== TOTALS (main + ' + (all.length - 1) + ' subagents) ===');
console.log(`API requests: ${T.requests}`);
console.log(`output:       ${K(T.out)}`);
console.log(`input(raw):   ${K(T.inRaw)}`);
console.log(`cache WRITE:  ${K(T.cacheW)}  (billed ~2x input at 1h TTL)`);
console.log(`cache READ:   ${K(T.cacheR)}  (billed 0.1x input)`);
console.log(`billed-input-equivalent: ${K(T.inRaw + 2 * T.cacheW + 0.1 * T.cacheR)}`);

console.log('\n=== BY ROLE ===');
console.log('role           files  reqs   output   cacheW    cacheR     avg-firstCacheW(spawn payload)');
for (const [r, v] of Object.entries(byRole).sort((a, b) => b[1].cacheR - a[1].cacheR)) {
  const avgFirst = v.firstW.length ? v.firstW.reduce((a, b) => a + b, 0) / v.firstW.length : 0;
  console.log(`${r.padEnd(14)} ${String(v.n).padStart(4)} ${String(v.requests).padStart(6)} ${K(v.out).padStart(8)} ${K(v.cacheW).padStart(9)} ${K(v.cacheR).padStart(10)}   ${K(avgFirst)}`);
}

console.log('\n=== MAIN session detail ===');
const main = all[0];
console.log(`requests=${main.requests} maxCtx=${K(main.maxCtx)} models=${JSON.stringify(main.models)}`);
console.log('skills loaded:', main.skills.join(', ') || '(none)');
console.log('agents spawned:', main.agents.length, '->', main.agents.slice(0, 40).join(', '));

console.log('\n=== TOOL RESULT VOLUME (chars, all files summed) ===');
const trv = {};
const tuc = {};
for (const s of all) {
  for (const [k, v] of Object.entries(s.toolResultChars)) trv[k] = (trv[k] || 0) + v;
  for (const [k, v] of Object.entries(s.tools)) tuc[k] = (tuc[k] || 0) + v;
}
for (const [k, v] of Object.entries(trv).sort((a, b) => b[1] - a[1]).slice(0, 15))
  console.log(`${(v / 1024).toFixed(0).padStart(7)} KB  ${String(tuc[k] || 0).padStart(5)} calls  ${k}`);

console.log('\n=== PER-FILE SUMMARY (sorted by cacheR = context re-read volume) ===');
console.log('file                                    reqs  output   cacheW     cacheR    firstW   maxCtx');
for (const s of all.sort((a, b) => b.cacheR - a.cacheR).slice(0, 20)) {
  console.log(`${s.name.slice(0, 38).padEnd(38)} ${String(s.requests).padStart(5)} ${K(s.out).padStart(7)} ${K(s.cacheW).padStart(8)} ${K(s.cacheR).padStart(10)} ${K(s.firstCacheW || 0).padStart(8)} ${K(s.maxCtx).padStart(8)}`);
}
