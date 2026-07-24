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
import { PRICING, REQUEST_CLASSES, TTL_MIN, classify, classifyCodex, clusterBursts, clusterCodexBursts } from './classify.js';
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
  type CodexRebuildEvent,
  type CodexTurn,
  type ZedAuditResult,
  type ZedRawTokens,
  type ZedThreadRecord,
} from './types.js';
import {
  openZedDatabase,
  queryAllThreadRows,
  queryThreadFamily,
  resolveDefaultZedDbPath,
  resolveThreadIdsByPrefix,
  type ZedDatabase,
} from './zed/database.js';
import { decodeZedThread } from './zed/decode.js';

/**
 * Codex dimensions the rollout data cannot support (design D7) — an explicit
 * named list, never pattern-derived. Post-full-corpus-survey this is only:
 * message-chain fork attribution (no parentUuid-style chain in rollouts) and
 * billed-input-equivalent pricing (no pinned OpenAI cached-input multipliers).
 */
const UNSUPPORTED_CODEX_DIMENSIONS: ReadonlyArray<{ dimension: string; reason: string }> = [
  {
    dimension: 'conversation-branch (message-chain fork) attribution',
    reason:
      'Codex rollouts carry no parentUuid-style message chain, so a cache rebuild cannot be attributed to a branch/fork; the "rebase" cause here always means an injected user message.',
  },
  {
    dimension: 'billed-input-equivalent pricing',
    reason:
      "OpenAI's cached-input discount multipliers are not pinned, so a Claude-style billed-equivalent figure would be a guess; raw token totals are reported instead.",
  },
];

/** Increment cross-check tolerance (design D4): summed per-request increments vs cumulative endpoint. */
const CROSS_CHECK_TOLERANCE = 0.02;

export interface RunAuditOptions extends GlobalDataDirOptions {
  /** Override the Claude projects directory a bare session id is resolved against. */
  projectsDir?: string;
  /** Explicit output file path — overrides the default `~/.rasen/analytics/...` resolution. */
  outPath?: string;
  /** Force detection to "claude", "codex", or "zed" instead of sniffing the target. */
  runtime?: string;
  /** Working directory used to derive the Claude projects dir (defaults to process.cwd()). */
  cwd?: string;
  /** Override the Codex home directory (defaults to resolveCodexHome()). */
  codexHome?: string;
  /** Zed runtime only: resolve the session by its first user command instead of a thread id. */
  match?: string;
  /** Zed runtime only: override the `threads.db` path (defaults to the per-OS location). */
  db?: string;
}

export interface RunAuditResult {
  result: AuditResult;
  outPath: string;
}

/**
 * Runtimes `agent audit` can select. Broader than `agent-context.ts`'s
 * {@link TranscriptKind} (claude/codex) because Zed is auditable but has no
 * transcript file for the context probe — so `agent context` deliberately
 * does NOT accept `zed`, and the two runtime sets stay distinct.
 */
type AuditRuntime = TranscriptKind | 'zed';

function validateRuntimeOption(runtime: string | undefined): AuditRuntime | undefined {
  if (runtime === undefined) return undefined;
  if (runtime === 'claude' || runtime === 'codex' || runtime === 'zed') return runtime;
  throw new Error(`--runtime must be "claude", "codex", or "zed" (got "${runtime}").`);
}

/**
 * Runtime selection (design D5, extended for Zed): an explicit `--runtime`
 * wins outright; otherwise a `threads.db`/`.db`/`.sqlite` path detects as Zed
 * and a `*.jsonl` path is detected from its filename/content; a bare id with
 * no `--runtime` resolves as Claude (unchanged default) — resolving a bare id
 * as Codex or Zed requires the corresponding `--runtime` flag.
 */
