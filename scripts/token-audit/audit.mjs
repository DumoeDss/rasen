#!/usr/bin/env node
/**
 * rasen token audit — consolidated session cost analyzer.
 *
 * Parses a Claude Code session transcript (main + subagent JSONL files) and
 * emits a single session-audit.json with: deduped billing totals, per-agent
 * records ordered by first activation, a per-request timeline, cache-churn
 * events with cause attribution, and burst/resume (warm vs cold) statistics.
 * Open the JSON in viewer.html (same directory) to explore it visually.
 *
 * Usage:
 *   node scripts/token-audit/audit.mjs <sessionId|path/to/main.jsonl>
 *        [--projects-dir <dir>] [--out <file>] [--pretty]
 *
 * Measurement discipline (hard-won, see rasen/office-hours/token-cost-audit.md):
 *  - Transcripts write one line PER CONTENT BLOCK and copy the full usage
 *    object onto every line. Counting by line overstates ~2.5x. All usage is
 *    deduplicated by message.id (max output_tokens wins), order preserved.
 *  - Cache-write pricing differs by agent tier: the main session writes at
 *    1h TTL (2x input), subagents at 5m TTL (1.25x). Reads are 0.1x.
 *  - Churn causes: a resumed request whose cache_read collapses below 90% of
 *    the previous cached prefix is a MISS. Classified as context-drop
 *    (context shrank >30%: compaction/rewind), ttl-expiry (idle gap >= the
 *    tier's TTL), rebase (gap under TTL but the parentUuid chain forked or a
 *    non-tool user message was injected — SendMessage/attachment delivery),
 *    else unattributed.
 */

import { createReadStream } from 'node:fs';
import { readdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, basename, resolve, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import * as readline from 'node:readline';

const PRICING = { cacheReadX: 0.1, cacheWriteMainX: 2, cacheWriteSubX: 1.25 };
const HIT_PREFIX_RATIO = 0.9; // cache_read >= 90% of prev prefix => warm continuation
const DROP_CTX_RATIO = 0.7; // context shrank below 70% of prev => compaction/rewind
const BURST_GAP_MS = 3 * 60_000; // >3min silence splits bursts (resume boundary)
const TTL_MIN = { main: 60, subagent: 5 };
const REQUEST_CLASSES = ['spawn', 'hit', 'ttl-expiry', 'rebase', 'context-drop', 'unattributed'];

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { pretty: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--projects-dir') args.projectsDir = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--pretty') args.pretty = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else rest.push(a);
  }
  args.target = rest[0];
  return args;
}

function defaultProjectsDir() {
  const slug = resolve(process.cwd()).replace(/[^a-zA-Z0-9-]/g, '-');
  return join(homedir(), '.claude', 'projects', slug);
}

/** Resolve the main transcript path from a session id (prefix ok) or a direct path. */
function resolveMainTranscript(target, projectsDir) {
  if (!target) throw new Error('usage: audit.mjs <sessionId|main.jsonl> [--projects-dir <dir>] [--out <file>] [--pretty]');
  if (target.endsWith('.jsonl')) {
    const p = isAbsolute(target) ? target : resolve(target);
    if (!existsSync(p)) throw new Error(`transcript not found: ${p}`);
    return p;
  }
  const dir = projectsDir || defaultProjectsDir();
  if (!existsSync(dir)) throw new Error(`projects dir not found: ${dir} (pass --projects-dir)`);
  const exact = join(dir, `${target}.jsonl`);
  if (existsSync(exact)) return exact;
  const matches = readdirSync(dir).filter((f) => f.endsWith('.jsonl') && f.startsWith(target));
  if (matches.length === 1) return join(dir, matches[0]);
  if (matches.length > 1) throw new Error(`session id prefix "${target}" is ambiguous: ${matches.slice(0, 5).join(', ')}`);
  throw new Error(`no transcript matching "${target}" in ${dir}`);
}

function discoverAgentFiles(mainPath) {
  const sid = basename(mainPath, '.jsonl');
  const files = [{ path: mainPath, kind: 'main' }];
  const subDir = join(dirname(mainPath), sid, 'subagents');
  try {
    for (const f of readdirSync(subDir).sort()) {
      if (f.endsWith('.jsonl')) files.push({ path: join(subDir, f), kind: 'subagent' });
    }
  } catch { /* no subagents dir */ }
  return { sid, files };
}

