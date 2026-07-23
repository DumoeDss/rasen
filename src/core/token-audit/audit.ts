/**
 * Session-level orchestration for `rasen agent audit` (design D1): resolves
 * the runtime (explicit `--runtime`, else filename/content detection reusing
 * `detectTranscriptKind` from `agent-context.ts`), discovers files for that
 * runtime, runs the matching parse path, aggregates, sorts agents into
 * activation order, and writes the runtime-appropriate result object.
 *
 * Mirrors `src/core/agent-context.ts`'s role for `agent context`, but this
 * module also owns the report write (the JSON file IS the product, unlike
 * agent context's stdout-only probe) — `AgentCommand.audit()` stays a thin
 * consumer that prints/catches, matching the `context`/`wait` pattern.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { claudeProjectsDir, detectTranscriptKind, type TranscriptKind } from '../agent-context.js';
import { findRolloutPath, resolveCodexHome } from '../codex/index.js';
import { getGlobalDataDir, type GlobalDataDirOptions } from '../global-config.js';
import { PRICING, REQUEST_CLASSES, TTL_MIN, classify, clusterBursts } from './classify.js';
import { buildCodexFamilyMember, discoverCodexThreadFamily } from './discover-codex.js';
import { TranscriptFormatError } from './errors.js';
import { parseCodexRolloutFile } from './parse-codex.js';
import { parseTranscriptFile, type TranscriptFile } from './parse.js';
import {
  SCHEMA_VERSION,
  type AgentKind,
  type AuditResult,
  type ChurnEvent,
  type ClaudeAgentRecord,
  type ClaudeAuditResult,
  type CodexAgentRecord,
  type CodexAuditResult,
  type CodexRawTokens,
  type CodexTurn,
} from './types.js';

export interface RunAuditOptions extends GlobalDataDirOptions {
  /** Override the Claude projects directory a bare session id is resolved against. */
  projectsDir?: string;
  /** Explicit output file path — overrides the default `~/.rasen/analytics/...` resolution. */
  outPath?: string;
  /** Force detection to "claude" or "codex" instead of sniffing the target. */
  runtime?: string;
  /** Working directory used to derive the Claude projects dir (defaults to process.cwd()). */
  cwd?: string;
  /** Override the Codex home directory (defaults to resolveCodexHome()). */
  codexHome?: string;
}

export interface RunAuditResult {
  result: AuditResult;
  outPath: string;
}

function validateRuntimeOption(runtime: string | undefined): TranscriptKind | undefined {
  if (runtime === undefined) return undefined;
  if (runtime === 'claude' || runtime === 'codex') return runtime;
  throw new Error(`--runtime must be "claude" or "codex" (got "${runtime}").`);
}

/**
 * Runtime selection (design D5): an explicit `--runtime` wins outright;
 * otherwise a direct path (`*.jsonl`) is detected from its filename/content;
 * a bare id with no `--runtime` resolves as Claude (unchanged default) —
 * resolving a bare id as Codex requires `--runtime codex`.
 */
function resolveRuntimeKind(target: string, override: TranscriptKind | undefined): TranscriptKind {
  if (override) return override;
  if (target.endsWith('.jsonl')) return detectTranscriptKind(target);
  return 'claude';
}

function defaultOutPath(options: RunAuditOptions, sid: string): string {
  return path.join(getGlobalDataDir(options), 'analytics', `session-audit-${sid.slice(0, 8)}.json`);
}

function writeReport(result: AuditResult, options: RunAuditOptions, sid: string): string {
  const outPath = options.outPath ?? defaultOutPath(options, sid);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(result), 'utf-8');
  return outPath;
}

export async function runAudit(target: string, options: RunAuditOptions = {}): Promise<RunAuditResult> {
  if (!target) {
    throw new Error('usage: rasen agent audit <sessionId|path> [--projects-dir <dir>] [--out <file>] [--runtime <claude|codex>]');
  }
  const override = validateRuntimeOption(options.runtime);
  const kind = resolveRuntimeKind(target, override);
  return kind === 'codex' ? runCodexAudit(target, options) : runClaudeAudit(target, options);
}

// ---------------------------------------------------------------------------
// Claude path
// ---------------------------------------------------------------------------

