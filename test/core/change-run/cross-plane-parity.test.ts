/**
 * Cross-plane parity matrix (task 15.1 of `ecp-run-spine`).
 *
 * ONE canonical fixture Record is asserted through three planes:
 *  (a) pure projection `projectRunView(record)` — the baseline
 *  (b) CLI `status` JSON output via PipelineCommand (test-injected runtime)
 *  (c) management detail JSON via `handleRunDetail` (filesystem store)
 *
 * The UI plane assertion lives in `packages/ui/test/components/`.
 *
 * Plane-specific transport wrappers may differ (CLI wraps in `{ runId, status,
 * view }`, mgmt wraps in `{ ok, view }`). The canonical view fields compared
 * are: `format`, `runId`, `change`, `engine`, `recordVersion`, `status`,
 * `sourceState`, top-level `workspace`, `drift`, and the complete ordered
 * `root-dag/1` section (frontier, activeInvocations, actions/effects, waits,
 * terminal, workspace revisions/effect diagnostics, allowedControls).
 *
 * This is NOT a kernel-only exercise: (b) crosses the real CLI command layer
 * (argument parsing → status → facade.inspect → printRunReceipt) and (c)
 * crosses the real management handler (filesystem store read → decode →
 * projectRunView). The fresh-process spawn E2E is task 15.3.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { projectRunView } from '../../../src/core/change-run/internal/projector.js';
import { createInMemoryRunStore } from '../../../src/core/change-run/internal/run-store.js';
import { createChangePipelineRuntime } from '../../../src/core/change-run/internal/facade-runtime.js';
import { PipelineCommand } from '../../../src/commands/pipeline.js';
import { handleRunDetail } from '../../../src/core/management-api/runs.js';
import {
  bugFixPlan,
  startRecord,
  succeedNode,
  awaitGate,
} from './reconciler-fixture.js';
import type { ChangeRunView, RootDagViewSection } from '../../../src/core/change-run/contracts.js';
import type { CanonicalRunRecord } from '../../../src/core/change-run/internal/record.js';
import type { RuntimePlan } from '../../../src/core/change-run/internal/runtime-plan.js';

// ---------------------------------------------------------------------------
// Canonical fixture: one Record, at a state that exercises every comparable
// field (committed actions, gate waits, allowed controls, workspace revision).
// ---------------------------------------------------------------------------

/**
 * Build the canonical parity Record:
 *  1. start → initial Record (running, no actions/waits)
 *  2. succeedNode(propose) → propose Gate awaited+decided(approve), action
 *     admitted(grant) → effect observed → result committed. Leaves one
 *     committed Action with effects and clears the propose wait.
 *  3. awaitGate(apply) → adds the apply Gate wait (decision controls).
 *
 * The resulting Record has: 1 committed action, 1 active gate wait, and
 * derived allowed controls (decision/escalate/cancel). This exercises every
 * comparable root-dag field.
 */
function buildCanonicalRecord(): { plan: RuntimePlan; record: CanonicalRunRecord } {
  const plan = bugFixPlan();
  let record = startRecord(plan);
  record = succeedNode(plan, record, 'root/propose');
  record = awaitGate(plan, record, 'root/apply');
  return { plan, record };
}

/**
 * Extract the canonical comparable fields from a ChangeRunView. These are the
 * exact fields design §15 mandates must be identical across planes.
 * Plane-specific wrappers are stripped before this extraction.
 */