// ---------------------------------------------------------------------------
// Per-file streaming parse
// ---------------------------------------------------------------------------

function parseAgentLabel(fileBase, kind) {
  if (kind === 'main') return { label: 'MAIN', roleFamily: 'main' };
  const label = fileBase.replace(/^agent-/, '').replace(/-[0-9a-f]{8,}$/, '');
  const l = label.toLowerCase();
  const roleFamily =
    /plan/.test(l) ? 'planner'
    : /impl/.test(l) ? 'implementer'
    : /(^|[^a-z])a?rev|review/.test(l) ? 'reviewer'
    : /fix/.test(l) ? 'fixer'
    : /ship/.test(l) ? 'shipper'
    : /archiv/.test(l) ? 'archiver'
    : /qa/.test(l) ? 'qa'
    : 'other';
  return { label, roleFamily };
}

/**
 * One streaming pass over a transcript file. Produces the deduped request
 * list (order preserved, usage keyed by message.id) plus tool statistics.
 * Each request carries the parent-chain and between-lines evidence needed
 * for rebase attribution.
 */
async function parseFile(file) {
  const requests = []; // {id, ts, model, in, cw, cr, out, firstParent, prevLastUuid, between}
  const seen = new Map(); // message.id -> request record
  const tools = {}; // name -> {calls, resultChars}
  const pendingTool = new Map(); // tool_use_id -> name
  let current = null; // request currently receiving lines
  let between = null; // lines accumulated since the previous request ended
  const freshBetween = () => ({ toolResultLines: 0, userTextLines: 0, metaLines: 0, compact: false });
  between = freshBetween();

  const rl = readline.createInterface({ input: createReadStream(file.path), crlfDelay: Infinity });
  for await (const line of rl) {
    let j;
    try { j = JSON.parse(line); } catch { continue; }
    if (j.isCompactSummary) between.compact = true;
    if (j.isMeta) between.metaLines++;

    if (j.type === 'assistant' && j.message) {
      const m = j.message;
      // Tool census: one content block per line, so counting per line is exact.
      if (Array.isArray(m.content)) {
        for (const c of m.content) {
          if (c.type === 'tool_use') {
            (tools[c.name] ??= { calls: 0, resultChars: 0 }).calls++;
            pendingTool.set(c.id, c.name);
          }
        }
      }
      const u = m.usage;
      if (u && ((u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.input_tokens || 0) + (u.output_tokens || 0) > 0)) {
        const id = m.id || j.uuid;
        if (current && current.id === id) {
          current.lastUuid = j.uuid;
          if ((u.output_tokens || 0) > current.out) current.out = u.output_tokens || 0;
        } else if (seen.has(id)) {
          // late duplicate of an older message id — refresh output ceiling only
          const r = seen.get(id);
          if ((u.output_tokens || 0) > r.out) r.out = u.output_tokens || 0;
        } else {
          const req = {
            id,
            ts: j.timestamp ? Date.parse(j.timestamp) : null,
            model: m.model || null,
            in: u.input_tokens || 0,
            cw: u.cache_creation_input_tokens || 0,
            cr: u.cache_read_input_tokens || 0,
            out: u.output_tokens || 0,
            firstParent: j.parentUuid || null,
            prevLastUuid: current ? current.lastUuid : null,
            between,
            lastUuid: j.uuid,
          };
          seen.set(id, req);
          requests.push(req);
          current = req;
          between = freshBetween();
        }
      }
    } else if (j.type === 'user' && j.message && Array.isArray(j.message.content)) {
      let sawToolResult = false;
      for (const c of j.message.content) {
        if (c.type === 'tool_result') {
          sawToolResult = true;
          const name = pendingTool.get(c.tool_use_id) || '?';
          let chars = 0;
          if (typeof c.content === 'string') chars = c.content.length;
          else if (Array.isArray(c.content)) for (const p of c.content) chars += (p.text || '').length;
          (tools[name] ??= { calls: 0, resultChars: 0 }).resultChars += chars;
        }
      }
      if (sawToolResult) between.toolResultLines++;
      else between.userTextLines++;
    }
  }
  return { requests, tools };
}

// ---------------------------------------------------------------------------
// Classification + aggregation
// ---------------------------------------------------------------------------

