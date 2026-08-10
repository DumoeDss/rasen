import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  applyArchive,
  applicableArchiveBlockers,
  createArchivePlan,
  defaultArchiveEngineAdapters,
  MERGE_TIMING_BLOCKER_MESSAGE,
  resolveArchiveSidecar,
  type ArchiveBlocker,
  type ArchivePlan,
} from '../../src/core/archive-engine.js';
import { Validator } from '../../src/core/validation/validator.js';
import { cleanupTempPathAsync } from '../helpers/temp-cleanup.js';

// ---------------------------------------------------------------------------
// B1 — apply-time merge confirmation (Blocker)
// ---------------------------------------------------------------------------

describe('B1: apply-time merge confirmation clears the timing gate', () => {
  let root: string;
  let active: string;
  let archiveParent: string;
  let ephemera: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'rasen-b1-'));
    active = path.join(root, 'rasen', 'changes', 'sample');
    archiveParent = path.join(root, 'rasen', 'changes', 'archive');
    ephemera = path.join(root, '.rasen', 'changes', 'sample', 'ephemera');
    await fs.mkdir(path.join(active, 'evidence'), { recursive: true });
    await fs.mkdir(ephemera, { recursive: true });
    await fs.writeFile(path.join(active, 'proposal.md'), '# Sample\n');
    await fs.writeFile(
      path.join(active, 'evidence', 'review-report.md'),
      '# Review\nFindings: 1\n'
    );
  });

  afterEach(async () => {
    await cleanupTempPathAsync(root);
  });

  async function makePlan(overrides?: {
    timingOverride?: boolean;
    shipLogContent?: string;
  }): Promise<ArchivePlan> {
    const sidecar = await resolveArchiveSidecar(active, root, 'sample');
    let shipLog: ArchivePlan['shipLog'] = {
      source: null,
      sha256: null,
      recordedCommit: null,
    };
    if (overrides?.shipLogContent !== undefined) {
      const shipLogPath = path.join(active, 'ship-log.md');
      await fs.writeFile(shipLogPath, overrides.shipLogContent);
      const crypto = await import('node:crypto');
      shipLog = {
        source: shipLogPath,
        sha256: crypto.createHash('sha256').update(overrides.shipLogContent).digest('hex'),
        recordedCommit: null,
      };
    }
    return createArchivePlan({
      change: 'sample',
      planningRoot: root,
      executionRoot: root,
      activePath: active,
      archiveParent,
      ephemeraPath: ephemera,
      date: '2026-08-10',
      keepEphemera: false,
      validation: 'passed',
      tasks: { total: 1, completed: 1, override: false },
      timing: {
        mode: 'on-merge',
        deliveryMode: 'pr',
        override: overrides?.timingOverride ?? false,
      },
      specActions: [],
      sidecar,
      shipLog,
      transactionId: '11111111-1111-4111-8111-111111111111',
      createdAt: '2026-08-10T00:00:00.000Z',
    });
  }

  it('a pr+on-merge plan saved without --yes is blocked without mergeConfirmed', async () => {
    const plan = await makePlan({ timingOverride: false });
    expect(plan.complete).toBe(false);
    expect(
      plan.blockers.some(b => b.operation === 'timing' && b.message === MERGE_TIMING_BLOCKER_MESSAGE)
    ).toBe(true);

    const result = await applyArchive(plan);
    expect(result.status).toBe('blocked');
  });

  it('the same plan applied with mergeConfirmed completes', async () => {
    const plan = await makePlan({ timingOverride: false });
    // Verify the timing blocker exists
    expect(plan.blockers.some(b => b.operation === 'timing')).toBe(true);

    const result = await applyArchive(plan, defaultArchiveEngineAdapters, {
      mergeConfirmed: true,
    });
    expect(result.status).toBe('complete');
  });

  it('the stored plan stays byte-identical (override stays false)', async () => {
    const plan = await makePlan({ timingOverride: false });
    const serializedBefore = JSON.stringify(plan);
    const result = await applyArchive(plan, defaultArchiveEngineAdapters, {
      mergeConfirmed: true,
    });
    expect(result.status).toBe('complete');
    // The plan object passed in is not mutated by applyArchive
    expect(JSON.stringify(plan)).toBe(serializedBefore);
    expect(plan.decisions.timing.override).toBe(false);
  });

  it('a non-merge plan is unaffected by mergeConfirmed', async () => {
    const sidecar = await resolveArchiveSidecar(active, root, 'sample');
    const plan = await createArchivePlan({
      change: 'sample',
      planningRoot: root,
      executionRoot: root,
      activePath: active,
      archiveParent,
      ephemeraPath: ephemera,
      date: '2026-08-10',
      keepEphemera: false,
      validation: 'passed',
      tasks: { total: 1, completed: 1, override: false },
      timing: { mode: 'in-ship', deliveryMode: 'local', override: false },
      specActions: [],
      sidecar,
      transactionId: '22222222-2222-4222-8222-222222222222',
      createdAt: '2026-08-10T00:00:00.000Z',
    });
    expect(plan.complete).toBe(true);
    const result = await applyArchive(plan);
    expect(result.status).toBe('complete');
  });

  // B1 mutation-discriminating test: disable the filter and assert the
  // observable flips.
  it('MUTATION TEST: without mergeConfirmed, apply stays blocked (guard discriminates)', async () => {
    const plan = await makePlan({ timingOverride: false });

    // WITH the guard (mergeConfirmed filters timing blocker)
    const withGuard = applicableArchiveBlockers(plan, { mergeConfirmed: true });
    expect(withGuard.length).toBe(0);

    // WITHOUT the guard (no mergeConfirmed — timing blocker remains)
    const withoutGuard = applicableArchiveBlockers(plan, { mergeConfirmed: false });
    expect(withoutGuard.some((b: ArchiveBlocker) => b.operation === 'timing')).toBe(true);

    // The observable flips: complete vs blocked
    const resultWithGuard = await applyArchive(plan, defaultArchiveEngineAdapters, {
      mergeConfirmed: true,
    });
    expect(resultWithGuard.status).toBe('complete');

    const resultWithoutGuard = await applyArchive(plan, defaultArchiveEngineAdapters, {
      mergeConfirmed: false,
    });
    expect(resultWithoutGuard.status).toBe('blocked');
  });
});

