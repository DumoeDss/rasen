import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type {
  AgentSessionBackend,
  AgentSessionTransport,
  BackendTurn,
} from '../../../src/core/session-host/backend.js';
import {
  sanitizeHostDiagnostic,
  validateSessionHostCommand,
} from '../../../src/core/session-host/contracts.js';
import { createSessionHost } from '../../../src/core/session-host/host.js';
import { createSessionHostRegistry } from '../../../src/core/session-host/registry.js';
import { asProcessRef } from '../../../src/core/session-host/process-scope.js';
import { hostedSessionToWire } from '../../../src/core/management-api/hosted-sessions.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('durable Session host security boundary', () => {
  it('rejects credential/authority/executable fields on every public command shape', () => {
    const execute = {
      op: 'execute',
      requestId: randomUUID(),
      backend: 'claude',
      cwd: process.cwd(),
      input: 'safe input',
      limits: { timeoutMs: 1000, maxInputBytes: 4096, maxOutputBytes: 4096 },
    };
    for (const [field, value] of [
      ['binary', 'C:\\attacker\\agent.exe'],
      ['argv', ['--dangerously-skip-permissions']],
      ['env', { AUTHORIZATION: 'Bearer secret' }],
      ['privateKey', '-----BEGIN PRIVATE KEY-----'],
      ['producerCredential', 'credential-secret'],
      ['Action', { kind: 'execute' }],
      ['Run', { state: 'completed' }],
      ['trustedCompletion', true],
    ] as const) {
      expect(validateSessionHostCommand({ ...execute, [field]: value }), field).toMatchObject({
        ok: false,
        code: 'invalid-input',
      });
    }
    for (const command of [
      { op: 'cancel', sessionId: randomUUID(), reason: 'stop', token: 'secret' },
      { op: 'restart', sessionId: randomUUID(), privateKey: 'secret' },
      { op: 'retire', sessionId: randomUUID(), reason: 'done', argv: ['evil'] },
    ]) {
      expect(validateSessionHostCommand(command)).toMatchObject({ ok: false, code: 'invalid-input' });
    }
  });

  it('keeps prompt/secret material out of registry, projections, and diagnostics', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-host-security-'));
    roots.push(root);
    const cwd = path.join(root, 'checkout');
    fs.mkdirSync(cwd);
    const registry = createSessionHostRegistry({ stateDir: path.join(root, 'state') });
    const backend: AgentSessionBackend = {
      id: 'replay',
      async prepare() {
        const runtimeRef = asProcessRef('rasen-process-scope/1:c2VjdXJpdHktdGVzdC1yZWY');
        const transport: AgentSessionTransport = {
          runtimeRef,
          displayPid: 7777,
          closed: new Promise<void>(() => undefined),
          send(_turn: BackendTurn) {
            const events = (async function* () {
              yield { type: 'init', sessionId: 'backend-security-1' };
              yield { type: 'result', sessionId: 'backend-security-1', content: 'bounded-safe-result' };
            })();
            return Object.assign(events, { accepted: Promise.resolve() });
          },
          async terminate() {
            return { closed: true, cancelledBeforeWork: false };
          },
        };
        return {
          runtimeRef,
          displayPid: transport.displayPid,
          async activate() { return transport; },
          async abort() {
            return { state: 'closed' as const, gracefulAttempted: false, forced: true };
          },
        };
      },
    };
    const host = createSessionHost({ registry, backends: [backend] });
    await host.reconcileOnStart();
    const sensitiveInput = [
      'PROMPT-SENTINEL-9e7d',
      'authorization=Bearer-credential-sentinel',
      'privateKey=-----BEGIN_PRIVATE_KEY-----',
      'password=hunter-sentinel',
    ].join('\n');
    const result = await host.dispatch({
      op: 'execute',
      requestId: randomUUID(),
      backend: 'replay',
      cwd,
      input: sensitiveInput,
      limits: { timeoutMs: 1000, maxInputBytes: 4096, maxOutputBytes: 4096 },
    });
    expect(result).toMatchObject({ ok: true, result: 'bounded-safe-result' });
    if (!result.ok) throw new Error('expected success');

    const durableBytes = fs.readFileSync(registry.paths.registryPath, 'utf8');
    const projections = JSON.stringify({
      inspect: host.inspect(result.session.sessionId),
      list: host.list(),
      legacy: hostedSessionToWire(result.session),
    });
    for (const sentinel of [
      'PROMPT-SENTINEL-9e7d',
      'Bearer-credential-sentinel',
      'BEGIN_PRIVATE_KEY',
      'hunter-sentinel',
    ]) {
      expect(durableBytes, sentinel).not.toContain(sentinel);
      expect(projections, sentinel).not.toContain(sentinel);
    }
    expect(durableBytes).not.toMatch(/Action|EvidenceStore|trustedCompletion|canonicalRun/);

    const diagnostic = sanitizeHostDiagnostic(
      'token=abc secret:xyz password=hunter authorization=Bearer private-key=material',
      256
    );
    expect(diagnostic).toBe(
      'token=[REDACTED] secret=[REDACTED] password=[REDACTED] authorization=[REDACTED] private-key=[REDACTED]'
    );
  });

  it('has no forbidden authority import or signing-key custody in the host product surface', () => {
    const files = [
      ...fs.readdirSync('src/core/session-host').map((name) => path.join('src/core/session-host', name)),
      'src/core/management-api/hosted-sessions.ts',
      'src/commands/session.ts',
    ].filter((file) => file.endsWith('.ts'));
    const source = files.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
    expect(source).not.toMatch(/from\s+['"][^'"]*change-run/);
    expect(source).not.toMatch(/EvidenceStore|trustedCompletion|completionAttestation|signingPrivateKey/);
    expect(source).not.toMatch(/privateKey\s*[?:]/);
  });
});