function resolveClaudeMainTranscript(target: string, options: RunAuditOptions): string {
  if (target.endsWith('.jsonl')) {
    const p = path.isAbsolute(target) ? target : path.resolve(target);
    if (!fs.existsSync(p)) throw new Error(`transcript not found: ${p}`);
    return p;
  }
  const dir = options.projectsDir ?? claudeProjectsDir(options.cwd ?? process.cwd(), options.homedir ?? os.homedir());
  if (!fs.existsSync(dir)) {
    throw new Error(`projects dir not found: ${dir} (pass --projects-dir)`);
  }
  const exact = path.join(dir, `${target}.jsonl`);
  if (fs.existsSync(exact)) return exact;
  const matches = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl') && f.startsWith(target));
  if (matches.length === 1) return path.join(dir, matches[0]);
  if (matches.length > 1) {
    throw new Error(`session id prefix "${target}" is ambiguous: ${matches.slice(0, 5).join(', ')}`);
  }
  throw new Error(`no transcript matching "${target}" in ${dir}`);
}

function discoverClaudeAgentFiles(mainPath: string): { sid: string; files: TranscriptFile[] } {
  const sid = path.basename(mainPath, '.jsonl');
  const files: TranscriptFile[] = [{ path: mainPath, kind: 'main' }];
  const subDir = path.join(path.dirname(mainPath), sid, 'subagents');
  try {
    for (const f of fs.readdirSync(subDir).sort()) {
      if (f.endsWith('.jsonl')) files.push({ path: path.join(subDir, f), kind: 'subagent' });
    }
  } catch {
    // no subagents dir
  }
  return { sid, files };
}

function parseAgentLabel(fileBase: string, kind: AgentKind): { label: string; roleFamily: string } {
  if (kind === 'main') return { label: 'MAIN', roleFamily: 'main' };
  const label = fileBase.replace(/^agent-/, '').replace(/-[0-9a-f]{8,}$/, '');
  const l = label.toLowerCase();
  const roleFamily = /plan/.test(l)
    ? 'planner'
    : /impl/.test(l)
      ? 'implementer'
      : /(^|[^a-z])a?rev|review/.test(l)
        ? 'reviewer'
        : /fix/.test(l)
          ? 'fixer'
          : /ship/.test(l)
            ? 'shipper'
            : /archiv/.test(l)
              ? 'archiver'
              : /qa/.test(l)
                ? 'qa'
                : 'other';
  return { label, roleFamily };
}

