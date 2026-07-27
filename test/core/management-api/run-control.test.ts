/**
 * Tests for the POST run-control bridge (task 13.7 RED / 13.8 GREEN).
 *
 * These tests exercise the REAL bridge handler (`handleRunControl`) through
 * the injectable spawn seam. The fake spawner captures argv + stdin (for safe-
 * argv assertions) and returns a canned CLI receipt — the bridge's validation,
 * defer-sealing, response formatting, and zero-write behavior are all tested
 * without building dist or spawning the real binary. This is the real handler
 * surface, not a kernel substitute.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createHash } from 'node:crypto';

import {
  handleRunControl,
  type RunControlSpawner,
  type RunControlSpawnCall,
  type RunControlSpawnResult,
} from '../../../src/core/management-api/run-control.js';
import { createCanonicalRunRecord, digestCanonicalRunRecord } from '../../../src/core/change-run/internal/record.js';
import { reduceCanonicalRunRecord } from '../../../src/core/change-run/internal/reducer.js';
import { createCanonicalWait } from '../../../src/core/change-run/internal/waits.js';
import {
  derivePlanningSpaceId,
  deriveWorkspaceInstanceId,
  deriveNodeId,
  deriveInvocationId,
  deriveRunId,
  readPhysicalIdentity,
} from '../../../src/core/change-run/internal/identity.js';
import { canonicalJson } from '../../../src/core/change-run/internal/identity.js';
import type { CanonicalRunRecord } from '../../../src/core/change-run/internal/record.js';

// ---------------------------------------------------------------------------
// Branded-ID helper (kernel records use branded string types).
// ---------------------------------------------------------------------------

function branded<T>(v: string): T {
  return v as T;
}

const D = `sha256:${'a'.repeat(64)}`;
const D2 = `sha256:${'b'.repeat(64)}`;

// ---------------------------------------------------------------------------
// Test fixture: create a project root + a valid Record with a gate wait.
// ---------------------------------------------------------------------------

interface Fixture {
  projectRoot: string;
  storeRoot: string;
  changeId: string;
  runId: string;
  planningSpaceId: string;
  workspaceInstanceId: string;
  record: CanonicalRunRecord;
  gateWaitId: string;
  recordVersion: number;
  recordPath: string;
}

function makeWorkspaceRevision(digest: string) {
  return {
    format: 'workspace-revision/1' as const,
    head: { kind: 'commit' as const, digest, detached: false },
    treeDigest: digest,
    dirtyWorktreeDigest: digest,
  };
}

function setupFixture(baseTempDir: string): Fixture {
  const projectRoot = fs.mkdtempSync(path.join(baseTempDir, 'proj-'));
  fs.mkdirSync(path.join(projectRoot, 'rasen'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, 'rasen', 'config.yaml'), 'schema: spec-driven\n');

  // Derive the workspace identity from the REAL project root so the bridge's
  // workspace scope check matches.
  const planningSpaceHome = `project-${createHash('sha256')
    .update(projectRoot)
    .digest('hex')
    .slice(0, 12)}`;
  const planningSpaceId = derivePlanningSpaceId(planningSpaceHome) as string;
  const st = fs.statSync(projectRoot, { bigint: true });
  const physical = readPhysicalIdentity({
    device: st.dev,
    ino: st.ino,
    birthtimeMs: st.birthtimeMs,
  });
  const workspaceInstanceId = deriveWorkspaceInstanceId(planningSpaceId as never, physical) as string;

  const changeId = 'test-change';
  const runId = deriveRunId(planningSpaceId, branded(`change-instance:${'c'.repeat(64)}`), changeId, 'cli-start-test-change') as string;
  const nodeId = deriveNodeId(runId, 'root/apply');
  const invocationId = deriveInvocationId(runId, nodeId, 0);

  const wsRev = makeWorkspaceRevision(D);

  // Step 1: create v0 Record (status: 'running', no waits).
  let record = createCanonicalRunRecord({
    runId: branded(runId),
    runOrdinal: 1,
    change: {
      planningSpaceId: branded(planningSpaceId),
      projectId: 'test-project',
      changeId,
      instanceId: branded(`change-instance:${'c'.repeat(64)}`),
    },
    workspaceInstanceId: branded(workspaceInstanceId),
    pipeline: 'bug-fix',
    launchRequestDigest: branded(D),
    planDigest: branded(D),
    sourceRevisionDigest: branded(D),
    capabilityDigest: branded(D),
    policyDigest: branded(D),
    executionProfileDigest: branded(D),
    initialWorkspaceRevision: wsRev,
    inputs: {},
    limits: {
      maxAttempts: 12,
      maxActions: 64,
      maxRecordRevisions: 256,
      maxTransitions: 4096,
      maxEvidenceRefsPerAction: 16,
      limitOutcome: 'escalated',
    },
  });

  // Step 2: add a gate wait via the reducer → status: 'waiting', version 1.
  const gateWait = createCanonicalWait(branded(runId), {
    kind: 'gate',
    nodeId: branded(nodeId),
    invocationId: branded(invocationId),
    occurrence: 0,
    gateId: 'apply-gate',
    decisionIds: ['approve', 'reject'],
  });

  const awaitResult = reduceCanonicalRunRecord(record, {
    kind: 'await-gate',
    wait: gateWait,
  });
  if (!awaitResult.ok) throw new Error(`await-gate failed: ${awaitResult.failure.message}`);
  record = awaitResult.record;

  // Write the Record to the filesystem store. getGlobalDataDir() returns
  // <XDG_DATA_HOME>/rasen, so the store root is <XDG_DATA_HOME>/rasen/runs.
  const storeRoot = path.join(baseTempDir, 'rasen', 'runs');
  const dirName = runId.replace(/[^a-z0-9]/gi, '_');
  const runDir = path.join(storeRoot, dirName);
  fs.mkdirSync(runDir, { recursive: true });
  const recordPath = path.join(runDir, `record-v${record.recordVersion}.json`);
  fs.writeFileSync(recordPath, canonicalJson(record));

  return {
    projectRoot,
    storeRoot,
    changeId,
    runId,
    planningSpaceId,
    workspaceInstanceId,
    record,
    gateWaitId: gateWait.waitId,
    recordVersion: record.recordVersion,
    recordPath,
  };
}

/** Writes a Record to the store at its current version (overwrites head). */
function writeRecord(storeRoot: string, runId: string, record: CanonicalRunRecord): string {
  const dirName = runId.replace(/[^a-z0-9]/gi, '_');
  const runDir = path.join(storeRoot, dirName);
  fs.mkdirSync(runDir, { recursive: true });
  const recordPath = path.join(runDir, `record-v${record.recordVersion}.json`);
  fs.writeFileSync(recordPath, canonicalJson(record));
  return recordPath;
}

