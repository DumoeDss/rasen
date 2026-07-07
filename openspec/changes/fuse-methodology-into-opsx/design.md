## Context

The 20 remaining experts split into: **already wired** (consumed by verify / review-cycle / opsx wrappers), **unwired methodology** (the phase0c grill four), and **audit candidates** (safety and design skills with no obvious consumer). The four grill experts are teaching references — `domain-modeling` (glossary + ADRs), `codebase-design` (deep-module vocabulary), `tdd` (red→green discipline), `prototype` (throwaway probe). Their bodies are 30–96 lines of pure methodology; they must NOT be inlined into workflow templates (that would recreate the 800-line-copy anti-pattern change 1 avoided). The fusion is a conditional *reference* — the template says "for design-dense changes, consult `/codebase-design`" — plus artifact-path capture into the change directory.

Verified this session: propose/apply/explore templates are all in the parity whitelist (`EXPECTED_FUNCTION_HASHES` + `EXPECTED_GENERATED_SKILL_CONTENT_HASHES`) — editing them recomputes 9 hashes. `schemas/spec-driven/schema.yaml` sets `enhance` to deleted plan-review skills on three artifacts (proposal:28 `plan-ceo-review`, specs:83 `plan-design-review`, design:112 `plan-eng-review`); no test asserts these values. `gen-skill-docs.ts:generatePlanFileReviewReport` (placeholder `{{PLAN_FILE_REVIEW_REPORT}}`, gen-skill-docs.ts:1976) is consumed by the surviving `codex` skill (`codex/SKILL.md.tmpl:132`) and lists dead plan-review JSONL fields (gen-skill-docs.ts:1081-1087). `{{TEST_COVERAGE_AUDIT_PLAN}}` has zero surviving consumers (grep-confirmed) — dead code.

## Goals / Non-Goals

**Goals:**
- Fuse the four methodology experts into propose/apply/explore as conditional, teaching-level references with change-directory artifact capture.
- Make every workflow / schema / generator / doc surface reference only skills that exist (fix the schema `enhance` bug and the dead plan-review references).
- Produce a complete audit matrix: every unwired/audit expert → a fusion action or an argued keep-as-pure-expert.

**Non-Goals:**
- Inlining expert bodies into workflow templates, or creating new entry points / commands.
- Re-registering or reviving any change-1-removed skill.
- Touching `browse` (independent subproject) or the already-wired experts.
- Rewriting archived historical-migration specs whose subjects change 1 deleted (see the stale-example decision).

## Fusion-Audit Matrix

Every one of the 20 experts, with its decision:

| Expert | Status | Decision | Where / rationale |
|---|---|---|---|
| review | already wired | no change | consumed by review-cycle / verify-enhanced |
| cso | already wired | no change | verify-enhanced security stage |
| qa | already wired | no change | verify-enhanced browser QA |
| qa-only | already wired | no change | report-only QA variant |
| benchmark | already wired | no change | verify-enhanced perf stage |
| design-review | already wired | no change | verify-enhanced visual stage |
| investigate | already wired | no change | on-ramp; has absorption history |
| office-hours | already wired | no change | `/opsx:office-hours` wrapper |
| **codebase-design** | unwired | **FUSE → propose (+ design.enhance)** | propose template references it for design-dense changes; retarget `design` artifact `enhance` → `codebase-design`; decisions captured in change `design.md` |
| **domain-modeling** | unwired | **FUSE → propose** | propose template references it for domain-heavy changes; glossary/ADR decisions captured in change directory, not `CONTEXT.md`/`docs/adr/` gstack paths |
| **tdd** | unwired | **FUSE → apply** | apply template mentions it as a test-first implementation option (seams, red→green) |
| **prototype** | unwired | **FUSE → explore** | explore template mentions it to settle a stuck design question; answer captured in change dir, code deleted |
| **careful** | audit | **LIGHT WIRE → apply** | one guardrail line in apply pointing at `/careful` for changes touching destructive operations (rm -rf / DROP TABLE / force-push) — apply is where risky edits happen |
| guard | audit | **keep pure** | manual directory scope-lock the user activates situationally; not a workflow stage — hard-wiring it would impose locking on every change |
| freeze | audit | **keep pure** | same as guard (the lock half) |
| unfreeze | audit | **keep pure** | the unlock half; situational |
| design-consultation | audit | **keep pure** | greenfield "build a design system from scratch"; distinct from design-review (audit rendered UI). The navigator already documents the split; no workflow wiring needed |
| codex | audit | **keep pure + clean dead refs** | external second opinion, already reachable from review-cycle; no new wiring, but its generated section (`{{PLAN_FILE_REVIEW_REPORT}}`) loses the dead plan-review bullets |
| navigator | audit | **no change (verified truthful)** | already maps the grill four; they stay standalone-invokable, so its descriptions remain accurate post-fusion |
| browse | audit | **do not touch** | independent subproject (productization track) |

