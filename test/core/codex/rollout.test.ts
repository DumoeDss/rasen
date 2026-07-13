import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  findRolloutPath,
  readRolloutConversation,
  readRolloutOccupancy,
} from '../../../src/core/codex/rollout.js';

let codexHome: string;

beforeEach(() => {
  codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-codex-rollout-'));
});

afterEach(() => {
  fs.rmSync(codexHome, { recursive: true, force: true });
});

function writeRollout(relativePath: string, lines: string[]): string {
  const full = path.join(codexHome, 'sessions', relativePath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, `${lines.join('\n')}\n`, 'utf-8');
  return full;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * The deterministic path/filename codex-cli would derive from a LOCAL Date —
 * built independently of `findRolloutPath`'s own implementation, from the
 * Date object's local getters (matching how codex-cli names rollout files:
 * local time, not UTC — see rollout.ts's `deterministicRolloutPath` doc
 * comment for the live-verified evidence). Using a real local `Date`
 * constructor here (not `Date.UTC`) means this test holds under any CI
 * timezone rather than encoding one machine's UTC offset.
 */
function localRolloutRelativePath(date: Date, threadId: string): string {
  const year = String(date.getFullYear());
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  const ts = `${year}-${month}-${day}T${pad2(date.getHours())}-${pad2(date.getMinutes())}-${pad2(date.getSeconds())}`;
  return path.join(year, month, day, `rollout-${ts}-${threadId}.jsonl`);
}

describe('findRolloutPath', () => {
  it('resolves the deterministic dated path (LOCAL time) when a timestamp is known', () => {
    const threadId = '019f5504-86db-7cf1-9b59-5cdcf0f70672';
    const timestamp = new Date(2026, 6, 12, 14, 29, 47); // local time, not UTC
    const expected = writeRollout(localRolloutRelativePath(timestamp, threadId), [
      '{"type":"session_meta"}',
    ]);
    const found = findRolloutPath(threadId, { codexHome, timestamp });
    expect(found).toBe(expected);
  });

  it('falls back to a newest-first tree scan when no timestamp is given', () => {
    const threadId = '019f5508-692d-7033-93ee-7421963506af';
    const expected = writeRollout(`2026/07/12/rollout-2026-07-12T09-00-00-${threadId}.jsonl`, [
      '{"type":"session_meta"}',
    ]);
    const found = findRolloutPath(threadId, { codexHome });
    expect(found).toBe(expected);
  });

  it('scans even when a timestamp is given but the deterministic file is absent', () => {
    const threadId = '019f5508-c42a-7e51-9f72-1ffbab60f7ea';
    const expected = writeRollout(`2026/07/12/rollout-2026-07-12T09-05-00-${threadId}.jsonl`, [
      '{"type":"session_meta"}',
    ]);
    const wrongTimestamp = new Date(2026, 6, 12, 3, 0, 0); // local time, deliberately not matching the file above
    const found = findRolloutPath(threadId, { codexHome, timestamp: wrongTimestamp });
    expect(found).toBe(expected);
  });

  it('reports absence explicitly when no rollout matches', () => {
    fs.mkdirSync(path.join(codexHome, 'sessions'), { recursive: true });
    expect(findRolloutPath('no-such-thread', { codexHome })).toBeUndefined();
  });

  it('reports absence when the sessions directory does not exist at all', () => {
    expect(findRolloutPath('no-such-thread', { codexHome })).toBeUndefined();
  });

  it('falls back to the archived_sessions/ flat directory when the active sessions tree has no match', () => {
    const threadId = '019c571a-5af1-7871-b861-434d6b995a5e';
    fs.mkdirSync(path.join(codexHome, 'sessions'), { recursive: true }); // active tree exists but empty
    const archivedFull = path.join(codexHome, 'archived_sessions', `rollout-2026-02-13T21-04-30-${threadId}.jsonl`);
    fs.mkdirSync(path.dirname(archivedFull), { recursive: true });
    fs.writeFileSync(archivedFull, '{"type":"session_meta"}\n', 'utf-8');
    const found = findRolloutPath(threadId, { codexHome });
    expect(found).toBe(archivedFull);
  });

  it('still reports absence when neither the active tree nor archived_sessions has a match', () => {
    fs.mkdirSync(path.join(codexHome, 'sessions'), { recursive: true });
    fs.mkdirSync(path.join(codexHome, 'archived_sessions'), { recursive: true });
    expect(findRolloutPath('no-such-thread', { codexHome })).toBeUndefined();
  });

  it('reports absence when archived_sessions does not exist at all either', () => {
    expect(findRolloutPath('no-such-thread', { codexHome })).toBeUndefined();
  });
});

