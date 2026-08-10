# Review report — fix-project-registry-alias-safety

- Mode: dispatched, report-only independent review
- Branch: `fix/archive-transaction-recovery-follow-up`
- Reviewed delta: the original child scope, seven-file S1/P1 remediation, and Round 3 two-file P2 remediation
- Excluded: concurrent archive, workspace, validator, root-selection, and other child changes
- Verdict: **CLEAN — Round 3: 0 Blocker, 0 Major, 0 Minor, 0 Trivial; S1/P1/P2 all independently resolved**

## Scope check

**CLEAN for the assigned Round 3 delta.** This re-review was limited to the P2 fix in `src/core/project-registry.ts` and `test/core/project-registry.test.ts`. Concurrent archive/workspace and all other dirty-worktree files were not reviewed or modified.

## Round 2 non-author delta re-review

### S1 — RESOLVED

- `ProjectIdentityClaimant` now carries the complete `aliases` inventory and `fixedMetadataConflict` (`src/core/project-registry.ts:552-566`), and `findProjectIdentityClaimants()` preserves both fields across the public boundary (`src/core/project-registry.ts:681-695`). Identity filtering still occurs only after canonical-root grouping and tests every alias identity (`src/core/project-registry.ts:642-651`), so direct-B/live-alias-A remains a claimant for A while retaining the conflict.
- The learned-skills owner consumer now refuses either multiple claimants or any conflicted claimant before reading the representative as an owner (`src/core/learned-skills/context.ts:329-359`). The StorePlanning dependency projection also forwards both fields, and its resolver rejects the same conflict before selecting a registry representative (`src/core/store-planning/internal/dependencies.ts:49-55,257-269`; `src/core/store-planning/internal/resolver.ts:1397-1439`).
- Repository-wide production search found no other `findProjectIdentityClaimants()` consumer or claimant projection: the learned-skills consumer and StorePlanning dependency/resolver path are the complete production set.
- Focused regressions exercise the public direct-B/live-alias-A claimant result and the real learned-skills owner refusal (`test/core/project-registry.test.ts:820`; `test/core/learned-skills/context.test.ts:179`). The StorePlanning snapshot contract has a separate same-normalized-identity/different-home conflict refusal (`test/core/store-planning/store-planning.test.ts:876`).

### P1 — RESOLVED

- Project-only selection now uses the raw selector matches only to establish candidate canonical-root keys, then maps every `snapshotProjects()` entry through the same root-key function and rebuilds `machineNamespace` from all entries at those roots (`src/core/store-planning/internal/resolver.ts:1360-1391`). This closes the pre-filter escape for an alias whose id/name/raw root does not itself match the selector.
- Admission rejects more than one normalized registry identity in the expanded group before choosing a root or reading project config (`src/core/store-planning/internal/resolver.ts:1470-1487`). For a sole normalized identity, the public claimant conflict check covers different-home aliases; the selected registry/config comparison then rejects genuine normalized drift before `explicitProjectSelector`, association, binding, or planning-content resolution (`src/core/store-planning/internal/resolver.ts:1492-1528`).
- The regression matrix seeds a matching entry beside a different-identity alias at the same canonical root and covers normalized id, display name, and absolute-root selectors with byte-level no-mutation assertions (`test/core/store-planning/store-planning.test.ts:996`). Separate three-selector drift rows and the equivalent-normalization success case preserve the intended config-admission behavior (`test/core/store-planning/store-planning.test.ts:948,1049`).

### Round 2 result

S1 and P1 are independently resolved: the first by preserving/refusing structured claimant conflict at every production identity consumer, and the second by expanding selector matches to the complete canonical-root registry group before identity/config admission. One separate Major remains on the required non-mutation axis.

### P2. Major — RESOLVED in Round 3 — alias-only live conflict could be mutated when explicit registration supplied a third identity

