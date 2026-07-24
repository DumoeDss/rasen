import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

import { listStoredRolloutFiles, readRolloutSessionMeta, resolveCodexHome } from '../codex/index.js';
import { getGlobalDataDir, type GlobalDataDirOptions } from '../global-config.js';
import { runAudit, type RunAuditOptions, type RunAuditResult } from './audit.js';
import type { AuditResult } from './types.js';
import {
  openZedDatabase,
  queryAllThreadRows,
  queryRecentRootThreadMetadata,
  queryRootThreadIds,
  resolveDefaultZedDbPath,
} from './zed/database.js';

export type AuditRuntime = 'claude' | 'codex' | 'zed';

export const DEFAULT_RECENT_AUDIT_LIMIT = 50;
export const MAX_RECENT_AUDIT_LIMIT = 200;
export const MAX_AUDIT_IMPORT_BYTES = 256 * 1024 * 1024;

export interface RecentAuditSession {
  runtime: AuditRuntime;
  sessionId: string;
  label: string;
  updatedAt: number;
  startedAt?: number;
  workingDir?: string;
  title?: string;
}

export interface AuditRuntimeDiagnostic {
  runtime: AuditRuntime;
  available: boolean;
  message?: string;
}

export interface DiscoverAuditSessionsResult {
  sessions: RecentAuditSession[];
  diagnostics: AuditRuntimeDiagnostic[];
  limit: number;
}

export interface AuditReportDescriptor {
  id: string;
  runtime: AuditRuntime;
  sessionId: string;
  title?: string;
  generatedAt: string;
  sessionStart: number | null;
  sessionEnd: number | null;
  memberCount: number;
  modifiedAt: number;
}

export interface AuditReportList {
  reports: AuditReportDescriptor[];
  skipped: number;
}

export interface AuditReportDetail {
  descriptor: AuditReportDescriptor;
  report: AuditResult;
}

export interface AuditManagementOptions extends GlobalDataDirOptions {
  claudeProjectsRoot?: string;
  codexHome?: string;
  zedDbPath?: string;
}

export class AuditServiceError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fix?: string
  ) {
    super(message);
    this.name = 'AuditServiceError';
  }
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function runtimeOf(value: unknown): AuditRuntime | null {
  return value === 'claude' || value === 'codex' || value === 'zed' ? value : null;
}

