import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { stringify as stringifyYaml } from 'yaml';

import { MODEL_PRESETS } from '../../../src/core/model-presets.js';
import {
  DEFAULT_HANDOFF_CONFIG,
  DEFAULT_REUSE_CONFIG,
} from '../../../src/core/pipeline-registry/index.js';
import { PROBE_RUNTIMES } from '../../../src/core/runtime-adapters.js';
import type { ManagementApiContext } from '../../../src/core/management-api/router.js';
import {
  startManagementServer,
  type ManagementServerHandle,
} from '../../../src/core/management-api/server.js';
import { setThresholdSchemeCleanupOpsForTesting } from '../../../src/core/threshold-scheme-lock-internal.js';
import type {
  ThresholdSchemeCatalogResponse,
  ThresholdSchemeMutationResponse,
} from '../../../src/core/management-api/wire-types.js';

const TOKEN = 'test-token-threshold-schemes';

interface HttpResult {
  status: number;
  body: string;
  json: () => unknown;
}

function request(
  port: number,
  options: {
    method: string;
    path?: string;
    headers?: Record<string, string>;
    body?: string;
  }
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method: options.method,
        path: options.path ?? '/api/v1/threshold-schemes',
        headers: options.headers,
        agent: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          resolve({
            status: res.statusCode ?? 0,
            body,
            json: () => JSON.parse(body) as unknown,
          });
        });
      }
    );
    req.on('error', reject);
    if (options.body !== undefined) req.write(options.body);
    req.end();
  });
}