- Evidence: with no direct canonical key, `registerProjectWithPolicy()` obtains `sameIdClaimants` only through `canonicalProjectIdentityClaimants(projects, input.projectId)` (`src/core/project-registry.ts:448-473`). That helper discards every canonical group having no alias with the requested normalized identity (`src/core/project-registry.ts:642-651`). Therefore a live alias-only group whose fixed tuples are A/home-A and B/home-B is invisible when explicit ensure is called for C.
- Failure trace: `existingAtPath` is absent; the A/B conflict is absent from the C-filtered `sameIdClaimants`; none of the conflict gates at `src/core/project-registry.ts:479-515` runs; ensure reaches `place(home, C)`, creates C's machine home, and writes a direct C registry entry (`src/core/project-registry.ts:527-544`). The conflicting A/B aliases are retained because `place()` deletes only aliases whose identity matches C (`src/core/project-registry.ts:411-429`). Registry bytes and the home inventory are thus mutated while a live fixed-metadata conflict exists at that exact canonical root.
- Spec mismatch: `project-registry` requires any mutation to fail closed before registry or home change when live aliases at one canonical claim disagree. Design decision 1 likewise requires every mutating entry point to check the structured canonical-root result before placement or home creation. The current gate is identity-relative rather than canonical-root-relative for an alias-only claim.
- Coverage gap: the existing non-mutation regression seeds alias-only A/B but calls registration and refresh with A (`test/core/project-registry.test.ts:749-818`), which makes the conflicted group visible. It does not exercise registration with an identity absent from every conflicting alias.
- Recommended action: before any ensure placement, inspect the canonical-root claimant independent of `input.projectId` and reject its live fixed-metadata conflict. Add an alias-only A/B plus ensure-C regression asserting unchanged registry bytes, no C entry, and no C home. Preserve the existing unambiguous moved-root and equivalent-normalized behaviors.
- Classification: **ASK** — recoverable state creation, but it violates the specified fail-closed ownership boundary and can compound a corrupted registry.

**Round 2 count:** 1 finding — 0 Blocker, 1 Major, 0 Minor, 0 Trivial.

## Round 3 non-author delta re-review

### P2 — RESOLVED

- The new target-root gate reduces the complete registry with `canonicalProjectClaimants(projects)` and selects by the already-resolved `canonicalPath`, independent of `input.projectId` (`src/core/project-registry.ts:448-452`). A live A/home-A + B/home-B conflict is therefore visible even when the incoming identity is C.
- The gate executes before `existingAtPath`, identity-scoped claimant filtering, alias deletion, `place()`, home creation, or registry write (`src/core/project-registry.ts:448-458,460,482,555-556`). Ensure throws `project_registry_alias_conflict`; refresh returns from the locked operation with no `resolvedEntry`, hence returns `null`.
- Input spelling cannot bypass the target selection: the entry path is canonicalized and pierced to its registration root before the lock (`src/core/project-registry.ts:360-361`), while the full reducer applies the same existing-path canonicalization and registration-root resolution to every live raw alias (`src/core/project-registry.ts:599-650`). Native symlink/junction aliases, Windows equivalent spellings, and linked worktree roots converge on the same platform-aware claim key.
- The new regression constructs two live symlink/junction aliases with different identities and homes, then calls ensure with a third identity (`test/core/project-registry.test.ts:820-866`). It proves byte-identical registry state, no canonical C entry, no C identity anywhere, no derived C home, and an unchanged machine-home directory inventory (`test/core/project-registry.test.ts:868-877`). Paths use `path.join`, a platform-specific junction/dir link kind, and a canonical expected root, satisfying `test/AGENTS.md` alias/path rules.
- Adjacent behavior remains admitted: conflict-free direct/unique-live aliases still collapse, member-identity conflicts still refuse ensure/refresh, moved-root rebind still preserves its home, and equivalent normalized identity still reuses the existing entry. Static branch tracing and the focused reviewer run below both cover these paths.