async function runClaudeAudit(target: string, options: RunAuditOptions): Promise<RunAuditResult> {
  const mainPath = resolveClaudeMainTranscript(target, options);
  const { sid, files } = discoverClaudeAgentFiles(mainPath);

  const agents: ClaudeAgentRecord[] = [];
  const timelineRows: Array<Array<number | null>> = [];
  const allChurn: ChurnEvent[] = [];
  const gapHistogram: Record<string, number> = { '<1m': 0, '1-5m': 0, '5-15m': 0, '15-60m': 0, '>60m': 0 };
  const totals = { requests: 0, outputTokens: 0, inputRaw: 0, cacheWrite: 0, cacheRead: 0, billedInputEq: 0 };
  const byModel: Record<string, { requests: number; outputTokens: number; cacheWrite: number; cacheRead: number }> = {};

  for (const file of files) {
    const fileBase = path.basename(file.path, '.jsonl');
    const { requests, tools } = await parseTranscriptFile(file);
    if (requests.length === 0) continue;
    const ttlMin = TTL_MIN[file.kind];
    const { classes, churnEvents } = classify(requests, ttlMin);
    const bursts = clusterBursts(requests, classes);
    const { label, roleFamily } = parseAgentLabel(fileBase, file.kind);
    const writeX = file.kind === 'main' ? PRICING.cacheWriteMainX : PRICING.cacheWriteSubX;

    const agent: ClaudeAgentRecord = {
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

    let prevTs: number | null = null;
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
        const reqTs: number = req.ts;
        const prevReqTs: number = prevTs;
        const gapMin: number = (reqTs - prevReqTs) / 60_000;
        const bucket: string = gapMin < 1 ? '<1m' : gapMin < 5 ? '1-5m' : gapMin < 15 ? '5-15m' : gapMin < 60 ? '15-60m' : '>60m';
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
      else {
        agent.resumes.miss++;
        agent.resumes.missRewrote += b.rewrote;
      }
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
  for (const row of timelineRows) row[0] = remap.get(row[0] as number) ?? row[0];
  for (const e of allChurn) e.agent = remap.get(e.agent) ?? e.agent;
  timelineRows.sort((a, b) => (a[1] ?? 0) - (b[1] ?? 0));
  allChurn.sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));

  const churnByCause: Record<string, { tokens: number; events: number }> = {};
  for (const e of allChurn) {
    (churnByCause[e.cause] ??= { tokens: 0, events: 0 });
    churnByCause[e.cause].tokens += e.rewrote;
    churnByCause[e.cause].events++;
  }
  const start = Math.min(...sortedAgents.map((a) => a.firstTs ?? Infinity));
  const end = Math.max(...sortedAgents.map((a) => a.lastTs ?? -Infinity));

  const result: ClaudeAuditResult = {
    schema: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    session: {
      id: sid,
      runtime: 'claude',
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

  const outPath = writeReport(result, options, sid);
  return { result, outPath };
}

// ---------------------------------------------------------------------------
// Codex path
// ---------------------------------------------------------------------------

function emptyRawTokens(): CodexRawTokens {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0,
  };
}

function addRawTokens(target: CodexRawTokens, delta: CodexRawTokens): void {
  target.inputTokens += delta.inputTokens;
  target.cachedInputTokens += delta.cachedInputTokens;
  target.cacheWriteInputTokens += delta.cacheWriteInputTokens;
  target.outputTokens += delta.outputTokens;
  target.reasoningOutputTokens += delta.reasoningOutputTokens;
  target.totalTokens += delta.totalTokens;
}

function cacheHitRatio(tokens: CodexRawTokens): number {
  return tokens.inputTokens > 0 ? tokens.cachedInputTokens / tokens.inputTokens : 0;
}

/**
 * M1 fix (`rasen/changes/agent-audit-command/work/review-report.md`): a
 * Codex thread that is a fork/resume replays its parent's history into its
 * own rollout file, so `token_count` transitions during that replay are
 * indistinguishable from real per-request deltas under the cumulative-delta
 * rule — flagged, not excluded (heuristic replay-segment exclusion is
 * future work; a silently-adjusted number is worse than an honestly-flagged
 * one).
 */
function buildForkCaveat(forkedFromId: string): string {
  return (
    `This session is a fork/resume of ${forkedFromId}: its rollout replays the parent session's history into its own file. ` +
    `token_count transitions recorded during that replay are indistinguishable from real per-request deltas, so request counts, ` +
    `turn timings, and cacheHitRatio are not per-request trustworthy before this thread's own first local turn.`
  );
}

async function runCodexAudit(target: string, options: RunAuditOptions): Promise<RunAuditResult> {
  const codexHome = options.codexHome ?? resolveCodexHome();
  const sessionsDir = path.join(codexHome, 'sessions');

  let mainPath: string;
  if (target.endsWith('.jsonl')) {
    mainPath = path.isAbsolute(target) ? target : path.resolve(target);
    if (!fs.existsSync(mainPath)) throw new Error(`rollout not found: ${mainPath}`);
  } else {
    const found = findRolloutPath(target, { codexHome });
    if (!found) {
      throw new Error(`no Codex rollout matching "${target}" in ${sessionsDir} (or archived_sessions)`);
    }
    mainPath = found;
  }

  const mainMember = buildCodexFamilyMember(mainPath);
  if (!mainMember) {
    throw new TranscriptFormatError(
      'Codex rollout is missing a recognizable session_meta first line',
      mainPath,
      1,
      'expected {"type":"session_meta","payload":{...,"session_id":"..."}} as the first line'
    );
  }

  const family = discoverCodexThreadFamily(mainMember.threadId, sessionsDir);
  if (!family.some((m) => m.path === mainPath)) family.unshift(mainMember);

  const agents: CodexAgentRecord[] = [];
  const totalsRaw = emptyRawTokens();
  let totalRequests = 0;

  for (const member of family) {
    const { requests, turnBoundaries } = parseCodexRolloutFile(member.path);
    if (requests.length === 0) continue;

    const rawTokens = emptyRawTokens();
    const turnsById = new Map<string, CodexTurn>();
    for (const boundary of turnBoundaries) {
      turnsById.set(boundary.turnId, {
        turnId: boundary.turnId,
        start: boundary.start,
        end: boundary.end,
        requests: 0,
        rawTokens: emptyRawTokens(),
        cacheHitRatio: 0,
      });
    }
    let untitledTurn: CodexTurn | undefined;

    for (const req of requests) {
      const delta: CodexRawTokens = {
        inputTokens: req.inputTokens,
        cachedInputTokens: req.cachedInputTokens,
        cacheWriteInputTokens: req.cacheWriteInputTokens,
        outputTokens: req.outputTokens,
        reasoningOutputTokens: req.reasoningOutputTokens,
        totalTokens: req.totalTokens,
      };
      addRawTokens(rawTokens, delta);

      let turn = req.turnId ? turnsById.get(req.turnId) : undefined;
      if (!turn) {
        if (req.turnId) {
          turn = { turnId: req.turnId, start: null, end: null, requests: 0, rawTokens: emptyRawTokens(), cacheHitRatio: 0 };
          turnsById.set(req.turnId, turn);
        } else {
          untitledTurn ??= { turnId: null, start: null, end: null, requests: 0, rawTokens: emptyRawTokens(), cacheHitRatio: 0 };
          turn = untitledTurn;
        }
      }
      turn.requests++;
      addRawTokens(turn.rawTokens, delta);
    }

    const turns = [...turnsById.values(), ...(untitledTurn ? [untitledTurn] : [])];
    for (const turn of turns) turn.cacheHitRatio = cacheHitRatio(turn.rawTokens);
    turns.sort((a, b) => (a.start ?? 0) - (b.start ?? 0));

    const firstTs = requests.find((r) => r.ts !== null)?.ts ?? null;
    const lastReqWithTs = [...requests].reverse().find((r) => r.ts !== null);
    const lastTs = lastReqWithTs?.ts ?? null;

    const agent: CodexAgentRecord = {
      index: agents.length,
      key: member.threadId,
      kind: member.threadId === mainMember.threadId ? 'main' : 'subagent',
      label: member.agentNickname ?? member.agentPath ?? member.threadId,
      threadId: member.threadId,
      parentThreadId: member.parentThreadId,
      firstTs,
      lastTs,
      requests: requests.length,
      rawTokens,
      cacheHitRatio: cacheHitRatio(rawTokens),
      turns,
    };
    agents.push(agent);
    addRawTokens(totalsRaw, rawTokens);
    totalRequests += requests.length;
  }

  // Activation order: sort agents by first request timestamp (main stays first on ties).
  const order = agents.map((a) => a.index);
  order.sort((x, y) => (agents[x].firstTs ?? 0) - (agents[y].firstTs ?? 0) || x - y);
  const sortedAgents = order.map((oldIdx, newIdx) => ({ ...agents[oldIdx], index: newIdx }));

  const start = Math.min(...sortedAgents.map((a) => a.firstTs ?? Infinity));
  const end = Math.max(...sortedAgents.map((a) => a.lastTs ?? -Infinity));

  const result: CodexAuditResult = {
    schema: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    session: {
      id: mainMember.threadId,
      runtime: 'codex',
      mainTranscript: mainPath,
      start: Number.isFinite(start) ? start : null,
      end: Number.isFinite(end) ? end : null,
      durationMs: Number.isFinite(start) && Number.isFinite(end) ? end - start : null,
      agentCount: sortedAgents.length,
      ...(mainMember.forkedFromId ? { forkedFrom: mainMember.forkedFromId } : {}),
    },
    totals: {
      requests: totalRequests,
      rawTokens: totalsRaw,
      cacheHitRatio: cacheHitRatio(totalsRaw),
    },
    agents: sortedAgents,
    ...(mainMember.forkedFromId ? { caveats: [buildForkCaveat(mainMember.forkedFromId)] } : {}),
  };

  const outPath = writeReport(result, options, mainMember.threadId);
  return { result, outPath };
}
