# Review Report — phase0d-router

**Reviewer:** isolated reviewer (author != verifier). **Mode:** read-only (no source edits, no git writes).
**Repo:** `Reference/OpenSpec-code` @ branch `dev-harness`, HEAD `3a70bd4` (note: sibling `add-context-handoff` has since been **archived/merged** — its handoff workflow+command are now committed baseline, not in-flight working tree).
**Scope:** the 2 ADDED specs of phase0d-router only — `navigator-router-skill` + `skill-user-invocation-support`.

## Verdict

**DONE_WITH_CONCERNS.** The navigator change itself is **clean and complete** — 0 Blockers and 0 Majors *attributable to navigator*. All navigator-owned assertions pass; tsc, skill:check, and `openspec validate --strict` are green. The single Major below is a **pre-existing, sibling-owned** red (2 command-count tests) that navigator correctly does not touch and cannot green from within its scope.

| Severity | Count |
|----------|-------|
| Blocker | 0 |
| Major | 1 (attribution: sibling `add-context-handoff` / committed baseline — **not** navigator) |
| Minor / Note | 4 (all informational; no action required for merge) |

---

## Verification run (reviewer self-executed)

| Gate | Result |
|------|--------|
| `npx tsc --noEmit` | **exit 0** — the `SkillTemplate` field + `generateSkillContent` + `navigator.ts` edits compile |
| `npx vitest run skill-generation.test.ts skill-templates-parity.test.ts` | **30 passed / 2 failed** — the 2 failures are the sibling's command-count assertions (see M1); every navigator-owned assertion passes; parity suite fully green |
| `npm run skill:check` | **exit 0** — `navigator/SKILL.md` reported FRESH (all 30 experts FRESH) |
| `npx openspec validate phase0d-router --strict` | **exit 0** — "Change 'phase0d-router' is valid" |
| leakage grep (`disable-model-invocation` across generated `skills/gstack/*/SKILL.md`) | **only `navigator/SKILL.md`** — no other generated skill emits the line |
| sibling files (`profiles.ts`, `workflows/handoff.ts`, `profiles.test.ts`) | **untouched** by navigator (git status clean for all three) |

---

## MAJOR

### M1. `skill-generation.test.ts` file is not fully green — 2 residual failures, both the sibling's command-count staleness (NOT navigator)

**Evidence — the committed HEAD baseline is internally inconsistent.** At HEAD `3a70bd4` (which archived `add-context-handoff`), `git show HEAD:` shows the handoff **command** is committed into `getCommandTemplates` (`{ template: getOpsxHandoffCommandTemplate(), id: 'handoff' }`, L191) and the handoff **workflow skill** into `getSkillTemplates` (L122) — but *none* of the count assertions were updated: HEAD still asserts `17 command templates` (L105), `17 command contents` (L167), and `17 workflow + 29 expert` = `46` skill templates (L11). So at HEAD, before navigator, the file already fails 3 assertions (skill-templates 46 vs actual 47; command-templates 17 vs 18; command-contents 17 vs 18).

**What navigator does with it.** Navigator's working tree adds one **expert** (no command) and updates only the four **skill-template** count assertions to the true runtime values — `48` (18 wf + 30 expert), `34`, `30`, `31` — plus the `18 workflow` / `30 expert` comments. This greens the skill-template count (verified: passes). Navigator's diff **does not touch** L105/L167 (the command counts) — confirmed by `git diff` on the test file — because commands are the sibling's territory and navigator adds no command.

**Net:** with navigator applied, the 2 remaining red tests are `getCommandTemplates` (17 vs 18) and `getCommandContents` (17 vs 18), and both are **100% attributable to `add-context-handoff`**, which added the handoff command but left the command-count assertions stale when it archived. This is exactly the independent-attribution split the LEAD asked to confirm — **confirmed**.

**Why this is Major (not a navigator Blocker):** the change's `tasks.md` 4.4 is checked, and navigator's *own* assertions do pass — but the `skill-generation.test.ts` **file** ships red (2 failures), which will trip CI, and neither the proposal nor tasks flags that a sibling-owned red remains after this change lands. A merger needs this stated.

**Recommendation:** fix the sibling's stale command counts (`17 → 18` at L105 and L167) as a sibling follow-up or a one-line baseline fixup — **do not** widen navigator's scope to own them. Navigator's role-isolation discipline here is **correct**.

---

## MINOR / NOTES (informational — no merge action required)

