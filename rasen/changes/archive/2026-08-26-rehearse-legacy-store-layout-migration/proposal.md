## Why

The layout-migration flow (`rasen store migrate-layout`, `src/core/store/layout-migration/`, 15 files) implements design SS11 (flat -> partitioned v2: inventory / attribution / plan / apply / recovery), but it has never been exercised against a store produced by real Rasen usage — every existing test seeds its own synthetic fixture, and a fixture whose bytes coincide with a defect's output renders that defect invisible. A genuine legacy store exists on this machine (`rasen-store`, uid `f35acc7d`), and it is already wedged today: it is a legacy flat store whose partition writes are refused with `legacy_flat_store_requires_migration`, while preliminary reading of the plan gate (`plan.ts:1048` requires at least one inventoried item) says the official migration can never complete for it either. Rehearsing the official flow against a disposable copy of that store is the only honest way to close the design's SS15 migration acceptance rows and to surface what fixtures cannot.

## What Changes

- Build an isolated rehearsal harness: a disposable copy (and a `git clone` variant) of the real `rasen-store`, registered under a fully redirected machine registry (`RASEN_HOME` + `GIT_CONFIG_GLOBAL`), driven by the real built CLI (`node bin/rasen.js`). The real store is read-only material; no command ever targets it. This constraint is restated as a hard rule in design.md.
- Run the official migration flow end-to-end against the copies — inventory, plan (expect fail-closed refusals), mapping file, re-plan, apply, status, retire-flat, plus an enriched-content variant exercising attribution, shared-spec provenance, multi-ref reporting, and Windows/UTF-8 path shapes — and capture receipts, plan JSON, refusal texts, and recovery manifests under this change's `evidence/` directory.
- Triage what the rehearsal surfaces into fix-now versus accepted-known, against recorded criteria (defect vs correct-but-illegible refusal vs correct-and-legible), then fix and guard each admitted defect. One defect is already predicted by code reading and confirmed by the real store's shape: an empty legacy flat store (zero specs/changes/archive entries — exactly what `rasen-store` is) produces a plan with zero items, which the apply gate refuses, leaving the store permanently unable to reach layout v2 by any supported route.
- Add the missing capability spec for layout migration: the flow ships with no spec at all today (no capability under `rasen/specs/` mentions `migrate-layout`), so its fail-closed attribution, shared-spec provenance, recoverable publication, multi-ref reporting, and refusal-legibility contracts are recorded nowhere the archive process protects.

## Capabilities

### New Capabilities

- `store-layout-migration`: the user-facing contract of `rasen store migrate-layout` — evidence-only attribution that blocks apply when ownership is unknown, conflicting, or shared; explicit mapping-file resolution that can never contradict recorded identity; staged, digest-verified, resumable/rollbackable publication with the layout flip last and retirement as a separate idempotent step; complete reporting of other refs still carrying the flat layout; a defined (non-dead-end) outcome for an empty legacy flat store; and refusals that name a concrete repair.

### Modified Capabilities

None. `store-planning-layout-v2` (addressing), `workspace-migration` (openspec->rasen copy), and `store-adopt` (in-repo project adoption) are adjacent but none of their requirements change; the migration flow's contract is net-new spec surface.

## Impact

- Code (fix scope, only as admitted by triage): `src/core/store/layout-migration/*` (the plan gate for empty stores is the one pre-identified fix), `src/commands/store-migrate-layout.ts` (refusal legibility), possibly `src/core/store/layout-write-guard.ts` message text. Sibling seams are out of bounds: `src/core/store-planning/internal/resolver.ts` and `src/core/store/identity.ts` belong to `fix-store-retention-scope-resolution`; `src/core/store/workspace/plan.ts` and `apply.ts` belong to `fix-store-workspace-pair-transactions`. If the rehearsal implicates those files, the finding is recorded and handed to the sibling, not fixed here.
- Tests: new real-git rehearsal-shaped suites with explicit per-test timeouts; each new guard demonstrated to fail against pre-fix behavior.
- Evidence: `rasen/changes/rehearse-legacy-store-layout-migration/evidence/` gains the captured rehearsal record (plans, receipts, refusals, recovery manifests, triage table).
- No version bumps, no changes to store content formats, no migration of any real store.