function resolveRuntimeKind(target: string, override: AuditRuntime | undefined): AuditRuntime {
  if (override) return override;
  if (target.endsWith('.jsonl')) return detectTranscriptKind(target);
  if (target.endsWith('.db') || target.endsWith('.sqlite') || path.basename(target) === 'threads.db') return 'zed';
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
  const override = validateRuntimeOption(options.runtime);
  const wantsZedMatch = override === 'zed' && !!options.match;
  if (!target && !wantsZedMatch) {
    throw new Error(
      'usage: rasen agent audit <sessionId|path> [--projects-dir <dir>] [--out <file>] [--runtime <claude|codex|zed>]\n' +
        '       rasen agent audit --runtime zed [<threadId> | --match <text>] [--db <threads.db>]'
    );
  }
  const kind = resolveRuntimeKind(target, override);
  if (kind !== 'zed' && (options.match !== undefined || options.db !== undefined)) {
    throw new Error('--match and --db only apply to --runtime zed');
  }
  if (kind === 'zed') return runZedAudit(target, options);
  if (kind === 'codex') return runCodexAudit(target, options);
  return runClaudeAudit(target, options);
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
    `turn timings, the per-request timeline, and cacheHitRatio are not per-request trustworthy before this thread's own first local turn.`
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
  // Per-request timeline rows (raw, remapped to activation order below). Each row also
  // carries its original agent index at [0]; classes indexed via REQUEST_CLASSES.
  const timelineRows: Array<Array<number | null>> = [];
  const allRebuilds: CodexRebuildEvent[] = [];
  // Cross-check accumulators (design D4): summed per-request primary figures vs cumulative endpoints.
  const summedIncrements = emptyRawTokens();
  const summedEndpoints = emptyRawTokens();

  for (const member of family) {
    const { requests, turnBoundaries, cumulativeEndpoint, modelContextWindow } = parseCodexRolloutFile(member.path);
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
        ...(boundary.aborted ? { aborted: true } : {}),
      });
    }
    let untitledTurn: CodexTurn | undefined;
    let peakContext = 0;

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
      if (req.contextEstimate > peakContext) peakContext = req.contextEstimate;

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

    // Cache-rebuild classification + bursts (design D2/D3/D9).
    const { classes, rebuildEvents } = classifyCodex(requests);
    const bursts = clusterCodexBursts(requests, classes);

    const rebuildRollup = { events: 0, rewroteTokens: 0, byCause: {} as Record<string, { events: number; rewroteTokens: number }> };
    for (const e of rebuildEvents) {
      rebuildRollup.events++;
      rebuildRollup.rewroteTokens += e.rewrote;
      (rebuildRollup.byCause[e.cause] ??= { events: 0, rewroteTokens: 0 });
      rebuildRollup.byCause[e.cause].events++;
      rebuildRollup.byCause[e.cause].rewroteTokens += e.rewrote;
      allRebuilds.push({ agent: agents.length, ...e });
    }

    const agentIndex = agents.length;
    for (let i = 0; i < requests.length; i++) {
      const req = requests[i];
      timelineRows.push([
        agentIndex,
        req.ts,
        req.inputTokens,
        req.cachedInputTokens,
        req.cacheWriteInputTokens,
        req.outputTokens,
        req.reasoningOutputTokens,
        req.contextEstimate,
        REQUEST_CLASSES.indexOf(classes[i]),
      ]);
      summedIncrements.inputTokens += req.inputTokens;
      summedIncrements.cachedInputTokens += req.cachedInputTokens;
      summedIncrements.cacheWriteInputTokens += req.cacheWriteInputTokens;
      summedIncrements.outputTokens += req.outputTokens;
      summedIncrements.reasoningOutputTokens += req.reasoningOutputTokens;
      summedIncrements.totalTokens += req.totalTokens;
    }
    if (cumulativeEndpoint) addRawTokens(summedEndpoints, cumulativeEndpoint as CodexRawTokens);

    const firstTs = requests.find((r) => r.ts !== null)?.ts ?? null;
    const lastReqWithTs = [...requests].reverse().find((r) => r.ts !== null);
    const lastTs = lastReqWithTs?.ts ?? null;

    const agent: CodexAgentRecord = {
      index: agentIndex,
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
      peakContext,
      modelContextWindow,
      bursts,
      rebuilds: rebuildRollup,
    };
    agents.push(agent);
    addRawTokens(totalsRaw, rawTokens);
    totalRequests += requests.length;
  }

  // Activation order: sort agents by first request timestamp (main stays first on ties).
  const order = agents.map((a) => a.index);
  order.sort((x, y) => (agents[x].firstTs ?? 0) - (agents[y].firstTs ?? 0) || x - y);
  const remap = new Map(order.map((oldIdx, newIdx) => [oldIdx, newIdx]));
  const sortedAgents = order.map((oldIdx, newIdx) => ({ ...agents[oldIdx], index: newIdx }));
  for (const row of timelineRows) row[0] = remap.get(row[0] as number) ?? row[0];
  for (const e of allRebuilds) e.agent = remap.get(e.agent) ?? e.agent;
  timelineRows.sort((a, b) => (a[1] ?? 0) - (b[1] ?? 0));
  allRebuilds.sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));

  const rebuildByCause: Record<string, { events: number; rewroteTokens: number }> = {};
  for (const e of allRebuilds) {
    (rebuildByCause[e.cause] ??= { events: 0, rewroteTokens: 0 });
    rebuildByCause[e.cause].events++;
    rebuildByCause[e.cause].rewroteTokens += e.rewrote;
  }

  const start = Math.min(...sortedAgents.map((a) => a.firstTs ?? Infinity));
  const end = Math.max(...sortedAgents.map((a) => a.lastTs ?? -Infinity));

  const caveats: string[] = [];
  if (mainMember.forkedFromId) caveats.push(buildForkCaveat(mainMember.forkedFromId));
  const crossCheck = buildCrossCheckCaveat(summedIncrements, summedEndpoints);
  if (crossCheck) caveats.push(crossCheck);

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
      rebuilds: { events: allRebuilds.length, rewroteTokens: allRebuilds.reduce((s, e) => s + e.rewrote, 0), byCause: rebuildByCause },
    },
    agents: sortedAgents,
    requests: {
      columns: ['agent', 'ts', 'input', 'cachedInput', 'cacheWrite', 'output', 'reasoningOutput', 'context', 'class'],
      classes: REQUEST_CLASSES,
      rows: timelineRows,
    },
    rebuildEvents: allRebuilds,
    unsupportedDimensions: UNSUPPORTED_CODEX_DIMENSIONS.map((d) => ({ ...d })),
    ...(caveats.length ? { caveats } : {}),
  };

  const outPath = writeReport(result, options, mainMember.threadId);
  return { result, outPath };
}