### Standards axis

No finding. The P2 delta adds one pre-mutation guard using the existing reducer and conflict diagnostic; it introduces no new value family, trust boundary, conditional side effect, or untested changed branch.

### Spec axis

No finding. The fix now satisfies the project-registry requirement and design decision 1: every live fixed-metadata conflict at the target canonical claim is checked before alias deletion, rebind, home creation, or registry write, without blocking unambiguous moved-root repair or equivalent normalized aliases.

### Round 3 coverage

```text
CODE PATH COVERAGE
==================
[+] target canonical claim gate
    ├─ [★★★ TESTED] ensure-C over alias-only A/B conflict throws before mutation
    ├─ [★★★ TESTED] ensure-A and refresh-A over the same conflict refuse
    └─ [★★★ TESTED] conflict-free equivalent aliases continue to collapse

USER FLOW COVERAGE
==================
[+] explicit registration → canonical root → full claimant reduction
    ├─ [★★★ TESTED] third identity cannot create a registry entry or home
    ├─ [★★★ TESTED] moved project still rebinds and preserves its home
    └─ [★★★ TESTED] normalized equivalent identity still reuses its entry
```

### Round 3 verdict

**CLEAN — 0 Blocker, 0 Major, 0 Minor, 0 Trivial.** P2 is non-author confirmed resolved; together with the retained Round 2 confirmation of S1/P1, all canonical findings in this child are closed.

## Round 1 findings — resolved in Round 2

### Standards axis

#### S1. Blocker — RESOLVED in Round 2 — identity claimant lookup erased a live fixed-metadata conflict and could resolve the requested owner to another identity

- Evidence: `canonicalProjectClaimants()` correctly groups every raw key before identity filtering and computes `fixedMetadataConflict` (`src/core/project-registry.ts:586-650`). However, `findProjectIdentityClaimants()` projects only `{ path, entry, live }` and drops both the alias inventory and conflict flag (`src/core/project-registry.ts:677-689`). Because the representative is selected direct-first (`src/core/project-registry.ts:619-634`), a group containing direct identity B plus a live alias identity A is returned for a query for A with B as `entry.projectId`.
- Concrete consumer failure: `resolveMachineProjectById(A)` accepts a single claimant when the root config agrees with the returned representative B, then returns the requested owner A at that root (`src/core/learned-skills/context.ts:329-356`). Thus a conflicted legacy registry can silently route owner A to project B rather than refusing. That is a cross-project ownership/data-corruption path.
- Why the current tests miss it: the live-conflict regression exercises explicit registration, refresh, and GC only (`test/core/project-registry.test.ts:749-818`). It never calls `findProjectIdentityClaimants()` or a real owner consumer with different identities at one canonical root.
- Recommended action: expose the structured conflict/alias inventory through the claimant API (or make the API return an explicit representative-or-conflict union), and require every identity-scoped consumer to reject a conflicted group before returning an owner. Add a direct-B/live-alias-A regression through the public claimant lookup and `resolveMachineProjectById(A)`.
- Classification: **ASK** — public API/consumer contract change with cross-project behavior.

**Standards count:** 1 finding — 1 Blocker.

### Spec axis

#### P1. Blocker — RESOLVED in Round 2 — Store planning filtered registry entries before canonical-root unification, so an unmatched conflicting alias could bypass drift refusal