function classify(requests, ttlMin) {
  const classes = [];
  const churnEvents = [];
  let prev = null;
  for (const req of requests) {
    let cls;
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

function clusterBursts(requests, classes) {
  const bursts = [];
  let cur = null;
  for (let i = 0; i < requests.length; i++) {
    const req = requests[i];
    if (!cur || (req.ts !== null && cur.end !== null && req.ts - cur.end > BURST_GAP_MS)) {
      if (cur) bursts.push(cur);
      cur = {
        start: req.ts,
        end: req.ts,
        requests: 0,
        resume: bursts.length === 0 && cur === null ? 'spawn' : classes[i] === 'hit' ? 'HIT' : 'MISS',
        rewrote: bursts.length === 0 && cur === null ? req.cw : classes[i] === 'hit' ? 0 : req.cw,
      };
    }
    cur.end = req.ts ?? cur.end;
    cur.requests++;
  }
  if (cur) bursts.push(cur);
  return bursts;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('usage: node audit.mjs <sessionId|path/to/main.jsonl> [--projects-dir <dir>] [--out <file>] [--pretty]');
    return;
  }
  const mainPath = resolveMainTranscript(args.target, args.projectsDir);
  const { sid, files } = discoverAgentFiles(mainPath);
  console.error(`session ${sid}: main + ${files.length - 1} subagent transcript(s)`);

  const agents = [];
  const timelineRows = []; // [agentIndex, ts, in, cw, cr, out, context, classIndex]
  const allChurn = [];
  const gapHistogram = { '<1m': 0, '1-5m': 0, '5-15m': 0, '15-60m': 0, '>60m': 0 };
  const totals = { requests: 0, outputTokens: 0, inputRaw: 0, cacheWrite: 0, cacheRead: 0, billedInputEq: 0 };
  const byModel = {};

  for (const file of files) {
    const fileBase = basename(file.path, '.jsonl');
    const { requests, tools } = await parseFile(file);
    if (requests.length === 0) continue;
    const ttlMin = TTL_MIN[file.kind];
    const { classes, churnEvents } = classify(requests, ttlMin);
    const bursts = clusterBursts(requests, classes);
    const { label, roleFamily } = parseAgentLabel(fileBase, file.kind);
    const writeX = file.kind === 'main' ? PRICING.cacheWriteMainX : PRICING.cacheWriteSubX;

    const agent = {
      index: agents.length,
      key: fileBase,
      kind: file.kind,
      label,
      roleFamily,
      ttlMinutes: ttlMin,
      models: {},
      firstTs: requests[0].ts,
      lastTs: requests[requests.length - 1].ts,
      requests: requests.length,
      outputTokens: 0,
      inputRaw: 0,
      cacheWrite: 0,
      cacheRead: 0,
      spawnWrite: requests[0].cw,
      peakContext: 0,
      billedInputEq: 0,
      churn: { tokens: 0, events: churnEvents.length },
      resumes: { hit: 0, miss: 0, missRewrote: 0 },
      tools,
      bursts,
    };

    let prevTs = null;
    for (let i = 0; i < requests.length; i++) {
      const req = requests[i];
      const ctx = req.in + req.cw + req.cr;
      agent.outputTokens += req.out;
      agent.inputRaw += req.in;
      agent.cacheWrite += req.cw;
      agent.cacheRead += req.cr;
      if (ctx > agent.peakContext) agent.peakContext = ctx;
      if (req.model) agent.models[req.model] = (agent.models[req.model] || 0) + 1;
      if (req.model) {
        (byModel[req.model] ??= { requests: 0, outputTokens: 0, cacheWrite: 0, cacheRead: 0 });
        byModel[req.model].requests++;
        byModel[req.model].outputTokens += req.out;
        byModel[req.model].cacheWrite += req.cw;
        byModel[req.model].cacheRead += req.cr;
      }
      if (prevTs !== null && req.ts !== null) {
        const gapMin = (req.ts - prevTs) / 60_000;
        const bucket = gapMin < 1 ? '<1m' : gapMin < 5 ? '1-5m' : gapMin < 15 ? '5-15m' : gapMin < 60 ? '15-60m' : '>60m';
        gapHistogram[bucket]++;
      }
      prevTs = req.ts ?? prevTs;
      timelineRows.push([agent.index, req.ts, req.in, req.cw, req.cr, req.out, ctx, REQUEST_CLASSES.indexOf(classes[i])]);
    }
    agent.billedInputEq = Math.round(agent.inputRaw + writeX * agent.cacheWrite + PRICING.cacheReadX * agent.cacheRead);
    for (const e of churnEvents) {
      agent.churn.tokens += e.rewrote;
      allChurn.push({ agent: agent.index, ...e });
    }
    for (const b of bursts.slice(1)) {
      if (b.resume === 'HIT') agent.resumes.hit++;
      else { agent.resumes.miss++; agent.resumes.missRewrote += b.rewrote; }
    }

    totals.requests += agent.requests;
    totals.outputTokens += agent.outputTokens;
    totals.inputRaw += agent.inputRaw;
    totals.cacheWrite += agent.cacheWrite;
    totals.cacheRead += agent.cacheRead;
    totals.billedInputEq += agent.billedInputEq;
    agents.push(agent);
  }

  // Activation order: sort agents by first request timestamp (main stays first on ties).
  const order = agents.map((a) => a.index);
  order.sort((x, y) => (agents[x].firstTs ?? 0) - (agents[y].firstTs ?? 0) || x - y);
  const remap = new Map(order.map((oldIdx, newIdx) => [oldIdx, newIdx]));
  const sortedAgents = order.map((oldIdx, newIdx) => ({ ...agents[oldIdx], index: newIdx }));
  for (const row of timelineRows) row[0] = remap.get(row[0]);
  for (const e of allChurn) e.agent = remap.get(e.agent);
  timelineRows.sort((a, b) => (a[1] ?? 0) - (b[1] ?? 0));
  allChurn.sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));

  const churnByCause = {};
  for (const e of allChurn) {
    (churnByCause[e.cause] ??= { tokens: 0, events: 0 });
    churnByCause[e.cause].tokens += e.rewrote;
    churnByCause[e.cause].events++;
  }
  const start = Math.min(...sortedAgents.map((a) => a.firstTs ?? Infinity));
  const end = Math.max(...sortedAgents.map((a) => a.lastTs ?? -Infinity));

  const result = {
    schema: 'rasen-token-audit/1',
    generatedAt: new Date().toISOString(),
    session: {
      id: sid,
      mainTranscript: mainPath,
      start: Number.isFinite(start) ? start : null,
      end: Number.isFinite(end) ? end : null,
      durationMs: Number.isFinite(start) && Number.isFinite(end) ? end - start : null,
      agentCount: sortedAgents.length,
    },
    pricing: PRICING,
    totals: {
      ...totals,
      churn: {
        tokens: allChurn.reduce((s, e) => s + e.rewrote, 0),
        events: allChurn.length,
        byCause: churnByCause,
      },
      resumes: {
        hit: sortedAgents.reduce((s, a) => s + a.resumes.hit, 0),
        miss: sortedAgents.reduce((s, a) => s + a.resumes.miss, 0),
        missRewrote: sortedAgents.reduce((s, a) => s + a.resumes.missRewrote, 0),
      },
    },
    byModel,
    gapHistogram,
    agents: sortedAgents,
    requests: {
      columns: ['agent', 'ts', 'input', 'cacheWrite', 'cacheRead', 'output', 'context', 'class'],
      classes: REQUEST_CLASSES,
      rows: timelineRows,
    },
    churnEvents: allChurn,
  };

  const outPath = args.out || `session-audit-${sid.slice(0, 8)}.json`;
  writeFileSync(outPath, JSON.stringify(result, null, args.pretty ? 2 : 0), 'utf-8');
  const M = (n) => (n / 1e6).toFixed(2) + 'M';
  console.error(
    `wrote ${outPath} (${(statSync(outPath).size / 1024).toFixed(0)} KB)\n` +
    `requests=${totals.requests} output=${M(totals.outputTokens)} cacheW=${M(totals.cacheWrite)} cacheR=${M(totals.cacheRead)}\n` +
    `billed-input-equivalent=${M(totals.billedInputEq)} churn=${M(result.totals.churn.tokens)} (${result.totals.churn.events} events)\n` +
    `resumes: HIT=${result.totals.resumes.hit} MISS=${result.totals.resumes.miss} miss-rewrote=${M(result.totals.resumes.missRewrote)}`
  );
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
