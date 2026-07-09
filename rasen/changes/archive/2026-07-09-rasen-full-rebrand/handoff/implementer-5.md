# Handoff — rasen-full-rebrand (implementer-5)

Reason: 5.3 test sweep + Group 6 docs complete and the full suite is green; the one
remaining code task (5.1 `git mv openspec rasen`) is **blocked on a shared-tree
conflict that contradicts the original brief** and needs LEAD adjudication, not a
lone worker forcing a 1036-file git move.

## Status at handoff

- **Build**: `node build.js` GREEN.
- **Tests**: full `pnpm test` (vitest) = **120 files / 2201 passed / 22 skipped / 0 failed**.
  Verified twice; a single transient failure on one run was the known Windows
  CLI-spawning flake (EBUSY/parallel-load), green on isolated + repeat full run.
- tasks.md checkboxes updated: 2.1–2.4, 3.x, 4.1–4.3, 5.2, 5.3, 6.1, 6.2, 6.3 done.
  Open: **5.1 (blocked)**, 5.4 (local green; CI matrix pending push), 2.5/4.4
  (unit contracts already tested & green; named integration rounding optional).

## 5.1 — BLOCKED: do NOT blindly `git mv openspec rasen`

The brief said "an UNTRACKED, empty-in-git `rasen/` blocks the mv; clear it, then
`git mv openspec rasen`." **That premise is now false.** Current tree state:

- `git ls-files openspec/` = **1036** tracked files (the real workspace, incl. this
  change dir `openspec/changes/rasen-full-rebrand/`).
- `git ls-files rasen/` = **12** tracked files — an archived change
  `rasen/changes/archive/2026-07-09-office-hours-dialogue-override/`, committed by a
  **different concurrent session** (`8c47a06 chore(rasen): archive
  office-hours-dialogue-override`). That change exists **only** under `rasen/`
  (0 files under openspec/ for it).
- Only untracked scrap left is `rasen/config.yaml`.

So another actor has already started treating `rasen/` as the workspace root on this
**shared working tree**. A wholesale `git mv openspec rasen` now either fails (rasen/
exists as a populated dir) or, done piecemeal, risks clobbering/conflicting with that
session's committed work. This is a cross-session coordination decision.

**Recommended path for whoever resolves it** (LEAD to confirm):
1. Decide ownership of the `rasen/office-hours-dialogue-override` archive (keep in place).
2. Move openspec/ *contents* into rasen/ (merge trees), not `git mv openspec rasen`:
   `git mv openspec/specs/* rasen/specs/`, `git mv openspec/changes/* rasen/changes/`
   (mind the already-present archive), then the config + change dir. Verify with
   `node bin/rasen.js status --change rasen-full-rebrand --json` resolving from rasen/.
3. After the move, re-run full `pnpm test` (fixtures use temp dirs, so unaffected, but
   confirm) and grep for any newly-orphaned `openspec/` self-references.

Until then, root resolution requiring `rasen/` is already shipped (slice 1.4); this
repo's own workspace simply still lives at `openspec/`.

## 5.2 — done, no CI coupling

- schemas/spec-driven/schema.yaml + templates/proposal.md guidance: `openspec/specs/`→`rasen/specs/`.
- hooks/compact-recovery.sh: `openspec pipeline resume`→`rasen pipeline resume`,
  `openspec/changes/`→`rasen/changes/`.
- `.github/workflows/*` have **no** `openspec/` workspace-path refs (only a
  commented-out `openspec-docs` Pages project name in deploy-docs.yml — infra, left).
  So CI is NOT coupled to the 5.1 mv.

## 5.3 — behavioral rewrites & whitelist reversions worth remembering

- init.test.ts / update.test.ts: rewrote for the new coexistence behavior; **deleted**
  the obsolete `describe('legacy cleanup')` and `describe('legacy tool upgrade')` blocks
  in update.test.ts (that machinery was removed in 4.2 — notice-only now).
- Predecessor over-swept several `format:'openspec'` assertions to `'rasen'`; reverted
  json-converter.test.ts + spec.test.ts back to `'openspec'` (Non-Goal whitelist).
- global-config.test.ts `migrateLegacyBrandConfig` block was mis-swept (legacy dir must
  be `openspec`, new dir `rasen`); fixed so it actually exercises the copy.
- pipelines/full-feature/pipeline.yaml referenced `rasen-office-hours` (predecessor
  applied the legacy double-prefix *collapse* rule); the real fusion skill name is
  `rasen-office-hours-command` — fixed.
- src/core/completions/command-registry.ts: added the missing `migrate` command entry
  (flags `--no-interactive`, positional `[path]`) so the Commander↔registry parity test passes.
- test/vocabulary-sweep.test.ts: allow-listed `workspace_detected` (surfaced by its regex
  from the intentional `legacy_workspace_detected` RootSelectionError code, slice 1.4).
- test/fixtures/tmp-init/openspec → `git mv` to rasen/ (fixture workspace).

## ESCALATION — telemetry endpoint (out of scope, needs a decision)

src/telemetry/index.ts POSTs to `https://openspec-telemetry.ws11579.workers.dev`.
The predecessor changed the *test* constant to `rasen-telemetry...`. I **reverted the
test to match shipped src** (openspec-telemetry) rather than rename the live endpoint,
because: (a) the endpoint is not in this change's proposal/design; (b) project memory
records the telemetry backend as another session's concern with the final endpoint being
the `telemetry.rasen.io` custom domain (TLS still provisioning); (c) repointing a live
fire-and-forget URL is outward-facing/hard-to-reverse. **The `openspec-`branded telemetry
hostname is a real brand leak** — LEAD/telemetry-session should decide the canonical
endpoint (likely telemetry.rasen.io) and update src + test together.

## Group 6 docs — follow-ups (non-blocking)

- 72 docs/website files swept mechanically (`/opsx:`→`/rasen:`, workspace paths,
  `openspec `binary→`rasen `; package names/URLs/`.openspec.yaml`/`.openspec-store`
  protected via lookbehind). installation.md + zh + local-install.md had the wrong
  install package (`@fission-ai/openspec`) → fixed to `rasen`; nix repo → DumoeDss/rasen.
- Left intentionally: historical/upstream-analysis docs (upstream-v1.5-stores-and-resolution
  [+zh], handoff-2026-07-06-*, grill-gstack-absorption, review-cycle-workflow-design) —
  verbatim record, matches vocabulary-sweep exemptions.
- Remaining prose polish (not done): `docs/opsx.md` / `docs/opsx-workflow-guide.md`
  **filenames** unchanged (renaming needs cross-link updates); some capitalized "OpenSpec"
  brand mentions in prose remain where ambiguous between product name and upstream reference.