- Evidence: project-only selection first filters raw `snapshotProjects()` entries by normalized id, name, or raw absolute root (`src/core/store-planning/internal/resolver.ts:1344-1367`). Canonical-root unification is then performed only on that already-filtered `machineNamespace` (`src/core/store-planning/internal/resolver.ts:1417-1439`), and the new identity set likewise includes only those filtered matches (`src/core/store-planning/internal/resolver.ts:1440-1457`). Finally, config admission compares only `machineNamespace[0]` (`src/core/store-planning/internal/resolver.ts:1462-1494`).
- Failure: with live aliases A and B for one canonical root and config identity A, selecting by A, A's display name, or the canonical root can include only entry A. Entry B does not match that selector, is never pulled back in by canonical root, and planning proceeds instead of returning `planning_selection_conflict`. The result depends on which conflicting alias happens to match the selector, violating the required fail-closed ownership contract.
- Spec mismatch: the `store-project-namespace` requirement says every selected registry identity must agree with config identity; design decision 4 requires identity establishment before adopting config evidence. This also defeats RSR-1's group-before-identity-filtering rule at the planning consumer boundary.
- Why the current tests miss it: all three id/name/root drift rows seed exactly one machine registry entry (`test/core/store-planning/store-planning.test.ts:860-906`); the equivalent-normalization case also seeds one (`test/core/store-planning/store-planning.test.ts:908-937`). No case seeds a selector-matching entry beside a different-identity alias at the same canonical root.
- Recommended action: after a selector identifies a candidate canonical root, gather every raw machine registry entry in that canonical claim (preferably through the shared structured reducer) before choosing a representative or reading planning content. Reject more than one normalized fixed identity, then compare the sole identity with config. Add id, display-name, and absolute-root regressions where only one alias matches the selector and a sibling alias at the same root carries another identity; assert byte-for-byte no mutation.
- Classification: **ASK** — selection/registry contract change with required user-visible refusal.

**Spec count:** 1 finding — 1 Blocker.

## RSR audit

| Axis | Result | Evidence-backed assessment |
|---|---|---|
| RSR-1 canonical-root grouping before identity filtering | **PASS** | S1/P1 consumers retain full grouped conflict state, and Round 3 makes mutation admission inspect the complete target canonical claim before any identity filter or side effect (P2 resolved). |
| RSR-2 non-creating read-only repair | **PASS** | Home creation is gated to `authority === 'ensure'` (`project-registry.ts:407-409`); alias-only refresh retains the missing home name without creating its directory (`project-home.test.ts:317-359`). |
| RSR-3 shared main-first lookup | **PASS** | Non-ensuring project-home uses `findProjectRegistryEntry()` (`project-home.ts:117-135`); lookup prefers a registered main claim and uses the exact worktree entry only as fallback (`project-registry.ts:727-753`), with both flows covered (`project-home.test.ts:547-611`). |
| RSR-4 normalized registry/config drift refusal | **PASS** | The expanded root group must establish one normalized registry identity, which is then compared with config before later binding/planning reads (`resolver.ts:1470-1528`); id/name/root conflict and drift regressions cover the refusal. |

## Adversarial edge audit

- Windows case/separator/dot aliases: implementation uses native canonicalization plus case-folded claim keys; native Windows coverage is recorded. No additional defect established in this path.
- Direct vs unique-live precedence: direct equivalent claimant and unique-live-over-missing permutations are covered and the reducer is insertion-order independent.
- Fixed-metadata disagreement / mutation order: the complete target canonical claim is now checked before member-identity filtering or mutation. Member-identity registration, third-identity registration, refresh, GC, and public claimant consumers all refuse the tested live conflict without changing registry/home state.
- Worktree/main fallback: main entry wins when present; the exact surviving worktree entry is used only when the main claim is unavailable.
- Moved-root self-heal: existing moved-root and duplicated-missing-alias regressions exercise unambiguous home-preserving rebind.
- Non-ensuring reads: no config mint, registry creation, home creation, or directory creation was found in `resolveProjectHome(..., { ensure: false })`.
- Normalized registry/config identity: equivalent casing is accepted; genuine drift is refused; selector matches are expanded to same-root aliases before multi-identity and config admission.

## Compact coverage diagram

