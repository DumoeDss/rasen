/**
 * Codex subagent-family discovery (design D5) — the Codex analog of Claude's
 * `<projectsDir>/<sessionId>/subagents/*.jsonl` directory scan. Codex has no
 * such directory: every thread (main or subagent) persists as its own
 * separate rollout file somewhere in the `sessions/<Y>/<M>/<D>/` tree, so
 * discovery is a bounded scan (`listRolloutFiles`, already exported and
 * bounded by that fixed three-level structure) plus a BFS over each
 * candidate's `session_meta.parent_thread_id`.
 */
import { listRolloutFiles, readRolloutSessionMeta } from '../codex/index.js';

/** One member of a Codex thread family (the target thread or one of its transitive subagents). */
export interface CodexFamilyMember {
  path: string;
  threadId: string;
  parentThreadId: string | null;
  agentNickname: string | null;
  agentPath: string | null;
  threadSource: string | null;
  /**
   * `session_meta.payload.forked_from_id` — set when this rollout is a
   * fork/resume that replays another session's history into its own file
   * (M1 fix, `rasen/changes/agent-audit-command/work/review-report.md`).
   * `agent-context.ts:findLatestRollout` already excludes any rollout with
   * this field set from `--latest` discovery; `discoverCodexThreadFamily`
   * does NOT exclude it (a fork can still be a legitimate audit target when
   * named explicitly by id/path) — callers must flag it instead, see D5.
   */
  forkedFromId: string | null;
}

function readString(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  return typeof v === 'string' ? v : null;
}

/**
 * Builds a family member record from a rollout's `session_meta` first line,
 * or `undefined` when the file is unreadable/malformed or carries no thread
 * id (`session_id`/`id`).
 */
export function buildCodexFamilyMember(rolloutPath: string): CodexFamilyMember | undefined {
  const meta = readRolloutSessionMeta(rolloutPath);
  if (!meta) return undefined;
  const threadId = readString(meta, 'session_id') ?? readString(meta, 'id');
  if (!threadId) return undefined;
  return {
    path: rolloutPath,
    threadId,
    parentThreadId: readString(meta, 'parent_thread_id'),
    agentNickname: readString(meta, 'agent_nickname'),
    agentPath: readString(meta, 'agent_path'),
    threadSource: readString(meta, 'thread_source'),
    forkedFromId: readString(meta, 'forked_from_id'),
  };
}

/**
 * BFS over every rollout under `sessionsDir` (`listRolloutFiles`, bounded)
 * starting at `threadId`, following each candidate's recorded
 * `parent_thread_id` to collect the full subagent family transitively — a
 * subagent's own subagent still belongs to the audit. Returns every family
 * member found in the tree, including the root when it is present there;
 * the root is NOT synthesized when it is not found (e.g. an archived
 * rollout outside `sessionsDir`) — callers that already hold the root's own
 * path should merge it in themselves.
 */
export function discoverCodexThreadFamily(threadId: string, sessionsDir: string): CodexFamilyMember[] {
  const candidates = listRolloutFiles(sessionsDir);
  const members: CodexFamilyMember[] = [];
  for (const candidate of candidates) {
    const member = buildCodexFamilyMember(candidate.path);
    if (member) members.push(member);
  }

  const byThreadId = new Map(members.map((m) => [m.threadId, m]));
  const childrenByParent = new Map<string, CodexFamilyMember[]>();
  for (const m of members) {
    if (!m.parentThreadId) continue;
    const list = childrenByParent.get(m.parentThreadId) ?? [];
    list.push(m);
    childrenByParent.set(m.parentThreadId, list);
  }

  const family: CodexFamilyMember[] = [];
  const visited = new Set<string>();
  const queue: string[] = [threadId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const member = byThreadId.get(id);
    if (member) family.push(member);
    for (const child of childrenByParent.get(id) ?? []) {
      queue.push(child.threadId);
    }
  }
  return family;
}
