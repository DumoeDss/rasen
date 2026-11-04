import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createSessionHost } from '../../../src/core/session-host/host.js';
import type { HostedSessionRecord } from '../../../src/core/session-host/contracts.js';
import {
  asProcessRef,
  type PreparedProcessScope,
  type ProcessScope,
} from '../../../src/core/session-host/process-scope.js';
import {
  createSessionHostRegistry,
  digestSessionHostText,
  type SessionHostRegistry,
} from '../../../src/core/session-host/registry.js';
import {
  startManagementServer,
  type ManagementServerHandle,
} from '../../../src/core/management-api/server.js';

const TOKEN = 'hosted-honesty-projection-token';
let handle: ManagementServerHandle | undefined;
const roots: string[] = [];

afterEach(async () => {
  await handle?.stopServer();
  handle = undefined;
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function request(port: number, path: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method: 'GET',
        path,
        agent: false,
        headers: { Authorization: `Bearer ${TOKEN}` },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({ status: res.statusCode ?? 0, body: text ? JSON.parse(text) : undefined });
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

/** Keeps a seeded scope live through reconcile so the declaration stays on the record. */
const retainingScope: ProcessScope = {
  async prepare(): Promise<PreparedProcessScope> {
    throw new Error('unused');
  },
  async inspect() {
    return { state: 'live', controllable: true };
  },
  async terminate() {
    return { state: 'retained', gracefulAttempted: true, forced: false };
  },
};

function seed(
  registry: SessionHostRegistry,
  cwd: string,
  extra: Partial<HostedSessionRecord>
): Promise<HostedSessionRecord> {
  const stamp = new Date().toISOString();
  return registry.create({
    sessionId: crypto.randomUUID(),
    backend: 'claude',
    backendSessionId: 'resume-identity',
    cwd,
    cwdDigest: digestSessionHostText(cwd),
    hostState: 'idle',
    generation: 1,
    revision: 0,
    createdAt: stamp,
    updatedAt: stamp,
    requests: [],
    ...extra,
  } as HostedSessionRecord);
}

describe('the HTTP operator surface carries the best-effort honesty fields', () => {
  it('projects the pre-start declaration and the unproven terminal onto the session wire record', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-hosted-honesty-'));
    roots.push(root);
    const cwd = fs.realpathSync.native(root);
    const registry = createSessionHostRegistry({ stateDir: path.join(root, 'state') });
    const stamp = new Date().toISOString();

    // Two records because the two fields are never simultaneously readable: the
    // declaration lives under the process facts, which release clears, and the
    // terminal is written as those facts go away.
    const declaredRunning = await seed(registry, cwd, {
      process: {
        generation: 1,
        ownerToken: 'honesty-projection-owner',
        runtimeRef: String(
          asProcessRef(
            `rasen-process-scope/1:${Buffer.from('honesty-projection-fixture').toString('base64url')}`
          )
        ),
        preparedAt: stamp,
        declaration: { tier: 'best-effort', exactCancel: false, scopeEmptyProof: false },
      },
    });
    const released = await seed(registry, cwd, {
      processTerminal: {
        outcome: 'cancelled',
        emptiness: 'unproven',
        label: 'cancelled / emptiness-unproven',
        groupObservedEmpty: true,
        forced: true,
        recordedAt: stamp,
      },
    });

    const host = createSessionHost({ registry, processScope: retainingScope, backends: [] });
    handle = await startManagementServer({
      context: {
        token: TOKEN,
        launchProjectRoot: null,
        launchProjectRef: null,
        version: 'test',
        uiAssetsDir: null,
      },
      sessions: { sessionHostOverride: host },
    });

    const listed = await request(handle.port, '/api/v1/sessions');
    expect(listed.status).toBe(200);
    const byId = new Map<string, any>(
      listed.body.sessions.map((entry: any) => [entry.session.id, entry.session])
    );

    // An operator reading the remote surface sees the limits the scope declared
    // before the workload started ...
    expect(byId.get(declaredRunning.sessionId)?.processDeclaration).toEqual({
      tier: 'best-effort',
      exactCancel: false,
      scopeEmptyProof: false,
    });
    // ... and the honest terminal, never a clean-cancel claim.
    expect(byId.get(released.sessionId)?.processTerminal).toMatchObject({
      outcome: 'cancelled',
      emptiness: 'unproven',
      label: 'cancelled / emptiness-unproven',
    });

    const detail = await request(handle.port, `/api/v1/sessions/${released.sessionId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.session.processTerminal?.label).toBe('cancelled / emptiness-unproven');
  }, 30_000);
});
