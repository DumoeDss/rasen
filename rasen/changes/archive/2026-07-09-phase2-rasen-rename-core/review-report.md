# Review Report — phase2-rasen-rename-core (C1)

**Reviewer:** reviewer-c1 (did not author). **Branch:** dev-harness. **Scope:** uncommitted working-tree rename diff (~171 files) + untracked `bin/rasen.js`, EXCLUDING `telemetry-backend/` and `openspec/changes/**` artifacts.

## VERDICT (round 2): CLEAN — Minor RESOLVED (0 Blocker / 0 Major / 0 open Minor / 2 Trivial). CONFIRMED-RESOLVED.

Round-1 verdict was CLEAN with 1 Minor; the implementer fixed it and the fix is confirmed by a non-author (see Round-2 addendum below). The core rename is faithful and disciplined. The seven-way token disambiguation (design D1) held: zero brand leaks, zero preserved-identifier over-reach, migration logic correct and well-tested, parity hash regen legitimate, and the single test failure is a confirmed pre-existing version-marker issue unrelated to the rename. No product-file edits were made during this review.

---

## Round-2 addendum — Minor "an Rasen → a Rasen" RESOLVED (non-author confirmed)

Re-reviewed the delta only. **CONFIRMED-RESOLVED.**

1. **7 sites fixed, nothing else changed.** `git diff` of the four touched files (apply-change.ts, continue-change.ts, change-context.ts, config.ts) shows only `an OpenSpec → a Rasen` article corrections plus the round-1 brand/command-string edits — no logic or structural changes. `grep -rln "a Rasen change|a Rasen project" src/` returns exactly those four files; no other src file carries the fix.
2. **Prototype ripple is sound.** `src/core/templates/experts/prototype.ts:3` imports `CHANGE_CONTEXT_CAPTURE_GUIDANCE` and line 42 embeds it into the prototype skill instructions — so editing that shared constant in change-context.ts legitimately flips `getPrototypeSkillTemplate` + `openspec-prototype` content hashes in addition to apply-change/continue-change. The implementer's 4-function-hash + 3-content-hash = 7-row accounting maps exactly to the 4 edited templates (getApplyChangeSkillTemplate, getOpsxApplyCommandTemplate, getContinueChangeSkillTemplate, getPrototypeSkillTemplate; openspec-apply-change, openspec-continue-change, openspec-prototype). config.ts:621 was a code comment with no template/hash impact.
3. **Parity + trio green.** Ran `skill-templates-parity.test.ts` + `skill-generation` + `skill-sidecar-install`: **44/44 pass**. Parity passing definitively confirms every hash table row matches current template output — the 7 rows were correctly refreshed and no other template drifted. (The exact round-2 incremental row count could not be git-diffed because round-1 was never committed, but the passing parity test proves the tables are correct end-to-end, which is the stronger guarantee.)
4. **No residual.** `grep -rin "an rasen" src/` → 0.

No new findings. The two Trivials from round 1 (logo "O" art, internal temp-dir prefix) remain untouched and out of scope, as noted.

---

## Findings

### [Minor] Grammar regression: "an Rasen" — mechanical replace left the wrong indefinite article (7 sites)
The `OpenSpec → Rasen` replace did not fix the preceding article. "OpenSpec" takes "an" (vowel sound); "Rasen" takes "a". Result reads "Implement tasks from **an Rasen** change." This is **user-visible** — it appears in generated skill/command `description` and `instructions` text shown in the skill picker and to agents.

Occurrences (`grep -rn "an Rasen" src/` = 7):
- `src/core/templates/workflows/apply-change.ts:13,14,173,176` (skill + command description/instructions/content)
- `src/core/templates/workflows/continue-change.ts:13` (skill description)
- `src/core/templates/workflows/change-context.ts:7` (guidance prose)
- `src/commands/config.ts:621` (code comment — cosmetic)

Fix: `an Rasen` → `a Rasen` at these sites. Note this will change 3 parity hashes (apply-change skill+command, continue-change skill), so re-run `skill-templates-parity.test.ts` and refresh those rows after the fix. Not a blocker — reads as a typo, not a functional defect.