export function validateAuditReport(value: unknown): AuditResult {
  const report = asObject(value);
  if (!report || (report.schema !== 'rasen-token-audit/1' && report.schema !== 'rasen-token-audit/2')) {
    throw new AuditServiceError(400, 'invalid_audit_report', 'The JSON file is not a supported Rasen audit report.');
  }
  const session = asObject(report.session);
  const runtime = runtimeOf(session?.runtime ?? 'claude');
  if (!session || !runtime || typeof session.id !== 'string' || session.id.length === 0) {
    throw new AuditServiceError(
      400,
      'invalid_audit_report',
      'The audit report is missing a supported runtime or session id.'
    );
  }
  if (typeof report.generatedAt !== 'string') {
    throw new AuditServiceError(400, 'invalid_audit_report', 'The audit report is missing generatedAt.');
  }
  const invalid = (): never => {
    throw new AuditServiceError(
      400,
      'invalid_audit_report',
      `The ${runtime} audit report does not match the supported ${String(report.schema)} structure.`
    );
  };
  const isNumber = (item: unknown): item is number =>
    typeof item === 'number' && Number.isFinite(item);
  const isNullableNumber = (item: unknown): boolean => item === null || isNumber(item);
  const isNullableString = (item: unknown): boolean => item === null || typeof item === 'string';
  const hasNumbers = (item: unknown, fields: string[]): boolean => {
    const object = asObject(item);
    return !!object && fields.every((field) => isNumber(object[field]));
  };
  const hasStringArray = (item: unknown): boolean =>
    Array.isArray(item) && item.every((entry) => typeof entry === 'string');
  const hasNumericValues = (item: unknown): boolean => {
    const object = asObject(item);
    return !!object && Object.values(object).every(isNumber);
  };
  const isRebuildRollup = (item: unknown): boolean => {
    const rollup = asObject(item);
    const byCause = asObject(rollup?.byCause);
    return !!rollup &&
      hasNumbers(rollup, ['events', 'rewroteTokens']) &&
      !!byCause &&
      Object.values(byCause).every((cause) => hasNumbers(cause, ['events', 'rewroteTokens']));
  };
  const validateCommonSession = (): void => {
    if (
      !session ||
      typeof session.mainTranscript !== 'string' ||
      !isNullableNumber(session.start) ||
      !isNullableNumber(session.end) ||
      !isNullableNumber(session.durationMs) ||
      !isNumber(session.agentCount)
    ) invalid();
  };
  validateCommonSession();
  if (report.caveats !== undefined && !hasStringArray(report.caveats)) invalid();

  if (runtime === 'claude') {
    if (
      !hasNumbers(report.pricing, ['cacheReadX', 'cacheWriteMainX', 'cacheWriteSubX']) ||
      !hasNumbers(report.totals, [
        'requests',
        'outputTokens',
        'inputRaw',
        'cacheWrite',
        'cacheRead',
        'billedInputEq',
      ])
    ) invalid();
    const totals = asObject(report.totals)!;
    const churn = asObject(totals.churn);
    const resumes = asObject(totals.resumes);
    if (
      !churn ||
      !isNumber(churn.tokens) ||
      !isNumber(churn.events) ||
      !asObject(churn.byCause) ||
      !resumes ||
      !hasNumbers(resumes, ['hit', 'miss', 'missRewrote']) ||
      !asObject(report.byModel) ||
      !hasNumericValues(report.gapHistogram) ||
      !Array.isArray(report.agents) ||
      !Array.isArray(report.churnEvents)
    ) invalid();
    if (
      !Object.values(asObject(report.byModel)!).every((value) =>
        hasNumbers(value, ['requests', 'outputTokens', 'cacheWrite', 'cacheRead'])
      ) ||
      !Object.values(asObject(churn!.byCause)!).every((value) =>
        hasNumbers(value, ['tokens', 'events'])
      )
    ) invalid();
    const requests = asObject(report.requests);
    if (
      !requests ||
      !hasStringArray(requests.columns) ||
      !hasStringArray(requests.classes) ||
      !Array.isArray(requests.rows) ||
      !requests.rows.every(
        (row) => Array.isArray(row) && row.every((cell) => cell === null || isNumber(cell))
      )
    ) invalid();
    for (const agentValue of report.agents as unknown[]) {
      const agent = asObject(agentValue);
      if (
        !agent ||
        !isNumber(agent.index) ||
        typeof agent.label !== 'string' ||
        typeof agent.roleFamily !== 'string' ||
        typeof agent.kind !== 'string' ||
        !asObject(agent.models) ||
        !hasNumericValues(agent.models) ||
        !isNullableNumber(agent.firstTs) ||
        !isNullableNumber(agent.lastTs) ||
        !hasNumbers(agent, [
          'requests',
          'outputTokens',
          'cacheWrite',
          'cacheRead',
          'billedInputEq',
          'peakContext',
          'spawnWrite',
        ]) ||
        !hasNumbers(agent.churn, ['tokens', 'events']) ||
        !hasNumbers(agent.resumes, ['hit', 'miss'])
      ) invalid();
    }
    for (const eventValue of report.churnEvents as unknown[]) {
      const event = asObject(eventValue);
      if (
        !event ||
        typeof event.cause !== 'string' ||
        !isNumber(event.agent) ||
        !isNullableNumber(event.ts) ||
        !isNullableNumber(event.gapMin) ||
        !hasNumbers(event, ['rewrote', 'prevPrefix', 'readNow']) ||
        typeof event.forked !== 'boolean' ||
        typeof event.injected !== 'boolean'
      ) invalid();
    }
  } else if (runtime === 'codex') {
    const totals = asObject(report.totals);
    if (
      !totals ||
      !isNumber(totals.requests) ||
      !isNumber(totals.cacheHitRatio) ||
      !hasNumbers(totals.rawTokens, [
        'inputTokens',
        'cachedInputTokens',
        'cacheWriteInputTokens',
        'outputTokens',
        'reasoningOutputTokens',
        'totalTokens',
      ]) ||
      !Array.isArray(report.agents)
    ) invalid();
    if (
      (session.forkedFrom !== undefined && typeof session.forkedFrom !== 'string') ||
      (totals!.rebuilds !== undefined && !isRebuildRollup(totals!.rebuilds))
    ) invalid();
    for (const agentValue of report.agents as unknown[]) {
      const agent = asObject(agentValue);
      if (
        !agent ||
        !isNumber(agent.index) ||
        typeof agent.label !== 'string' ||
        typeof agent.kind !== 'string' ||
        !isNumber(agent.requests) ||
        !isNumber(agent.cacheHitRatio) ||
        !hasNumbers(agent.rawTokens, [
          'inputTokens',
          'cachedInputTokens',
          'cacheWriteInputTokens',
          'outputTokens',
          'reasoningOutputTokens',
          'totalTokens',
        ]) ||
        !Array.isArray(agent.turns)
      ) invalid();
      if (
        (agent!.key !== undefined && typeof agent!.key !== 'string') ||
        (agent!.threadId !== undefined && typeof agent!.threadId !== 'string') ||
        (agent!.parentThreadId !== undefined && !isNullableString(agent!.parentThreadId)) ||
        (agent!.firstTs !== undefined && !isNullableNumber(agent!.firstTs)) ||
        (agent!.lastTs !== undefined && !isNullableNumber(agent!.lastTs)) ||
        (agent!.peakContext !== undefined && !isNumber(agent!.peakContext)) ||
        (agent!.modelContextWindow !== undefined && !isNullableNumber(agent!.modelContextWindow)) ||
        (agent!.bursts !== undefined && !Array.isArray(agent!.bursts)) ||
        (agent!.rebuilds !== undefined && !isRebuildRollup(agent!.rebuilds))
      ) invalid();
      for (const turnValue of agent!.turns as unknown[]) {
        const turn = asObject(turnValue);
        if (
          !turn ||
          !(turn.turnId === null || typeof turn.turnId === 'string') ||
          !isNullableNumber(turn.start) ||
          !isNullableNumber(turn.end) ||
          !isNumber(turn.requests) ||
          !isNumber(turn.cacheHitRatio) ||
          !hasNumbers(turn.rawTokens, [
            'inputTokens',
            'cachedInputTokens',
            'cacheWriteInputTokens',
            'outputTokens',
            'reasoningOutputTokens',
            'totalTokens',
          ]) ||
          (turn.aborted !== undefined && typeof turn.aborted !== 'boolean')
        ) invalid();
      }
    }
    const requests = report.requests === undefined ? null : asObject(report.requests);
    if (
      report.requests !== undefined &&
      (!requests ||
        !hasStringArray(requests.columns) ||
        !hasStringArray(requests.classes) ||
        !Array.isArray(requests.rows) ||
        !requests.rows.every(
          (row) => Array.isArray(row) && row.every((cell) => cell === null || isNumber(cell))
        ))
    ) invalid();
    if (
      report.rebuildEvents !== undefined &&
      (!Array.isArray(report.rebuildEvents) ||
        !report.rebuildEvents.every((eventValue) => {
          const event = asObject(eventValue);
          return !!event &&
            typeof event.cause === 'string' &&
            isNumber(event.agent) &&
            isNullableNumber(event.ts) &&
            isNullableNumber(event.gapMin) &&
            hasNumbers(event, ['rewrote', 'prevPrefix', 'readNow']) &&
            (event.compacted === undefined || typeof event.compacted === 'boolean') &&
            (event.injected === undefined || typeof event.injected === 'boolean') &&
            (event.rolledBack === undefined || typeof event.rolledBack === 'boolean') &&
            (event.approximate === undefined || typeof event.approximate === 'boolean');
        }))
    ) invalid();
    if (
      report.unsupportedDimensions !== undefined &&
      (!Array.isArray(report.unsupportedDimensions) ||
        !report.unsupportedDimensions.every((item) => {
          const dimension = asObject(item);
          return !!dimension &&
            typeof dimension.dimension === 'string' &&
            typeof dimension.reason === 'string';
        }))
    ) invalid();
  } else {
    const totals = asObject(report.totals);
    const source = asObject(report.source);
    if (
      !totals ||
      !isNumber(totals.retainedRequests) ||
      !isNumber(totals.cacheHitRatio) ||
      !hasNumbers(totals.rawTokens, ['inputTokens', 'cachedInputTokens', 'outputTokens']) ||
      !Array.isArray(report.threads) ||
      !source ||
      source.adapter !== 'zed-threads-db' ||
      !(source.dataVersion === null || typeof source.dataVersion === 'string')
    ) invalid();
    for (const field of ['title', 'workingDir', 'firstUserCommand'] as const) {
      const fieldValue = session[field];
      if (fieldValue !== undefined && !isNullableString(fieldValue)) invalid();
    }
    for (const threadValue of report.threads as unknown[]) {
      const thread = asObject(threadValue);
      if (
        !thread ||
        !isNumber(thread.index) ||
        typeof thread.threadId !== 'string' ||
        typeof thread.kind !== 'string' ||
        !isNumber(thread.retainedRequests) ||
        !isNumber(thread.cacheHitRatio) ||
        !hasNumbers(thread.rawTokens, ['inputTokens', 'cachedInputTokens', 'outputTokens'])
      ) invalid();
      for (const field of ['title', 'model', 'parentThreadId', 'workingDir', 'firstUserCommand'] as const) {
        const fieldValue = thread![field];
        if (fieldValue !== null && fieldValue !== undefined && typeof fieldValue !== 'string') invalid();
      }
    }
  }
  return value as AuditResult;
}