function canonicalFields(view: ChangeRunView) {
  const root = view.sections.find(
    (s): s is RootDagViewSection => s.kind === 'root-dag'
  );
  if (!root) throw new Error('canonical: view has no root-dag section');
  return {
    format: view.format,
    runId: view.runId,
    change: view.change,
    engine: view.engine,
    recordVersion: view.recordVersion,
    status: view.status,
    sourceState: view.sourceState,
    workspace: view.workspace,
    drift: view.drift,
    // The complete ordered root-dag/1 section. Using toJSON-style comparison
    // so readonly arrays and branded strings compare by value.
    rootDag: {
      kind: root.kind,
      version: root.version,
      frontier: [...root.frontier],
      activeInvocations: root.activeInvocations.map((inv) => ({ ...inv })),
      actions: root.actions.map((a) => ({ ...a, effects: [...a.effects] })),
      waits: [...root.waits],
      ...(root.terminal ? { terminal: root.terminal } : {}),
      workspace: {
        current: root.workspace.current,
        expectedByActiveWriters: [...root.workspace.expectedByActiveWriters],
      },
      effectDiagnostics: [...root.effectDiagnostics],
      allowedControls: [...root.allowedControls],
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function captureLog(fn: () => Promise<void>): Promise<string> {
  let captured = '';
  const spy = vi.spyOn(console, 'log').mockImplementation((...args) => {
    captured += args.map((s) => String(s)).join(' ') + '\n';
  });
  try {
    await fn();
    return captured;
  } finally {
    spy.mockRestore();
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('cross-plane parity matrix (15.1)', () => {
  let xdgBackup: string | undefined;
  let rasenHomeBackup: string | undefined;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'rasen-parity-'));
    xdgBackup = process.env.XDG_DATA_HOME;
    rasenHomeBackup = process.env.RASEN_HOME;
    // Point the global data dir at the temp dir so handleRunDetail reads our
    // fixture record. RASEN_HOME must be blanked so XDG wins (same isolation
    // pattern as test/helpers/run-cli.ts).
    process.env.XDG_DATA_HOME = tempDir;
    process.env.RASEN_HOME = '';
  });

  afterEach(() => {
    if (xdgBackup === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = xdgBackup;
    if (rasenHomeBackup === undefined) delete process.env.RASEN_HOME;
    else process.env.RASEN_HOME = rasenHomeBackup;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('asserts identical canonical view fields across projector, CLI status, and management detail', async () => {
    const { plan, record } = buildCanonicalRecord();

    // --- (a) Pure projection: the baseline ---
    const projectedView = projectRunView(record);
    const expected = canonicalFields(projectedView);

    // Sanity: the canonical fixture exercises every comparable field.
    const projectedRoot = projectedView.sections.find(
      (s): s is RootDagViewSection => s.kind === 'root-dag'
    )!;
    expect(projectedRoot.actions.length).toBeGreaterThan(0);
    expect(projectedRoot.waits.length).toBeGreaterThan(0);
    expect(projectedRoot.allowedControls.length).toBeGreaterThan(0);
    expect(projectedRoot.frontier).toEqual([]);
    expect(projectedRoot.activeInvocations).toEqual([]);

    // --- (b) CLI status via PipelineCommand (test-injected runtime) ---
    // The injected runtime bypasses only the heavy root-selection + registry-
    // freeze chain. The status method still calls facade.inspect →
    // projectRunView(record), exactly as in production.
    const store = createInMemoryRunStore();
    store.create(plan.runId, record);
    const facade = createChangePipelineRuntime({
      store,
      plan,
      initialRecord: record,
      buildAction: () => {
        throw new Error('buildAction not called by inspect');
      },
    });
    const command = new PipelineCommand(async () => ({
      ctx: {
        facade,
        store,
        plan,
        initialRecord: store.load(plan.runId),
      },
      pipeline: { name: plan.pipeline } as never,
      runId: plan.runId as string,
      projectRoot: '/root',
      projectId: 'project-fixture',
      launchKey: 'parity-test',
    }));
    const cliOutput = await captureLog(() =>
      command.status('fixture-change', plan.pipeline, { json: true })
    );
    const cliJson = JSON.parse(cliOutput.trim());
    // CLI wraps the view in { runId, status, view }.
    expect(cliJson.runId).toBe(plan.runId);
    const cliView = cliJson.view as ChangeRunView;
    expect(canonicalFields(cliView)).toEqual(expected);

    // --- (c) Management detail via handleRunDetail (filesystem store) ---
    // Write the record to the temp filesystem store and read it back through
    // the management detail handler — the same path the HTTP server uses.
    const storeRoot = path.join(tempDir, 'rasen', 'runs');
    const dirName = (record.runId as string).replace(/[^a-z0-9]/gi, '_');
    const runDir = path.join(storeRoot, dirName);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      path.join(runDir, `record-v${record.recordVersion}.json`),
      JSON.stringify(record, null, 2)
    );
    // root=undefined → no workspace filter → scope stays "current" (the
    // canonical projection, not the other-worktree read-only view).
    const detail = await handleRunDetail(
      'fixture-change',
      record.runId as string,
      undefined,
      null
    );
    expect(detail.ok).toBe(true);
    if (!detail.ok) throw new Error('mgmt detail failed');
    // mgmt wraps the view in { ok, view }.
    expect(canonicalFields(detail.view)).toEqual(expected);
  });

  it('proves the canonical fixture has non-trivial root-dag content (guards against a degenerate matrix)', () => {
    const { record } = buildCanonicalRecord();
    const view = projectRunView(record);
    const root = view.sections.find(
      (s): s is RootDagViewSection => s.kind === 'root-dag'
    )!;

    // The fixture MUST have committed actions, active waits, and derived
    // controls — otherwise the parity matrix is comparing empty arrays
    // (trivially equal) and wouldn't catch a plane deriving these locally.
    expect(root.actions.length).toBe(1);
    expect(root.actions[0]!.kind).toBe('agent');
    // The propose action has been admitted + observed + committed, so its
    // delivery state is 'closed' (the terminal delivery state for a completed
    // action). What matters for parity is that all planes see the same state.
    expect(root.actions[0]!.deliveryState).toBe('closed');
    expect(root.actions[0]!.effects.length).toBeGreaterThan(0);

    expect(root.waits.length).toBe(1);
    expect(root.waits[0]!.kind).toBe('gate');

    // A gate wait produces decision controls; escalate+cancel are always added.
    const controlKinds = root.allowedControls.map((c) => c.kind).sort();
    expect(controlKinds).toContain('decision');
    expect(controlKinds).toContain('escalate');
    expect(controlKinds).toContain('cancel');

    // Drift is fully populated (not unavailable).
    expect(view.drift.definition).toBe('unchanged');
    expect(view.drift.capability).toBe('unchanged');
  });
});
