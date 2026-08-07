import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { createHostedProcessScope } from '../../../src/core/session-host/process-capsule/hosted-process-scope.js';
import { POSIX_BEST_EFFORT_DECLARATION } from '../../../src/core/session-host/process-capsule/posix-best-effort-scope.js';
import {
  createWin32BestEffortProcessScope,
  WIN32_BEST_EFFORT_DECLARATION,
} from '../../../src/core/session-host/process-capsule/win32-best-effort-scope.js';
import {
  receiptAuthorizesRelease,
  type ProcessPrepareInput,
  type TerminationReceipt,
} from '../../../src/core/session-host/process-scope.js';
import {
  ACTIVATE,
  capsuleSeam,
  PREPARE,
  PROBE_CLOSED,
  PROBE_FOREIGN,
  PROBE_LIVE,
  PROBE_UNKNOWN,
  refFor,
  ROOT_EXIT,
  SCOPE_EMPTY,
  TERMINATE,
} from '../../helpers/fake-process-capsule.js';

const repoRoot = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const ABSOLUTE_COMMAND = process.platform === 'win32' ? 'C:\\bin\\workload' : '/bin/workload';

function prepareInput(overrides: Partial<ProcessPrepareInput> = {}): ProcessPrepareInput {
  return {
    command: ABSOLUTE_COMMAND,
    args: ['--resident'],
    cwd: repoRoot,
    env: { SystemRoot: 'C:\\Windows' },
    ...overrides,
  };
}

async function settledWithin<T>(promise: Promise<T>, ms: number): Promise<boolean> {
  const marker = Symbol('pending');
  const raced = await Promise.race([
    promise.then(() => true as const),
    new Promise<typeof marker>((resolve) => setTimeout(() => resolve(marker), ms)),
  ]);
  return raced !== marker;
}

describe('the win32 hosted tier declares its limits before anything starts', () => {
  it('attaches the win32 declaration to the prepared scope before activation', async () => {
    const seam = capsuleSeam();
    const scope = createWin32BestEffortProcessScope({ spawn: seam.spawn, resolve: seam.resolve });

    const prepared = await scope.prepare(prepareInput());

    expect(prepared.declaration).toEqual({
      tier: 'best-effort',
      exactCancel: false,
      scopeEmptyProof: false,
      semantics: [
        'own-job-object',
        'job-kill-cancel',
        'kill-on-job-close-teardown',
        'exact-root-exit',
        'bounded-controls',
        'honest-unproven-terminal',
      ],
    });
    expect(WIN32_BEST_EFFORT_DECLARATION.exactCancel).toBe(false);
    expect(WIN32_BEST_EFFORT_DECLARATION.scopeEmptyProof).toBe(false);
    // Declared before start: the capsule was asked to prepare, never to activate.
    expect(seam.controllers).toHaveLength(1);
    expect(seam.controllers[0].received).toEqual([PREPARE]);
  });

  it('selects the win32 tier at the hosted-session platform selection', async () => {
    const seam = capsuleSeam();
    const scope = createHostedProcessScope({
      platform: 'win32',
      spawn: seam.spawn,
      resolve: seam.resolve,
    });

    const prepared = await scope.prepare(prepareInput());

    expect(prepared.declaration).toEqual(WIN32_BEST_EFFORT_DECLARATION);
    // The two shipped tiers are distinct declarations; win32 must not be routed
    // to the POSIX module, which cannot drive a Job object.
    expect(prepared.declaration).not.toEqual(POSIX_BEST_EFFORT_DECLARATION);
    expect(seam.controllers).toHaveLength(1);
  });
});