function memberCount(report: AuditResult): number {
  const sessionCount = report.session.agentCount;
  if (typeof sessionCount === 'number' && Number.isFinite(sessionCount)) return sessionCount;
  const raw = report as unknown as Record<string, unknown>;
  if (Array.isArray(raw.agents)) return raw.agents.length;
  if (Array.isArray(raw.threads)) return raw.threads.length;
  return 0;
}

function descriptorFor(id: string, report: AuditResult, modifiedAt: number): AuditReportDescriptor {
  const session = report.session;
  const runtime = runtimeOf(session.runtime) ?? 'claude';
  const title =
    'title' in session && typeof session.title === 'string' && session.title.trim() !== ''
      ? session.title
      : undefined;
  return {
    id,
    runtime,
    sessionId: session.id,
    ...(title ? { title } : {}),
    generatedAt: report.generatedAt,
    sessionStart: typeof session.start === 'number' ? session.start : null,
    sessionEnd: typeof session.end === 'number' ? session.end : null,
    memberCount: memberCount(report),
    modifiedAt,
  };
}

function analyticsDir(options: AuditManagementOptions): string {
  return path.join(getGlobalDataDir(options), 'analytics');
}

function parseReportText(content: string): AuditResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new AuditServiceError(400, 'invalid_audit_report', 'The saved audit report is not valid JSON.');
  }
  return validateAuditReport(parsed);
}