// ---------------------------------------------------------------------------
// B6 — plan-time reserved ship-log heading (Blocker)
// ---------------------------------------------------------------------------

describe('B6: plan-time reserved ship-log heading rejection', () => {
  let root: string;
  let active: string;
  let archiveParent: string;
  let ephemera: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'rasen-b6-'));
    active = path.join(root, 'rasen', 'changes', 'sample');
    archiveParent = path.join(root, 'rasen', 'changes', 'archive');
    ephemera = path.join(root, '.rasen', 'changes', 'sample', 'ephemera');
    await fs.mkdir(path.join(active, 'evidence'), { recursive: true });
    await fs.mkdir(ephemera, { recursive: true });
    await fs.writeFile(path.join(active, 'proposal.md'), '# Sample\n');
    await fs.writeFile(
      path.join(active, 'evidence', 'review-report.md'),
      '# Review\nFindings: 1\n'
    );
  });

  afterEach(async () => {
    await cleanupTempPathAsync(root);
  });

  async function makePlanWithShipLog(shipLogContent: string): Promise<ArchivePlan> {
    const sidecar = await resolveArchiveSidecar(active, root, 'sample');
    const shipLogPath = path.join(active, 'ship-log.md');
    await fs.writeFile(shipLogPath, shipLogContent);
    const crypto = await import('node:crypto');
    return createArchivePlan({
      change: 'sample',
      planningRoot: root,
      executionRoot: root,
      activePath: active,
      archiveParent,
      ephemeraPath: ephemera,
      date: '2026-08-10',
      keepEphemera: false,
      validation: 'passed',
      tasks: { total: 1, completed: 1, override: false },
      timing: { mode: 'in-ship', deliveryMode: 'local', override: false },
      specActions: [],
      sidecar,
      shipLog: {
        source: shipLogPath,
        sha256: crypto.createHash('sha256').update(shipLogContent).digest('hex'),
        recordedCommit: null,
      },
      transactionId: '33333333-3333-4333-8333-333333333333',
      createdAt: '2026-08-10T00:00:00.000Z',
    });
  }

  it('rejects a ship log with reserved ## Archive heading', async () => {
    const plan = await makePlanWithShipLog(
      '# Ship Log\n\n**Mode:** local\n\nSome content.\n\n## Archive\n\nPre-existing section.\n'
    );
    expect(plan.complete).toBe(false);
    expect(
      plan.blockers.some(
        b => b.operation === 'evidence' && b.message.includes('## Archive')
      )
    ).toBe(true);
  });

  it('a clean ship log proceeds without the reserved-heading blocker', async () => {
    const plan = await makePlanWithShipLog(
      '# Ship Log\n\n**Mode:** local\n\nClean content.\n'
    );
    expect(plan.complete).toBe(true);
    expect(
      plan.blockers.some(b => b.operation === 'evidence' && b.message.includes('## Archive'))
    ).toBe(false);
  });

  // B6 mutation-discriminating test: disable the plan-time blocker and assert
  // complete flips false→true.
  it('MUTATION TEST: reserved heading makes plan incomplete (guard discriminates)', async () => {
    const planWithHeading = await makePlanWithShipLog(
      '# Ship Log\n\n## Archive\n\nBad.\n'
    );
    const planClean = await makePlanWithShipLog('# Ship Log\n\nGood.\n');

    // WITH the guard: plan with heading is incomplete
    expect(planWithHeading.complete).toBe(false);
    expect(planWithHeading.blockers.some(b => b.operation === 'evidence')).toBe(true);

    // Clean plan is complete
    expect(planClean.complete).toBe(true);

    // The observable flips: if we remove the evidence blocker from
    // planWithHeading.blockers, complete computation would need to change too.
    // The discriminator: the evidence blocker is present vs absent.
    const headingBlockers = planWithHeading.blockers.filter(b => b.operation === 'evidence');
    const cleanBlockers = planClean.blockers.filter(b => b.operation === 'evidence');
    expect(headingBlockers.length).toBeGreaterThan(0);
    expect(cleanBlockers.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// B4 — strict-intent named constraints
// ---------------------------------------------------------------------------

describe('B4: strict-intent rejections name the offending constraint', () => {
  let root: string;
  let active: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'rasen-b4-'));
    active = path.join(root, 'rasen', 'changes', 'sample');
    await fs.mkdir(active, { recursive: true });
    await fs.writeFile(path.join(active, 'proposal.md'), '# Sample\n');
    // Create a handoff directory with one file so inventory is non-empty
    await fs.mkdir(path.join(active, 'handoff'), { recursive: true });
    await fs.writeFile(path.join(active, 'handoff', 'note.md'), '# Note\n');
  });

  afterEach(async () => {
    await cleanupTempPathAsync(root);
  });

  async function resolveWithIntent(
    intent: Record<string, unknown>
  ): Promise<ReturnType<typeof resolveArchiveSidecar>> {
    const intentPath = path.join(active, '.rasen-archive-input.json');
    await fs.writeFile(intentPath, JSON.stringify(intent));
    return resolveArchiveSidecar(active, root, 'sample');
  }

  it('names the unexpected key and lists accepted keys', async () => {
    const projection = await resolveWithIntent({
      schemaVersion: 1,
      change: 'sample',
      handoff: {
        complete: true,
        decisions: [{ path: 'handoff/note.md', outcome: 'preserved' }],
      },
      probes: [],
      unexpectedExtra: true,
    });
    const messages = projection.blockers.map(b => b.message).join('\n');
    expect(messages).toContain('"unexpectedExtra"');
    expect(messages).toContain('schemaVersion');
    expect(messages).toContain('change');
    expect(messages).toContain('handoff');
    expect(messages).toContain('probes');
  });

  it('names schemaVersion and the received value when wrong', async () => {
    const projection = await resolveWithIntent({
      schemaVersion: 2,
      change: 'sample',
      handoff: {
        complete: true,
        decisions: [{ path: 'handoff/note.md', outcome: 'preserved' }],
      },
      probes: [],
    });
    const messages = projection.blockers.map(b => b.message).join('\n');
    expect(messages).toContain('schemaVersion');
    expect(messages).toContain('2');
  });

  it('names change and the received value when mismatched', async () => {
    const projection = await resolveWithIntent({
      schemaVersion: 1,
      change: 'wrong-change',
      handoff: {
        complete: true,
        decisions: [{ path: 'handoff/note.md', outcome: 'preserved' }],
      },
      probes: [],
    });
    const messages = projection.blockers.map(b => b.message).join('\n');
    expect(messages).toContain('change');
    expect(messages).toContain('"wrong-change"');
    expect(messages).toContain('"sample"');
  });

  it('names incomplete handoff when handoff.complete is false', async () => {
    const projection = await resolveWithIntent({
      schemaVersion: 1,
      change: 'sample',
      handoff: {
        complete: false,
        decisions: [{ path: 'handoff/note.md', outcome: 'preserved' }],
      },
      probes: [],
    });
    const messages = projection.blockers.map(b => b.message).join('\n');
    expect(messages).toContain('handoff.complete');
    expect(messages).toContain('true');
    expect(messages).toContain('false');
  });

  it('does not use a single generic restatement identical across modes', async () => {
    const unexpectedKeyProj = await resolveWithIntent({
      schemaVersion: 1,
      change: 'sample',
      handoff: {
        complete: true,
        decisions: [{ path: 'handoff/note.md', outcome: 'preserved' }],
      },
      probes: [],
      extra: 1,
    });
    const wrongVersionProj = await resolveWithIntent({
      schemaVersion: 99,
      change: 'sample',
      handoff: {
        complete: true,
        decisions: [{ path: 'handoff/note.md', outcome: 'preserved' }],
      },
      probes: [],
    });
    const msgs1 = unexpectedKeyProj.blockers.map(b => b.message).sort().join('|');
    const msgs2 = wrongVersionProj.blockers.map(b => b.message).sort().join('|');
    // The two failure modes must produce at least one different message
    expect(msgs1).not.toBe(msgs2);
  });

  // --- Missing required field regression tests (Major-1) ---
  // Each test proves the missing-key guard catches the omission. Mutation
  // discriminator: if the missing-key check is removed, the field silently
  // passes and blockers.length drops to 0 for that field → test goes RED.

  it('rejects a missing schemaVersion key', async () => {
    const projection = await resolveWithIntent({
      change: 'sample',
      handoff: {
        complete: true,
        decisions: [{ path: 'handoff/note.md', outcome: 'preserved' }],
      },
      probes: [],
    });
    const messages = projection.blockers.map(b => b.message).join('\n');
    expect(messages).toContain('missing the "schemaVersion" key');
    // No wrong-value message should fire (the key is absent, not wrong)
    expect(messages).not.toContain('must be 1, but received');
  });

  it('rejects a missing change key', async () => {
    const projection = await resolveWithIntent({
      schemaVersion: 1,
      handoff: {
        complete: true,
        decisions: [{ path: 'handoff/note.md', outcome: 'preserved' }],
      },
      probes: [],
    });
    const messages = projection.blockers.map(b => b.message).join('\n');
    expect(messages).toContain('missing the "change" key');
    expect(messages).not.toContain('must be "sample", but received');
  });

  it('rejects a missing handoff.complete key', async () => {
    const projection = await resolveWithIntent({
      schemaVersion: 1,
      change: 'sample',
      handoff: {
        decisions: [{ path: 'handoff/note.md', outcome: 'preserved' }],
      },
      probes: [],
    });
    const messages = projection.blockers.map(b => b.message).join('\n');
    expect(messages).toContain('missing the "handoff.complete" key');
    expect(messages).not.toContain('must be true, but received');
  });
});

