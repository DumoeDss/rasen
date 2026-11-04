import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess, spawn as nodeSpawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';

import {
  createPosixBestEffortProcessScope,
  type ProcessGroupControl,
} from '../../../src/core/session-host/process-capsule/posix-best-effort-scope.js';
import { createWin32BestEffortProcessScope } from '../../../src/core/session-host/process-capsule/win32-best-effort-scope.js';
import { createNativeProcessScope } from '../../../src/core/session-host/process-capsule/native-process-scope.js';
import { sweepSettledTerminals } from '../../../src/core/session-host/process-capsule/scope-retention.js';
import type { ProcessPrepareInput, ProcessRef } from '../../../src/core/session-host/process-scope.js';
import { capsuleSeam } from '../../helpers/fake-process-capsule.js';

/**
 * Closes RC-005 / cutover finding F4: the three ProcessScope tiers each keep a
 * per-ref retention map that, before this rule, never released an entry. The one
 * lifecycle rule (scope-retention.ts) releases a settled definite terminal on
 * the successor Session's prepare while retaining every live / control-lost /
 * uncertain entry for reconciliation. This suite discriminates both directions:
 * removing the sweep leaves settled terminals behind (releases fail), and
 * widening the predicate to sweep unconditionally drops entries that must be
 * retained (retention fails).
 *
 * The exact tier's legacy `clients` map lives in the byte-pinned
 * `native-process-scope.ts`; wiring the shared sweep into it required a
 * LEAD-authorized pin rebaseline of that file (both `LEGACY_PROCESS_CAPSULE_INPUTS`
 * lists), exactly per the cutover F1 precedent. All three tiers are covered
 * below, and the rule's logic is additionally pinned by the unit block.
 */

const ABSOLUTE_COMMAND = process.platform === 'win32' ? 'C:\\bin\\workload' : '/bin/workload';

function prepareInput(overrides: Partial<ProcessPrepareInput> = {}): ProcessPrepareInput {
  return {
    command: ABSOLUTE_COMMAND,
    args: ['--resident'],
    cwd: process.cwd(),
    env: process.platform === 'win32' ? { SystemRoot: 'C:\\Windows' } : { HOME: '/tmp/home' },
    ...overrides,
  };
}

// ----- POSIX tier harness -------------------------------------------------

class FakePosixChild extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  constructor(readonly pid: number) {
    super();
  }
  kill(): boolean {
    return true;
  }
}

function posixSpawn(): { spawn: typeof nodeSpawn; children: FakePosixChild[] } {
  const children: FakePosixChild[] = [];
  let pid = 6000;
  const fake = () => {
    pid += 1;
    const child = new FakePosixChild(pid);
    children.push(child);
    setImmediate(() => child.emit('spawn'));
    return child as unknown as ChildProcess;
  };
  return { spawn: fake as unknown as typeof nodeSpawn, children };
}

/** A group that is observed empty at once, so a cancel settles a terminal. */
const emptyGroup: ProcessGroupControl = {
  signalGroup() {
    /* accepted; the group is already gone */
  },
  groupPresent() {
    return false;
  },
};

// ----- Shared rule (all three tiers, including the pinned exact tier) ------

describe('the shared retention rule releases settled terminals and retains everything else', () => {
  it('releases the best-effort settled-terminal shape and keeps a live one', () => {
    const map = new Map<string, { terminal?: unknown }>();
    map.set('settled', { terminal: { state: 'declared-unproven' } });
    map.set('live', {});
    sweepSettledTerminals(map, (value) => value.terminal !== undefined);
    expect([...map.keys()]).toEqual(['live']);
  });

  it('releases the exact-tier closed client and retains a control-lost one', () => {
    // Mirrors native-process-scope.ts CapsuleClient: 'closed' is the only
    // definite terminal; a control-lost client keeps its non-closed state and
    // must be retained.
    const map = new Map<string, { state: string }>();
    map.set('closed', { state: 'closed' });
    map.set('live', { state: 'live' });
    map.set('control-lost', { state: 'root-exited' });
    sweepSettledTerminals(map, (value) => value.state === 'closed');
    expect([...map.keys()]).toEqual(['live', 'control-lost']);
  });
});

// ----- POSIX best-effort tier ---------------------------------------------

describe('POSIX best-effort retention lifecycle', () => {
  it('releases a settled-terminal scope on the successor prepare, retains a live one', async () => {
    const { spawn } = posixSpawn();
    let retained!: () => readonly ProcessRef[];
    const scope = createPosixBestEffortProcessScope({
      spawn,
      control: emptyGroup,
      retentionProbe: (probe) => {
        retained = probe;
      },
    });

    const a = await scope.prepare(prepareInput());
    const aLive = await a.activate();
    const b = await scope.prepare(prepareInput());
    const bLive = await b.activate();

    const cancelled = await scope.terminate(aLive.ref, { reason: 'cancel', graceMs: 0 });
    expect(cancelled.state).toBe('declared-unproven');
    // Before any successor prepare the settled terminal is still retained for
    // an in-Session replay.
    expect(retained()).toContain(aLive.ref);
    expect(retained()).toContain(bLive.ref);
    expect(await scope.inspect(aLive.ref)).toMatchObject({ state: 'declared-unproven' });

    // The successor Session's prepare is the release point.
    const c = await scope.prepare(prepareInput());
    expect(retained()).not.toContain(aLive.ref); // settled terminal released
    expect(retained()).toContain(bLive.ref); // live scope retained
    expect(retained()).toContain(c.ref);
    // Behavioural confirmation: the released ref is now foreign, the live one
    // is still controllable.
    expect((await scope.inspect(aLive.ref)).state).toBe('foreign');
    expect((await scope.inspect(bLive.ref)).controllable).toBe(true);
  });
});

