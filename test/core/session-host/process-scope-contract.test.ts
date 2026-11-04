import { describe, expect, it, vi } from 'vitest';

import {
  createDeterministicProcessScope,
  type ProcessPrepareInput,
} from '../../../src/core/session-host/process-scope.js';

const launch: ProcessPrepareInput = {
  command: process.execPath,
  args: ['fixture.mjs'],
  cwd: process.cwd(),
  env: {},
};

describe('opaque ProcessScope contract', () => {
  it('keeps a prepared scope inert until the published ref is activated exactly once', async () => {
    const activated = vi.fn();
    const scope = createDeterministicProcessScope({ onActivate: activated });

    const prepared = await scope.prepare(launch);
    expect(activated).not.toHaveBeenCalled();
    expect(String(prepared.ref)).toMatch(/^rasen-process-scope\/1:/);

    const live = await prepared.activate();
    expect(live.ref).toBe(prepared.ref);
    expect(activated).toHaveBeenCalledTimes(1);
    await expect(prepared.activate()).rejects.toMatchObject({ code: 'activation-failed' });
  });

  it('aborts a CAS-lost prepared scope without an activation or backend marker', async () => {
    const activated = vi.fn();
    const scope = createDeterministicProcessScope({ onActivate: activated });
    const prepared = await scope.prepare(launch);

    await expect(prepared.abort('authority-persist-failed')).resolves.toMatchObject({
      state: 'closed',
    });
    expect(activated).not.toHaveBeenCalled();
    await expect(prepared.activate()).rejects.toMatchObject({ code: 'activation-failed' });
  });

  it('never signals or releases authority for foreign, uncertain, or unobserved close', async () => {
    const signalled = vi.fn();
    const scope = createDeterministicProcessScope({
      onTerminate: signalled,
      inspectState: 'foreign',
      terminationState: 'uncertain',
    });
    const prepared = await scope.prepare(launch);

    expect(await scope.inspect(prepared.ref)).toEqual({
      state: 'foreign',
      controllable: false,
    });
    await expect(scope.terminate(prepared.ref, { reason: 'test', graceMs: 5 })).resolves.toMatchObject({
      state: 'uncertain',
    });
    expect(signalled).not.toHaveBeenCalled();
  });

  it('models root-exit independently from exact scope-empty at the same opaque seam', async () => {
    const scope = createDeterministicProcessScope({
      rootExitAfterActivation: { code: 23, signal: null },
      scopeEmptyAfterRootExit: false,
    });
    const prepared = await scope.prepare(launch);
    const live = await prepared.activate();

    await expect(live.rootExited).resolves.toEqual({
      state: 'root-exited', code: 23, signal: null,
    });
    await expect(scope.inspect(live.ref)).resolves.toEqual({
      state: 'root-exited', controllable: true,
    });
    await expect(Promise.race([
      live.closed.then(() => 'scope-empty'),
      new Promise<string>((resolve) => setTimeout(() => resolve('retained'), 10)),
    ])).resolves.toBe('retained');

    await expect(scope.terminate(live.ref, { reason: 'test', graceMs: 5 }))
      .resolves.toMatchObject({ state: 'closed' });
    await expect(live.closed).resolves.toEqual({ state: 'scope-empty' });
  });
});
