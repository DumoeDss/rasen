import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { buildCodexFamilyMember, discoverCodexThreadFamily } from '../../../../src/core/token-audit/discover-codex.js';

function sessionMeta(overrides: Record<string, unknown>): string {
  return JSON.stringify({ type: 'session_meta', payload: overrides });
}

describe('discoverCodexThreadFamily', () => {
  let sessionsDir: string;

  beforeEach(() => {
    sessionsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-token-audit-codex-discover-'));
  });
  afterEach(() => {
    fs.rmSync(sessionsDir, { recursive: true, force: true });
  });

  function writeRollout(relativePath: string, meta: Record<string, unknown>): string {
    const full = path.join(sessionsDir, relativePath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, sessionMeta(meta) + '\n', 'utf-8');
    return full;
  }

  it('finds the root thread alone when it has no subagents', () => {
    writeRollout('2026/01/01/rollout-2026-01-01T00-00-00-main.jsonl', { session_id: 'main-1', thread_source: 'user' });
    const family = discoverCodexThreadFamily('main-1', sessionsDir);
    expect(family.map((m) => m.threadId)).toEqual(['main-1']);
  });

  it('collects direct subagents via parent_thread_id', () => {
    writeRollout('2026/01/01/rollout-a-main.jsonl', { session_id: 'main-1', thread_source: 'user' });
    writeRollout('2026/01/01/rollout-b-sub.jsonl', {
      session_id: 'sub-1',
      thread_source: 'subagent',
      parent_thread_id: 'main-1',
      agent_nickname: 'worker',
    });
    const family = discoverCodexThreadFamily('main-1', sessionsDir);
    expect(new Set(family.map((m) => m.threadId))).toEqual(new Set(['main-1', 'sub-1']));
    const sub = family.find((m) => m.threadId === 'sub-1')!;
    expect(sub.parentThreadId).toBe('main-1');
    expect(sub.agentNickname).toBe('worker');
  });

  it('collects a transitively nested subagent (subagent of a subagent)', () => {
    writeRollout('2026/01/01/rollout-a-main.jsonl', { session_id: 'main-1', thread_source: 'user' });
    writeRollout('2026/01/01/rollout-b-sub.jsonl', {
      session_id: 'sub-1', thread_source: 'subagent', parent_thread_id: 'main-1',
    });
    writeRollout('2026/01/01/rollout-c-subsub.jsonl', {
      session_id: 'sub-sub-1', thread_source: 'subagent', parent_thread_id: 'sub-1',
    });
    const family = discoverCodexThreadFamily('main-1', sessionsDir);
    expect(new Set(family.map((m) => m.threadId))).toEqual(new Set(['main-1', 'sub-1', 'sub-sub-1']));
  });

  it('does not pull in an unrelated thread family', () => {
    writeRollout('2026/01/01/rollout-a-main.jsonl', { session_id: 'main-1', thread_source: 'user' });
    writeRollout('2026/01/01/rollout-b-unrelated.jsonl', { session_id: 'other-main', thread_source: 'user' });
    const family = discoverCodexThreadFamily('main-1', sessionsDir);
    expect(family.map((m) => m.threadId)).toEqual(['main-1']);
  });
});

describe('buildCodexFamilyMember', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-token-audit-codex-member-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns undefined for a rollout with no session_id/id', () => {
    const p = path.join(dir, 'r.jsonl');
    fs.writeFileSync(p, sessionMeta({ thread_source: 'user' }) + '\n', 'utf-8');
    expect(buildCodexFamilyMember(p)).toBeUndefined();
  });

  it('falls back agentNickname -> agentPath when nickname is absent', () => {
    const p = path.join(dir, 'r.jsonl');
    fs.writeFileSync(p, sessionMeta({ session_id: 'x1', agent_path: 'agents/worker.md' }) + '\n', 'utf-8');
    const member = buildCodexFamilyMember(p)!;
    expect(member.agentNickname).toBeNull();
    expect(member.agentPath).toBe('agents/worker.md');
  });

  it('reads forked_from_id when present (M1)', () => {
    const p = path.join(dir, 'forked.jsonl');
    fs.writeFileSync(p, sessionMeta({ session_id: 'x2', forked_from_id: 'parent-thread-1' }) + '\n', 'utf-8');
    const member = buildCodexFamilyMember(p)!;
    expect(member.forkedFromId).toBe('parent-thread-1');
  });

  it('reports forkedFromId as null when absent', () => {
    const p = path.join(dir, 'unforked.jsonl');
    fs.writeFileSync(p, sessionMeta({ session_id: 'x3' }) + '\n', 'utf-8');
    const member = buildCodexFamilyMember(p)!;
    expect(member.forkedFromId).toBeNull();
  });
});
