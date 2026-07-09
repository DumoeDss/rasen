# Review report — worker-reuse-playbook

Reviewer: reviewer-playbook (fresh eyes; did not author, did not review the sibling change).
Scope: uncommitted working-tree diff — `_orchestration.ts`, `handoff.ts`, `auto.test.ts`, `handoff.test.ts`, docs EN/zh, changeset, and the change artifacts.
Evidence: `npx vitest run test/commands/auto.test.ts test/commands/handoff.test.ts` → 48 passed. `openspec validate worker-reuse-playbook` → valid.

## Verdict (round 1)

No Blockers. No Majors. One Minor, three Trivial. The highest-risk axis — anchor-phrase lockstep between the two MODIFIED deltas and the playbook text — is **clean**.

## Blocker

None.

## Major

None.

## Minor

1. **`_orchestration.ts:206` (H.7) / `specs/session-relay/spec.md:4` — "knowledge digest document" has no defined template or location.** The retire-between-children path pins a reason code (`retired-between-children`) and reuses the handoff template at `openspec/changes/<id>/handoff/`; the held-warm-candidate-before-relay path only says "write its knowledge digest document" so that F.1's document-first channel can read it. But F.1's ladder reads a *handoff document* first — an ad-hoc "digest" with no stated template/location may not land where F.1 looks. Spec and playbook agree (no drift), so this is a specification gap, not a lockstep defect.
   Fix: add half a sentence stating the knowledge digest is written as a handoff document (same template + `handoff/` location) so F.1's document-first channel finds it.

## Trivial

2. **`_orchestration.ts:176` (Step G.1 item 3) — asymmetric field specificity.** B.1 item 5 names the exact field (`resolvePipelineReuseConfig(pipeline).roles.planner`); G.1 only says "the resolved implementer reuse threshold" without naming `.roles.implementer`. Both resolve correctly (verified: `roles.implementer` is always populated, defaulting to `threshold` = 0.25). Fix: name `.roles.implementer` in G.1 for parity. Cosmetic.

3. **`test/commands/auto.test.ts` — three scenarios lack a dedicated substring assertion.** "Reuse disabled under never" (implementer), "Reuse degrades on non-Tier-A hosts", and "Manual sequential runs are out of scope" are realized in the playbook (`_orchestration.ts:172,181`) but only covered indirectly by the `reuse.implementer` presence assertion. Acceptable for playbook-text tests; if strict per-scenario coverage is wanted, add `.toContain` on "always fresh", "threadId", and "manually-run sequence".

4. **`handoff.ts:64` — "knowledge digest" naming.** The retire note here is titled `retired-between-children`; the H.7 held-candidate path (a distinct trigger) writes a "knowledge digest document." A reader may conflate the two. Fix (optional): a one-line cross-reference clarifying they are two triggers producing knowledge-transfer docs. Tied to Minor #1.

## Axis-by-axis findings