describe('win32 terminals are declared-unproven, never the capsule exact claim', () => {
  it('translates an acknowledged capsule cancel into cancelled / emptiness-unproven', async () => {
    const seam = capsuleSeam();
    const scope = createWin32BestEffortProcessScope({ spawn: seam.spawn, resolve: seam.resolve });
    const prepared = await scope.prepare(prepareInput());
    const live = await prepared.activate();

    const receipt = await scope.terminate(live.ref, { reason: 'cancel', graceMs: 50 });

    expect(receipt.state).toBe('declared-unproven');
    expect(receipt.state).not.toBe('closed');
    expect(receipt.unproven).toMatchObject({
      outcome: 'cancelled',
      emptiness: 'unproven',
      forced: true,
      groupObservedEmpty: true,
    });
    // The Job-accounting observation is carried as diagnostic detail and says so.
    expect(receipt.unproven?.diagnostic).toMatch(/Job accounting observed empty/);
    expect(receipt.unproven?.diagnostic).toMatch(/not proven/);
    expect(seam.controllers[0].received).toEqual([PREPARE, ACTIVATE, TERMINATE]);
  });

  it('settles the live closed promise with an honest terminal, never a scope-empty receipt', async () => {
    const seam = capsuleSeam();
    const scope = createWin32BestEffortProcessScope({ spawn: seam.spawn, resolve: seam.resolve });
    const prepared = await scope.prepare(prepareInput());
    const live = await prepared.activate();

    // Natural completion: the workload's Job empties with no cancel in flight.
    const rootExit = Buffer.allocUnsafe(4);
    rootExit.writeInt32BE(0);
    seam.controllers[0].emitFrame(ROOT_EXIT, rootExit);
    seam.controllers[0].emitFrame(SCOPE_EMPTY);

    await expect(live.closed).resolves.toMatchObject({
      state: 'declared-unproven',
      outcome: 'completed',
      emptiness: 'unproven',
      forced: false,
      groupObservedEmpty: true,
    });
    await expect(live.rootExited).resolves.toMatchObject({ state: 'root-exited', code: 0 });
    const observation = await scope.inspect(live.ref);
    expect(observation.state).toBe('declared-unproven');
    expect(observation.controllable).toBe(false);
  });

  it('reports a scope aborted before activation as never-activated, having run nothing', async () => {
    const seam = capsuleSeam();
    const scope = createWin32BestEffortProcessScope({ spawn: seam.spawn, resolve: seam.resolve });
    const prepared = await scope.prepare(prepareInput());

    const receipt = await prepared.abort('never-needed');

    expect(receipt.state).toBe('declared-unproven');
    expect(receipt.unproven).toMatchObject({
      outcome: 'never-activated',
      emptiness: 'unproven',
      forced: false,
      groupObservedEmpty: false,
      diagnostic: 'no workload ran',
    });
    expect(seam.controllers[0].received).not.toContain(ACTIVATE);
  });

  it('yields no clean-cancel or proven-empty result on ANY reachable outcome path', async () => {
    const outcomes: TerminationReceipt[] = [];

    // 1. local acknowledged cancel of an activated scope
    const cancelled = capsuleSeam();
    const cancelledScope = createWin32BestEffortProcessScope({
      spawn: cancelled.spawn,
      resolve: cancelled.resolve,
    });
    const cancelledPrepared = await cancelledScope.prepare(prepareInput());
    const cancelledLive = await cancelledPrepared.activate();
    outcomes.push(await cancelledScope.terminate(cancelledLive.ref, { reason: 'a', graceMs: 10 }));
    // terminate again: the latched terminal must replay in the same vocabulary
    outcomes.push(await cancelledScope.terminate(cancelledLive.ref, { reason: 'b', graceMs: 10 }));

    // 2. abort before activation
    const aborted = capsuleSeam();
    const abortedScope = createWin32BestEffortProcessScope({
      spawn: aborted.spawn,
      resolve: aborted.resolve,
    });
    outcomes.push(await (await abortedScope.prepare(prepareInput())).abort('b'));

    // 3. stale ref whose Job the one-shot probe found gone
    const stale = capsuleSeam({ probe: PROBE_CLOSED });
    const staleScope = createWin32BestEffortProcessScope({
      spawn: stale.spawn,
      resolve: stale.resolve,
    });
    outcomes.push(
      await staleScope.terminate(refFor('previous-daemon-lifetime'), { reason: 'c', graceMs: 10 })
    );

    // 4. transport loss and 5. control timeout
    const lost = capsuleSeam({ controller: 'lose-transport-on-terminate' });
    const lostScope = createWin32BestEffortProcessScope({
      spawn: lost.spawn,
      resolve: lost.resolve,
    });
    const lostLive = await (await lostScope.prepare(prepareInput())).activate();
    outcomes.push(await lostScope.terminate(lostLive.ref, { reason: 'd', graceMs: 0 }));

    const stalled = capsuleSeam({ controller: 'silent-on-terminate' });
    const stalledScope = createWin32BestEffortProcessScope({
      spawn: stalled.spawn,
      resolve: stalled.resolve,
      controlTimeoutMs: 25,
    });
    const stalledLive = await (await stalledScope.prepare(prepareInput())).activate();
    outcomes.push(await stalledScope.terminate(stalledLive.ref, { reason: 'e', graceMs: 0 }));

    expect(outcomes).toHaveLength(6);
    for (const [index, receipt] of outcomes.entries()) {
      // The capsule's exact vocabulary must never reach the hosted seam.
      expect(receipt.state, `outcome ${index}`).not.toBe('closed');
      expect(['declared-unproven', 'uncertain'], `outcome ${index}`).toContain(receipt.state);
      if (receipt.unproven) {
        expect(receipt.unproven.emptiness, `outcome ${index}`).toBe('unproven');
      }
    }
  });

  it('has no source path that emits closed or scope-empty on this tier', () => {
    const source = fs.readFileSync(
      path.join(repoRoot, 'src/core/session-host/process-capsule/win32-best-effort-scope.ts'),
      'utf8'
    );
    const code = source
      .split('\n')
      .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
      .join('\n');
    expect(code).not.toMatch(/state:\s*'closed'/);
    expect(code).not.toMatch(/'scope-empty'/);
    expect(code).not.toMatch(/emptiness:\s*'proven/);
  });

  it('contains no reattach or identity revalidation anywhere in the module', () => {
    const source = fs.readFileSync(
      path.join(repoRoot, 'src/core/session-host/process-capsule/win32-best-effort-scope.ts'),
      'utf8'
    );
    expect(source).not.toMatch(/reattach/i);
    expect(source).not.toMatch(/revalidat/i);
  });
});

describe('transport and controller loss are retained uncertainty, never a terminal', () => {
  it('returns typed uncertainty when the controller dies before acknowledging', async () => {
    const seam = capsuleSeam({ controller: 'lose-transport-on-terminate' });
    const scope = createWin32BestEffortProcessScope({ spawn: seam.spawn, resolve: seam.resolve });
    const prepared = await scope.prepare(prepareInput());
    const live = await prepared.activate();

    const receipt = await scope.terminate(live.ref, { reason: 'controller-death', graceMs: 0 });

    expect(receipt.state).toBe('uncertain');
    expect(receipt.unproven).toBeUndefined();
    expect(receipt.failure).toEqual({ code: 'process-control-lost', phase: 'scope-empty' });
    // The whole point: authority is NOT released on a lost transport, and the
    // declaration does not change that.
    expect(receiptAuthorizesRelease(receipt, true)).toBe(false);
    expect(receiptAuthorizesRelease(receipt, false)).toBe(false);
  });

  it('leaves the hosted terminal unsettled after transport loss', async () => {
    const seam = capsuleSeam({ controller: 'lose-transport-on-terminate' });
    const scope = createWin32BestEffortProcessScope({ spawn: seam.spawn, resolve: seam.resolve });
    const prepared = await scope.prepare(prepareInput());
    const live = await prepared.activate();

    await scope.terminate(live.ref, { reason: 'controller-death', graceMs: 0 });

    // A terminal here would be a fabricated Record entry: nothing observed the
    // Job empty. The promise must simply stay pending.
    expect(await settledWithin(live.closed, 60)).toBe(false);
  });

  it('returns typed uncertainty when the cancel exceeds its control bound', async () => {
    const seam = capsuleSeam({ controller: 'silent-on-terminate' });
    const scope = createWin32BestEffortProcessScope({
      spawn: seam.spawn,
      resolve: seam.resolve,
      controlTimeoutMs: 25,
    });
    const prepared = await scope.prepare(prepareInput());
    const live = await prepared.activate();

    const receipt = await scope.terminate(live.ref, { reason: 'stuck', graceMs: 0 });

    expect(receipt.state).toBe('uncertain');
    expect(receipt.unproven).toBeUndefined();
    expect(receipt.failure).toEqual({ code: 'process-control-timeout', phase: 'scope-empty' });
    expect(receiptAuthorizesRelease(receipt, true)).toBe(false);
  });

  it('returns typed uncertainty on a capsule protocol violation', async () => {
    const seam = capsuleSeam({ controller: 'protocol-error-on-terminate' });
    const scope = createWin32BestEffortProcessScope({ spawn: seam.spawn, resolve: seam.resolve });
    const prepared = await scope.prepare(prepareInput());
    const live = await prepared.activate();

    const receipt = await scope.terminate(live.ref, { reason: 'protocol', graceMs: 0 });

    expect(receipt.state).toBe('uncertain');
    expect(receipt.unproven).toBeUndefined();
    expect(receipt.failure?.code).toBe('process-control-lost');
    expect(receiptAuthorizesRelease(receipt, true)).toBe(false);
  });

  it('reports a probe that never answers as an uncertain observation', async () => {
    const seam = capsuleSeam({ probe: 'close-without-observation' });
    const scope = createWin32BestEffortProcessScope({ spawn: seam.spawn, resolve: seam.resolve });

    const observation = await scope.inspect(refFor('previous-daemon-lifetime'));

    expect(observation.state).toBe('uncertain');
    expect(observation.controllable).toBe(false);
  });
});

describe('foreign and stale refs translate conservatively without wedging', () => {
  it('keeps a probe-live scope controllable', async () => {
    const seam = capsuleSeam({ probe: PROBE_LIVE });
    const scope = createWin32BestEffortProcessScope({ spawn: seam.spawn, resolve: seam.resolve });

    const observation = await scope.inspect(refFor('previous-daemon-lifetime'));

    expect(observation).toEqual({ state: 'live', controllable: true });
  });

  it('passes foreign and unknown probe outcomes through unchanged', async () => {
    for (const [probe, state] of [
      [PROBE_FOREIGN, 'foreign'],
      [PROBE_UNKNOWN, 'uncertain'],
    ] as const) {
      const seam = capsuleSeam({ probe });
      const scope = createWin32BestEffortProcessScope({ spawn: seam.spawn, resolve: seam.resolve });

      const observation = await scope.inspect(refFor('previous-daemon-lifetime'));

      expect(observation.state, String(probe)).toBe(state);
      expect(observation.controllable, String(probe)).toBe(false);
    }
  });

  it('translates a probe-observed-gone Job into a declared-unproven observation', async () => {
    const seam = capsuleSeam({ probe: PROBE_CLOSED });
    const scope = createWin32BestEffortProcessScope({ spawn: seam.spawn, resolve: seam.resolve });

    const observation = await scope.inspect(refFor('previous-daemon-lifetime'));

    expect(observation.state).toBe('declared-unproven');
    expect(observation.controllable).toBe(false);
    expect(observation.state === 'declared-unproven' && observation.terminal).toMatchObject({
      outcome: 'completed',
      emptiness: 'unproven',
      groupObservedEmpty: true,
    });
    expect(
      observation.state === 'declared-unproven' ? observation.terminal.diagnostic : undefined
    ).toMatch(/one-shot probe/);
  });

  it('lets a declared stale record be reaped instead of wedging it forever', async () => {
    const seam = capsuleSeam({ probe: PROBE_CLOSED });
    const scope = createWin32BestEffortProcessScope({ spawn: seam.spawn, resolve: seam.resolve });

    const receipt = await scope.terminate(refFor('previous-daemon-lifetime'), {
      reason: 'daemon-reconcile-stale-scope',
      graceMs: 0,
    });

    expect(receipt.state).toBe('declared-unproven');
    expect(receipt.unproven).toMatchObject({ outcome: 'cancelled', emptiness: 'unproven' });
    expect(receipt.unproven?.diagnostic).toMatch(/one-shot probe/);
    expect(receipt.unproven?.diagnostic).toMatch(/previous daemon lifetime/);
    // Declaration-gated exactly like a live scope: the record's pre-start
    // declaration is what authorises the release, not the probe result.
    expect(receiptAuthorizesRelease(receipt, true)).toBe(true);
    expect(receiptAuthorizesRelease(receipt, false)).toBe(false);
  });

  it('keeps a still-live foreign scope retained rather than releasing it', async () => {
    const seam = capsuleSeam({ probe: PROBE_LIVE });
    const scope = createWin32BestEffortProcessScope({ spawn: seam.spawn, resolve: seam.resolve });

    const receipt = await scope.terminate(refFor('previous-daemon-lifetime'), {
      reason: 'stale',
      graceMs: 0,
    });

    expect(receipt.state).toBe('retained');
    expect(receiptAuthorizesRelease(receipt, true)).toBe(false);
  });
});
