import { describe, expect, it } from 'vitest';
import {
  backoffDelayMs,
  claimThreadWriter,
  classifyTurnFailure,
  detectDeathInRows,
  detectThreadDeath,
  distillWarmSeed,
  isThreadWriterClaimed,
} from '../../../src/core/codex/lifecycle.js';
import type { TurnFailedEvent } from '../../../src/core/codex/exec-events.js';
import type { RolloutConversation } from '../../../src/core/codex/rollout.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// Fixture below is trimmed from a REAL rollout tail captured on this machine
// by killing a throwaway `codex exec` process mid-turn (thread
// 019f5786-0da4-7021-b634-87e1aba13592, codex-cli 0.144.1): the process was
// sent SIGKILL ~6s into a turn that had started a `sleep 30` tool call. The
// resulting rollout has a `task_started` event_msg row with no matching
// `task_complete`/`turn_aborted` afterward — exactly the death signal this
// module detects. Irrelevant scaffolding rows (session_meta, world_state,
// turn_context, the multi-agent system prompt) are omitted for readability;
// the turn-boundary-relevant rows are byte-faithful to the real capture.
const KILLED_MID_TURN_ROWS = [
  {
    timestamp: '2026-07-12T18:10:31.163Z',
    type: 'event_msg',
    payload: {
      type: 'task_started',
      turn_id: '019f5786-0e4f-7a20-aca3-94d7d883957c',
      started_at: 1783879831,
      model_context_window: 353400,
      collaboration_mode_kind: 'default',
    },
  },
  {
    timestamp: '2026-07-12T18:10:31.196Z',
    type: 'response_item',
    payload: {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: 'Remember the secret codeword LIFECYCLE-KILL-42. Then run: sleep 30. Then tell me the codeword back.' }],
    },
  },
  {
    timestamp: '2026-07-12T18:10:34.547Z',
    type: 'event_msg',
    payload: { type: 'agent_message', message: 'I’ll wait for the command to finish, then return the codeword.', phase: 'commentary' },
  },
  {
    timestamp: '2026-07-12T18:10:36.272Z',
    type: 'response_item',
    payload: { type: 'custom_tool_call', id: 'ctc_082ace003448cf92016a53d89a7b008196a216c2b533439152', status: 'completed', call_id: 'call_iv9OPm3wQ3tPQQ0JHFyXKz1t', name: 'exec' },
  },
  // <-- process was SIGKILLed here; no task_complete/turn_aborted follows.
];

// Cleanly-completed fixture: task_started paired with task_complete on the
// same turn_id (real shape from E01/E03: docs/codex-parity/experiments).
const CLEANLY_COMPLETED_ROWS = [
  {
    timestamp: '2026-07-12T06:29:48.065Z',
    type: 'event_msg',
    payload: {
      type: 'task_started',
      turn_id: '019f5504-877a-78f2-b66c-a3c4ebaed061',
      model_context_window: 353400,
    },
  },
  {
    timestamp: '2026-07-12T06:29:53.312Z',
    type: 'event_msg',
    payload: {
      type: 'task_complete',
      turn_id: '019f5504-877a-78f2-b66c-a3c4ebaed061',
      last_agent_message: 'PONG',
    },
  },
];

describe('detectDeathInRows', () => {
  it('reports dead-in-flight for the real killed-mid-turn rollout tail', () => {
    const result = detectDeathInRows(KILLED_MID_TURN_ROWS);
    expect(result.dead).toBe(true);
    expect(result.lastOpenedAt).toBe('2026-07-12T18:10:31.163Z');
  });

  it('reports not dead for a cleanly-completed thread', () => {
    const result = detectDeathInRows(CLEANLY_COMPLETED_ROWS);
    expect(result).toEqual({ dead: false });
  });

  it('reports not dead for a rollout with no turn-opening event (idle, not dead)', () => {
    const result = detectDeathInRows([
      { type: 'session_meta', payload: {} },
      { type: 'event_msg', payload: { type: 'token_count', info: {} } },
    ]);
    expect(result).toEqual({ dead: false });
  });

  it('reports not dead when a turn_aborted closer follows the opener', () => {
    const result = detectDeathInRows([
      { type: 'event_msg', payload: { type: 'task_started', turn_id: 't1' } },
      { type: 'event_msg', payload: { type: 'turn_aborted', turn_id: 't1', reason: 'interrupted' } },
    ]);
    expect(result).toEqual({ dead: false });
  });

  it('tracks only the LAST turn: an earlier closed turn does not mask a later unmatched opener', () => {
    const result = detectDeathInRows([
      { type: 'event_msg', payload: { type: 'task_started', turn_id: 't1' } },
      { type: 'event_msg', payload: { type: 'task_complete', turn_id: 't1', last_agent_message: 'ok' } },
      { timestamp: 'later', type: 'event_msg', payload: { type: 'task_started', turn_id: 't2' } },
    ]);
    expect(result).toEqual({ dead: true, lastOpenedAt: 'later' });
  });

  it('also matches the dotted turn.* vocabulary defensively (top-level or nested)', () => {
    const result = detectDeathInRows([{ type: 'turn.started' }]);
    expect(result.dead).toBe(true);
  });

  it('tolerates a typeless row mixed in (a row with no `type`/`payload.type` match contributes no opener or closer)', () => {
    const rows = [
      { type: 'event_msg', payload: { type: 'task_started', turn_id: 't1' } },
      { notAnEvent: true },
      { type: 'event_msg', payload: { type: 'task_complete', turn_id: 't1', last_agent_message: 'ok' } },
    ];
    expect(detectDeathInRows(rows)).toEqual({ dead: false });
  });
});