function readReportFile(filePath: string): AuditResult {
  return parseReportText(fs.readFileSync(filePath, 'utf8'));
}

function safeDirectReportPath(dir: string, id: string): string {
  if (
    id.length === 0 ||
    id !== path.basename(id) ||
    !id.toLowerCase().endsWith('.json') ||
    id.includes('/') ||
    id.includes('\\') ||
    path.isAbsolute(id)
  ) {
    throw new AuditServiceError(404, 'audit_not_found', 'No saved audit report matches that id.');
  }
  const resolvedDir = path.resolve(dir);
  const resolved = path.resolve(resolvedDir, id);
  if (path.dirname(resolved) !== resolvedDir) {
    throw new AuditServiceError(404, 'audit_not_found', 'No saved audit report matches that id.');
  }
  return resolved;
}

export class AuditReportRepository {
  constructor(private readonly options: AuditManagementOptions = {}) {}

  list(): AuditReportList {
    const dir = analyticsDir(this.options);
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { reports: [], skipped: 0 };
      throw new AuditServiceError(500, 'audit_list_failed', `Unable to read saved audits: ${String(error)}`);
    }
    const reports: AuditReportDescriptor[] = [];
    let skipped = 0;
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.json')) {
        skipped++;
        continue;
      }
      const full = path.join(dir, entry.name);
      try {
        const { report, stat } = readDirectReport(full);
        reports.push(descriptorFor(entry.name, report, stat.mtimeMs));
      } catch {
        skipped++;
      }
    }
    reports.sort((a, b) => b.modifiedAt - a.modifiedAt || b.generatedAt.localeCompare(a.generatedAt));
    return { reports, skipped };
  }

  read(id: string): AuditReportDetail {
    const full = safeDirectReportPath(analyticsDir(this.options), id);
    try {
      const { report, stat } = readDirectReport(full);
      return { descriptor: descriptorFor(id, report, stat.mtimeMs), report };
    } catch (error) {
      if (error instanceof AuditServiceError) {
        throw new AuditServiceError(404, 'audit_not_found', 'No valid saved audit report matches that id.');
      }
      throw error;
    }
  }

  importReport(report: AuditResult, preferredName: string): AuditReportDetail {
    const dir = analyticsDir(this.options);
    fs.mkdirSync(dir, { recursive: true });
    const stem = path.basename(preferredName, path.extname(preferredName))
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^[.-]+/, '')
      .slice(0, 80) || 'imported-audit';
    let id = `${stem}.json`;
    let n = 1;
    while (fs.existsSync(path.join(dir, id))) id = `${stem}-${n++}.json`;
    const target = safeDirectReportPath(dir, id);
    fs.writeFileSync(target, JSON.stringify(report), { encoding: 'utf8', flag: 'wx' });
    return this.read(id);
  }
}

