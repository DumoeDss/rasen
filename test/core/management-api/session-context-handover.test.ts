import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * The context file must be COMPLETE before the agent starts, and the child
 * must receive its LOCATION rather than its contents. Both are properties of
 * the spawn call itself, so this file records every spawn and reads the
 * filesystem at the moment `spawn` is entered — a mock that asserts after the
 * fact could not distinguish "written before spawn" from "written just after".
 */
const mockSpawnCalls: Array<{
  options: { env?: NodeJS.ProcessEnv } & Record<string, unknown>;
  argv: string[];
  /** What the context file contained AT THE MOMENT spawn was called. */
  contextAtSpawn: string | null;
}> = [];

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: (...args: Parameters<typeof actual.spawn>) => {
      const options = (args[2] ?? {}) as { env?: NodeJS.ProcessEnv } & Record<string, unknown>;
      const pointer = options.env?.RASEN_SESSION_CONTEXT;
      let contextAtSpawn: string | null = null;
      if (typeof pointer === 'string') {
        try {
          contextAtSpawn = fs.readFileSync(pointer, 'utf-8');
        } catch {
          contextAtSpawn = null;
        }
      }
      mockSpawnCalls.push({
        options,
        argv: (args[1] ?? []) as string[],
        contextAtSpawn,
      });
      return actual.spawn(...args);
    },
  };
});

import { createSessionSupervisor } from '../../../src/core/management-api/supervisor.js';
import { createSessionRegistry } from '../../../src/core/management-api/session-registry.js';
import {
  RASEN_SESSION_CONTEXT_ENV,
  RUNTIME_CONTEXT_VERSION,
  RuntimeContextSchema,
  sessionRuntimeContextDir,
  sessionRuntimeContextPath,
  writeSessionRuntimeContext,
} from '../../../src/core/session-runtime-context.js';
import { fakeClaudeBin } from '../../helpers/fake-claude-bin.js';
import { cleanupTempPathAsync } from '../../helpers/temp-cleanup.js';

const IS_WINDOWS = process.platform === 'win32';
const SETTLE_MS = IS_WINDOWS ? 1200 : 400;