- **N1 — count guidance was itself stale, implementer did the right thing anyway.** The proposal (L47) instructed "apply +1 to the current committed value (46) — don't hardcode 47". But committed `46` was already 1 low (the sibling hadn't updated it), so a mechanical `46+1 = 47` would have been **wrong** (true value is 48). The implementer instead landed on the correct `48` (18 wf + 30 expert). Outcome correct; the guidance's premise (that the committed base was current) was the imprecise part. No action.

- **N2 — the two expert duplicates `/ship` and `/office-hours` appear in the map only via their `/opsx:ship` and `/opsx:office-hours` command forms.** All 30 expert dirs are accounted for: 27 experts named directly in on-ramps/vocabulary/standalone, `investigate` in on-ramps, and `ship`+`office-hours` represented through their OPSX-command cousins in main-flow/on-ramps (deliberate per proposal §1). **No hallucinated entries** — every `/name` in the map resolves to a real installed skill or command. Not a defect.

- **N3 — `/handoff` now exists in the fork (sibling added it) but the map does not reference it.** Navigator was authored when handoff was fork-absent (design D4 lists it among skills-not-to-reference). Adding `/opsx:handoff` to the map is a reasonable *future* touch-up but is out of this change's scope and not required. Not a defect.

- **N4 — generated `navigator/SKILL.md` injects the full gstack `{{PREAMBLE}}`** (AskUserQuestion format, Completeness Principle, Repo Ownership, eureka logging, Completion Status, Plan Status Footer). This is **required by task 1.1** and identical to every other gstack skill. Because the skill is `disable-model-invocation: true` with a stripped human-facing description, it carries **zero standing context load** and only expands the preamble when a human invokes `/navigator`. Not a defect.

---

## What was verified clean (positive evidence)

**Mechanism (Option A) — correct.**
- `types.ts`: `disableModelInvocation?: boolean` added as an optional field with a doc comment (L12-13). Non-breaking.
- `skill-generation.ts` `generateSkillContent`: conditional `disableModelInvocationLine` emitted **only when the flag is set**, placed immediately before the `license:` line inside the fixed frontmatter; all other fields (`name`, `description`, `license`, `compatibility`, `metadata`) unchanged (satisfies `skill-user-invocation-support` scenarios 1-3).
- `navigator.ts`: sets `disableModelInvocation: true` and the human-facing router `description`; mirrors `investigate.ts` structure (readFileSync of `skills/gstack/navigator/SKILL.md`, frontmatter strip, `name: 'gstack:navigator'`, `metadata { author: 'openspec', version: '1.0' }`).
- New test asserts **both directions** — flag-set content contains `disable-model-invocation: true`, flag-unset content does not (passes).
- **No leakage:** among all generated `skills/gstack/*/SKILL.md`, only `navigator/SKILL.md` carries the line.

**Registration chain — complete, mirrors the expert pattern.** `experts/navigator.ts` created; `experts/index.ts` export; `skill-templates.ts` re-export; `skill-generation.ts` import + `getSkillTemplates()` expertSkills entry (`dirName: 'openspec-gstack-navigator'`, `workflowId: 'navigator'`); `AGENTS.md` `/navigator` row. All four wire-points present.

**Shared-file discipline — respected.** `git diff` on `skill-templates.ts`, `experts/index.ts`, `skill-generation.ts` shows **only** navigator-only added lines; the sibling's committed `handoff` lines are present and untouched; `profiles.ts` / `workflows/handoff.ts` / `profiles.test.ts` are zero-touch.

**Count assertions — self-consistent.** Runtime `getSkillTemplates()` = 48 (18 workflow + 30 expert); assertions L11=48, L70=34 (4+30), L89=30 (0+30), L95=31 (1+30) and the `18 workflow` / `30 expert` comments all match and pass.

**Content quality — no hallucination, reflects post-absorb.** Four-part map present (main flow / on-ramps / vocabulary / standalone); each named entry has a one-line "when to reach for it"; `/investigate` = "refuses to hypothesise until it has a red-capable feedback loop … regression test" (0d-absorb, diagnosing-bugs merged); `/review` = "two-axis … Standards + Spec … reported side by side" (0d-absorb). No fork-absent grill skill referenced (`/to-prd`, `/to-issues`, `/implement`, `/triage`, `/improve-codebase-architecture`, `/research`, `/teach`, `/grill-*`, `/handoff`, `/setup-matt-pocock-skills` all absent). MIT NOTICE `<!-- adapted from mattpocock/skills (MIT, Copyright Matt Pocock) -->` present after frontmatter. Faithful adaptation of ask-matt's shape (verified against the grill source, which itself is `disable-model-invocation: true` with a router description).

**Generated frontmatter — user-invoked both layers.** Rendered `navigator/SKILL.md` frontmatter carries `disable-model-invocation: true` and a human-facing `description` with no "Use when …" trigger list; and because `navigator.ts` sets the `.ts` flag, the install-time `generateSkillContent` re-emits `disable-model-invocation: true` even though the source frontmatter is stripped — so the flag survives the strip→regenerate path.

---

## Attribution conclusion (as asked)

- **navigator-owned work:** clean. 4 skill-template count assertions + comments correct; mechanism correct with no leakage; registration complete; shared-file discipline intact; content free of hallucination and reflecting the post-absorb reality; MIT + user-invoked frontmatter verified. tsc / skill:check / openspec validate green.
- **residual 2 red tests:** `getCommandTemplates`(17→18) and `getCommandContents`(17→18) — **independently attributable to the sibling `add-context-handoff`**, which committed the handoff command without updating command-count assertions. Navigator neither caused them nor is scoped to fix them. Fix belongs to the sibling/baseline.
