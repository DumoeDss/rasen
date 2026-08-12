# Plan: store-v2-foundation

## Change boundary

Preferred: **one Change** (`store-v2-foundation`) that ports the store base v2 model + the Store
Issues module onto 0.2.0 as a single reviewable diff. If the port proves too large at design time,
split into a 2-child portfolio — `store-base-v2` (L0) then `store-issues` (L1) with L1 depending on
L0 — but default to one Change unless reviewability demands the split.

## Target project / base

- Base: `dev/0.2.0` (the forward line; currently carries merged #151 + #153).
- 0.1.7 `src/core/store/` (esp. `issues/`) is a **read-only behavior reference**, never a copy target
  (bidirectional divergence; memory-confirmed). Re-implement on 0.2.0 structures.

## Dependencies

- None within this workstream (this is the foundation).
- Inputs: 0.1.7 store base + `store/issues/` (behavior reference); 0.2.0 `store/` + `change-run/`
  (base to extend, must not regress).

## Parallelism

None — foundation, single Change (or strictly serial L0→L1 if split).

## Dogfood path

After the port, exercise a real Issue lifecycle on 0.2.0: create an Issue, publish a plan that
references an already-committed Change instance, set state, then list/show and verify canonical
bytes/digests round-trip. If a real planning Issue is available, use it; otherwise a committed
fixture that mirrors the real shape.

## Evidence to return

- Ported store-base + Issues suite results (green) on 0.2.0.
- The Issue lifecycle artifact (fixture or real Issue) + read-back proof.
- Regression proof: 0.2.0 `store/` + `change-run/` suites green; `tsc` + ESLint clean.
- A short note of any 0.1.7→0.2.0 structural adaptation made (where 0.2.0's structures required a
  re-implementation rather than a port).

## Direction source references

- Workstream: `issue-centered-automation-platform/store-v2-onto-020`.
- Higher authority: `../north-star.md`, `../goal.md` §4–5; `store-session-execution-context.md`.
- Slice spec: `slices/store-v2-foundation/spec.md`.

## Next action (after this slice lands)

Select the next slice — `layout-migration` (L2) — via `rasen-direction`, since the
coordinator-bridge (L8) depends on both this foundation and L2.