Headline: **4 fusions** (codebase-design, domain-modeling, tdd, prototype), **1 light wire** (careful), **5 keep-pure** (guard/freeze/unfreeze/design-consultation/codex), **navigator/browse untouched**, **8 already wired**.

## Decisions

### D1 — Fusion is a conditional reference, not an inline copy

Each workflow template gains a short conditional pointer (2–5 lines) naming the expert and when to reach for it, plus where its artifact lands. Example shape for propose: "If the change is design-dense (new module, non-trivial interface) or the domain language is fuzzy, consult `/codebase-design` and `/domain-modeling` before writing specs; record the resulting interface/domain decisions in this change's `design.md` Decisions section." No methodology body is copied. This keeps the templates lean and the experts the single source of truth.

### D2 — Artifact capture redirects to the change directory

The grill experts natively write to `CONTEXT.md`, `docs/adr/`, or a prototype folder. The fusion references instruct: capture the *decision* (ADR, domain resolution, prototype verdict) in the change directory (`design.md` Decisions, or a change-dir sidecar resolved from `openspec status --json` `changeRoot`), following the fix-pipeline-root-selection teaching convention. The experts' own file conventions remain valid when invoked standalone; the workflow reference just points the output at the change dir.

### D3 — `enhance` hooks retarget (primary gate decision, see Open Questions)