/**
 * Endpoint cross-check (design D4): compares summed per-request primary
 * figures against the cumulative endpoint totals. Returns a caveat naming the
 * fields that disagree beyond {@link CROSS_CHECK_TOLERANCE}, or `undefined`
 * when they agree (or when there are no cumulative endpoints to compare —
 * absence adds no caveat).
 */
function buildCrossCheckCaveat(summed: CodexRawTokens, endpoint: CodexRawTokens): string | undefined {
  if (endpoint.totalTokens === 0) return undefined;
  const fields: Array<keyof CodexRawTokens> = [
    'inputTokens',
    'cachedInputTokens',
    'cacheWriteInputTokens',
    'outputTokens',
    'reasoningOutputTokens',
    'totalTokens',
  ];
  const diverged: string[] = [];
  for (const f of fields) {
    const a = summed[f];
    const b = endpoint[f];
    const denom = Math.max(Math.abs(b), 1);
    if (Math.abs(a - b) / denom > CROSS_CHECK_TOLERANCE) {
      diverged.push(`${f} (per-request sum ${a} vs cumulative endpoint ${b})`);
    }
  }
  if (diverged.length === 0) return undefined;
  return (
    'Per-request increments (last_token_usage) disagree with the cumulative endpoint totals beyond tolerance for: ' +
    `${diverged.join('; ')}. Per-request figures are shown as-is; neither source is silently reconciled.`
  );
}