describe('detectThreadDeath', () => {
  it('reads a rollout file from disk and detects death, skipping malformed lines', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-codex-lifecycle-'));
    const rolloutPath = path.join(dir, 'rollout.jsonl');
    const lines = [
      'not json',
      ...KILLED_MID_TURN_ROWS.map((r) => JSON.stringify(r)),
      '',
      '   ',
    ];
    fs.writeFileSync(rolloutPath, `${lines.join('\n')}\n`, 'utf-8');
    const result = detectThreadDeath(rolloutPath);
    expect(result.dead).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reads a cleanly-completed rollout file and reports not dead', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-codex-lifecycle-'));
    const rolloutPath = path.join(dir, 'rollout.jsonl');
    fs.writeFileSync(rolloutPath, `${CLEANLY_COMPLETED_ROWS.map((r) => JSON.stringify(r)).join('\n')}\n`, 'utf-8');
    expect(detectThreadDeath(rolloutPath)).toEqual({ dead: false });
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

// E02's captured 429 message (docs/codex-parity/experiments/E02-resume-warm-continuation.md:62).
const E02_429_MESSAGE = 'exceeded retry limit, last status: 429 Too Many Requests, ...';
// E05's captured 404 message (docs/codex-parity/experiments/E05-model-effort-overrides.md:37-38).
const E05_404_MESSAGE =
  'unexpected status 404 Not Found: model totally-not-a-real-model-xyz is not available for /codex prefix, url: https://code.newcli.com/codex/v1/responses, ...';

describe('classifyTurnFailure', () => {
  it("classifies E02's 429 message as retryable", () => {
    const result = classifyTurnFailure(E02_429_MESSAGE);
    expect(result.kind).toBe('retryable');
    expect(result.reason).toContain('429');
  });

  it("classifies E05's 404 model-not-available message as fatal", () => {
    const result = classifyTurnFailure(E05_404_MESSAGE);
    expect(result.kind).toBe('fatal');
    expect(result.reason).toMatch(/404|not available/);
  });

  it('classifies an unrelated message as unknown', () => {
    const result = classifyTurnFailure('connection reset by peer');
    expect(result.kind).toBe('unknown');
    expect(result.reason).toContain('connection reset by peer');
  });

  it('accepts a bare string', () => {
    expect(classifyTurnFailure('429 rate limited').kind).toBe('retryable');
  });

  it('accepts a TurnFailedEvent', () => {
    const event: TurnFailedEvent = { type: 'turn.failed', error: { message: E02_429_MESSAGE } };
    expect(classifyTurnFailure(event).kind).toBe('retryable');
  });

  it('classifies a TurnFailedEvent with no error message as unknown', () => {
    const event: TurnFailedEvent = { type: 'turn.failed' };
    const result = classifyTurnFailure(event);
    expect(result.kind).toBe('unknown');
    expect(result.reason).toMatch(/no error message/);
  });

  it('matches case-insensitively', () => {
    expect(classifyTurnFailure('TOO MANY REQUESTS').kind).toBe('retryable');
    expect(classifyTurnFailure('Rate Limit exceeded').kind).toBe('retryable');
  });
});

describe('backoffDelayMs', () => {
  it('produces the 20s/40s/80s/120s/120s sequence for attempts 1-5', () => {
    const sequence = [1, 2, 3, 4, 5].map((attempt) => backoffDelayMs(attempt));
    expect(sequence).toEqual([20_000, 40_000, 80_000, 120_000, 120_000]);
  });

  it('respects a custom baseMs/maxMs', () => {
    expect(backoffDelayMs(1, { baseMs: 1000, maxMs: 5000 })).toBe(1000);
    expect(backoffDelayMs(2, { baseMs: 1000, maxMs: 5000 })).toBe(2000);
    expect(backoffDelayMs(3, { baseMs: 1000, maxMs: 5000 })).toBe(4000);
    expect(backoffDelayMs(4, { baseMs: 1000, maxMs: 5000 })).toBe(5000); // capped
  });

  it('is deterministic: repeated calls for the same attempt return the same value', () => {
    expect(backoffDelayMs(3)).toBe(backoffDelayMs(3));
  });
});

describe('claimThreadWriter / isThreadWriterClaimed', () => {
  it('a double-claim throws with the thread id in the message', () => {
    const threadId = `claim-test-${Math.random()}`;
    const release = claimThreadWriter(threadId);
    expect(isThreadWriterClaimed(threadId)).toBe(true);
    expect(() => claimThreadWriter(threadId)).toThrow(threadId);
    release();
  });

  it('release then re-claim succeeds', () => {
    const threadId = `claim-test-${Math.random()}`;
    const release = claimThreadWriter(threadId);
    release();
    expect(isThreadWriterClaimed(threadId)).toBe(false);
    const release2 = claimThreadWriter(threadId);
    expect(isThreadWriterClaimed(threadId)).toBe(true);
    release2();
  });

  it('release is idempotent (calling it twice does not throw or double-free)', () => {
    const threadId = `claim-test-${Math.random()}`;
    const release = claimThreadWriter(threadId);
    release();
    expect(() => release()).not.toThrow();
    expect(isThreadWriterClaimed(threadId)).toBe(false);
  });

  it('independent thread ids do not interfere with each other', () => {
    const idA = `claim-test-a-${Math.random()}`;
    const idB = `claim-test-b-${Math.random()}`;
    const releaseA = claimThreadWriter(idA);
    const releaseB = claimThreadWriter(idB);
    expect(isThreadWriterClaimed(idA)).toBe(true);
    expect(isThreadWriterClaimed(idB)).toBe(true);
    releaseA();
    expect(isThreadWriterClaimed(idA)).toBe(false);
    expect(isThreadWriterClaimed(idB)).toBe(true);
    releaseB();
  });

  it('isThreadWriterClaimed is false for a thread id that was never claimed', () => {
    expect(isThreadWriterClaimed(`never-claimed-${Math.random()}`)).toBe(false);
  });
});

describe('distillWarmSeed', () => {
  it('keeps turns unchanged', () => {
    const conversation: RolloutConversation = {
      turns: [
        { role: 'user', text: 'Remember ZEBRA-19.' },
        { role: 'assistant', text: 'Stored ZEBRA-19.' },
      ],
      finalAnswers: [],
      finalAnswerRecords: [],
      turnIds: [],
    };
    expect(distillWarmSeed(conversation).turns).toEqual(conversation.turns);
  });

  it('drops commentary-phase agent_message records', () => {
    const conversation: RolloutConversation = {
      turns: [],
      finalAnswers: [],
      finalAnswerRecords: [
        { text: 'working on it', source: 'agent_message', phase: 'commentary' },
        { text: 'ZEBRA-19', source: 'agent_message', phase: 'final_answer' },
      ],
      turnIds: [],
    };
    const distilled = distillWarmSeed(conversation);
    expect(distilled.finalAnswers).toEqual([{ text: 'ZEBRA-19', source: 'agent_message', phase: 'final_answer' }]);
  });

  it('dedupes the duplicated terminal answer (agent_message final_answer + task_complete) to one occurrence', () => {
    const conversation: RolloutConversation = {
      turns: [],
      finalAnswers: [],
      finalAnswerRecords: [
        { text: 'PANTHER-7', source: 'agent_message', phase: 'final_answer' },
        { text: 'PANTHER-7', source: 'task_complete' },
      ],
      turnIds: [],
    };
    const distilled = distillWarmSeed(conversation);
    expect(distilled.finalAnswers).toHaveLength(1);
    expect(distilled.finalAnswers[0].text).toBe('PANTHER-7');
  });

  it('keeps records without phase metadata (missing metadata degrades to keep, not loss)', () => {
    const conversation: RolloutConversation = {
      turns: [],
      finalAnswers: [],
      finalAnswerRecords: [{ text: 'no phase here', source: 'agent_message' }],
      turnIds: [],
    };
    const distilled = distillWarmSeed(conversation);
    expect(distilled.finalAnswers).toEqual([{ text: 'no phase here', source: 'agent_message' }]);
  });

  it('keeps task_complete records (which never carry phase) unconditionally, aside from dedup', () => {
    const conversation: RolloutConversation = {
      turns: [],
      finalAnswers: [],
      finalAnswerRecords: [{ text: 'PONG', source: 'task_complete' }],
      turnIds: [],
    };
    expect(distillWarmSeed(conversation).finalAnswers).toEqual([{ text: 'PONG', source: 'task_complete' }]);
  });

  it('does not mutate the input conversation', () => {
    const conversation: RolloutConversation = {
      turns: [],
      finalAnswers: ['x'],
      finalAnswerRecords: [{ text: 'x', source: 'task_complete' }],
      turnIds: [],
    };
    const snapshot = JSON.parse(JSON.stringify(conversation));
    distillWarmSeed(conversation);
    expect(conversation).toEqual(snapshot);
  });

  // M2: a whitelist on phase === 'final_answer' would silently drop a record
  // whose phase drifted to an unrecognized value — contradicting design D6's
  // own risk mitigation ("missing/UNKNOWN phase degrades to keep, not loss").
  // Only 'commentary' is a blacklisted drop; anything else (including a
  // never-before-seen phase string) must survive.
  it('keeps an agent_message record whose phase is present but unrecognized (M2: blacklist, not whitelist)', () => {
    const conversation: RolloutConversation = {
      turns: [],
      finalAnswers: [],
      finalAnswerRecords: [{ text: 'DRIFTED-PHASE-ANSWER', source: 'agent_message', phase: 'summary' }],
      turnIds: [],
    };
    const distilled = distillWarmSeed(conversation);
    expect(distilled.finalAnswers).toEqual([
      { text: 'DRIFTED-PHASE-ANSWER', source: 'agent_message', phase: 'summary' },
    ]);
  });

  it('still drops phase === "commentary" specifically (blacklist entry unchanged)', () => {
    const conversation: RolloutConversation = {
      turns: [],
      finalAnswers: [],
      finalAnswerRecords: [{ text: 'progress update', source: 'agent_message', phase: 'commentary' }],
      turnIds: [],
    };
    expect(distillWarmSeed(conversation).finalAnswers).toEqual([]);
  });

  // M3: dedup must apply only across the agent_message/task_complete source
  // pair, not to independent repeats within one source across different turns.
  it('does NOT dedupe two agent_message records with identical text from different turns (M3: cross-source only)', () => {
    const conversation: RolloutConversation = {
      turns: [],
      finalAnswers: [],
      finalAnswerRecords: [
        { text: 'DONE', source: 'agent_message', phase: 'final_answer' },
        { text: 'DONE', source: 'agent_message', phase: 'final_answer' },
      ],
      turnIds: [],
    };
    const distilled = distillWarmSeed(conversation);
    expect(distilled.finalAnswers).toHaveLength(2);
  });

  it('does NOT dedupe two task_complete records with identical text from different turns (M3: cross-source only)', () => {
    const conversation: RolloutConversation = {
      turns: [],
      finalAnswers: [],
      finalAnswerRecords: [
        { text: 'DONE', source: 'task_complete' },
        { text: 'DONE', source: 'task_complete' },
      ],
      turnIds: [],
    };
    const distilled = distillWarmSeed(conversation);
    expect(distilled.finalAnswers).toHaveLength(2);
  });

  it('still dedupes the cross-source pair even with an unrelated same-source repeat present (M3 + n1 combined)', () => {
    const conversation: RolloutConversation = {
      turns: [],
      finalAnswers: [],
      finalAnswerRecords: [
        { text: 'PANTHER-7', source: 'agent_message', phase: 'final_answer' },
        { text: 'PANTHER-7', source: 'task_complete' }, // cross-source dup of the record above — dropped
        { text: 'PANTHER-7', source: 'agent_message', phase: 'final_answer' }, // same-source repeat — kept
      ],
      turnIds: [],
    };
    const distilled = distillWarmSeed(conversation);
    expect(distilled.finalAnswers).toHaveLength(2);
    expect(distilled.finalAnswers.every((r) => r.text === 'PANTHER-7')).toBe(true);
    expect(distilled.finalAnswers.filter((r) => r.source === 'task_complete')).toHaveLength(0);
    expect(distilled.finalAnswers.filter((r) => r.source === 'agent_message')).toHaveLength(2);
  });
});
