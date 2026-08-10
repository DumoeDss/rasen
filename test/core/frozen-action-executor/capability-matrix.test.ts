import { describe, expect, it } from 'vitest';

import {
  BACKEND_DECLARATIONS,
  HOSTED_BEST_EFFORT_DECLARATION,
  IN_TOOL_DECLARATION,
  buildExecutionCapabilityMatrix,
  currentHostCells,
  queryCapabilityCell,
  resolveBackendSelection,
} from '../../../src/core/frozen-action-executor/capability-matrix.js';

describe('execution capability matrix - computation and content', () => {
  it('enumerates exactly six cells (3 OS x 2 backends) with no kernel-enforced tier', () => {
    const matrix = buildExecutionCapabilityMatrix({ hostPlatform: 'linux' });
    expect(Object.keys(matrix.cells).sort()).toEqual([
      'darwin:hosted',
      'darwin:in-tool',
      'linux:hosted',
      'linux:in-tool',
      'win32:hosted',
      'win32:in-tool',
    ]);
    // No cell advertises kernel-enforced authority.
    for (const cell of Object.values(matrix.cells)) {
      expect(cell.backend === 'kernel-enforced').toBe(false);
    }
    expect(BACKEND_DECLARATIONS.map((b) => b.id)).toEqual(['in-tool', 'hosted']);
  });

  it('hosted best-effort declares exactCancel:false and scopeEmptyProof:false on every OS', () => {
    for (const os of ['linux', 'darwin', 'win32'] as const) {
      const matrix = buildExecutionCapabilityMatrix({ hostPlatform: os });
      const cell = queryCapabilityCell(matrix, os, 'hosted');
      expect(cell?.declaration.exactCancel).toBe(false);
      expect(cell?.declaration.scopeEmptyProof).toBe(false);
      expect(cell?.declaration.durable).toBe(true);
      expect(cell?.declaration.headlessDriver).toBe(true);
      expect(cell?.declaration.continuableTurns).toBe(true);
      expect(cell?.declaration.cancelTerminalLabel).toBe('cancelled / emptiness-unproven');
    }
    expect(HOSTED_BEST_EFFORT_DECLARATION.exactCancel).toBe(false);
    expect(HOSTED_BEST_EFFORT_DECLARATION.scopeEmptyProof).toBe(false);
  });

  it('in-tool declares durable false, headless false, and makes no exact-termination claim', () => {
    for (const os of ['linux', 'darwin', 'win32'] as const) {
      const matrix = buildExecutionCapabilityMatrix({ hostPlatform: os });
      const cell = queryCapabilityCell(matrix, os, 'in-tool');
      expect(cell?.declaration.durable).toBe(false);
      expect(cell?.declaration.headlessDriver).toBe(false);
      expect(cell?.declaration.continuableTurns).toBe(false);
      // No exact-termination claim: the fields are absent, not false-as-claim.
      expect(cell?.declaration.exactCancel).toBeUndefined();
      expect(cell?.declaration.scopeEmptyProof).toBeUndefined();
    }
    expect(IN_TOOL_DECLARATION.durable).toBe(false);
    expect(IN_TOOL_DECLARATION.headlessDriver).toBe(false);
  });

  it('the matrix is queryable before any Run starts and is stable across calls', () => {
    const matrix = buildExecutionCapabilityMatrix({ hostPlatform: 'darwin' });
    // Queryable: every declared cell is retrievable without starting anything.
    for (const os of ['linux', 'darwin', 'win32'] as const) {
      for (const backend of ['in-tool', 'hosted'] as const) {
        expect(queryCapabilityCell(matrix, os, backend)).toBeDefined();
      }
    }
    // Stable: re-querying returns the same cell identity.
    const a = queryCapabilityCell(matrix, 'darwin', 'hosted');
    const b = queryCapabilityCell(matrix, 'darwin', 'hosted');
    expect(a).toBe(b);
  });

  it('matches the live declarations on each host (no hand-edited divergence)', () => {
    // The matrix is computed from the same frozen declarations the hosted tiers
    // persist; this guard fails if someone hand-edits a cell away from the
    // frozen literal.
    const matrix = buildExecutionCapabilityMatrix({ hostPlatform: 'win32' });
    const hosted = queryCapabilityCell(matrix, 'win32', 'hosted');
    expect(hosted?.declaration).toBe(HOSTED_BEST_EFFORT_DECLARATION);
    const inTool = queryCapabilityCell(matrix, 'win32', 'in-tool');
    expect(inTool?.declaration).toBe(IN_TOOL_DECLARATION);
  });
});

describe('execution capability matrix - live availability verdicts', () => {
  it('the current host cells for an available hosted tier are both available', () => {
    const matrix = buildExecutionCapabilityMatrix({
      hostPlatform: 'linux',
      hostedTierStatus: 'available',
    });
    const cells = currentHostCells(matrix);
    const verdicts = cells.map((c) => c.availability.kind);
    expect(verdicts).toContain('available');
    expect(verdicts.every((v) => v === 'available')).toBe(true);
  });

  it('a non-current-host cell is authority-unavailable (not-current-host)', () => {
    const matrix = buildExecutionCapabilityMatrix({ hostPlatform: 'linux' });
    const darwinHosted = queryCapabilityCell(matrix, 'darwin', 'hosted');
    expect(darwinHosted?.availability).toMatchObject({
      kind: 'authority-unavailable',
      reason: 'not-current-host',
    });
  });

  it('an undeclared platform has no hosted tier (unsupported-platform)', () => {
    const matrix = buildExecutionCapabilityMatrix({ hostPlatform: 'freebsd' });
    const hosted = queryCapabilityCell(matrix, 'freebsd', 'hosted');
    expect(hosted?.availability).toMatchObject({
      kind: 'authority-unavailable',
      reason: 'unsupported-platform',
    });
  });
});