// ---------------------------------------------------------------------------
// B2/B3 — scenario preservation in validate
// ---------------------------------------------------------------------------

describe('B2/B3: scenario preservation in validate', () => {
  let root: string;
  let changesDir: string;
  let specsDir: string;
  let changeDir: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'rasen-b2-'));
    changesDir = path.join(root, 'rasen', 'changes');
    specsDir = path.join(root, 'rasen', 'specs');
    changeDir = path.join(changesDir, 'sample');
    const capabilityDir = path.join(changeDir, 'specs', 'my-cap');
    await fs.mkdir(capabilityDir, { recursive: true });

    // Create main spec with two requirements, each with scenarios
    const mainSpecDir = path.join(specsDir, 'my-cap');
    await fs.mkdir(mainSpecDir, { recursive: true });
    await fs.writeFile(
      path.join(mainSpecDir, 'spec.md'),
      [
        '# My Capability',
        '',
        '## Purpose',
        'Test capability.',
        '',
        '## Requirements',
        '',
        '### Requirement: First requirement',
        'The system SHALL do something.',
        '',
        '#### Scenario: Alpha',
        '- **WHEN** alpha',
        '- **THEN** result',
        '',
        '#### Scenario: Beta',
        '- **WHEN** beta',
        '- **THEN** result',
        '',
        '### Requirement: Second requirement',
        'The system SHALL do another thing.',
        '',
        '#### Scenario: Gamma',
        '- **WHEN** gamma',
        '- **THEN** result',
        '',
      ].join('\n')
    );
  });

  afterEach(async () => {
    await cleanupTempPathAsync(root);
  });

  it('validate --strict rejects a MODIFIED delta that drops scenarios', async () => {
    const deltaDir = path.join(changeDir, 'specs', 'my-cap');
    await fs.writeFile(
      path.join(deltaDir, 'spec.md'),
      [
        '## MODIFIED Requirements',
        '',
        '### Requirement: First requirement',
        'The system SHALL do something.',
        '',
        '#### Scenario: Alpha',
        '- **WHEN** alpha',
        '- **THEN** result',
        '',
      ].join('\n')
    );

    const validator = new Validator(true); // strict
    const report = await validator.validateChangeDeltaSpecs(changeDir, specsDir);
    expect(report.valid).toBe(false);
    const messages = report.issues.map(i => i.message).join('\n');
    expect(messages).toContain('"Beta"');
    expect(report.issues.some(i => i.level === 'ERROR')).toBe(true);
  });

  it('plain validate warns and preserves its exit code (WARNING only)', async () => {
    const deltaDir = path.join(changeDir, 'specs', 'my-cap');
    await fs.writeFile(
      path.join(deltaDir, 'spec.md'),
      [
        '## MODIFIED Requirements',
        '',
        '### Requirement: First requirement',
        'The system SHALL do something.',
        '',
        '#### Scenario: Alpha',
        '- **WHEN** alpha',
        '- **THEN** result',
        '',
      ].join('\n')
    );

    const validator = new Validator(false); // non-strict
    const report = await validator.validateChangeDeltaSpecs(changeDir, specsDir);
    // Non-strict: only ERRORs make it invalid; WARNINGs don't
    expect(report.valid).toBe(true);
    // But the warning should be present
    const warnings = report.issues.filter(i => i.level === 'WARNING');
    expect(warnings.some(w => w.message.includes('"Beta"'))).toBe(true);
  });

  it('reports ALL failing requirements in one pass (B3)', async () => {
    const deltaDir = path.join(changeDir, 'specs', 'my-cap');
    // Both requirements drop scenarios — no scenarios at all in the MODIFIED blocks
    await fs.writeFile(
      path.join(deltaDir, 'spec.md'),
      [
        '## MODIFIED Requirements',
        '',
        '### Requirement: First requirement',
        'The system SHALL do something updated.',
        '',
        '#### Scenario: Alpha',
        '- **WHEN** alpha',
        '- **THEN** result',
        '',
        '### Requirement: Second requirement',
        'The system SHALL do another updated thing.',
        '',
        '#### Scenario: Delta',
        '- **WHEN** delta',
        '- **THEN** result',
        '',
      ].join('\n')
    );

    const validator = new Validator(true); // strict
    const report = await validator.validateChangeDeltaSpecs(changeDir, specsDir);
    const messages = report.issues.map(i => i.message).join('\n');
    // First requirement drops "Beta"
    expect(messages).toContain('"Beta"');
    // Second requirement drops "Gamma"
    expect(messages).toContain('"Gamma"');
    // Both in a single report — not just the first
    const preservationIssues = report.issues.filter(
      i => i.message.includes('would drop scenario')
    );
    expect(preservationIssues.length).toBe(2);
  });

  it('a MODIFIED delta that preserves all scenarios passes', async () => {
    const deltaDir = path.join(changeDir, 'specs', 'my-cap');
    await fs.writeFile(
      path.join(deltaDir, 'spec.md'),
      [
        '## MODIFIED Requirements',
        '',
        '### Requirement: First requirement',
        'The system SHALL do something updated.',
        '',
        '#### Scenario: Alpha',
        '- **WHEN** alpha',
        '- **THEN** result',
        '',
        '#### Scenario: Beta',
        '- **WHEN** beta',
        '- **THEN** result',
        '',
      ].join('\n')
    );

    const validator = new Validator(true); // strict
    const report = await validator.validateChangeDeltaSpecs(changeDir, specsDir);
    // No scenarios dropped — should pass the preservation check
    const preservationIssues = report.issues.filter(
      i => i.message.includes('would drop scenario')
    );
    expect(preservationIssues.length).toBe(0);
  });
});