### 1. Spec-implementation fidelity — PASS
Every scenario across the three specs is realized in the template text:
- worker-reuse-orchestration (5 requirements / 9 scenarios): planner auto/never (B.1 preface `:68`), cross-child decision + contamination guard + retire/dual-source (G.1 `:172-178`), probe-timing review-clean (`:175`), merge-node unique predecessor (`:179`), lineage `reusedFrom` (`:180`), scope guards — design-fixer / Tier B / Codex / manual-sequence (`:181`). All realized.
- orchestration-handoff (MODIFIED): durable-findings DONE clause realized H.3 `:195`.
- session-relay (MODIFIED): held-warm-candidate digest realized H.7 `:206`.
Test coverage: all core clauses have `skillText.toContain` assertions that match the playbook text verbatim (spot-checked all 20 auto.test + 3 handoff.test assertions against the source — every substring is present). Three scenarios covered only indirectly (Trivial #3).

### 2. Anchor-phrase lockstep (highest risk) — PASS / CLEAN
- **orchestration-handoff durable-findings**: delta and playbook match on all load-bearing anchors — "durable-findings clause", "1–3 lines of discoveries", "not per-task chatter", "relays … verbatim", "implementation discoveries feed". No drift.
- **session-relay held-warm-candidate digest**: match on "held/holding warm reuse candidate", "returned `DONE` but was retained/RETAINED … rather than dismissed", "write its knowledge digest document", "cross-change knowledge would otherwise be lost with its session-scoped agent handle". The only wording variance ("retained for cross-child reuse" vs "RETAINED for a dependent child") is not on an anchor phrase; the anchor "retained … rather than dismissed" matches. Archive-time sync will not corrupt.

### 3. Internal consistency — PASS
- **"Step G.1" naming**: coherent, not ambiguous. It follows the file's existing subsection convention (Step F already has a "Step F.1"). No text uses "G.1" to mean a numbered item of Step G, and no text uses "G.4" — internal cross-refs correctly say "item 4 of Step G" (`:175`). Verified via grep across the file.
- **B.1 item 5 reuse-threshold change**: coherent. The retire-on-bloat guard fires only "Before EVERY planner re-engagement," which happens only under `reuse.planner: auto` (the preface scopes "everything else in this section" to the auto path); under `never` there is no persistent planner to retire. Threshold field `.roles.planner` is correct and always-populated (verified against `resolvePipelineReuseConfig`, types.ts:419-431).
- **Frozen child-1 semantics**: no contradictions. auto/never modes, threshold 0.25, roles restricted to planner/implementer (ReuseRolesSchema, types.ts:142), `reusedFrom` optional LEAD-written string (run-state.ts:59) — all referenced, none changed.
- **handoff.ts note**: the section names it cites (Key decisions / Dead ends & gotchas / Working set / Remaining) all exist in the handoff template below it; "template unchanged" claim is accurate.

### 4. Docs parity + changeset + tests — PASS
- EN/zh mirror: the new bullet is present in both `docs/opsx-workflow-guide.md:133` and `docs/zh/opsx-workflow-guide.md:132`; the zh translation is faithful and complete (contamination guard, retire, merge-node, reusedFrom, planner reuse, scope guards, durable-findings all mirrored).
- changeset: accurate, minor, matches the implemented behavior.
- Note (informational, not a finding): the untracked `openspec/changes/worker-reuse-policy/` directory is the portfolio parent container (planning-context + portfolio-run.json), not scope creep.

---

## Round 2 — fix-delta re-review (fix delta only)

Warm continue (LEAD probe 9.6%). Re-reviewed only the 5-file fix delta against round-1 findings; did not re-review the whole change. Evidence: `npx vitest run test/commands/{auto,handoff}.test.ts` → 48/48 passed (firsthand); rendered-anchor byte-comparison run.

**Finding resolution:**
- **Minor #1 — RESOLVED.** H.7 (`_orchestration.ts:206`) and session-relay spec (`spec.md:4`) now state the digest IS a handoff document: same openspec-handoff template, written to `openspec/changes/<name>/handoff/<role>-<n>.md`, reason `retired-between-children`, so F.1's document-first ladder finds it. Location/template pinned; F.1-findable. The concern (ad-hoc digest F.1 can't locate) is gone.
- **Trivial #2 — RESOLVED.** G.1 item 3 (`_orchestration.ts:176`) now names `resolvePipelineReuseConfig(pipeline).roles.implementer`, matching B.1's `.roles.planner` specificity.
- **Trivial #4 — RESOLVED.** `handoff.ts:64` now explicitly ties the `retired-between-children` document to the session-relay "knowledge digest" — "the same file" — removing the conflation risk.
- **Trivial #3 — ACCEPTED (known).** LEAD accepts the three scenarios (implementer never→fresh, Tier B/Codex degrade, manual-sequence non-goal) covered only indirectly by tests. No change.

**Anchor-phrase lockstep — still byte-clean.** The load-bearing inserted segment ("knowledge digest document — which IS a handoff document: the same openspec-handoff template, written to `openspec/changes/<name>/handoff/<role>-<n>.md` with reason `retired-between-children`, …") is byte-identical between the rendered playbook and the session-relay spec delta (verified programmatically after unescaping the template-literal backticks). The two intentional divergences are harmless: (a) SHALL (spec) vs MUST (playbook) is the pre-existing normative-verb convention; (b) the "(F.1)" internal step ref appears only in the playbook and is correctly omitted from the runtime-agnostic spec. Archive-time sync copies the spec delta (not the playbook), so neither divergence can corrupt the synced spec — and the spec text is internally self-consistent (SHALL, no F.1 ref).

**No new inconsistency introduced.** Reason `retired-between-children` is now produced by two triggers (threshold-breach retire in G.1; held-candidate-before-relay in H.7). This is coherent — a held candidate whose live handle dies at a session boundary IS being retired between children, just relay-triggered rather than threshold-triggered — and `handoff.ts` explicitly unifies the two as the same document, so no reason-code proliferation or contradiction. New test assertions (`which IS a handoff document`, `knowledge digest`) match the source and pass.

**Round-2 verdict: CLEAN.** All round-1 findings resolved or accepted-known; no findings remain; lockstep intact; no regressions.
