import fs from 'node:fs';
import { createHash as nodeCreateHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createSessionHostRegistry } from '../../../src/core/session-host/registry.js';

const roots: string[] = [];

function legacyDocument(processFacts?: Record<string, unknown>, hostState = 'idle') {
  const now = new Date().toISOString();
  const cwd = fs.realpathSync.native(process.cwd());
  const session = {
    sessionId: '11111111-1111-4111-8111-111111111111',
    backend: 'claude',
    cwd,
    cwdDigest: createHash(cwd),
    hostState,
    generation: 1,
    revision: 1,
    createdAt: now,
    updatedAt: now,
    requests: [],
    ...(processFacts ? { process: processFacts } : {}),
  };
  const payload = {
    schema: 'rasen-session-host-registry/1',
    generation: 1,
    sessions: { [session.sessionId]: session },
  };
  return { ...payload, digest: createHash(JSON.stringify(payload)) };
}

function createHash(value: string): string {
  return nodeCreateHash('sha256').update(value).digest('hex');
}

function registryFrom(document: unknown) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-process-capsule-migration-'));
  roots.push(root);
  const directory = path.join(root, 'session-host');
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, 'registry.json');
  fs.writeFileSync(file, `${JSON.stringify(document)}\n`);
  return { file, registry: createSessionHostRegistry({ stateDir: root }) };
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('registry v1 to opaque ProcessRef migration', () => {
  it('never upgrades live v1 PID facts into a strong v2 runtimeRef', async () => {
    const original = legacyDocument({
      generation: 1,
      ownerToken: 'legacy-owner',
      rootPid: process.pid,
      processInstanceId: 'sampled-fact',
      startedAt: new Date().toISOString(),
    });
    const { file, registry } = registryFrom(original);
    const before = fs.readFileSync(file);

    await expect(registry.load()).rejects.toMatchObject({ code: 'registry-corrupt' });
    expect(fs.readFileSync(file)).toEqual(before);
    expect(fs.readFileSync(file, 'utf8')).not.toContain('runtimeRef');
  });

  it('migrates an owner-free v1 record only when the next mutation publishes v2', async () => {
    const { file, registry } = registryFrom(legacyDocument());
    await registry.load();
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).schema).toBe('rasen-session-host-registry/1');

    await registry.update('11111111-1111-4111-8111-111111111111', 1, (record) => {
      record.recoveryReason = 'safe-v1-migration';
      return record;
    });
    const next = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(next.schema).toBe('rasen-session-host-registry/2');
    expect(JSON.stringify(next)).not.toContain('rootPid');
  });

  it('preserves unknown v2 bytes when opened by a v1-only rollback parser', async () => {
    const unknown = Buffer.from('{"schema":"rasen-session-host-registry/2","future":true}\n');
    const { file } = registryFrom({ schema: 'placeholder' });
    fs.writeFileSync(file, unknown);
    const registry = createSessionHostRegistry({
      stateDir: path.dirname(path.dirname(file)),
      acceptedSchema: 'rasen-session-host-registry/1',
    });

    await expect(registry.load()).rejects.toMatchObject({ code: 'registry-corrupt' });
    expect(fs.readFileSync(file)).toEqual(unknown);
  });
});