// ----- win32 best-effort tier ---------------------------------------------

describe('win32 best-effort retention lifecycle', () => {
  it('releases a settled-terminal scope on the successor prepare, retains a live one', async () => {
    const seam = capsuleSeam({ controller: 'acknowledge' }, (index) => `win32-retain-scope-${index}`);
    let retained!: () => readonly ProcessRef[];
    const scope = createWin32BestEffortProcessScope({
      spawn: seam.spawn,
      resolve: seam.resolve,
      retentionProbe: (probe) => {
        retained = probe;
      },
    });

    const a = await scope.prepare(prepareInput());
    const aLive = await a.activate();
    const b = await scope.prepare(prepareInput());
    const bLive = await b.activate();

    const cancelled = await scope.terminate(aLive.ref, { reason: 'cancel', graceMs: 10 });
    expect(cancelled.state).toBe('declared-unproven');
    expect(retained()).toContain(aLive.ref);
    expect(retained()).toContain(bLive.ref);

    const c = await scope.prepare(prepareInput());
    expect(retained()).not.toContain(aLive.ref); // settled terminal released
    expect(retained()).toContain(bLive.ref); // live scope retained
    expect(retained()).toContain(c.ref);
  });

  it('retains a control-lost scope across the successor prepare (never a clean detach)', async () => {
    const seam = capsuleSeam(
      { controller: 'lose-transport-on-terminate' },
      (index) => `win32-lost-scope-${index}`
    );
    let retained!: () => readonly ProcessRef[];
    const scope = createWin32BestEffortProcessScope({
      spawn: seam.spawn,
      resolve: seam.resolve,
      retentionProbe: (probe) => {
        retained = probe;
      },
    });

    const a = await scope.prepare(prepareInput());
    const aLive = await a.activate();

    const receipt = await scope.terminate(aLive.ref, { reason: 'cancel', graceMs: 10 });
    // Transport loss is retained uncertainty, never a terminal - so the entry
    // carries no settled terminal and the sweep must not drop it.
    expect(receipt.state).toBe('uncertain');

    const b = await scope.prepare(prepareInput());
    expect(retained()).toContain(aLive.ref); // control-lost retained for reconciliation
    expect(retained()).toContain(b.ref);
    // Still reconcilable: reports retained uncertainty, not a terminal.
    expect((await scope.inspect(aLive.ref)).state).toBe('uncertain');
  });
});

// ----- exact tier (legacy `clients`) --------------------------------------
// This block exercises the byte-pinned native-process-scope.ts map. It requires
// the LEAD-authorized pin rebaseline of that file (native digest a070733c ->
// 3e74b2c2) to be in place.

describe('exact-tier legacy clients retention lifecycle', () => {
  it('releases a closed client on the successor prepare, retains a live one', async () => {
    const seam = capsuleSeam({ controller: 'acknowledge' }, (index) => `native-retain-scope-${index}`);
    let retained!: () => readonly ProcessRef[];
    const scope = createNativeProcessScope({
      spawn: seam.spawn,
      resolve: seam.resolve,
      retentionProbe: (probe) => {
        retained = probe;
      },
    });

    const a = await scope.prepare(prepareInput());
    const aLive = await a.activate();
    const b = await scope.prepare(prepareInput());
    const bLive = await b.activate();

    const receipt = await scope.terminate(aLive.ref, { reason: 'cancel', graceMs: 10 });
    expect(receipt.state).toBe('closed'); // exact SCOPE_EMPTY: a definite terminal
    expect(retained()).toContain(aLive.ref);
    expect(retained()).toContain(bLive.ref);

    const c = await scope.prepare(prepareInput());
    expect(retained()).not.toContain(aLive.ref); // closed client released
    expect(retained()).toContain(bLive.ref); // live client retained
    expect(retained()).toContain(c.ref);
  });

  it('retains a control-lost client across the successor prepare', async () => {
    const seam = capsuleSeam(
      { controller: 'lose-transport-on-terminate' },
      (index) => `native-lost-scope-${index}`
    );
    let retained!: () => readonly ProcessRef[];
    const scope = createNativeProcessScope({
      spawn: seam.spawn,
      resolve: seam.resolve,
      retentionProbe: (probe) => {
        retained = probe;
      },
    });

    const a = await scope.prepare(prepareInput());
    const aLive = await a.activate();

    const receipt = await scope.terminate(aLive.ref, { reason: 'cancel', graceMs: 10 });
    // Control loss leaves the client non-closed; the sweep must retain it.
    expect(receipt.state).toBe('uncertain');

    const b = await scope.prepare(prepareInput());
    expect(retained()).toContain(aLive.ref); // control-lost retained for reconciliation
    expect(retained()).toContain(b.ref);
  });
});