describe('never-silently-reroute (authority-unavailable never becomes in-tool)', () => {
  it('a hosted request on a platform whose tier cannot serve it returns authority-unavailable', () => {
    const matrix = buildExecutionCapabilityMatrix({
      hostPlatform: 'linux',
      hostedTierStatus: 'unavailable',
    });
    const selection = resolveBackendSelection({ matrix, requested: 'hosted' });
    expect(selection.kind).toBe('authority-unavailable');
    if (selection.kind === 'authority-unavailable') {
      expect(selection.reason).toBe('hosted-tier-unavailable');
    }
  });

  it('never starts an in-tool backend in response to hosted unavailability', () => {
    // This is the never-reroute guard. Hosted is unavailable; the resolver MUST
    // NOT return a selected in-tool backend. There is no code path that does so.
    const matrix = buildExecutionCapabilityMatrix({
      hostPlatform: 'linux',
      hostedTierStatus: 'unavailable',
    });
    const selection = resolveBackendSelection({ matrix, requested: 'hosted' });
    expect(selection.kind).not.toBe('selected');
    if (selection.kind === 'selected') {
      expect(selection.backend).not.toBe('in-tool');
    }
  });

  it('hosted-unavailable on an undeclared platform is authority-unavailable, not in-tool', () => {
    const matrix = buildExecutionCapabilityMatrix({ hostPlatform: 'freebsd' });
    const selection = resolveBackendSelection({ matrix, requested: 'hosted' });
    expect(selection.kind).toBe('authority-unavailable');
  });

  it('an explicit hosted request on an available tier selects hosted', () => {
    const matrix = buildExecutionCapabilityMatrix({
      hostPlatform: 'linux',
      hostedTierStatus: 'available',
    });
    const selection = resolveBackendSelection({ matrix, requested: 'hosted' });
    expect(selection.kind).toBe('selected');
    if (selection.kind === 'selected') {
      expect(selection.backend).toBe('hosted');
      expect(selection.origin).toEqual({ kind: 'explicit-request', backend: 'hosted' });
    }
  });

  it('in-tool is selectable only by explicit request or an explicit pre-start default', () => {
    const matrix = buildExecutionCapabilityMatrix({ hostPlatform: 'linux' });
    const byRequest = resolveBackendSelection({ matrix, requested: 'in-tool' });
    expect(byRequest.kind).toBe('selected');
    if (byRequest.kind === 'selected') {
      expect(byRequest.origin).toEqual({ kind: 'explicit-request', backend: 'in-tool' });
    }
    const byDefault = resolveBackendSelection({ matrix, explicitDefault: 'in-tool' });
    expect(byDefault.kind).toBe('selected');
    if (byDefault.kind === 'selected') {
      expect(byDefault.origin).toEqual({ kind: 'explicit-default', backend: 'in-tool' });
    }
  });

  it('refuses to invent a backend when none is requested or defaulted', () => {
    const matrix = buildExecutionCapabilityMatrix({ hostPlatform: 'linux' });
    const selection = resolveBackendSelection({ matrix });
    expect(selection.kind).toBe('authority-unavailable');
  });

  it('refuses an uncontinuable consultation route without rerouting', () => {
    const matrix = buildExecutionCapabilityMatrix({ hostPlatform: 'linux' });
    const inTool = resolveBackendSelection({
      matrix,
      requested: 'in-tool',
      requiresContinuableTurns: true,
    });
    expect(inTool).toMatchObject({ kind: 'authority-unavailable' });
    if (inTool.kind === 'authority-unavailable') {
      expect(inTool.message).toContain('consultation-continuation-unavailable');
    }
    const hosted = resolveBackendSelection({
      matrix,
      requested: 'hosted',
      requiresContinuableTurns: true,
    });
    expect(hosted).toMatchObject({ kind: 'selected', backend: 'hosted' });
  });

  it('a platform with only in-tool declares the headless boundary (hosted unavailable)', () => {
    // On a platform where the hosted tier cannot be prepared, only in-tool is
    // available; the absence of a headless driver is a declared, pre-start-
    // visible boundary, not a defect.
    const matrix = buildExecutionCapabilityMatrix({
      hostPlatform: 'linux',
      hostedTierStatus: 'unavailable',
    });
    const hostedCell = queryCapabilityCell(matrix, 'linux', 'hosted');
    expect(hostedCell?.availability.kind).toBe('authority-unavailable');
    const inToolCell = queryCapabilityCell(matrix, 'linux', 'in-tool');
    expect(inToolCell?.availability.kind).toBe('available');
    expect(inToolCell?.declaration.headlessDriver).toBe(false);
  });
});
