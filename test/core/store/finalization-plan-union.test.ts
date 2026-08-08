/**
 * `store-finalization-outcomes-v2` tasks 1.4 and 6.2 — the plan union is
 * structurally landed-only for spec actions.
 *
 * The invariant is that a passive plan has NOTHING to populate, so "did we
 * remember to skip spec synchronization?" is not a question any call site can
 * get wrong. That is a type-system property, and `tsc --noEmit` deliberately
 * excludes `test/` — so the proof itself lives in `src/` as two compile-time
 * constants, and this suite reads them.
 *
 * READ THIS BEFORE TRUSTING THE FIRST TWO CASES. `expect(CONSTANT).toBe(false)`
 * proves almost nothing on its own: the constant is a literal in the source, so
 * the assertion passes whatever the declared type resolves to. The load-bearing
 * gate is `tsc`, and an earlier spelling of it did NOT hold — a bare
 * conditional type DISTRIBUTES, so one passive member gaining `specActions`
 * made the alias `boolean`, and `const X: boolean = false` compiled clean. The
 * repair is `ExactlyFalse<…>`, which widens to `never` instead of to `boolean`.
 * Both directions were mutation-verified against this repository's own
 * compiler: `superseded` gaining the field and `landed` losing it each produce
 * `TS2322 … is not assignable to type 'never'`. The third case below pins that
 * spelling in the source, because the runtime assertions cannot.
 *
 * This also closes what a purely textual count could not see: a member widened
 * by intersecting an extracted `{ specActions: … }` interface keeps the
 * union-slice count at 1, but it still carries the field structurally, so the
 * type-level constant catches it.
 *
 * The second half is the call-site guard: exactly one place in the Module may
 * hand spec actions to the engine, asserted against the source rather than
 * against a comment claiming it.
 */
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  LANDED_PLAN_CARRIES_SPEC_ACTIONS,
  PASSIVE_PLAN_CARRIES_SPEC_ACTIONS,
} from '../../../src/core/store/finalization/types.js';

const MODULE_DIR = path.join(
  fileURLToPath(new URL('../../../src/core/store/finalization/', import.meta.url))
);

function source(file: string): string {
  return readFileSync(path.join(MODULE_DIR, file), 'utf8');
}

describe('the plan union carries spec actions only on the landed variant', () => {
  it('proves no passive variant is assignable to a shape carrying specActions', () => {
    expect(PASSIVE_PLAN_CARRIES_SPEC_ACTIONS).toBe(false);
  });

  it('proves the landed variant is the one that does carry them', () => {
    expect(LANDED_PLAN_CARRIES_SPEC_ACTIONS).toBe(true);
  });

  /**
   * The two cases above read literals and would pass under the broken spelling
   * too. This one pins the spelling that makes `tsc` the gate: the declared
   * types must widen to `never`, not to `boolean`. Reverting `ExactlyFalse` /
   * `ExactlyTrue` to a bare `CarriesSpecActions<…>` fails here immediately,
   * rather than silently at the next union edit.
   */
  it('declares both constants through the widening wrapper, not the bare conditional', () => {
    const types = source('types.ts');
    expect(types).toContain(
      'type IsExactly<T, U> = [T] extends [U] ? ([U] extends [T] ? true : false) : false;'
    );
    expect(types).toContain(
      'export const PASSIVE_PLAN_CARRIES_SPEC_ACTIONS: ExactlyFalse<'
    );
    expect(types).toContain('export const LANDED_PLAN_CARRIES_SPEC_ACTIONS: ExactlyTrue<');
    // `never` is what a bare conditional never produces, and it is the whole
    // difference between a proof and a comment.
    expect(types).toContain('IsExactly<T, false> extends true ? false : never');
    expect(types).toContain('IsExactly<T, true> extends true ? true : never');
  });

  it('declares specActions on exactly one member of the union', () => {
    const types = source('types.ts');
    const start = types.indexOf('export type ImmutableFinalizationPlan');
    const end = types.indexOf('/** Every plan variant that is passive history');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const union = types.slice(start, end);
    expect(union.match(/specActions/gu) ?? []).toHaveLength(1);
    // …and it sits inside the landed member, not a shared base.
    const landedMember = union.slice(union.indexOf("outcome: 'landed'"));
    expect(landedMember).toContain('specActions');
    // The shared base carries none, so a passive plan literally has no field
    // to read — the field cannot leak in by being hoisted.
    const baseStart = types.indexOf('export interface FinalizationPlanBase {');
    expect(baseStart).toBeGreaterThan(-1);
    const baseBody = types.slice(baseStart, types.indexOf('\n}', baseStart));
    expect(baseBody).toContain('readonly destination: string;');
    expect(baseBody).not.toContain('specActions');
  });
});

describe('exactly one call site may hand spec actions to the engine', () => {
  const moduleSource = source('module.ts');

  it('passes them to createArchivePlan through one outcome-discriminated expression', () => {
    const start = moduleSource.indexOf('await createArchivePlan({');
    const end = moduleSource.indexOf('for (const item of archivePlan.blockers)');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const call = moduleSource.slice(start, end);

    expect(call.match(/specActions:/gu) ?? []).toHaveLength(1);
    expect(call).toContain("specActions: request.outcome === 'landed' ? [...specActions] : []");
  });

  it('derives the record spec-sync actions behind the same guard', () => {
    const start = moduleSource.indexOf('const recordDraft = buildArchiveV2RecordDraft({');
    const end = moduleSource.indexOf('const association = this.planAssociation(');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const call = moduleSource.slice(start, end);

    expect(call.match(/specActions:/gu) ?? []).toHaveLength(1);
    expect(call).toContain("request.outcome === 'landed' ? archiveSpecActionsFor(specActions) : []");
  });

  it('never reads a passive plan variant for spec actions', () => {
    // A passive plan has no such field, so any read would be a type error —
    // but a cast could hide one. There is none.
    expect(moduleSource).not.toMatch(/as\s+unknown\s+as[^\n]*specActions/u);
    expect(moduleSource).not.toMatch(/plan\.specActions/u);
  });
});
