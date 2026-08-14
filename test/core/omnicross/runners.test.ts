import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildClaudePrintInvocation, runClaudePrint } from '../../../src/core/claude/index.js';
import { runCodexExec } from '../../../src/core/codex/index.js';

const fixtureRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures'
);
const codexBinary = path.join(
  fixtureRoot, 'codex', process.platform === 'win32' ? 'fake-codex.cmd' : 'fake-codex.mjs'
);
const claudeBinary = path.join(
  fixtureRoot, 'claude', process.platform === 'win32' ? 'fake-claude.cmd' : 'fake-claude.mjs'
);

let root: string;
let cwd: string;

beforeAll(() => {
  if (process.platform !== 'win32') {
    fs.chmodSync(codexBinary, 0o755);
    fs.chmodSync(claudeBinary, 0o755);
  }
});

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-omnicross-runners-'));
  cwd = path.join(root, 'workspace with spaces');
  fs.mkdirSync(cwd);
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const providerOverride = {
  name: 'omnicross',
  baseUrl: 'http://127.0.0.1:8766/openai',
  wireApi: 'responses',
  envKey: 'OMNICROSS_CODEX_ROUTE_TOKEN',
  disableResponseStorage: true,
} as const;

function resultSummary(receipt: Awaited<ReturnType<typeof runCodexExec>> | Awaited<ReturnType<typeof runClaudePrint>>) {
  if (!receipt.ok || receipt.result.status !== 'DONE') throw new Error('expected DONE receipt');
  return JSON.parse(receipt.result.summary ?? '{}') as Record<string, unknown>;
}

function snapshot(file: string) {
  const stat = fs.statSync(file);
  return {
    hash: createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
    size: stat.size,
    mtimeMs: stat.mtimeMs,
  };
}

