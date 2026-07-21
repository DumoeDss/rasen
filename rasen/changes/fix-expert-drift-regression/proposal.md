## Why

The shared profile/delivery drift detector (`hasToolProfileOrDeliveryDrift` / `hasProjectConfigDrift` in `profile-sync-drift.ts`) reports **false-positive drift** for `custom` profiles, producing a spurious "your config has drifted, run sync" warning on a correctly-synced machine.

Root cause (confirmed by reproduction, not inference): after the expert-install-flip (`6f7ae96`), expert *presence on disk* is governed by the resolved profile **plus dependency closure** (spec `profiles`: "Installed experts SHALL be governed by the resolved profile plus dependency closure"), while the *stored* profile selection is deliberately **not** closure-expanded (spec `profiles`: a stored profile "SHALL NOT be auto-expanded with closure-pulled experts"). The drift detector compares the un-expanded stored set against the closure-governed disk contents, so every closure-required expert on disk (e.g. `cso`, `design-review`, `qa`, `qa-only`, `review` pulled in by pipeline workflows) is misread as a "deselected workflow whose skill dir lingers" → drift.

Reproduction on this machine, through the exact production path (`resolveCurrentProfileState` → `hasProjectConfigDrift`, the call at `profile-editor.ts:299`):
- custom profile, pipeline workflows selected, experts not explicitly listed → `state.workflows` = 20 ids, missing `["cso","design-review","qa","qa-only","review"]`; those experts ARE installed on disk; `hasProjectConfigDrift(state.workflows)` = **true** (spurious). Passing the closure-resolved set returns the correct **false**.
- `core` / `full` profiles are unaffected (their profile set already contains every expert they close over).

This is a **live product bug**, not merely a test issue. `rasen update`'s sync detection (`update.ts:218`) happens to pass the closure-resolved set and is correct; the profile editor's drift warning (`profile-editor.ts:299`) passes the un-expanded set and is wrong. The `command-file-id.test.ts` failure diagnosed under `fix-management-api-windows` is the same defect surfacing in a test (it passes a raw list too) — split out to here.

## What Changes

- Make the drift detector **foolproof**: `hasToolProfileOrDeliveryDrift` (and thus `hasProjectConfigDrift` / `getToolsNeedingProfileSync`) SHALL evaluate the desired workflow selection as its **dependency closure** before the deselection comparison, using the same closure primitive the install/removal seam uses (`resolveWorkflowSelection(..., { includeSkillDependencies: true })`). This is idempotent for callers that already pass a closure-resolved set (`update.ts`), and corrects callers that pass the un-expanded stored set (`profile-editor.ts`). Resolving inside the boundary — rather than fixing one caller — prevents recurrence; the caller mistake has already happened twice (profile editor + the test).
- Update `command-file-id.test.ts`'s drift assertion: it becomes correct-by-construction under the foolproof API (the raw list it passes is now closure-expanded internally). No behavioral test change beyond re-greening.
- Add regression coverage asserting a `custom` profile with omitted closure experts reports **no** drift.

Non-goal: changing what the profile stores (it stays un-expanded, per spec `profiles`), the install/removal semantics, or `rasen update`'s already-correct behavior.

## Capabilities

### New Capabilities
<!-- None. -->

### Modified Capabilities
- `profiles`: add the guarantee that profile/delivery **drift detection** evaluates the desired selection as its dependency closure, so a closure-required expert present on disk is never reported as drift. Reconciles the existing "stored profile is not closure-expanded" and "installed experts are closure-governed" requirements at the detection boundary.

## Impact

- **Product code:** `src/core/profile-sync-drift.ts` (closure-expand the desired set inside `hasToolProfileOrDeliveryDrift`). No change to `profile-editor.ts` / `update.ts` callers required (the fix is caller-agnostic); optionally tighten a JSDoc contract note.
- **Test code:** `test/core/command-generation/command-file-id.test.ts` (re-greens); new regression test for the custom-profile no-drift case.
- **No version bump.** No change to stored config shape, install/removal, or `rasen update` output.
- **Cross-platform** fix — the bug is not OS-specific (it was merely first observed via a Windows test run).