describe('readRolloutOccupancy', () => {
  it('reads totalTokens/modelContextWindow/pct from the LAST token_count event (E03)', () => {
    const rolloutPath = writeRollout('2026/07/12/rollout-e03.jsonl', [
      JSON.stringify({
        timestamp: '2026-07-12T06:29:48.065Z',
        type: 'event_msg',
        payload: {
          type: 'task_started',
          turn_id: '019f5504-877a-78f2-b66c-a3c4ebaed061',
          model_context_window: 353400,
        },
      }),
      JSON.stringify({
        timestamp: '2026-07-12T06:29:50.000Z',
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: {
            total_token_usage: { total_tokens: 4000 },
            model_context_window: 353400,
          },
        },
      }),
      JSON.stringify({
        timestamp: '2026-07-12T06:29:53.304Z',
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: {
            total_token_usage: { total_tokens: 8059 },
            model_context_window: 353400,
          },
        },
      }),
    ]);
    const occupancy = readRolloutOccupancy(rolloutPath);
    expect(occupancy).toEqual({
      totalTokens: 8059,
      modelContextWindow: 353400,
      pct: 8059 / 353400,
    });
  });

  it('returns null (not an error) when the rollout has no token_count event yet', () => {
    const rolloutPath = writeRollout('2026/07/12/rollout-empty.jsonl', [
      JSON.stringify({ type: 'session_meta' }),
      JSON.stringify({ type: 'event_msg', payload: { type: 'task_started', turn_id: 'abc' } }),
    ]);
    expect(readRolloutOccupancy(rolloutPath)).toBeNull();
  });

  it('tolerates malformed lines while still finding the last token_count event', () => {
    const rolloutPath = writeRollout('2026/07/12/rollout-malformed.jsonl', [
      'not json',
      JSON.stringify({
        type: 'event_msg',
        payload: { type: 'token_count', info: { total_token_usage: { total_tokens: 100 }, model_context_window: 1000 } },
      }),
    ]);
    expect(readRolloutOccupancy(rolloutPath)).toEqual({ totalTokens: 100, modelContextWindow: 1000, pct: 0.1 });
  });
});