The three broken `enhance` values are fixed as: `proposal` and `specs` **drop** `enhance` (no surviving skill reviews a proposal/spec — that was the plan-review skills' unique role, now removed); `design.enhance` → **`codebase-design`** (deep-module/interface review is a clean fit for design.md and doubles as the fusion vehicle). This unbreaks `openspec instructions` (no more pointing at deleted skills) with the minimal honest change. Alternatives for the gate in Open Questions.

*Alternative considered*: retarget all three to surviving skills (proposal→office-hours, specs→review, design→codebase-design) to keep the enhance feature on every artifact. Rejected as primary because office-hours/review don't naturally "review" a freshly-created proposal/spec, and running them on every change adds noise; but it is a valid gate choice.

### D4 — Dead plan-review references are removed, not retargeted

`generatePlanFileReviewReport` aggregates review-log JSONL from multiple review skills; three of its four documented skills are deleted. Drop the `plan-ceo-review`/`plan-eng-review`/`plan-design-review` bullets, keep `codex-review` (codex survives). Remove the dead `{{TEST_COVERAGE_AUDIT_PLAN}}` mode/comment (no consumer). Fix `ARCHITECTURE.md`'s `BASE_BRANCH_DETECT` example list (`ship, review, qa, plan-ceo-review` → `review, qa`). All flow through the re-render + `skill:check` + dangling-grep gate.

### D5 — Stale-example specs: fix all seven, judged per-requirement (gate overrule, 2026-07-07)

The planner initially recommended fixing four and leaving three as historical record. **The gate (user, 2026-07-07) overruled this: fix all seven.** Rationale accepted: `openspec/specs/` is the *current truth* about the live system and must not carry requirements about deleted skills even as history — the historical record already lives in the archived change directories under `openspec/changes/archive/`. The honest forms are applied per-requirement (not per-file): MODIFIED where a requirement survives with its example/scope swapped to a live artifact; REMOVED (with Reason + Migration) where a requirement is entirely about deleted skills, which drops it from the main spec at archive-sync.

Per-spec breakdown:
- `artifact-graph`, `schema-enhance-field`, `instruction-loader` — MODIFIED: `enhance: "plan-ceo-review"` is a throwaway example of the enhance field → swap to `review` (a surviving skill), matching the retargeted mechanism.
- `preamble-migration` — MODIFIED: its ETHOS-cleanup file list names the now-deleted `plan-ceo-review/SKILL.md.tmpl`; drop that one entry (office-hours + ARCHITECTURE.md remain).
- `dead-stub-removal` — MODIFIED the "no pending-integration stubs in skill sources" requirement (narrow the file-list scenario to the surviving `codex` tmpl; keep the design-review-lite diff-scope scenario, which survives) + REMOVED the "Retro global-mode dead path" requirement (retro deleted). Its "no stubs in generator functions" requirement is unchanged (it constrains `gen-skill-docs.ts`, not a deleted skill) and is not part of the delta.
- `skill-name-prefix` — MODIFIED all three requirements: drop the stale "28" count (replaced with "all gstack expert skill templates"), drop the removed-skill mapping rows (keep representative surviving examples), and remove the "gstack-upgrade drops redundant prefix" scenario (that skill is deleted and the path is no longer exercised). The prefix/dirName/author rules themselves survive for the live roster.
- `ship-portability` — REMOVED all three requirements: every one constrains the deleted `ship`/`document-release` `.tmpl` files. Migration points at the `/opsx:ship` workflow template.

At archive-sync, the MODIFIED requirements replace their main-spec counterparts and the REMOVED requirements are deleted from the main specs; `ship-portability` becomes an empty capability (all requirements removed) and is expected to be dropped from `openspec/specs/` by the sync.

## Risks / Trade-offs

- **[Fusion references bloat lean workflow templates]** → cap each at a few conditional lines; the expert stays the source of truth. Parity recompute confirms the only template change is the intended fusion text.
- **[Dropping proposal/specs `enhance` removes a feature users relied on]** → the dropped hooks pointed at deleted skills (already broken); the fusion's propose-template prose replaces the planning-review intent more precisely for design-dense changes. Gate may keep them via the alternative.
- **[Parity hash recompute masks an unintended template change]** → recompute strictly via the test's own recipe against a fresh `pnpm build` dist; review the template diffs so the hash change reflects only the fusion edits.
- **[Windows test flakes (EBUSY/EPERM/timeouts)]** → isolate-rerun untouched files; green on isolated rerun passes; record it. `openspec config list` after tests confirms no global-config pollution.

## Migration Plan

1. Fuse references into propose, apply, explore templates (both skill + command variants).
2. Retarget schema.yaml `enhance`; remove dead plan-review references in gen-skill-docs + ARCHITECTURE.md.
3. Re-render (`gen:skill-docs`) so codex/SKILL.md updates; `skill:check` FRESH.
4. Recompute the 9 parity hashes against the fresh dist build.
5. MODIFIED deltas for the 4 stale-example specs.
6. `pnpm build` + `pnpm test` + `openspec update --force` + `openspec config list` + whole-repo dangling grep (incl. scripts/ + schemas/) + `openspec validate --strict`.

Rollback: coherent additive change on a feature branch; revert if parity/build fails or the enhance decision is reversed.

## Open Questions

Both propose-gate questions are now RESOLVED (user, 2026-07-07):

1. **`enhance` retarget** — RESOLVED: recommended option accepted. Drop `enhance` from `proposal` and `specs`; set `design.enhance` → `codebase-design`. Artifacts already reflect this as primary; no amendment needed.
2. **Historical specs** — RESOLVED: fix all seven (planner's fix-4-keep-3 overruled). Applied per-requirement as MODIFIED/REMOVED — see D5. The historical record remains in the archived change directories.
