import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createSessionHostOwnership } from '../../../src/core/session-host/ownership.js';
import { getClaudeSessionStatePaths } from '../../../src/core/claude/session-state.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('host writer ownership adapter', () => {
  it('claims only the single-writer token and publishes no process authority', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-host-ownership-'));
    roots.push(root);
    const cwd = path.join(root, 'checkout');
    fs.mkdirSync(cwd);
    const ownership = createSessionHostOwnership({ stateDir: path.join(root, 'owners') });
    const sessionId = crypto.randomUUID();

    const first = await ownership.claim(sessionId, cwd);
    expect(first.ownerToken).toMatch(/^[0-9a-f]{32}$/);
    expect(Object.keys(first).sort()).toEqual(['ownerToken', 'release']);
    await expect(ownership.isClaimed(sessionId)).resolves.toBe(true);

    await first.release();
    await expect(ownership.isClaimed(sessionId)).resolves.toBe(false);
    const successor = await ownership.claim(sessionId, cwd);
    expect(successor.ownerToken).not.toBe(first.ownerToken);
    await successor.release();
  });

  it('reclaims an exact dead pre-spawn writer without inventing PID authority', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-host-pre-spawn-'));
    roots.push(root);
    const stateDir = path.join(root, 'owners');
    const sessionId = crypto.randomUUID();
    const ownerToken = 'abcdef0123456789abcdef0123456789';
    const { writerPath } = getClaudeSessionStatePaths(sessionId, { stateDir });
    fs.mkdirSync(path.dirname(writerPath), { recursive: true });
    fs.writeFileSync(writerPath, `${JSON.stringify({
      version: 3,
      bridgePid: 999999,
      bridgeProcessInstanceId: 'dead-bridge-instance',
      nonce: ownerToken,
      createdAt: '2026-08-04T00:00:00.000Z',
      admission: 'supervised',
    })}\n`);
    const ownership = createSessionHostOwnership({ stateDir });

    await expect(ownership.reapStaleOwner(sessionId, { ownerToken: 'wrong-token' }))
      .resolves.toBe('live-or-uncertain');
    expect(fs.existsSync(writerPath)).toBe(true);
    await expect(ownership.reapStaleOwner(sessionId, { ownerToken })).resolves.toBe('reaped');
    expect(fs.existsSync(writerPath)).toBe(false);
  });

  it('contains no worker PID bind or signalling callback surface', () => {
    const source = fs.readFileSync('src/core/session-host/ownership.ts', 'utf8');
    expect(source).not.toMatch(/bindWorker|rootPid|terminateTree|killProcessTree/);
  });
});