describe('readRolloutConversation', () => {
  // response_item rows nest role/content under `payload` — live-verified
  // against a real rollout on this machine (~/.codex/sessions), e.g.:
  // {"type":"response_item","payload":{"type":"message","role":"user",
  //  "content":[{"type":"input_text","text":"..."}]}}
  it('reconstructs ordered user/assistant turns, skipping developer scaffolding (real nested shape)', () => {
    const rolloutPath = writeRollout('2026/07/12/rollout-convo.jsonl', [
      JSON.stringify({
        type: 'response_item',
        payload: { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'system scaffolding' }] },
      }),
      JSON.stringify({
        type: 'response_item',
        payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Remember ZEBRA-19.' }] },
      }),
      JSON.stringify({
        type: 'response_item',
        payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Stored ZEBRA-19.' }] },
      }),
    ]);
    const conversation = readRolloutConversation(rolloutPath);
    expect(conversation.turns).toEqual([
      { role: 'user', text: 'Remember ZEBRA-19.' },
      { role: 'assistant', text: 'Stored ZEBRA-19.' },
    ]);
  });

  it('falls back to a top-level role/content shape for robustness against drift', () => {
    const rolloutPath = writeRollout('2026/07/12/rollout-convo-flat.jsonl', [
      JSON.stringify({ type: 'response_item', role: 'user', content: [{ type: 'input_text', text: 'flat shape' }] }),
    ]);
    const conversation = readRolloutConversation(rolloutPath);
    expect(conversation.turns).toEqual([{ role: 'user', text: 'flat shape' }]);
  });

  // task_complete carries its answer as `last_agent_message`; agent_message
  // carries its answer as `message` — both live-verified, and distinct from
  // each other (not a shared `text` field).
  it('surfaces task_complete (last_agent_message) and agent_message (message) payloads as final answers', () => {
    const rolloutPath = writeRollout('2026/07/12/rollout-final.jsonl', [
      JSON.stringify({ type: 'event_msg', payload: { type: 'task_complete', turn_id: 't1', last_agent_message: 'PANTHER-7' } }),
      JSON.stringify({ type: 'event_msg', payload: { type: 'agent_message', message: 'PONG', phase: 'final_answer' } }),
    ]);
    const conversation = readRolloutConversation(rolloutPath);
    expect(conversation.finalAnswers).toEqual(['PANTHER-7', 'PONG']);
    expect(conversation.finalAnswerRecords).toEqual([
      { text: 'PANTHER-7', source: 'task_complete' },
      { text: 'PONG', source: 'agent_message', phase: 'final_answer' },
    ]);
  });

  it('omits a task_complete final answer when last_agent_message is null (finalAnswers and finalAnswerRecords both)', () => {
    const rolloutPath = writeRollout('2026/07/12/rollout-null-final.jsonl', [
      JSON.stringify({ type: 'event_msg', payload: { type: 'task_complete', turn_id: 't1', last_agent_message: null } }),
    ]);
    const conversation = readRolloutConversation(rolloutPath);
    expect(conversation.finalAnswers).toEqual([]);
    expect(conversation.finalAnswerRecords).toEqual([]);
  });

  it('finalAnswerRecords carries a commentary-phase agent_message record too (filtering is distillWarmSeed policy, not extraction policy)', () => {
    const rolloutPath = writeRollout('2026/07/12/rollout-commentary.jsonl', [
      JSON.stringify({ type: 'event_msg', payload: { type: 'agent_message', message: 'working on it', phase: 'commentary' } }),
    ]);
    const conversation = readRolloutConversation(rolloutPath);
    expect(conversation.finalAnswerRecords).toEqual([
      { text: 'working on it', source: 'agent_message', phase: 'commentary' },
    ]);
  });

  it('finalAnswerRecords omits phase when the agent_message payload does not carry one', () => {
    const rolloutPath = writeRollout('2026/07/12/rollout-nophase.jsonl', [
      JSON.stringify({ type: 'event_msg', payload: { type: 'agent_message', message: 'no phase field' } }),
    ]);
    const conversation = readRolloutConversation(rolloutPath);
    expect(conversation.finalAnswerRecords).toEqual([{ text: 'no phase field', source: 'agent_message' }]);
    expect('phase' in conversation.finalAnswerRecords[0]).toBe(false);
  });

  it('collects turn_ids from task_started/task_complete payloads', () => {
    const rolloutPath = writeRollout('2026/07/12/rollout-turnids.jsonl', [
      JSON.stringify({ type: 'event_msg', payload: { type: 'task_started', turn_id: 't1' } }),
      JSON.stringify({ type: 'event_msg', payload: { type: 'task_complete', turn_id: 't1', last_agent_message: 'done' } }),
    ]);
    const conversation = readRolloutConversation(rolloutPath);
    expect(conversation.turnIds).toEqual(['t1', 't1']);
  });

  it('returns empty arrays for a rollout with no conversation content', () => {
    const rolloutPath = writeRollout('2026/07/12/rollout-blank.jsonl', [
      JSON.stringify({ type: 'session_meta' }),
    ]);
    const conversation = readRolloutConversation(rolloutPath);
    expect(conversation).toEqual({ turns: [], finalAnswers: [], finalAnswerRecords: [], turnIds: [] });
  });
});