// ---------------------------------------------------------------------------
// Fake spawner.
// ---------------------------------------------------------------------------

interface FakeSpawner extends RunControlSpawner {
  calls: RunControlSpawnCall[];
}

function createFakeSpawner(
  respond: (call: RunControlSpawnCall) => RunControlSpawnResult | Promise<RunControlSpawnResult>
): FakeSpawner {
  const calls: RunControlSpawnCall[] = [];
  const spawner: RunControlSpawner = async (call) => {
    calls.push(call);
    return respond(call);
  };
  return Object.assign(spawner, { calls });
}

/** A canned success receipt the CLI `control --json` would emit. */
function successReceipt(runId: string): string {
  return JSON.stringify({ runId, disposition: 'advanced', status: 'waiting' });
}

/** Builds a valid control request body for a gate decision. */
function gateDecisionBody(fixture: Fixture, outcome = 'approve'): unknown {
  return {
    control: {
      format: 'change-run-control/1',
      ref: {
        change: { projectRoot: fixture.projectRoot, changeId: fixture.changeId },
        runId: fixture.runId,
      },
      expectedRecordVersion: fixture.recordVersion,
      command: {
        kind: 'decision',
        waitId: fixture.gateWaitId,
        decisionId: 'approve',
        outcome,
      },
    },
  };
}