function runCompetingFilesystemMutation(
  operation: 'create' | 'delete',
  targetPath: string,
  lockPath: string,
  content = ''
): Promise<void> {
  const script = [
    "const fs = require('node:fs');",
    "const [operation, targetPath, lockPath, encoded] = process.argv.slice(1);",
    'setTimeout(() => {',
    '  try {',
    "    if (operation === 'create') {",
    "      fs.writeFileSync(targetPath, Buffer.from(encoded, 'base64'), { flag: 'wx', mode: 0o600 });",
    '    } else {',
    '      fs.rmSync(targetPath);',
    '    }',
    '  } finally {',
    '    fs.rmSync(lockPath, { force: true });',
    '  }',
    '}, 75);',
  ].join('\n');
  const child = spawn(
    process.execPath,
    [
      '-e',
      script,
      operation,
      targetPath,
      lockPath,
      Buffer.from(content).toString('base64'),
    ],
    { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true }
  );

  return new Promise((resolve, reject) => {
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Competing mutation exited ${code}: ${stderr}`));
    });
  });
}

describe('management-api threshold scheme catalog and mutations', () => {
  let configHome: string;
  let projectRoot: string;
  let schemesDir: string;
  let originalEnv: NodeJS.ProcessEnv;
  let handle: ManagementServerHandle | undefined;

  function authed(extra: Record<string, string> = {}): Record<string, string> {
    return { Authorization: `Bearer ${TOKEN}`, ...extra };
  }

  async function startServer(): Promise<ManagementServerHandle> {
    const context: ManagementApiContext = {
      token: TOKEN,
      launchProjectRoot: projectRoot,
      launchProjectRef: {
        projectId: 'threshold-project',
        name: 'threshold-project',
        root: projectRoot,
      },
      version: '0.0.0-test',
      uiAssetsDir: null,
    };
    handle = await startManagementServer({ context });
    return handle;
  }

  async function mutate(body: unknown): Promise<HttpResult> {
    const server = handle ?? (await startServer());
    return request(server.port, {
      method: 'POST',
      headers: authed({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    });
  }

  beforeEach(() => {
    configHome = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-threshold-api-home-'));
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-threshold-api-project-'));
    fs.mkdirSync(path.join(projectRoot, 'rasen'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'rasen', 'config.yaml'), 'schema: spec-driven\n');
    schemesDir = path.join(configHome, 'rasen', 'schemes');

    originalEnv = { ...process.env };
    delete process.env.RASEN_HOME;
    process.env.XDG_CONFIG_HOME = configHome;
    process.env.XDG_DATA_HOME = configHome;
    delete process.env.RASEN_LANG;
  });

  afterEach(async () => {
    await handle?.stopServer();
    handle = undefined;
    process.env = originalEnv;
    fs.rmSync(configHome, { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('returns an empty catalog with complete registry-derived presets and probe rows', async () => {
    const server = await startServer();
    const response = await request(server.port, {
      method: 'GET',
      headers: authed(),
    });

    expect(response.status).toBe(200);
    const catalog = response.json() as ThresholdSchemeCatalogResponse;
    expect(catalog.schemes).toEqual([]);
    expect(catalog.bindingRows).toEqual([...PROBE_RUNTIMES, 'default']);
    expect(catalog.bindingRows).not.toContain('zed');
    expect(catalog.presets).toHaveLength(MODEL_PRESETS.length);

    for (const [index, preset] of MODEL_PRESETS.entries()) {
      const wire = catalog.presets[index]!;
      expect(wire).toMatchObject({
        id: preset.match[0],
        match: preset.match,
        contextWindow: preset.contextWindow,
        seed: {
          handoff: preset.handoffThreshold ?? DEFAULT_HANDOFF_CONFIG.threshold,
          reuse: preset.reuseThreshold ?? DEFAULT_REUSE_CONFIG.threshold,
        },
        sources: {
          handoff: preset.handoffThreshold === undefined ? 'default' : 'preset',
          reuse: preset.reuseThreshold === undefined ? 'default' : 'preset',
        },
      });
    }
  });

  it('returns valid and malformed scheme entries in deterministic name order', async () => {
    fs.mkdirSync(schemesDir, { recursive: true });
    fs.writeFileSync(
      path.join(schemesDir, 'z-valid.yaml'),
      'handoff: 0.5\nreuse:\n  remainingTokens: 180000\n'
    );
    fs.writeFileSync(path.join(schemesDir, 'a-broken.yaml'), 'handoff: [\n');

    const server = await startServer();
    const response = await request(server.port, {
      method: 'GET',
      headers: authed(),
    });
    const catalog = response.json() as ThresholdSchemeCatalogResponse;

    expect(response.status).toBe(200);
    expect(catalog.schemes.map((entry) => entry.name)).toEqual([
      'a-broken',
      'z-valid',
    ]);
    expect(catalog.schemes[0]).toMatchObject({ valid: false });
    expect(catalog.schemes[1]).toEqual({
      name: 'z-valid',
      valid: true,
      scheme: { handoff: 0.5, reuse: { remainingTokens: 180000 } },
    });
  });

  it('creates without overwrite, repairs malformed contents on update, and deletes one joined path', async () => {
    const scheme = {
      handoff: 0.5,
      handoffRoles: { reviewer: { remainingTokens: 48000 } },
      reuse: 0.25,
      reuseRoles: { implementer: 0.2 },
    };
    const created = await mutate({ op: 'create', name: 'focused', scheme });
    expect(created.status).toBe(201);
    expect(created.json()).toEqual({
      op: 'create',
      name: 'focused',
      scheme,
    } satisfies ThresholdSchemeMutationResponse);

    const focusedPath = path.join(schemesDir, 'focused.yaml');
    expect(fs.existsSync(focusedPath)).toBe(true);
    const beforeConflict = fs.readFileSync(focusedPath, 'utf8');
    const conflict = await mutate({ op: 'create', name: 'focused', scheme });
    expect(conflict.status).toBe(409);
    expect(fs.readFileSync(focusedPath, 'utf8')).toBe(beforeConflict);

    fs.writeFileSync(focusedPath, 'handoff: [\n');
    const repairedScheme = { handoff: { remainingTokens: 60000 }, reuse: 0.3 };
    const repaired = await mutate({
      op: 'update',
      name: 'focused',
      scheme: repairedScheme,
    });
    expect(repaired.status).toBe(200);
    expect(repaired.json()).toEqual({
      op: 'update',
      name: 'focused',
      scheme: repairedScheme,
    } satisfies ThresholdSchemeMutationResponse);

    fs.writeFileSync(
      path.join(schemesDir, 'untouched.yaml'),
      'handoff: 0.6\nreuse: 0.2\n'
    );
    const deleted = await mutate({ op: 'delete', name: 'focused' });
    expect(deleted.status).toBe(200);
    expect(deleted.json()).toEqual({ op: 'delete', deleted: 'focused' });
    expect(fs.existsSync(focusedPath)).toBe(false);
    expect(fs.existsSync(path.join(schemesDir, 'untouched.yaml'))).toBe(true);
  });

  it('serializes concurrent same-name creates and preserves the single winner bytes', async () => {
    await startServer();
    const firstScheme = { handoff: 0.41, reuse: 0.21 };
    const secondScheme = { handoff: 0.62, reuse: 0.32 };

    const results = await Promise.all([
      mutate({ op: 'create', name: 'create-race', scheme: firstScheme }),
      mutate({ op: 'create', name: 'create-race', scheme: secondScheme }),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    const winner = results.find((result) => result.status === 201)!;
    const winnerResponse = winner.json() as Extract<
      ThresholdSchemeMutationResponse,
      { op: 'create' }
    >;
    expect(fs.readFileSync(path.join(schemesDir, 'create-race.yaml'), 'utf8')).toBe(
      stringifyYaml(winnerResponse.scheme, { lineWidth: 0 })
    );
  });

  it('waits for an interleaved same-name creator and returns conflict without changing its bytes', async () => {
    await startServer();
    fs.mkdirSync(schemesDir, { recursive: true });
    const targetPath = path.join(schemesDir, 'interleaved-create.yaml');
    const lockPath = path.join(schemesDir, '.interleaved-create.yaml.lock');
    const winnerScheme = { handoff: 0.43, reuse: 0.23 };
    const winnerBytes = stringifyYaml(winnerScheme, { lineWidth: 0 });
    fs.writeFileSync(lockPath, 'competing creator owns this scheme\n', {
      flag: 'wx',
    });
    const competitor = runCompetingFilesystemMutation(
      'create',
      targetPath,
      lockPath,
      winnerBytes
    );

    const loser = await mutate({
      op: 'create',
      name: 'interleaved-create',
      scheme: { handoff: 0.64, reuse: 0.34 },
    });
    await competitor;

    expect(loser.status).toBe(409);
    expect(fs.readFileSync(targetPath, 'utf8')).toBe(winnerBytes);
  });

  it('rechecks update after an interleaved same-name delete and never resurrects the scheme', async () => {
    await startServer();
    await mutate({
      op: 'create',
      name: 'interleaved-delete',
      scheme: { handoff: 0.5, reuse: 0.25 },
    });
    const targetPath = path.join(schemesDir, 'interleaved-delete.yaml');
    const lockPath = path.join(schemesDir, '.interleaved-delete.yaml.lock');
    fs.writeFileSync(lockPath, 'competing deleter owns this scheme\n', {
      flag: 'wx',
    });
    const competitor = runCompetingFilesystemMutation(
      'delete',
      targetPath,
      lockPath
    );

    const updated = await mutate({
      op: 'update',
      name: 'interleaved-delete',
      scheme: { handoff: 0.7, reuse: 0.35 },
    });
    await competitor;

    expect(updated.status).toBe(404);
    expect(fs.existsSync(targetPath)).toBe(false);
  });

  it('keeps committed create/update/delete results when close and scratch cleanup report failures', async () => {
    await startServer();
    const realCloseSync = fs.closeSync.bind(fs);
    const realRmSync = fs.rmSync.bind(fs);
    const resetCleanup = setThresholdSchemeCleanupOpsForTesting({
      closeSync: (fd) => {
        realCloseSync(fd);
        throw Object.assign(new Error('simulated post-close failure'), { code: 'EIO' });
      },
      rmSync: ((target: fs.PathLike, options?: fs.RmDirOptions) => {
        realRmSync(target, options);
        const filePath = String(target);
        if (
          filePath.includes('cleanup-') &&
          (filePath.endsWith('.tmp') || filePath.endsWith('.lock'))
        ) {
          throw Object.assign(new Error('simulated post-remove failure'), {
            code: 'EBUSY',
          });
        }
      }) as typeof fs.rmSync,
    });

    try {
      const createdScheme = { handoff: 0.46, reuse: 0.26 };
      const created = await mutate({
        op: 'create',
        name: 'cleanup-create',
        scheme: createdScheme,
      });
      expect(created.status).toBe(201);
      expect(fs.readFileSync(path.join(schemesDir, 'cleanup-create.yaml'), 'utf8')).toBe(
        stringifyYaml(createdScheme, { lineWidth: 0 })
      );

      const losingCreate = await mutate({
        op: 'create',
        name: 'cleanup-create',
        scheme: { handoff: 0.71, reuse: 0.31 },
      });
      expect(losingCreate.status).toBe(409);
      expect(fs.readFileSync(path.join(schemesDir, 'cleanup-create.yaml'), 'utf8')).toBe(
        stringifyYaml(createdScheme, { lineWidth: 0 })
      );

      const updatedScheme = { handoff: 0.57, reuse: 0.27 };
      const updated = await mutate({
        op: 'update',
        name: 'cleanup-create',
        scheme: updatedScheme,
      });
      expect(updated.status).toBe(200);
      expect(fs.readFileSync(path.join(schemesDir, 'cleanup-create.yaml'), 'utf8')).toBe(
        stringifyYaml(updatedScheme, { lineWidth: 0 })
      );

      const deleted = await mutate({ op: 'delete', name: 'cleanup-create' });
      expect(deleted.status).toBe(200);
      expect(deleted.json()).toEqual({
        op: 'delete',
        deleted: 'cleanup-create',
      } satisfies ThresholdSchemeMutationResponse);
      expect(fs.existsSync(path.join(schemesDir, 'cleanup-create.yaml'))).toBe(false);
    } finally {
      resetCleanup();
    }
  });

  it('does not unlink a successor lock when ownership changes after commit', async () => {
    await startServer();
    fs.mkdirSync(schemesDir, { recursive: true });
    const targetPath = path.join(schemesDir, 'ownership-safe.yaml');
    const lockPath = path.join(schemesDir, '.ownership-safe.yaml.lock');
    const successorBytes = 'successor process owns this lock\n';
    const realCloseSync = fs.closeSync.bind(fs);
    const resetCleanup = setThresholdSchemeCleanupOpsForTesting({
      closeSync: (fd) => {
        realCloseSync(fd);
        if (fs.existsSync(lockPath)) {
          fs.rmSync(lockPath, { force: true });
          fs.writeFileSync(lockPath, successorBytes, { flag: 'wx' });
        }
      },
    });

    try {
      const scheme = { handoff: 0.48, reuse: 0.28 };
      const created = await mutate({
        op: 'create',
        name: 'ownership-safe',
        scheme,
      });
      expect(created.status).toBe(201);
      expect(fs.readFileSync(targetPath, 'utf8')).toBe(
        stringifyYaml(scheme, { lineWidth: 0 })
      );
      expect(fs.readFileSync(lockPath, 'utf8')).toBe(successorBytes);
    } finally {
      resetCleanup();
      fs.rmSync(lockPath, { force: true });
    }
  });

  it('maps bounded lock contention to an actionable non-500 response', async () => {
    await startServer();
    fs.mkdirSync(schemesDir, { recursive: true });
    const lockPath = path.join(schemesDir, '.busy.yaml.lock');
    fs.writeFileSync(lockPath, 'active owner\n', { flag: 'wx' });
    const stale = new Date(Date.now() - 60 * 60 * 1000);
    fs.utimesSync(lockPath, stale, stale);
    let logicalNow = Date.now();
    const dateSpy = vi.spyOn(Date, 'now').mockImplementation(() => {
      logicalNow += 6_000;
      return logicalNow;
    });

    try {
      const response = await mutate({
        op: 'create',
        name: 'busy',
        scheme: { handoff: 0.5, reuse: 0.25 },
      });
      expect(response.status).toBe(423);
      expect(response.json()).toEqual({
        error: {
          code: 'lock_timeout',
          message: expect.stringMatching(
            /busy.*inspect.*confirm that no Rasen process.*remove.*manually/i
          ),
          fix: expect.stringMatching(
            /inspect the lock file.*confirming that no Rasen process.*remove.*manually/i
          ),
        },
      });
      expect(fs.readFileSync(lockPath, 'utf8')).toBe('active owner\n');
      expect(fs.existsSync(path.join(schemesDir, 'busy.yaml'))).toBe(false);
    } finally {
      dateSpy.mockRestore();
    }

    fs.rmSync(lockPath);
    const recovered = await mutate({
      op: 'create',
      name: 'busy',
      scheme: { handoff: 0.5, reuse: 0.25 },
    });
    expect(recovered.status).toBe(201);
  });

  it('rejects invalid input and missing updates without damaging an existing file', async () => {
    const originalScheme = { handoff: 0.5, reuse: 0.25 };
    await mutate({ op: 'create', name: 'focused', scheme: originalScheme });
    const focusedPath = path.join(schemesDir, 'focused.yaml');
    const beforeInvalid = fs.readFileSync(focusedPath, 'utf8');

    const invalidScheme = await mutate({
      op: 'update',
      name: 'focused',
      scheme: { handoff: 0.8 },
    });
    expect(invalidScheme.status).toBe(400);
    expect(fs.readFileSync(focusedPath, 'utf8')).toBe(beforeInvalid);

    const invalidName = await mutate({
      op: 'create',
      name: '..\\escape',
      scheme: originalScheme,
    });
    expect(invalidName.status).toBe(400);
    expect(fs.existsSync(path.resolve(schemesDir, '..', 'escape.yaml'))).toBe(false);

    const missingUpdate = await mutate({
      op: 'update',
      name: 'missing',
      scheme: originalScheme,
    });
    expect(missingUpdate.status).toBe(404);

    const malformedRequest = await mutate({
      op: 'create',
      name: 'focused',
    });
    expect(malformedRequest.status).toBe(400);
  });

  it('requires bearer authorization before storage access and rejects unsupported methods', async () => {
    const server = await startServer();

    for (const options of [
      { method: 'GET', headers: undefined },
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          op: 'create',
          name: 'unauthorized',
          scheme: { handoff: 0.5, reuse: 0.25 },
        }),
      },
    ]) {
      const response = await request(server.port, options);
      expect(response.status).toBe(401);
      expect((response.json() as { error: { code: string } }).error.code).toBe(
        'unauthorized'
      );
    }
    expect(fs.existsSync(schemesDir)).toBe(false);

    for (const method of ['PUT', 'DELETE']) {
      const response = await request(server.port, {
        method,
        headers: authed(),
      });
      expect(response.status).toBe(405);
      expect((response.json() as { error: { code: string } }).error.code).toBe(
        'method_not_allowed'
      );
    }
    expect(fs.existsSync(schemesDir)).toBe(false);
  });
});
