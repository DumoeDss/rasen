## Context

Phase C, the final child. The CLI now emits `nextWorkflows` (child 2, `src/core/workflow-chain.ts` + `instructions`/`status`), but workflow skill bodies still hardcode the chain and use `/rasen:*` colon references. Verified against the current tree:

- **C1 steering sites:** `apply-change.ts:56/94/125` ("steer to verify + ship, `/rasen:verify` → `/rasen:ship`"), `continue-change.ts:53` ("Next: implement with `/rasen:apply`"). (`goal-iterate.ts:28` uses "steer" in an unrelated sense — not a chain nudge.) The spec contract for this steering lives in `lifecycle-stage-sequencing` (two requirements mandating the colon commands).
- **C2 colon surface:** every `src/core/templates/workflows/*.ts` with `/rasen:` (help.ts ~19, onboard.ts ~20, ship.ts 13, office-hours.ts 8, …), the navigator router expert (9), and CLI output (`init.ts:927/930`). Specs mandating colon form: `lifecycle-stage-sequencing`, `cli-init` ("Init output uses the rasen namespace"), `workflow-help-command`, `navigator-router-skill`, and `methodology-expert-fusion` (bare-slash `/tdd`).
- **C3 frozen:** `_shared.ts` — verified that **workflow templates do NOT import `_shared.ts`** (grep clean), so freezing it does not block cleaning workflow bodies. Its `/rasen:` refs (`:141-146`, `:349-351`, `:1533-1598`) sit in dispatched-report tables / the spec-review methodology block — the dispatched contract.
- **Residuals:** code is already delivery-free (`grep delivery src/core/update.ts src/core/migration.ts` finds no `delivery:"both"` write); the leftovers are spec-only (`cli-update` migration/drift/deselection, `profiles` drift/config-changes) plus `help.ts:98/125` body wording.

## Goals / Non-Goals

**Goals:**
- Skill bodies relay CLI `nextWorkflows` (no second source of truth for the chain) with a zero-CLI fallback.
- No `/rasen:` colon reference in any generated workflow skill body; cross-references use canonical skill names.
- Grep guard + refreshed parity hashes so the suite stays green and stays clean.
- Close the residual `delivery` leftovers (spec-only) and the `delivery` wording in help.
- No version bump.

**Non-Goals:**
- `_shared.ts` PREAMBLE / dispatched contract / dispatched-report templates — zero changes.
- `ship.ts`/`archive.ts`/`auto.ts` "delivery" (ship-mode) wording — untouched.
- The CLI `nextWorkflows` mechanism itself (done in child 2) — this change only makes bodies relay it.
- Rewriting the brand-identity governance specs (`rasen-cli-identity`, `spec-brand-consistency`) — see D4.

## Decisions

### D1 — Steering becomes a uniform relay slot, contract moved to lifecycle-stage-sequencing
The two `lifecycle-stage-sequencing` requirements currently mandate the colon commands ("SHALL name `/rasen:verify` and `/rasen:ship`"). MODIFY both so apply/continue completion **relay the CLI's `nextWorkflows`** (each named by this tool's invocation for that skill) and carry the zero-CLI fallback ("run `rasen status --change \"<name>\" --json`"). The body no longer encodes the verify→ship→archive order — that lives once, in `workflow-chain.ts`. Rationale: kills the second source of truth and the lean-profile mismatch (core has no verify/ship; the CLI already skips ahead to archive). Alternative rejected: keeping a soft hardcoded hint as a fallback — reintroduces the drift the whole phase removes.

### D2 — Canonical-name + grep-guard as a cross-cutting contract on workflow-next-steps
Rather than restate the naming rule in every skill spec, ADD to `workflow-next-steps`: generated workflow skill bodies and CLI next-step output reference other workflows by canonical skill name (skill-directory form, e.g. `rasen-apply-change`), never the `/rasen:*` colon form; a grep test asserts no `/rasen:` colon reference survives in a generated workflow skill body. The individual colon-mandating specs (lifecycle, cli-init, help, navigator, methodology) are then MODIFIED only to stop *requiring* the colon form (so they don't contradict the guard). Rationale: one normative home for the rule; the per-skill deltas shrink to "don't mandate colon."

### D3 — C4 grep scope = workflow skill bodies, not expert skills
Because `_shared.ts` is frozen (C3) and legitimately keeps colon refs in its dispatched-report tables, a blanket "no colon in any generated skill" would be unsatisfiable. The C4 guard therefore targets the **generated workflow skill bodies** (the 19 workflow templates) plus the navigator router body (a pure cross-reference map). Expert skills that embed frozen `_shared.ts` content are out of the guard's scope; historical/archive docs are whitelisted. Rationale: keeps C3 and C4 non-contradictory while still hard-gating the surface Phase C actually rewrites.

### D4 — Brand-identity colon-form governance left as backlog
`rasen-cli-identity:59` states "the slash-command prefix SHALL be `rasen:` (hyphen form `rasen-` for tools without colon support)" and `spec-brand-consistency` governs brand tokens. Post-skills-only every tool uses the skill-directory (hyphen) form, so the colon-primary framing is stale — but it is not a false hard contract (the hyphen-fallback clause already covers reality), and rewriting the brand governance specs is a distinct branding decision the user should own. Decision: do NOT touch them here; log as post-portfolio backlog. This change scopes colon-form removal to skill bodies + CLI hints + the specs that *mandate* colon output (cli-init/help/navigator/lifecycle), per the LEAD's explicit scope.

### D5 — Parity hashes are an explicit task, not a discovered red suite
Every touched template body changes both its function-payload hash and its generated-skill-content hash in `skill-templates-parity.test.ts`. Make hash regeneration an explicit task so the implementer regenerates deliberately (and eyeballs the diff) rather than rubber-stamping a red suite green.

### D6 — Residual delivery scrub is spec-only and bounded
Code is already delivery-free. The `cli-update` and `profiles` residuals are stale spec text; MODIFY/REMOVE the affected requirements. The one item that was a genuine false contract — `cli-update` "One-time migration" spec claiming a `delivery:"both"` write — is corrected to match the shipped code. `help.ts:98/125` delivery wording is body text removed under C2. Truly out-of-scope wording (e.g. the `profiles` Purpose prose, which delta specs cannot target cleanly) is listed as post-portfolio backlog.

## Risks / Trade-offs

- **Body relay diverges from CLI reasons** → the relay slot instructs the skill to transcribe `nextWorkflows` verbatim (workflow + reason), not to paraphrase a chain; a fixture test checks the apply skill body contains the relay-and-fallback instruction, not a hardcoded `verify`/`ship`.
- **Grep guard collides with frozen `_shared.ts`** → D3 scopes the guard to workflow skill bodies + navigator; expert dispatched content whitelisted.
- **Parity suite churn hides a real regression** → D5 makes hash regen explicit and diff-reviewed; the grep guard + a body-content assertion catch semantic drift independently of the hashes.
- **Over-reach into ship-mode "delivery"** → non-goal is explicit; only the command/skills-delivery wording (help.ts) is removed, never ship.ts/archive.ts/auto.ts.
- **Brand-governance divergence** (D4 leaves colon-form in identity specs while bodies drop it) → identity spec's hyphen-fallback clause keeps it non-contradictory; logged as backlog.

## Open Questions

- Whether the CLI init hint should print the exact tool-specific invocation (`/rasen-propose` on Claude Code) or a tool-neutral "run the rasen-propose skill." Recommend the skill-directory name (`rasen-propose`) as the canonical, tool-neutral form; implementer discretion on exact phrasing. Not spec-pinned beyond "not the colon form."