```text
CODE PATH COVERAGE
==================
[+] canonical registry reduction
    ├─ [★★★ TESTED] direct claimant + equivalent aliases, insertion permutations
    ├─ [★★★ TESTED] unique live alias outranks a missing alias
    ├─ [★★★ TESTED] live conflict blocks register/refresh/GC and retains homes
    ├─ [★★★ TESTED] public claimant preserves conflict; owner consumers refuse (S1 resolved)
    └─ [★★★ TESTED] alias-only A/B conflict rejects explicit ensure for third identity C (P2 resolved)

[+] non-ensuring project home
    ├─ [★★★ TESTED] canonical main entry wins over legacy worktree entry
    ├─ [★★★ TESTED] missing-main exact worktree fallback
    └─ [★★★ TESTED] identity drift returns null with no mutation

[+] Store planning selection
    ├─ [★★★ TESTED] single registry entry vs drifted config by id/name/root
    ├─ [★★ TESTED] equivalent normalized identity succeeds
    ├─ [★★★ TESTED] id/name/root expand to unmatched same-root aliases (P1 resolved)
    └─ [GAP] legacy config with no projectId is retained by code but has no focused child regression

USER FLOW COVERAGE
==================
[+] root-resolving read → alias self-heal → no missing machine home creation [★★★ TESTED]
[+] worktree probe → shared lookup → main home/direct fallback              [★★★ TESTED]
[+] project selector → complete registry root group → config admission     [★★★ TESTED]
[+] knowledge owner id → conflict-aware claimant lookup → canonical owner  [★★★ TESTED]
```

## Recorded verification evidence assessment

- Round 3 independent reviewer run: `pnpm exec vitest run test/core/project-registry.test.ts -t "refuses a third identity|refuses conflicting live aliases|collapses canonical aliases|rebinds a moved repo|finds an existing uppercase-UUID entry"` — **5/5 passed**, 45 skipped; the automatic build-if-stale check reported `dist/` matches current sources.
- Round 3 fixer evidence assessed from the dispatch record: full project-registry **50/50 passed**, build green, focused ESLint green, and strict change validation valid. The reviewer did not rerun the full suite or those remaining gates.
- Round 2 recorded red/green evidence: the five new S1/P1 regressions failed before the fixes and passed afterward.
- Round 2 full focused registry/project-home/root-selection/StorePlanning/learned-skills run: **184/184 passed**.
- Round 2 StorePlanning run after the consumer regression: **39/39 passed**; the recorded StorePlanning/finalization contract run was **51/51 passed**.
- Round 2 TypeScript compilation, focused ESLint, strict change validation, scoped diff check, and strict UTF-8/BOM/mojibake checks were recorded green.
- Focused registry/project-home/root-selection/Store-planning run: **159/159 passed**.
- Native Windows CI-style registry/project-home/root-selection run: **124/124 passed** with `VITEST_MAX_WORKERS=2`.
- Final focused `project-registry` run: **48/48 passed**.
- TypeScript compilation and focused ESLint: recorded green.
- Strict change validation: recorded valid.
- The original Windows results are documented in `evidence/windows-registry-root-selection.md`; the Round 2 results and remaining gates were supplied in the dispatch record. This reviewer did not rerun tests or gates, did not treat `evidence/review-cycle-report.md` as proof, and assessed coverage from the implementation, regression sources, and recorded command outcomes only.
- No external Codex/Claude review process was invoked.

## Final disposition

**CLEAN for the assigned child.** S1, P1, and P2 are all independently resolved with final canonical counts of 0 Blocker, 0 Major, 0 Minor, and 0 Trivial. On this child-specific evidence, `fix-project-registry-alias-safety` is ready to return to the parent review/landing flow; concurrent sibling work remains outside this disposition.

## Durable findings

1. Conflict state must survive the canonical claimant API boundary; returning only a preferred representative is unsafe for identity-scoped consumers.
2. Project selection must expand from a selector match to the complete canonical-root registry group before registry/config identity admission.
3. A mutation gate must inspect the target canonical claim independently of the incoming identity; otherwise an identity absent from the conflicted aliases can bypass the gate.