describe('validated routed runner bindings', () => {
  it('applies the Codex provider override and replacement token to fresh and exact resume', async () => {
    const state = path.join(root, 'codex-state');
    const first = await runCodexExec({
      binary: codexBinary,
      prompt: 'MODE=success\nTHREAD_ID=routed-thread',
      contract: 'leaf',
      sandbox: 'read-only',
      cwd,
      threadStateDir: state,
      scratchParent: root,
      model: 'deepseek-chat',
      providerOverride,
      env: { ...process.env, OMNICROSS_CODEX_ROUTE_TOKEN: 'route-token-a' },
      secretValues: ['route-token-a'],
    });
    expect(first).toMatchObject({ ok: true, threadId: 'routed-thread' });
    const firstSummary = resultSummary(first);
    expect(firstSummary.routeEnv).toBe('<redacted>');
    expect(firstSummary.adminEnv).toBeUndefined();
    expect(firstSummary.args).toEqual(expect.arrayContaining([
      'model_providers.omnicross.env_key="OMNICROSS_CODEX_ROUTE_TOKEN"',
      'disable_response_storage=true',
    ]));
    expect(JSON.stringify(firstSummary.args)).not.toContain('requires_openai_auth');
    expect(JSON.stringify(firstSummary.args)).not.toContain('OPENAI_API_KEY');

    const resumed = await runCodexExec({
      binary: codexBinary,
      prompt: 'MODE=success',
      contract: 'leaf',
      sandbox: 'read-only',
      cwd,
      threadStateDir: state,
      scratchParent: root,
      model: 'deepseek-chat',
      resumeThreadId: 'routed-thread',
      providerOverride,
      env: { ...process.env, OMNICROSS_CODEX_ROUTE_TOKEN: 'route-token-b' },
      secretValues: ['route-token-b'],
    });
    expect(resumed).toMatchObject({ ok: true, threadId: 'routed-thread' });
    expect(resultSummary(resumed).routeEnv).toBe('<redacted>');
    expect(JSON.stringify(resumed)).not.toContain('route-token-b');
  });

  it('applies only the routed Claude environment to fresh and exact resume', async () => {
    const state = path.join(root, 'claude-state');
    const env = {
      ...process.env,
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:8766/anthropic',
      ANTHROPIC_AUTH_TOKEN: 'claude-route-a',
      ANTHROPIC_API_KEY: 'omnicross-route',
      ANTHROPIC_MODEL: 'claude-sonnet-4-6',
    };
    const first = await runClaudePrint({
      binary: claudeBinary,
      invocation: buildClaudePrintInvocation({
        prompt: 'MODE=success\nSESSION_ID=routed-session',
        contract: 'leaf',
        sandbox: 'read-only',
        model: 'claude-sonnet-4-6',
      }),
      cwd,
      sessionStateDir: state,
      env,
      secretValues: ['claude-route-a'],
    });
    expect(first).toMatchObject({ ok: true, sessionId: 'routed-session' });
    expect(resultSummary(first)).toMatchObject({
      baseUrl: 'http://127.0.0.1:8766/anthropic',
      authToken: '<redacted>',
      model: 'claude-sonnet-4-6',
    });

    const resumed = await runClaudePrint({
      binary: claudeBinary,
      invocation: buildClaudePrintInvocation({
        prompt: 'MODE=success',
        contract: 'leaf',
        sandbox: 'read-only',
        model: 'claude-sonnet-4-6',
        resumeSessionId: 'routed-session',
      }),
      cwd,
      sessionStateDir: state,
      env: { ...env, ANTHROPIC_AUTH_TOKEN: 'claude-route-b' },
      secretValues: ['claude-route-b'],
    });
    expect(resumed).toMatchObject({ ok: true, sessionId: 'routed-session' });
    expect(JSON.stringify(resumed)).not.toContain('claude-route-b');
  });

  it.each(['codex', 'claude'] as const)('terminates %s on AbortSignal and returns cancellation', async (runtime) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new Error('test cancellation')), 150).unref?.();
    const receipt = runtime === 'codex'
      ? await runCodexExec({
          binary: codexBinary,
          prompt: `MODE=hold\nRELEASE_FILE=${path.join(root, 'never')}`,
          contract: 'leaf', sandbox: 'read-only', cwd,
          scratchParent: root, threadStateDir: path.join(root, 'codex-state'),
          signal: controller.signal,
        })
      : await runClaudePrint({
          binary: claudeBinary,
          invocation: buildClaudePrintInvocation({
            prompt: `MODE=hold\nRELEASE_FILE=${path.join(root, 'never')}`,
            contract: 'leaf', sandbox: 'read-only',
          }),
          cwd, sessionStateDir: path.join(root, 'claude-state'), signal: controller.signal,
        });
    expect(receipt).toMatchObject({ ok: false, failure: { kind: 'cancelled' } });
  });

  it('leaves Codex and Claude user files byte/size/mtime-identical', async () => {
    const files = [
      path.join(root, '.codex', 'config.toml'),
      path.join(root, '.codex', 'auth.json'),
      path.join(root, '.claude', 'settings.json'),
      path.join(root, '.claude', 'credentials.json'),
    ];
    for (const file of files) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `sentinel:${path.basename(file)}\n`, 'utf8');
    }
    const before = Object.fromEntries(files.map((file) => [file, snapshot(file)]));
    await runCodexExec({
      binary: codexBinary, prompt: 'MODE=success', contract: 'leaf', sandbox: 'read-only', cwd,
      scratchParent: root, threadStateDir: path.join(root, 'codex-state'), codexHome: path.join(root, '.codex'),
      providerOverride,
      env: { ...process.env, CODEX_HOME: path.join(root, '.codex'), OMNICROSS_CODEX_ROUTE_TOKEN: 'token' },
    });
    await runClaudePrint({
      binary: claudeBinary,
      invocation: buildClaudePrintInvocation({ prompt: 'MODE=success', contract: 'leaf', sandbox: 'read-only' }),
      cwd,
      sessionStateDir: path.join(root, 'claude-state'),
      env: { ...process.env, CLAUDE_CONFIG_DIR: path.join(root, '.claude') },
    });
    expect(Object.fromEntries(files.map((file) => [file, snapshot(file)]))).toEqual(before);
  });
});
