# Result: layout-migration (L2)

**Status:** passed
**Outcome:** 0.1.7's flat-to-v2 layout migration runs on 0.2.0 (`src/core/store/layout-migration/`
byte-parity with the frozen 0.1.7 reference): inventory, immutable migration plan with byte-stable
receipts, gated apply with recovery, doctor diagnostics, and the runtime no-dual-write layout guard
(`layout-write-guard.ts`, design D12) that keeps a legacy flat Store read-only until
`rasen store migrate-layout <store-id>`.

Delivered as a direct git port under the port-first directive: commit `964acecc`
("port layout-migration at 95f26f4c") in PR #160 (merge `958b75dd`), green after the documented CI
reconciliation rounds (13->9->6->4->2->0 failing checks across six rounds).

## Evidence

- Ported suites, all on 0.2.0: `layout-migration-inventory / -mapping / -module / -plan-gates /
  -apply-recovery / -catalog-receipt / -provenance / -doctor / -scene-bridge-e2e /
  -windows-paths` (ten suites under `test/core/store/`).
- Byte stability is pinned by golden vectors (digest preimages), not relational assertions;
  the LF-pinned fixture set (`.gitattributes test/fixtures/** text eol=lf`) keeps them
  platform-stable.
- Post-merge review 2026-08-16: `src/core/store/layout-migration/` content is byte-identical to
  the 0.1.7 tip `a3f49007` (whole-tree per-file reconciliation, zero unexplained divergence).

## Attempts / history

- 2026-08-13..16 - Ported with the rest of the five-slice wave in PR #160; CI reconciliation
  classes recorded in `handoff/lead-5.md` (LF-pinned fixtures among them).
- 2026-08-16 - Post-merge review verified reference parity; slice closed `passed`.
