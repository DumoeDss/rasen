## Why

A1 vendored the chrome-use CDP proxy and registered a self-contained `chrome-use` expert skill, but the existing expert skills that actually drive a browser — QA, design review, benchmark, office-hours — still instruct the reader to call the `$B` browse binary (via shared blocks in `src/core/templates/experts/_shared.ts`). This change (batch A2) rewrites those browse-coupled shared blocks and their consuming expert templates to drive chrome-use over its curl endpoints (`localhost:3456`), so the generated skills tell users to use the real Chrome the fork ships with. It is the middle A-chain change: it depends on A1's endpoint surface and clears the way for A3 to delete browse.

## What Changes

- **Rewrite the browse-coupled shared blocks in `_shared.ts`**:
  - `BROWSE_SETUP` (:101-118) → a chrome-use SETUP block that runs `check-deps.mjs` and establishes a `targetId` (replacing the browse-binary probe).
  - `SNAPSHOT_FLAGS` (:121-154) and `COMMAND_REFERENCE` (:157-244) → chrome-use curl endpoint reference tables (using the shipped `/snapshot?mode=i|C|D`, `/perf`, `/viewport`, `/responsive` plus the existing endpoints).
  - The `$B`-heavy methodology blocks `QA_METHODOLOGY` (:325-601), `DESIGN_METHODOLOGY` (:603-932), and `DESIGN_SKETCH` (:1402-1458): every `$B <cmd>` invocation becomes a `curl localhost:3456/<endpoint>` call with the `targetId` lifecycle. (60 `$B` occurrences total across `_shared.ts`, concentrated in these blocks — the bulk of the work.)
- **Rewrite the 6 rewrite-class consumer expert templates** whose generated content changes through the shared blocks: `qa`, `qa-only`, `design-review`, `design-consultation`, `benchmark`, `office-hours` — adjust any template-local `$B`/browse wording to chrome-use curl + targetId.
- **Update the 2 prose-class templates** (`navigator`, `verify-enhanced`): text-only — replace browse-specific wording (e.g. navigator's `/browse` "headless Chromium" bullet) with chrome-use / real-Chrome framing; no methodology mechanics.
- **Freeze `browse.ts` (the 7th browse consumer) minimally**: it is deleted next in A3, so it is NOT rewritten. It is decoupled from the rewritten shared blocks (given a frozen inline copy of the browse constants it imports) so the build keeps compiling with byte-identical browse output — leaving a clean deletion seam for A3.
- **Regenerate the parity golden hashes** for every edited template in both `EXPECTED_FUNCTION_HASHES` and `EXPECTED_GENERATED_SKILL_CONTENT_HASHES` (`test/core/templates/skill-templates-parity.test.ts`).

No experts are added or removed (count stays 20). Endpoint names/params are kept exactly consistent with the shipped proxy and `skills/experts/chrome-use/references/cdp-api.md`.

## Capabilities

### New Capabilities
- `chrome-use-expert-methodology`: The browser-driving expert skills (QA, design review, design consultation, benchmark, office-hours) and the shared methodology blocks instruct the reader to drive the vendored chrome-use CDP proxy via its curl endpoints with a `targetId` lifecycle — replacing the `$B` browse-binary commands — while preserving snapshot/perf/viewport/responsive coverage; navigator's command guide points to chrome-use instead of browse.

### Modified Capabilities
<!-- None. browse-integration removal is A3. chrome-use-integration (A1) is not yet in main specs; A2's consumer-side contract is expressed as a new capability. -->

## Impact

- **Code**: `src/core/templates/experts/_shared.ts` (6 blocks); `qa.ts`, `qa-only.ts`, `design-review.ts`, `design-consultation.ts`, `benchmark.ts`, `office-hours.ts`, `navigator.ts`; `src/core/templates/workflows/verify-enhanced.ts` (prose scan); `browse.ts` (decouple/freeze only).
- **Tests**: `test/core/templates/skill-templates-parity.test.ts` — regenerate hashes for edited templates in both maps. The 4 expert-count assertions in `test/core/shared/skill-generation.test.ts` stay at 20 (no expert added/removed).
- **Behavioral contract**: generated QA/design/benchmark/office-hours skills now curl `localhost:3456` endpoints; `/perf` reports LCP/FCP/CLS/resource timing but not reliable long-task counts (A1 accepted Minor) — methodology text must not promise long-task numbers or must caveat them.
- **Depends on**: A1 (endpoint surface + chrome-use skill). **Unblocks**: A3 (browse deletion) via the frozen `browse.ts` seam.
