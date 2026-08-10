import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  bindCodexThreadCwd,
  bindCodexThreadState,
  claimCodexThreadWriter,
  getCodexThreadSandbox,
  isCodexThreadWriterClaimed,
  CodexThreadBusyError,
} from '../../../src/core/codex/index.js';

let root: string;
let cwd: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-codex-thread-state-'));
  cwd = path.join(root, 'cwd');
  fs.mkdirSync(cwd, { recursive: true });
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('durable Codex thread writer ownership', () => {
  it('rejects duplicate claims and allows idempotent release/reclaim', async () => {
    const threadId = randomUUID();
    const claim = await claimCodexThreadWriter(threadId, cwd, { stateDir: root });
    await expect(claimCodexThreadWriter(threadId, cwd, { stateDir: root }))
      .rejects.toBeInstanceOf(CodexThreadBusyError);
    expect(await isCodexThreadWriterClaimed(threadId, { stateDir: root })).toBe(true);
    await claim.release();
    await claim.release();
    const reclaimed = await claimCodexThreadWriter(threadId, cwd, { stateDir: root });
    await reclaimed.release();
  });

  it('allows independent thread ids concurrently', async () => {
    const first = await claimCodexThreadWriter(`a-${randomUUID()}`, cwd, { stateDir: root });
    const second = await claimCodexThreadWriter(`b-${randomUUID()}`, cwd, { stateDir: root });
    await Promise.all([first.release(), second.release()]);
  });

  it('persists and retrieves the creation-time sandbox for fresh threads', async () => {
    const threadId = randomUUID();
    await bindCodexThreadState(threadId, cwd, 'read-only', { stateDir: root });

    expect(await getCodexThreadSandbox(threadId, { stateDir: root })).toBe('read-only');
    const claim = await claimCodexThreadWriter(threadId, cwd, { stateDir: root });
    expect(claim.sandbox).toBe('read-only');
    await claim.release();
  });

  it('keeps sandbox unknown for backwards-compatible legacy cwd-only records', async () => {
    const threadId = randomUUID();
    await bindCodexThreadCwd(threadId, cwd, { stateDir: root });

    expect(await getCodexThreadSandbox(threadId, { stateDir: root })).toBeUndefined();
    const claim = await claimCodexThreadWriter(threadId, cwd, { stateDir: root });
    expect(claim.sandbox).toBeUndefined();
    await claim.release();
  });
});