// ---------------------------------------------------------------------------
// Zed path (Zed threads.db adapter)
// ---------------------------------------------------------------------------

/**
 * Zed data-limit disclosures, always attached to a Zed report's `caveats`
 * (spec: "Zed data limits are disclosed"). A named constant, never derived.
 */
const ZED_CAVEATS: readonly string[] = [
  "Experimental Zed adapter: Zed's threads.db is an internal, undocumented format and may change without notice.",
  'Zed does not store reasoning-output or cache-write totals; those dimensions are omitted (not zero) — their absence is not observed zero usage.',
  'Request counts are retained request_token_usage entries, not a complete API-request count, and can undercount after a compaction.',
  'Each thread is a single aggregate entry; Zed does not retain enough per-request detail for a per-request or per-turn timeline.',
  'Descendant Zed threads (linked by parent_id) are included; Claude or Codex processes launched as external tools are not linked in threads.db and are not included — audit those separately with their own --runtime.',
];

/** Cached-input share of total input (kept distinct from the Codex cached/input definition, design D6). */
function zedHitRatio(inputTokens: number, cachedInputTokens: number): number {
  const total = inputTokens + cachedInputTokens;
  return total > 0 ? cachedInputTokens / total : 0;
}

function normalizeMatch(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Resolves a Zed root thread by a case-insensitive, whitespace-normalized
 * substring match of its first user command. Threads that fail to decode are
 * skipped during the scan (an unrelated bad row must not abort the search);
 * the chosen root is decoded on the normal audit path, where a bad payload
 * fails soft. Ambiguity lists candidates and never guesses.
 */
function resolveZedRootByFirstCommand(db: ZedDatabase, query: string): string {
  const needle = normalizeMatch(query);
  const matches: Array<{ id: string; title: string | null; firstTs: number | null }> = [];
  for (const row of queryAllThreadRows(db)) {
    try {
      const d = decodeZedThread(row);
      if (d.firstUserCommand && normalizeMatch(d.firstUserCommand).includes(needle)) {
        matches.push({ id: row.id, title: d.title, firstTs: d.firstTs });
      }
    } catch {
      // Skip a thread that fails to decode during the scan.
    }
  }
  if (matches.length === 0) throw new Error(`no Zed thread whose first command matches "${query}"`);
  if (matches.length > 1) {
    const list = matches
      .map((m) => `${m.id} "${(m.title ?? '').slice(0, 40)}" (${m.firstTs ? new Date(m.firstTs).toISOString() : '?'})`)
      .join('; ');
    throw new Error(`first-command match "${query}" is ambiguous across ${matches.length} Zed threads: ${list}`);
  }
  return matches[0].id;
}

/** Resolves the Zed thread id to audit from a positional id/prefix or `--match`. */
function resolveZedRootId(db: ZedDatabase, target: string, options: RunAuditOptions): string {
  if (target && options.match !== undefined) {
    throw new Error('provide either a Zed thread id or --match <text>, not both');
  }
  if (options.match !== undefined) {
    if (!options.match.trim()) throw new Error('--match requires non-empty text');
    return resolveZedRootByFirstCommand(db, options.match);
  }
  if (!target) throw new Error('rasen agent audit --runtime zed requires a thread id or --match <text>');
  const ids = resolveThreadIdsByPrefix(db, target);
  if (ids.length === 0) throw new Error(`no Zed thread matching "${target}"`);
  if (ids.length > 1) throw new Error(`Zed thread id prefix "${target}" is ambiguous: ${ids.slice(0, 5).join(', ')}`);
  return ids[0];
}

async function runZedAudit(target: string, options: RunAuditOptions): Promise<RunAuditResult> {
  const dbPath = options.db ? path.resolve(options.db) : resolveDefaultZedDbPath({ homedir: options.homedir });
  if (!options.db && !fs.existsSync(dbPath)) {
    throw new Error(`Zed thread database not found at its default location: ${dbPath} (pass --db <path>)`);
  }

  const db = openZedDatabase(dbPath);
  try {
    const rootId = resolveZedRootId(db, target, options);
    const familyRows = queryThreadFamily(db, rootId);
    if (familyRows.length === 0) throw new Error(`Zed thread not found: ${rootId} in ${dbPath}`);

    // Decode each family thread exactly once; a bad payload here fails soft.
    const decoded = familyRows.map((row) => decodeZedThread(row));

    const threads: ZedThreadRecord[] = decoded.map((d) => {
      const record: ZedThreadRecord = {
        index: 0,
        key: d.threadId,
        threadId: d.threadId,
        parentThreadId: d.parentThreadId,
        kind: d.threadId === rootId ? 'main' : 'subagent',
        title: d.title,
        firstTs: d.firstTs,
        lastTs: d.lastTs,
        retainedRequests: d.retainedRequests,
        rawTokens: { inputTokens: d.inputTokens, cachedInputTokens: d.cachedInputTokens, outputTokens: d.outputTokens },
        cacheHitRatio: zedHitRatio(d.inputTokens, d.cachedInputTokens),
      };
      if (d.workingDir != null) record.workingDir = d.workingDir;
      if (d.model != null) record.model = d.model;
      if (d.firstUserCommand != null) record.firstUserCommand = d.firstUserCommand;
      return record;
    });

    // Activation order: earliest thread first; the root stays first on ties.
    threads.sort(
      (a, b) =>
        (a.firstTs ?? 0) - (b.firstTs ?? 0) ||
        (a.kind === 'main' ? -1 : b.kind === 'main' ? 1 : 0) ||
        a.threadId.localeCompare(b.threadId)
    );
    threads.forEach((t, i) => {
      t.index = i;
    });

    const totalsRaw: ZedRawTokens = threads.reduce(
      (acc, t) => ({
        inputTokens: acc.inputTokens + t.rawTokens.inputTokens,
        cachedInputTokens: acc.cachedInputTokens + t.rawTokens.cachedInputTokens,
        outputTokens: acc.outputTokens + t.rawTokens.outputTokens,
      }),
      { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 }
    );
    const retainedRequests = threads.reduce((s, t) => s + t.retainedRequests, 0);
    const root = threads.find((t) => t.kind === 'main') ?? threads[0];
    const dataVersion = decoded.find((d) => d.threadId === rootId)?.dataVersion ?? decoded[0]?.dataVersion ?? null;

    const start = Math.min(...threads.map((t) => t.firstTs ?? Infinity));
    const end = Math.max(...threads.map((t) => t.lastTs ?? -Infinity));

    const result: ZedAuditResult = {
      schema: SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      session: {
        id: rootId,
        runtime: 'zed',
        mainTranscript: dbPath,
        title: root?.title ?? null,
        workingDir: root?.workingDir ?? null,
        firstUserCommand: root?.firstUserCommand ?? null,
        start: Number.isFinite(start) ? start : null,
        end: Number.isFinite(end) ? end : null,
        durationMs: Number.isFinite(start) && Number.isFinite(end) ? end - start : null,
        agentCount: threads.length,
      },
      totals: {
        retainedRequests,
        rawTokens: totalsRaw,
        cacheHitRatio: zedHitRatio(totalsRaw.inputTokens, totalsRaw.cachedInputTokens),
      },
      threads,
      source: { adapter: 'zed-threads-db', dataVersion },
      caveats: [...ZED_CAVEATS],
    };

    const outPath = writeReport(result, options, rootId);
    return { result, outPath };
  } finally {
    db.close();
  }
}