/**
 * Open once, then validate and read the same object. O_NOFOLLOW closes the
 * symlink race on platforms that support it; the post-open lstat/fstat
 * identity comparison is the cross-platform fallback.
 */
function readDirectReport(filePath: string): { report: AuditResult; stat: fs.Stats } {
  let descriptor: number | undefined;
  try {
    const noFollow = fs.constants.O_NOFOLLOW ?? 0;
    descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | noFollow);
    const opened = fs.fstatSync(descriptor);
    const direct = fs.lstatSync(filePath);
    if (
      !opened.isFile() ||
      !direct.isFile() ||
      direct.isSymbolicLink() ||
      direct.dev !== opened.dev ||
      direct.ino !== opened.ino
    ) {
      throw new AuditServiceError(404, 'audit_not_found', 'No direct saved audit report matches that id.');
    }
    return { report: parseReportText(fs.readFileSync(descriptor, 'utf8')), stat: opened };
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function safeDirEntries(dir: string): fs.Dirent[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function claudeRoot(options: AuditManagementOptions): string {
  return options.claudeProjectsRoot ?? path.join(options.homedir ?? os.homedir(), '.claude', 'projects');
}

interface NativeTarget {
  target: string;
  options: AuditManagementOptions & {
    projectsDir?: string;
    runtime: AuditRuntime;
    codexHome?: string;
    db?: string;
  };
}

function discoverClaude(options: AuditManagementOptions, limit: number): RecentAuditSession[] {
  const root = claudeRoot(options);
  if (!fs.existsSync(root)) throw new Error(`Claude projects store not found: ${root}`);
  const sessions: RecentAuditSession[] = [];
  for (const project of safeDirEntries(root)) {
    if (!project.isDirectory()) continue;
    const projectDir = path.join(root, project.name);
    for (const entry of safeDirEntries(projectDir)) {
      if (!entry.isFile() || !entry.name.endsWith('.jsonl') || entry.name.startsWith('agent-')) continue;
      const full = path.join(projectDir, entry.name);
      try {
        const stat = fs.statSync(full);
        const sessionId = path.basename(entry.name, '.jsonl');
        sessions.push({
          runtime: 'claude',
          sessionId,
          label: sessionId,
          updatedAt: stat.mtimeMs,
          workingDir: project.name,
        });
      } catch {
        // A disappearing transcript is omitted.
      }
    }
  }
  return sessions
    .sort((a, b) => b.updatedAt - a.updatedAt || a.sessionId.localeCompare(b.sessionId))
    .slice(0, limit);
}

function discoverCodex(options: AuditManagementOptions, limit: number): RecentAuditSession[] {
  const home = options.codexHome ?? resolveCodexHome();
  const activeDir = path.join(home, 'sessions');
  const archivedDir = path.join(home, 'archived_sessions');
  if (!fs.existsSync(activeDir) && !fs.existsSync(archivedDir)) {
    throw new Error(`Codex session store not found: ${home}`);
  }
  const sessions: RecentAuditSession[] = [];
  const candidateLimit = Math.max(100, Math.min(MAX_RECENT_AUDIT_LIMIT * 4, limit * 4));
  const candidates = listStoredRolloutFiles(home).slice(0, candidateLimit);
  for (const entry of candidates) {
    const meta = readRolloutSessionMeta(entry.path);
    if (!meta || meta.parent_thread_id !== undefined || meta.forked_from_id !== undefined) continue;
    const id = typeof meta.session_id === 'string' ? meta.session_id : typeof meta.id === 'string' ? meta.id : null;
    if (!id) continue;
    sessions.push({
      runtime: 'codex',
      sessionId: id,
      label: id,
      updatedAt: entry.mtimeMs,
      ...(typeof meta.timestamp === 'string' && Number.isFinite(Date.parse(meta.timestamp))
        ? { startedAt: Date.parse(meta.timestamp) }
        : {}),
      ...(typeof meta.cwd === 'string' ? { workingDir: meta.cwd } : {}),
    });
  }
  return sessions.slice(0, limit);
}

function discoverZed(options: AuditManagementOptions, limit: number): RecentAuditSession[] {
  const dbPath = options.zedDbPath ?? resolveDefaultZedDbPath(options);
  const db = openZedDatabase(dbPath);
  try {
    return queryRecentRootThreadMetadata(db, limit)
      .map((row) => {
        const updated = row.updatedAt ? Date.parse(row.updatedAt) : NaN;
        const started = row.createdAt ? Date.parse(row.createdAt) : NaN;
        return {
          runtime: 'zed' as const,
          sessionId: row.id,
          label: row.summary || row.id,
          updatedAt: Number.isFinite(updated) ? updated : Number.isFinite(started) ? started : 0,
          ...(Number.isFinite(started) ? { startedAt: started } : {}),
          ...(row.summary ? { title: row.summary } : {}),
          ...(row.folderPaths ? { workingDir: row.folderPaths } : {}),
        };
      });
  } finally {
    db.close();
  }
}

export function discoverAuditSessions(
  requestedLimit = DEFAULT_RECENT_AUDIT_LIMIT,
  options: AuditManagementOptions = {}
): DiscoverAuditSessionsResult {
  const limit = Math.max(1, Math.min(MAX_RECENT_AUDIT_LIMIT, Math.trunc(requestedLimit)));
  const sessions: RecentAuditSession[] = [];
  const diagnostics: AuditRuntimeDiagnostic[] = [];
  const discoverers: Array<[AuditRuntime, () => RecentAuditSession[]]> = [
    ['claude', () => discoverClaude(options, limit)],
    ['codex', () => discoverCodex(options, limit)],
    ['zed', () => discoverZed(options, limit)],
  ];
  for (const [runtime, discover] of discoverers) {
    try {
      sessions.push(...discover());
      diagnostics.push({ runtime, available: true });
    } catch (error) {
      diagnostics.push({
        runtime,
        available: false,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  sessions.sort((a, b) => b.updatedAt - a.updatedAt || a.sessionId.localeCompare(b.sessionId));
  const unique: RecentAuditSession[] = [];
  const seen = new Set<string>();
  const duplicateRuntimes = new Set<AuditRuntime>();
  for (const session of sessions) {
    const key = `${session.runtime}:${session.sessionId}`;
    if (seen.has(key)) {
      duplicateRuntimes.add(session.runtime);
      continue;
    }
    seen.add(key);
    unique.push(session);
  }
  for (const runtime of duplicateRuntimes) {
    const diagnostic = diagnostics.find((item) => item.runtime === runtime);
    if (diagnostic) diagnostic.message = 'Older duplicate session ids were omitted; the newest entry is selected deterministically.';
  }
  return { sessions: unique.slice(0, limit), diagnostics, limit };
}

export function resolveNativeAuditTarget(
  runtime: AuditRuntime,
  sessionId: string,
  options: AuditManagementOptions = {}
): NativeTarget {
  if (!sessionId || sessionId.includes('/') || sessionId.includes('\\') || sessionId.includes('\0')) {
    throw new AuditServiceError(400, 'invalid_session', 'A valid exact session id is required.');
  }
  if (runtime === 'claude') {
    const matches: Array<{ dir: string; mtimeMs: number }> = [];
    for (const project of safeDirEntries(claudeRoot(options))) {
      if (!project.isDirectory()) continue;
      const candidate = path.join(claudeRoot(options), project.name, `${sessionId}.jsonl`);
      try {
        const stat = fs.lstatSync(candidate);
        if (stat.isFile() && !stat.isSymbolicLink()) matches.push({ dir: path.dirname(candidate), mtimeMs: stat.mtimeMs });
      } catch {
        // no exact transcript in this project
      }
    }
    if (matches.length === 0) {
      throw new AuditServiceError(
        404,
        'audit_session_not_found',
        `Claude session "${sessionId}" is no longer available.`
      );
    }
    matches.sort((a, b) => b.mtimeMs - a.mtimeMs || a.dir.localeCompare(b.dir));
    return {
      target: sessionId,
      options: { ...options, runtime, projectsDir: matches[0].dir },
    };
  }
  if (runtime === 'codex') {
    const matches = discoverCodex(options, MAX_RECENT_AUDIT_LIMIT).filter((item) => item.sessionId === sessionId);
    if (matches.length === 0) {
      throw new AuditServiceError(404, 'audit_session_not_found', `Codex session "${sessionId}" is no longer available.`);
    }
    return {
      target: sessionId,
      options: { ...options, runtime, codexHome: options.codexHome ?? resolveCodexHome() },
    };
  }
  const dbPath = options.zedDbPath ?? resolveDefaultZedDbPath(options);
  const db = openZedDatabase(dbPath);
  try {
    const matches = queryRootThreadIds(db, sessionId);
    if (matches.length !== 1) {
      throw new AuditServiceError(404, 'audit_session_not_found', `Zed session "${sessionId}" is no longer available.`);
    }
  } finally {
    db.close();
  }
  return { target: sessionId, options: { ...options, runtime, db: dbPath } };
}

function normalizeAuditError(error: unknown): AuditServiceError {
  if (error instanceof AuditServiceError) return error;
  const message = error instanceof Error ? error.message : String(error);
  const formatDrift = /format|transcript|rollout|parse|session_meta|token/i.test(message);
  return new AuditServiceError(
    400,
    formatDrift ? 'audit_format_error' : 'audit_failed',
    message,
    formatDrift ? 'Update Rasen or use `rasen agent audit <path>` to inspect the source directly.' : undefined
  );
}

async function executeAuditOffLoop(target: string, options: RunAuditOptions): Promise<RunAuditResult> {
  const workerUrl = new URL('./management-worker.js', import.meta.url);
  // Vitest loads TypeScript source directly, where the compiled worker does
  // not exist. Production builds always include it; source-mode tests retain
  // behavior via the same core after yielding the request loop.
  if (!fs.existsSync(fileURLToPath(workerUrl))) {
    await new Promise<void>((resolve) => setImmediate(resolve));
    return runAudit(target, options);
  }
  return new Promise<RunAuditResult>((resolve, reject) => {
    const worker = new Worker(workerUrl, { workerData: { target, options } });
    worker.once(
      'message',
      (message: { ok: boolean; result?: RunAuditResult; error?: { message?: string } }) => {
        if (message.ok && message.result) resolve(message.result);
        else reject(new Error(message.error?.message ?? 'Audit worker failed.'));
      }
    );
    worker.once('error', reject);
    worker.once('exit', (code) => {
      if (code !== 0) reject(new Error(`Audit worker exited with code ${code}.`));
    });
  });
}

async function discoverOffLoop(
  limit: number | undefined,
  options: AuditManagementOptions
): Promise<DiscoverAuditSessionsResult> {
  const workerUrl = new URL('./management-discovery-worker.js', import.meta.url);
  if (!fs.existsSync(fileURLToPath(workerUrl))) {
    await new Promise<void>((resolve) => setImmediate(resolve));
    return discoverAuditSessions(limit, options);
  }
  return new Promise<DiscoverAuditSessionsResult>((resolve, reject) => {
    const worker = new Worker(workerUrl, { workerData: { limit, options } });
    let settled = false;
    worker.once(
      'message',
      (message: {
        ok: boolean;
        result?: DiscoverAuditSessionsResult;
        error?: { message?: string };
      }) => {
        settled = true;
        if (message.ok && message.result) resolve(message.result);
        else reject(new Error(message.error?.message ?? 'Audit discovery worker failed.'));
      }
    );
    worker.once('error', (error) => {
      settled = true;
      reject(error);
    });
    worker.once('exit', (code) => {
      if (!settled && code !== 0) reject(new Error(`Audit discovery worker exited with code ${code}.`));
    });
  });
}

export class AuditManagementService {
  private busy = false;
  readonly reports: AuditReportRepository;

  constructor(private readonly options: AuditManagementOptions = {}) {
    this.reports = new AuditReportRepository(options);
  }

  discover(limit?: number): Promise<DiscoverAuditSessionsResult> {
    return discoverOffLoop(limit, this.options);
  }

  async runNative(runtime: AuditRuntime, sessionId: string): Promise<AuditReportDetail> {
    return this.withFlight(async () => {
      const resolved = resolveNativeAuditTarget(runtime, sessionId, this.options);
      try {
        const result = await executeAuditOffLoop(resolved.target, resolved.options);
        return this.reports.read(path.basename(result.outPath));
      } catch (error) {
        throw normalizeAuditError(error);
      }
    });
  }

  async importStream(
    source: Readable,
    clientFilename: string,
    declaredBytes?: number,
    maxBytes = MAX_AUDIT_IMPORT_BYTES
  ): Promise<AuditReportDetail> {
    return this.withFlight(async () => {
      if (declaredBytes !== undefined && declaredBytes > maxBytes) {
        throw new AuditServiceError(
          413,
          'payload_too_large',
          `Audit imports are limited to ${maxBytes} bytes.`
        );
      }
      const safeName = path.basename(clientFilename.replaceAll('\\', '/'));
      const ext = path.extname(safeName).toLowerCase();
      if (!['.jsonl', '.db', '.sqlite', '.json'].includes(ext)) {
        throw new AuditServiceError(
          400,
          'unsupported_audit_file',
          'Choose a .jsonl, .db, .sqlite, or supported audit-report .json file.'
        );
      }
      const tempDir = path.join(getGlobalDataDir(this.options), 'tmp', 'audit-imports');
      fs.mkdirSync(tempDir, { recursive: true });
      const tempPath = path.join(tempDir, `${randomUUID()}${ext}`);
      let handle: fs.promises.FileHandle | undefined;
      try {
        handle = await fs.promises.open(tempPath, 'wx');
        let total = 0;
        for await (const raw of source) {
          const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
          total += chunk.length;
          if (total > maxBytes) {
            throw new AuditServiceError(
              413,
              'payload_too_large',
              `Audit imports are limited to ${maxBytes} bytes.`
            );
          }
          await handle.write(chunk);
        }
        await handle.close();
        handle = undefined;

        if (ext === '.json') {
          const report = readReportFile(tempPath);
          return this.reports.importReport(report, safeName);
        }

        let auditTarget = tempPath;
        let auditOptions: RunAuditOptions = this.options;
        if (ext === '.db' || ext === '.sqlite') {
          const db = openZedDatabase(tempPath);
          try {
            const roots = queryAllThreadRows(db)
              .filter((row) => row.parentId === null)
              .sort((a, b) => {
                const aTime = Date.parse(a.updatedAt ?? a.createdAt ?? '') || 0;
                const bTime = Date.parse(b.updatedAt ?? b.createdAt ?? '') || 0;
                return bTime - aTime || a.id.localeCompare(b.id);
              });
            if (roots.length === 0) {
              throw new AuditServiceError(400, 'audit_format_error', 'The uploaded Zed database has no root threads.');
            }
            auditTarget = roots[0].id;
            auditOptions = { ...this.options, runtime: 'zed', db: tempPath };
          } finally {
            db.close();
          }
        }
        const result = await executeAuditOffLoop(auditTarget, auditOptions);
        return this.reports.read(path.basename(result.outPath));
      } catch (error) {
        throw normalizeAuditError(error);
      } finally {
        await handle?.close().catch(() => undefined);
        await fs.promises.rm(tempPath, { force: true }).catch(() => undefined);
      }
    });
  }

  private async withFlight<T>(operation: () => Promise<T>): Promise<T> {
    if (this.busy) {
      throw new AuditServiceError(
        409,
        'audit_busy',
        'Another audit or import is already running.',
        'Wait for it to finish, then retry.'
      );
    }
    this.busy = true;
    try {
      return await operation();
    } finally {
      this.busy = false;
    }
  }
}
