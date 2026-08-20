# 3.x — Seeding the real children as the store's first committed evidence

Script: `.rasen/changes/issue-persistent-baseline/ephemera/research/seed-store-children.mjs`
(operator bootstrap tooling, explicit list, shipped helpers from the
worktree's `dist` build — `derivePlanningScopeId` +
`deriveChangeInstanceId`, the same pair the store-planning resolver
verifies). One-shot: a rerun would mint fresh identities, which is why the
seed map below is the durable receipt.

## Scope and instances (seed map also at `3-seed-map.json`)

- planningScopeId (one scope — same store/project/line):
  `ps_5e57bf1a510520c23b0a68cafd51d6f9096bb0f0fccdce2137b098220f954e93`

| child | instanceId | instanceSeed |
| --- | --- | --- |
| `2026-08-20-issue-plan-publication` (archived) | `ci_d94c1e6a7563e9d815f100867eb717cba9a8ebddf332ff6257f2c41c128dda03` | `23f3719a4a7d4ed3fc6bba88914501d9` |
| `2026-08-20-issue-node-lifecycle` (archived) | `ci_8740087b798d080a086d4e18ee283efe44bd4de1205e8cb5247a70cabcb36d7e` | `71096d6565f60685dfd8fa7ebb426eb1` |
| `issue-persistent-baseline` (active) | `ci_31ac4af911fefd06c65efd8a8d4da5ec4193b3795133a7d41a0fc87544bd9e7d` | `54c4bbee450a5180f636adeb9ca6b7cc` |

## What landed (store commit `9d1452d`, pathspec `rasen/projects/`)

- Archived children under
  `rasen/projects/e2ee72ed-04a1-4395-86aa-7e77d2b83ec7/changes/archive/line-0.2/<dated-entry>/`:
  the repo's real archive dirs mirrored verbatim (proposal/design/tasks/
  specs/evidence, `archive.json` riding as the v1 legacy record it is, plus
  the repo's archive sidecars), with the metadata overlaid by an
  identity-carrying `.openspec.yaml` — every scalar quoted (the
  fixture-documented YAML typing trap), existing `schema`/`created`/`quality`
  preserved. Dated names keep the repo form; g-001's resolver matches them
  through the archive engine's date-prefix splitter.
- The active child as a metadata-only entry under
  `rasen/projects/<projectId>/changes/issue-persistent-baseline/.openspec.yaml`
  (artifacts still moving; the committed-evidence contract needs identity
  only — its observation comes from the live run-state).
- Store tree listing at seed time: `3-store-tree.txt` (36 files).

## M-1 guard

Exactly ONE committed copy per instance — `git ls-files -- rasen/projects/`
yields exactly three `.openspec.yaml` (two archive entries + one active
entry, three distinct change names, no overlap); the repo's own archive is
not store evidence and never entered the store, so the g-001 M-1
active+archived refusal shape cannot arise. The script itself verifies the
working-tree shape (duplicate-name scan + unexpected-name scan) before the
commit; the committed shape is re-verified above.

CRLF warnings during the store commit are the known cosmetic Windows
autocrlf chatter (design Risks note) — committed bytes are LF; no action.