describe('session context handover (unified-session-runtime-context D3)', () => {
  let cwd: string;
  let dataDir: string;

  beforeEach(() => {
    mockSpawnCalls.length = 0;
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-session-handover-'));
    dataDir = path.join(cwd, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
  });

  afterEach(async () => {
    await cleanupTempPathAsync(cwd);
  });

  function makeSupervisor() {
    return createSessionSupervisor({
      registry: createSessionRegistry(),
      resolveAgentCli: async () => fakeClaudeBin,
      killGraceMs: 200,
      sessionContextPaths: { globalDataDir: dataDir },
    });
  }

  const storeSpace = { type: 'store' as const, id: 'team-store', root: '/store/root' };

  async function launchWith(
    execution: Parameters<ReturnType<typeof makeSupervisor>['launch']>[0]['execution'],
    space: typeof storeSpace | null = storeSpace
  ) {
    const supervisor = makeSupervisor();
    const result = await supervisor.launch({
      kind: 'auto',
      skill: '/rasen-auto',
      task: 'MODE=fast-exit handover',
      cwd,
      ...(space !== null ? { space } : {}),
      ...(execution !== undefined ? { execution } : {}),
      timeoutMs: 5000,
      noOutputTimeoutMs: 5000,
    });
    return { supervisor, result };
  }

  it('records the execution binding on the session and hands the child a PATH', async () => {
    const { result } = await launchWith({
      kind: 'project',
      projectId: 'project-a',
      root: cwd,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.record.execution).toEqual({
      kind: 'project',
      projectId: 'project-a',
      root: cwd,
    });

    const spawnCall = mockSpawnCalls.at(-1)!;
    const pointer = spawnCall.options.env?.[RASEN_SESSION_CONTEXT_ENV];
    expect(pointer).toBe(sessionRuntimeContextPath(result.record.id, { globalDataDir: dataDir }));

    // The PATH, never the document: no environment variable carries the
    // context's contents, and nothing about it reaches the command line.
    const serialized = JSON.stringify(spawnCall.options.env);
    expect(serialized).not.toContain('"planning"');
    expect(serialized).not.toContain('"execution"');
    expect(spawnCall.argv.join(' ')).not.toContain('project-a');

    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
  }, 15_000);

  it('has the context fully written and valid before the agent starts', async () => {
    const { result } = await launchWith({
      kind: 'project',
      projectId: 'project-a',
      root: cwd,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const contextAtSpawn = mockSpawnCalls.at(-1)!.contextAtSpawn;
    expect(contextAtSpawn).not.toBeNull();
    const parsed = RuntimeContextSchema.safeParse(JSON.parse(contextAtSpawn as string));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.sessionId).toBe(result.record.id);
      expect(parsed.data.planning).toEqual({
        type: 'store',
        id: 'team-store',
        root: '/store/root',
      });
    }

    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
  }, 15_000);

  it('records planning-only explicitly in the handed-over context', async () => {
    const { result } = await launchWith({ kind: 'planning-only' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.record.execution).toEqual({ kind: 'planning-only' });
    const contextAtSpawn = JSON.parse(mockSpawnCalls.at(-1)!.contextAtSpawn as string);
    expect(contextAtSpawn.execution).toEqual({ kind: 'planning-only' });

    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
  }, 15_000);

  it('hands over nothing when the launch has no derivable planning space', async () => {
    const { result } = await launchWith(
      { kind: 'project', projectId: 'project-a', root: cwd },
      null
    );
    expect(result.ok).toBe(true);

    const spawnCall = mockSpawnCalls.at(-1)!;
    expect(spawnCall.options.env?.[RASEN_SESSION_CONTEXT_ENV]).toBeUndefined();

    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
  }, 15_000);

  it('removes the context file when the session ends', async () => {
    const { result } = await launchWith({
      kind: 'project',
      projectId: 'project-a',
      root: cwd,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const dir = sessionRuntimeContextDir(result.record.id, { globalDataDir: dataDir });
    expect(fs.existsSync(dir)).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    expect(fs.existsSync(dir)).toBe(false);
  }, 15_000);

  it('removes the context file when the session is killed', async () => {
    const supervisor = makeSupervisor();
    const result = await supervisor.launch({
      kind: 'auto',
      skill: '/rasen-auto',
      task: 'MODE=idle-after-init handover-kill',
      cwd,
      space: storeSpace,
      execution: { kind: 'project', projectId: 'project-a', root: cwd },
      timeoutMs: 10_000,
      noOutputTimeoutMs: 10_000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const dir = sessionRuntimeContextDir(result.record.id, { globalDataDir: dataDir });

    supervisor.kill(result.record.id);
    await supervisor.shutdownAll('killed');
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    expect(fs.existsSync(dir)).toBe(false);
  }, 20_000);

  it('leaves a crashed session s leftover context with no effect on a later session', async () => {
    // A context file from a session id that no longer exists.
    writeSessionRuntimeContext(
      {
        // Tracks the current context-file version rather than pinning a
        // literal, which `store-planning-worktree-bindings` raised to 2.
        version: RUNTIME_CONTEXT_VERSION,
        sessionId: 'crashed-session',
        planning: { type: 'store', id: 'other-store', root: '/elsewhere' },
        execution: { kind: 'project', projectId: 'other-project', root: '/elsewhere/checkout' },
      },
      { globalDataDir: dataDir }
    );

    const { result } = await launchWith({
      kind: 'project',
      projectId: 'project-a',
      root: cwd,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const pointer = mockSpawnCalls.at(-1)!.options.env?.[RASEN_SESSION_CONTEXT_ENV];
    expect(pointer).not.toContain('crashed-session');
    const handed = JSON.parse(fs.readFileSync(pointer as string, 'utf-8'));
    expect(handed.sessionId).toBe(result.record.id);
    expect(handed.execution.projectId).toBe('project-a');

    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
  }, 15_000);
});