/** Builds a valid control request body for a cancel. */
function cancelBody(fixture: Fixture): unknown {
  return {
    control: {
      format: 'change-run-control/1',
      ref: {
        change: { projectRoot: fixture.projectRoot, changeId: fixture.changeId },
        runId: fixture.runId,
      },
      expectedRecordVersion: fixture.recordVersion,
      command: {
        kind: 'cancel',
        reason: 'user cancelled',
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Tests.
// ---------------------------------------------------------------------------

describe('POST /api/v1/runs/<changeId>/<runId> control bridge (task 13.7/13.8)', () => {
  let baseTempDir: string;
  let originalEnv: NodeJS.ProcessEnv;
  let fixture: Fixture;

  beforeEach(() => {
    baseTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-run-control-'));
    originalEnv = { ...process.env };
    delete process.env.RASEN_HOME;
    process.env.XDG_CONFIG_HOME = baseTempDir;
    process.env.XDG_DATA_HOME = baseTempDir;
    fixture = setupFixture(baseTempDir);
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(baseTempDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Pre-spawn admission: validation rejects BEFORE any spawn.
  // -------------------------------------------------------------------------

  describe('pre-spawn admission', () => {
    it('rejects a non-object body with 400 and never spawns', async () => {
      const spawner = createFakeSpawner(() => ({ exitCode: 0, stdout: '', stderr: '', timedOut: false }));
      const result = await handleRunControl(
        fixture.changeId, fixture.runId, fixture.projectRoot, null,
        'not-an-object', spawner
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(400);
        expect(result.code).toBe('bad_request');
      }
      expect(spawner.calls.length).toBe(0);
    });

    it('rejects a body missing the control field with 400 and never spawns', async () => {
      const spawner = createFakeSpawner(() => ({ exitCode: 0, stdout: '', stderr: '', timedOut: false }));
      const result = await handleRunControl(
        fixture.changeId, fixture.runId, fixture.projectRoot, null,
        { uploads: [] }, spawner
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.status).toBe(400);
      expect(spawner.calls.length).toBe(0);
    });

    it('rejects a malformed control request (smuggled deliveryMode) with 400', async () => {
      const spawner = createFakeSpawner(() => ({ exitCode: 0, stdout: '', stderr: '', timedOut: false }));
      const body = {
        control: {
          format: 'change-run-control/1',
          ref: {
            change: { projectRoot: fixture.projectRoot, changeId: fixture.changeId },
            runId: fixture.runId,
          },
          expectedRecordVersion: fixture.recordVersion,
          command: { kind: 'cancel' },
          // Strict schema must reject this unknown field.
          deliveryMode: 'grant',
        },
      };
      const result = await handleRunControl(
        fixture.changeId, fixture.runId, fixture.projectRoot, null,
        body, spawner
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(400);
        expect(result.code).toBe('invalid_control');
      }
      expect(spawner.calls.length).toBe(0);
    });

    it('rejects a body whose ref.changeId does not match the path', async () => {
      const spawner = createFakeSpawner(() => ({ exitCode: 0, stdout: '', stderr: '', timedOut: false }));
      const body = {
        control: {
          format: 'change-run-control/1',
          ref: {
            change: { projectRoot: fixture.projectRoot, changeId: 'wrong-change' },
            runId: fixture.runId,
          },
          expectedRecordVersion: fixture.recordVersion,
          command: { kind: 'cancel' },
        },
      };
      const result = await handleRunControl(
        fixture.changeId, fixture.runId, fixture.projectRoot, null,
        body, spawner
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(400);
        expect(result.code).toBe('run_ref_mismatch');
      }
      expect(spawner.calls.length).toBe(0);
    });

    it('rejects a body whose ref.runId does not match the path', async () => {
      const spawner = createFakeSpawner(() => ({ exitCode: 0, stdout: '', stderr: '', timedOut: false }));
      // Use a valid RunId format (run:<64hex>) that is different from the path's runId.
      const otherValidRunId = `run:${'0'.repeat(64)}`;
      const body = {
        control: {
          format: 'change-run-control/1',
          ref: {
            change: { projectRoot: fixture.projectRoot, changeId: fixture.changeId },
            runId: otherValidRunId,
          },
          expectedRecordVersion: fixture.recordVersion,
          command: { kind: 'cancel' },
        },
      };
      const result = await handleRunControl(
        fixture.changeId, fixture.runId, fixture.projectRoot, null,
        body, spawner
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(400);
        expect(result.code).toBe('run_ref_mismatch');
      }
    });

    it('rejects an unknown runId with 404 run_not_found', async () => {
      const spawner = createFakeSpawner(() => ({ exitCode: 0, stdout: '', stderr: '', timedOut: false }));
      // Use a valid RunId format that doesn't exist in the store.
      const unknownRunId = `run:${'f'.repeat(64)}`;
      const body = {
        control: {
          format: 'change-run-control/1',
          ref: {
            change: { projectRoot: fixture.projectRoot, changeId: fixture.changeId },
            runId: unknownRunId,
          },
          expectedRecordVersion: fixture.recordVersion,
          command: { kind: 'cancel' },
        },
      };
      const result = await handleRunControl(
        fixture.changeId, unknownRunId, fixture.projectRoot, null,
        body, spawner
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(404);
        expect(result.code).toBe('run_not_found');
      }
      expect(spawner.calls.length).toBe(0);
    });

    it('rejects a stale expectedRecordVersion with 409 record_version_conflict', async () => {
      const spawner = createFakeSpawner(() => ({ exitCode: 0, stdout: '', stderr: '', timedOut: false }));
      const body = {
        control: {
          format: 'change-run-control/1',
          ref: {
            change: { projectRoot: fixture.projectRoot, changeId: fixture.changeId },
            runId: fixture.runId,
          },
          expectedRecordVersion: fixture.recordVersion + 99,
          command: { kind: 'cancel' },
        },
      };
      const result = await handleRunControl(
        fixture.changeId, fixture.runId, fixture.projectRoot, null,
        body, spawner
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(409);
        expect(result.code).toBe('record_version_conflict');
      }
      expect(spawner.calls.length).toBe(0);
    });

    it('rejects a workspace mismatch with 403 workspace_scope_mismatch', async () => {
      // Create a second project root that derives a different workspaceInstanceId.
      const otherRoot = fs.mkdtempSync(path.join(baseTempDir, 'other-'));
      const spawner = createFakeSpawner(() => ({ exitCode: 0, stdout: '', stderr: '', timedOut: false }));
      const body = cancelBody(fixture);
      const result = await handleRunControl(
        fixture.changeId, fixture.runId, otherRoot, null,
        body, spawner
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(403);
        expect(result.code).toBe('workspace_scope_mismatch');
      }
      expect(spawner.calls.length).toBe(0);
    });

    it('rejects a terminal Run with 409 run_terminal', async () => {
      // Cancel the Run via the reducer to make it terminal.
      const cancelResult = reduceCanonicalRunRecord(fixture.record, {
        kind: 'cancel',
        reason: 'done',
      });
      if (!cancelResult.ok) throw new Error('cancel failed');
      writeRecord(fixture.storeRoot, fixture.runId, cancelResult.record);

      const spawner = createFakeSpawner(() => ({ exitCode: 0, stdout: '', stderr: '', timedOut: false }));
      // Update the body's expectedRecordVersion to the terminal record's version.
      const body = {
        control: {
          format: 'change-run-control/1',
          ref: {
            change: { projectRoot: fixture.projectRoot, changeId: fixture.changeId },
            runId: fixture.runId,
          },
          expectedRecordVersion: cancelResult.record.recordVersion,
          command: { kind: 'cancel' },
        },
      };
      const result = await handleRunControl(
        fixture.changeId, fixture.runId, fixture.projectRoot, null,
        body, spawner
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(409);
        expect(result.code).toBe('run_terminal');
      }
      expect(spawner.calls.length).toBe(0);
    });

    it('rejects with 400 no_project when no root is provided', async () => {
      const spawner = createFakeSpawner(() => ({ exitCode: 0, stdout: '', stderr: '', timedOut: false }));
      const body = cancelBody(fixture);
      const result = await handleRunControl(
        fixture.changeId, fixture.runId, undefined, null,
        body, spawner
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(400);
        expect(result.code).toBe('no_project');
      }
      expect(spawner.calls.length).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Safe argv: no injection into the spawned CLI.
  // -------------------------------------------------------------------------

  describe('safe argv', () => {
    it('constructs structured argv with shell:false-compatible tokens', async () => {
      const spawner = createFakeSpawner(() => ({
        exitCode: 0,
        stdout: successReceipt(fixture.runId),
        stderr: '',
        timedOut: false,
      }));
      await handleRunControl(
        fixture.changeId, fixture.runId, fixture.projectRoot, null,
        cancelBody(fixture), spawner
      );
      expect(spawner.calls.length).toBe(1);
      const call = spawner.calls[0]!;

      // argv must be an array of discrete tokens — no shell concatenation.
      expect(Array.isArray(call.argv)).toBe(true);

      // The changeId and runId are discrete argv elements, never interpolated
      // into a single shell string.
      expect(call.argv).toContain(fixture.changeId);
      expect(call.argv).toContain(fixture.runId);
      expect(call.argv).toContain('--from');
      expect(call.argv).toContain('-');
      expect(call.argv).toContain('--json');
      expect(call.argv).toContain('pipeline');
      expect(call.argv).toContain('control');

      // No shell metacharacters in any argv token.
      const shellMetachars = /[;|&`$(){}<>!\\]/;
      for (const arg of call.argv) {
        // changeId/runId are kebab-case/hex IDs — they must never contain
        // shell metacharacters that could break out of an argv token.
        if (arg === call.argv[0]) continue; // cli entry path may contain backslashes on Windows
        expect(shellMetachars.test(arg), `argv token contains shell metachar: ${arg}`).toBe(false);
      }
    });

    it('pipes the body via stdin, never as an argv token', async () => {
      const spawner = createFakeSpawner(() => ({
        exitCode: 0,
        stdout: successReceipt(fixture.runId),
        stderr: '',
        timedOut: false,
      }));
      const body = cancelBody(fixture);
      await handleRunControl(
        fixture.changeId, fixture.runId, fixture.projectRoot, null,
        body, spawner
      );
      expect(spawner.calls.length).toBe(1);
      const call = spawner.calls[0]!;
      // The body travels via stdin, NOT argv.
      expect(call.stdin).toBe(JSON.stringify(body));
      // No argv token should contain the serialized body.
      for (const arg of call.argv) {
        expect(arg).not.toContain('"kind":"cancel"');
      }
    });
  });

  // -------------------------------------------------------------------------
  // Sealed defer: response always has empty actions.
  // -------------------------------------------------------------------------

  describe('sealed defer mode', () => {
    it('returns a response with an EMPTY action list (no executable grant)', async () => {
      const spawner = createFakeSpawner(() => ({
        exitCode: 0,
        stdout: successReceipt(fixture.runId),
        stderr: '',
        timedOut: false,
      }));
      const result = await handleRunControl(
        fixture.changeId, fixture.runId, fixture.projectRoot, null,
        gateDecisionBody(fixture), spawner
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // The receipt actions are sealed to empty — no granted actions leave
      // via HTTP. A subsequent trusted CLI resume performs the first grant.
      expect(result.response.actions).toEqual([]);
    });

    it('the request body cannot override deliveryMode (strict schema rejects the field)', async () => {
      const spawner = createFakeSpawner(() => ({
        exitCode: 0,
        stdout: successReceipt(fixture.runId),
        stderr: '',
        timedOut: false,
      }));
      const body = {
        control: {
          format: 'change-run-control/1',
          ref: {
            change: { projectRoot: fixture.projectRoot, changeId: fixture.changeId },
            runId: fixture.runId,
          },
          expectedRecordVersion: fixture.recordVersion,
          command: { kind: 'cancel' },
          deliveryMode: 'grant', // attempt to override — must be rejected
        },
      };
      const result = await handleRunControl(
        fixture.changeId, fixture.runId, fixture.projectRoot, null,
        body, spawner
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('invalid_control');
      }
      expect(spawner.calls.length).toBe(0);
    });

    it('returns the committed view with no executable payload in action entries', async () => {
      // Write a Record that has an admitted_undelivered action so the view
      // includes it — verifying the action view has identity but no
      // agent/command/host execution payload.
      const admitResult = reduceCanonicalRunRecord(fixture.record, {
        kind: 'decide-gate',
        waitId: branded(fixture.gateWaitId),
        decisionId: 'approve',
        outcome: 'approve',
      });
      if (!admitResult.ok) throw new Error(`decide-gate failed: ${admitResult.failure.message}`);
      writeRecord(fixture.storeRoot, fixture.runId, admitResult.record);

      // Update the body version to match the new record.
      const body = {
        control: {
          format: 'change-run-control/1',
          ref: {
            change: { projectRoot: fixture.projectRoot, changeId: fixture.changeId },
            runId: fixture.runId,
          },
          expectedRecordVersion: admitResult.record.recordVersion,
          command: { kind: 'cancel' },
        },
      };

      const spawner = createFakeSpawner(() => ({
        exitCode: 0,
        stdout: JSON.stringify({ runId: fixture.runId, disposition: 'advanced', status: 'running' }),
        stderr: '',
        timedOut: false,
      }));
      const result = await handleRunControl(
        fixture.changeId, fixture.runId, fixture.projectRoot, null,
        body, spawner
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // The view's root-dag section may contain action entries, but they must
      // only carry identity/digest fields — never executable payloads.
      const rootSection = result.response.view.sections.find(
        (s): s is Extract<typeof s, { kind: 'root-dag' }> => s.kind === 'root-dag'
      );
      expect(rootSection).toBeDefined();
      if (rootSection && rootSection.kind === 'root-dag') {
        for (const action of rootSection.actions) {
          // Action views have kind/deliveryState/capability — but no agent
          // dispatch instructions, command strings, or host endpoints.
          expect(action.format).toBe('change-run-action-view/1');
          expect(['admitted_undelivered', 'granted', 'closed']).toContain(action.deliveryState);
          // No executable instruction fields:
          expect(action).not.toHaveProperty('prompt');
          expect(action).not.toHaveProperty('command');
          expect(action).not.toHaveProperty('endpoint');
          expect(action).not.toHaveProperty('host');
        }
      }
    });
  });

  // -------------------------------------------------------------------------
  // Browser response loss / replay.
  // -------------------------------------------------------------------------

  describe('browser response loss / replay', () => {
    it('replaying the same request returns the same committed view with empty actions', async () => {
      const spawner = createFakeSpawner(() => ({
        exitCode: 0,
        stdout: successReceipt(fixture.runId),
        stderr: '',
        timedOut: false,
      }));
      const body = cancelBody(fixture);

      // First call (browser "loses" the response).
      const result1 = await handleRunControl(
        fixture.changeId, fixture.runId, fixture.projectRoot, null,
        body, spawner
      );
      expect(result1.ok).toBe(true);

      // Replay (browser retries the same request).
      const result2 = await handleRunControl(
        fixture.changeId, fixture.runId, fixture.projectRoot, null,
        body, spawner
      );

      // Both calls return the same committed view (the fake spawner didn't
      // modify the Record, so the view is identical). Both have empty actions.
      if (result1.ok && result2.ok) {
        expect(result2.response.actions).toEqual([]);
        expect(result2.response.view.recordVersion).toBe(result1.response.view.recordVersion);
        expect(result2.response.view.status).toBe(result1.response.view.status);
      }
    });

    it('a replay after the Record advanced rejects with record_version_conflict', async () => {
      // Simulate: first POST applied a control (Record advanced via decide-gate,
      // which keeps the Run non-terminal). The browser lost the response and
      // retries with the OLD expectedRecordVersion.
      const advancedResult = reduceCanonicalRunRecord(fixture.record, {
        kind: 'decide-gate',
        waitId: branded(fixture.gateWaitId),
        decisionId: 'approve',
        outcome: 'approve',
      });
      if (!advancedResult.ok) throw new Error('decide-gate failed');
      writeRecord(fixture.storeRoot, fixture.runId, advancedResult.record);

      const spawner = createFakeSpawner(() => ({
        exitCode: 0,
        stdout: successReceipt(fixture.runId),
        stderr: '',
        timedOut: false,
      }));
      // The body still has the OLD expectedRecordVersion.
      const result = await handleRunControl(
        fixture.changeId, fixture.runId, fixture.projectRoot, null,
        cancelBody(fixture), spawner
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(409);
        expect(result.code).toBe('record_version_conflict');
      }
      expect(spawner.calls.length).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // CLI spawn behavior: output validation, timeout, exit handling.
  // -------------------------------------------------------------------------

  describe('CLI output validation', () => {
    it('rejects non-JSON CLI output with 500 cli_protocol_error', async () => {
      const spawner = createFakeSpawner(() => ({
        exitCode: 0,
        stdout: 'this is not JSON',
        stderr: '',
        timedOut: false,
      }));
      const result = await handleRunControl(
        fixture.changeId, fixture.runId, fixture.projectRoot, null,
        cancelBody(fixture), spawner
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(500);
        expect(result.code).toBe('cli_protocol_error');
      }
    });

    it('rejects JSON missing required receipt fields with 500 cli_protocol_error', async () => {
      const spawner = createFakeSpawner(() => ({
        exitCode: 0,
        stdout: JSON.stringify({ foo: 'bar' }),
        stderr: '',
        timedOut: false,
      }));
      const result = await handleRunControl(
        fixture.changeId, fixture.runId, fixture.projectRoot, null,
        cancelBody(fixture), spawner
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('cli_protocol_error');
    });

    it('rejects empty stdout with 500 cli_protocol_error', async () => {
      const spawner = createFakeSpawner(() => ({
        exitCode: 0,
        stdout: '',
        stderr: '',
        timedOut: false,
      }));
      const result = await handleRunControl(
        fixture.changeId, fixture.runId, fixture.projectRoot, null,
        cancelBody(fixture), spawner
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('cli_protocol_error');
    });
  });

  describe('spawn timeout / exit handling', () => {
    it('returns 504 cli_timeout when the subprocess times out', async () => {
      const spawner = createFakeSpawner(() => ({
        exitCode: null,
        stdout: '',
        stderr: '',
        timedOut: true,
      }));
      const result = await handleRunControl(
        fixture.changeId, fixture.runId, fixture.projectRoot, null,
        cancelBody(fixture), spawner
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(504);
        expect(result.code).toBe('cli_timeout');
      }
    });

    it('passes through a non-zero CLI exit as 422 cli_error with exit code and stderr', async () => {
      const spawner = createFakeSpawner(() => ({
        exitCode: 1,
        stdout: '',
        stderr: 'Error: wait not found',
        timedOut: false,
      }));
      const result = await handleRunControl(
        fixture.changeId, fixture.runId, fixture.projectRoot, null,
        cancelBody(fixture), spawner
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(422);
        expect(result.code).toBe('cli_error');
        expect(result.cliExitCode).toBe(1);
        expect(result.stderr).toContain('wait not found');
      }
    });
  });

  // -------------------------------------------------------------------------
  // Zero in-process Record-file writes.
  // -------------------------------------------------------------------------

  describe('zero in-process Record-file writes', () => {
    it('the bridge never modifies the Record file (only reads)', async () => {
      const beforeMtime = fs.statSync(fixture.recordPath).mtimeMs;
      const beforeContent = fs.readFileSync(fixture.recordPath, 'utf-8');

      const spawner = createFakeSpawner(() => ({
        exitCode: 0,
        stdout: successReceipt(fixture.runId),
        stderr: '',
        timedOut: false,
      }));
      await handleRunControl(
        fixture.changeId, fixture.runId, fixture.projectRoot, null,
        cancelBody(fixture), spawner
      );

      // The fake spawner did NOT write anything (it just returned a canned
      // result). The bridge must not have written either — the Record file
      // is byte-identical with the same mtime.
      const afterContent = fs.readFileSync(fixture.recordPath, 'utf-8');
      const afterMtime = fs.statSync(fixture.recordPath).mtimeMs;
      expect(afterContent).toBe(beforeContent);
      // mtime should be unchanged (no write occurred).
      expect(afterMtime).toBe(beforeMtime);
    });

    it('the bridge creates no new Record files (no record-v<N+1>.json)', async () => {
      const spawner = createFakeSpawner(() => ({
        exitCode: 0,
        stdout: successReceipt(fixture.runId),
        stderr: '',
        timedOut: false,
      }));
      await handleRunControl(
        fixture.changeId, fixture.runId, fixture.projectRoot, null,
        cancelBody(fixture), spawner
      );

      const runDir = path.dirname(fixture.recordPath);
      const files = fs.readdirSync(runDir).filter((f) => /^record-v\d+\.json$/.test(f));
      // Only the original record file should exist — no new versions written.
      expect(files.length).toBe(1);
      expect(files[0]).toBe(path.basename(fixture.recordPath));
    });
  });

  // -------------------------------------------------------------------------
  // Closed control + expected version + WaitId.
  // -------------------------------------------------------------------------

  describe('closed control contract', () => {
    it('accepts a gate decision with the correct version and WaitId', async () => {
      const spawner = createFakeSpawner((call) => {
        // Verify the body piped via stdin carries the correct WaitId.
        const parsed = JSON.parse(call.stdin) as { control: { command: { waitId: string } } };
        expect(parsed.control.command.waitId).toBe(fixture.gateWaitId);
        return {
          exitCode: 0,
          stdout: successReceipt(fixture.runId),
          stderr: '',
          timedOut: false,
        };
      });
      const result = await handleRunControl(
        fixture.changeId, fixture.runId, fixture.projectRoot, null,
        gateDecisionBody(fixture), spawner
      );
      expect(result.ok).toBe(true);
      expect(spawner.calls.length).toBe(1);
    });

    it('accepts a cancel control (no WaitId required)', async () => {
      const spawner = createFakeSpawner(() => ({
        exitCode: 0,
        stdout: successReceipt(fixture.runId),
        stderr: '',
        timedOut: false,
      }));
      const result = await handleRunControl(
        fixture.changeId, fixture.runId, fixture.projectRoot, null,
        cancelBody(fixture), spawner
      );
      expect(result.ok).toBe(true);
    });

    it('the response disposition comes from the CLI receipt', async () => {
      const spawner = createFakeSpawner(() => ({
        exitCode: 0,
        stdout: JSON.stringify({ runId: fixture.runId, disposition: 'terminal', status: 'cancelled' }),
        stderr: '',
        timedOut: false,
      }));
      const result = await handleRunControl(
        fixture.changeId, fixture.runId, fixture.projectRoot, null,
        cancelBody(fixture), spawner
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.response.disposition).toBe('terminal');
    });
  });

  // -------------------------------------------------------------------------
  // Wrong / stale wait — the CLI rejects it, bridge returns cli_error.
  // -------------------------------------------------------------------------

  describe('wrong / stale wait rejection', () => {
    it('passes a wrong WaitId to the CLI and returns its error (no pre-spawn wait validation)', async () => {
      // The bridge does NOT pre-validate the waitId against active waits —
      // that's the CLI/facade's job. The body carries a stale waitId; the CLI
      // rejects it; the bridge passes the error through.
      const body = {
        control: {
          format: 'change-run-control/1',
          ref: {
            change: { projectRoot: fixture.projectRoot, changeId: fixture.changeId },
            runId: fixture.runId,
          },
          expectedRecordVersion: fixture.recordVersion,
          command: {
            kind: 'resume',
            waitId: `wait:${'e'.repeat(64)}`,
          },
        },
      };
      const spawner = createFakeSpawner(() => ({
        exitCode: 1,
        stdout: '',
        stderr: 'Error: wait wait:deadbeef is not active',
        timedOut: false,
      }));
      const result = await handleRunControl(
        fixture.changeId, fixture.runId, fixture.projectRoot, null,
        body, spawner
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(422);
        expect(result.code).toBe('cli_error');
        expect(result.message).toContain('not active');
      }
    });
  });
});