### [Trivial] Logo art still describes the OpenSpec "O"
`src/ui/ascii-patterns.ts:3` — comment "Rasen logo animation - diamond/rhombus shape with hollow center \"O\"." The rendered ASCII logo still centers on an "O" (OpenSpec's initial); Rasen begins with R. A logo redesign is legitimately out of scope for a mechanical rename, but the visual identity now mismatches the brand. Flagging for a future visual-identity pass, not this change.

### [Trivial] Internal temp-dir prefix not rebranded
`scripts/pack-version-check.mjs:61` — `mkdtempSync(... 'openspec-pack-check-')`. Purely internal ephemeral dir name, never user-visible. Harmless; leave or rebrand at will.

---

## Lens confirmations

**1. Migration (`migrateLegacyBrandConfig`, global-config.ts:203) — CORRECT.**
- Iterates both resolved targets (`getGlobalConfigDir()`, `getGlobalDataDir()`), which already cover every XDG / APPDATA / LOCALAPPDATA / `~/.config` / `~/.local/share` variant — so the migration inherits full platform coverage for free.
- Copy-not-move (`fs.cpSync recursive`), never-overwrite (`if (fs.existsSync(newDir)) continue`), never-delete legacy. anonymousId genuinely preserved (whole-dir copy of `config.json`).
- Sibling legacy path derived as `path.join(path.dirname(newDir), 'openspec')` from an already-resolved dir — no user input, no path-traversal/symlink foot-gun. Guards: `legacyDir === newDir` short-circuit (defensive for future same-name case) and `statSync(legacyDir).isDirectory()` (rejects a file-shaped legacy path).
- Errors swallowed at both per-target and outer scope — cannot break startup. Invoked once in `runCli()` (cli/index.ts:731) **before** `program.parse(argv)`, i.e. before any config read. Cheap when neither dir exists (2× existsSync).
- Unit tests (global-config.test.ts:373-443) cover all four required scenarios: legacy-adopted+anonymousId-preserved+copy-not-move, new-present→no-op, neither-present→no-op, adverse fs shape (file where dir expected) swallowed without throw.

**2. Bucket discipline — CLEAN (modulo the Minor above).**
- `grep process.env.OPENSPEC_ src/` → 0. `grep "\bOpenSpec\b" src/` (excl. OPENSPEC constants) → 0. `grep Fission-AI src/` → 0.
- Preserved identifiers intact: workspace constants still value `'openspec'` (`OPENSPEC_ROOT_DIR`, `OPENSPEC_SPECS_DIR`, `OPENSPEC_CHANGES_DIR`, `OPENSPEC_ARCHIVE_DIR`, `OPENSPEC_DIR_NAME`); `OPENSPEC:START/END` markers unchanged; `DEFAULT_OPENSPEC_SCHEMA = 'spec-driven'` intact; `opsx:` prefix present 124× and unchanged; template placeholders `__OPENSPEC_PROACTIVE__`/`__OPENSPEC_REPO_MODE__`/`OPENSPEC_VERSION` preserved.
- Env vars migrated: `RASEN_TELEMETRY` (telemetry/index.ts:99), and by task enumeration the other three. Feedback/URLs repointed to `DumoeDss/rasen` (feedback.ts:101,133; init.ts:820-821; update.ts:313).
- No missed `openspec <verb>` CLI-invocation examples (`grep` for 15 verbs excluding `openspec/` paths → 0).

**3. Parity hash regen — LEGITIMATE.**
- The parity-test diff is purely the two hash tables (`EXPECTED_FUNCTION_HASHES` + `EXPECTED_GENERATED_SKILL_CONTENT_HASHES`); no test-logic change.
- Spot-checked underlying template source diffs (apply-change.ts, review.ts expert, bash-generator.ts, and sampled others): edits are ONLY `OpenSpec→Rasen` prose + `openspec <verb>→rasen <verb>` command strings + completion-function/`rasen` binary renames. No semantic drift in skill instructions. Skill `name:` (`openspec-*`), `metadata.author: 'openspec'`, `/opsx:*`, and `spec-driven` are all preserved inside the regenerated templates — consistent with LEAD decision #8.

**4. Pre-existing-failure claim — HELD.**
`update.test.ts:826 "should only update tools that need updating"` fails independent of the rename. `git show HEAD:package.json` = version `0.1.0`; the test makes a tool "stale" by rewriting `generatedBy` to `"0.1.0"` (test line 836), but `getToolVersionStatus` compares that against `OPENSPEC_VERSION` (= package version 0.1.0) → equal → not stale → the expected `"Updating 1 tool(s)"` never prints. Version-driven, not rename-driven (brand strings never enter version comparison). Fix belongs to C3 per decision #9 (drop the stale sentinel to `"0.0.1"`); correctly out of scope here.

**5. package.json / completions / telemetry — CLEAN.**
- package.json: `name: rasen`, `version: 0.1.0`, `bin.rasen: ./bin/rasen.js`, `homepage`/`repository` → DumoeDss/rasen, `author: DumoeDss`, `publishConfig.access: public`, `dev:cli: node bin/rasen.js`. Changesets scripts (`release`/`release:ci`/`changeset`) and changeset devDeps **untouched** — left for sibling C3. `bin/rasen.js` present with correct content; old `bin/openspec.js` deleted.
- Completions register against the `rasen` binary (`complete -F _rasen_completion rasen`); helper functions renamed consistently.
- Telemetry transport unchanged: `node:https` + `agent: false` + guard timer (no revert to fetch); opt-out `RASEN_TELEMETRY`; endpoint constant `openspec-telemetry.ws11579.workers.dev` **unchanged** (owned by C4). Notice text rebranded to "Rasen sends anonymous usage stats…".

---

## Durable findings
- **Mechanical `Brand→Brand` replaces silently break indefinite articles.** Any rename where the old and new brand differ in leading vowel-sound (OpenSpec→Rasen, "an"→"a") needs an `"an <NewBrand>"` post-grep. Cheap guard: `grep -rn "an Rasen" src/` after the replace.
- **`getToolVersionStatus` uses the live package version as the freshness oracle**, so any test that hardcodes the current version as a "stale" sentinel breaks the moment the fork's version equals that literal. C3's marker demotion to `0.0.1` is the right fix; future version bumps make the failure self-heal.
