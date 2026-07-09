## 0. Setup & guardrails (read before editing)

- [x] 0.1 Read design.md fully — apply the D3 RULESET (R1-R7 rewrite, K1-K7 keep) per token, per file. Never blanket find-replace a file that has any K-flag in its Special column.
- [x] 0.2 Confirm code-truth pins (design "Context"): bin `rasen`; `/rasen:*`; dirNames `rasen-<base>`; workspace `rasen/`; config/data dir `rasen`; `RASEN_TELEMETRY`. Do NOT re-derive — these are verified.
- [x] 0.3 Commit discipline for EVERY commit in this change: stage only the specific spec paths for that batch with an explicit pathspec (`git commit -- rasen/specs/<cap>/spec.md …`), then run `git show --stat HEAD` and confirm ONLY intended files are in the commit. Never `git add -A`; never stage `src/` or other sessions' files.
- [x] 0.4 Baseline: run `node dist/cli/index.js validate --specs` and record it is green BEFORE edits (so any post-edit failure is attributable to this change). BASELINE: 113 passed, 0 failed.
- [x] 0.5 Delta-of-record (already authored at planning time): confirm `specs/spec-brand-consistency/spec.md` exists and states the brand-token governance requirement. This ADDED delta is what makes the change valid and is synced to `rasen/specs/spec-brand-consistency/spec.md` at archive. Do NOT delete it; do NOT add per-capability MODIFIED deltas for the bulk rewrite (see design D1). The direct in-place edits below are the mechanic for the ~78 files. CONFIRMED present and correct.

## 1. Batch 1 — CLI-surface specs (R1 command invocations; R4 paths; R7 prose)

- [x] 1.1 Rewrite the straight-R files: cli-agent-context, cli-artifact-workflow, cli-change, cli-completion, cli-show, cli-list, cli-init, cli-spec, cli-view, change-creation, config-loading, graceful-status-empty, context-injection, docs-agent-instructions, ci-nix-validation, safety-hook, cli-config. Apply R1/R2/R4/R5/R7. For cli-completion: rewrite bin-tied script/identifier names (`_openspec`→`_rasen`, `openspec.fish`→`rasen.fish`, `complete -c openspec`→`-c rasen`, `-CommandName openspec`→`rasen`, `openspec __complete`→`rasen __complete`); leave `isOpenSpecProject` unless a `src/` grep confirms rename (K7). Verified via src/ grep: no rename found, kept per K7 default.
- [x] 1.2 Rewrite the MIXED files line-by-line: cli-archive (keep `.openspec.yaml` L237,241 and `openspec-conventions` spec-ID xrefs L71,84,192), cli-feedback (**R6**: `OPENSPEC_TELEMETRY`→`RASEN_TELEMETRY` L118,170; "OpenSpec CLI version"→Rasen), cli-validate (keep `OPEN_SPEC_INTERACTIVE` L207 unless code confirms rename → F2; verified via src/utils/interactive.ts grep, code unchanged, kept), global-config (keep legacy-detection `openspec` config dir L108).
- [x] 1.3 Rewrite cli-update (high-touch, MIXED): rewrite generated command/file names (`openspec-proposal.md`→`rasen-proposal.md`, `/openspec:archive`→`/rasen:archive`, `openspec/proposal.md`→`rasen/proposal.md`, `openspec update/init/list`→rasen); KEEP `<!-- OPENSPEC:START/END -->` + "OpenSpec-managed" markers (K2) and the already-rewritten rasen-namespace + legacy-detection requirement block (L305-334).
- [x] 1.4 `node dist/cli/index.js validate --specs` → green (113/113). Grep the batch's files for residual positive drift; confirmed only intended keeps remain.
- [x] 1.5 Batch 1 edits complete and verified (21 files). NOTE: per orchestrator instruction, implementer does NOT commit — the ship stage owns commits. Pathspec-scoped commit deferred to ship.

## 2. Batch 2 — schema-surface specs (R1 `openspec schema`; R4 `openspec/schemas`; R5 XDG)

- [x] 2.1 Rewrite straight-R: schema-enhance-field, schema-context-from-field, schema-provider-field, schema-fork-command, schema-init-command, schema-validate-command (`openspec validate` L82→rasen), schema-which-command, artifact-graph (`${XDG_DATA_HOME}/openspec/schemas/`→rasen).
- [x] 2.2 Rewrite schema-resolution (MIXED): rewrite `./openspec/schemas`, `~/.local/share/openspec`, `openspec/config.yaml`, the L155 error-message path; KEEP `.openspec.yaml` L118,171 (K1).
- [x] 2.3 `validate --specs` green (113/113) + residual-drift grep clean. Commit deferred to ship stage per orchestrator instruction.

## 3. Batch 3 — opsx-* / workflow specs (R2 slash; R3 dirNames; R4 paths; R1 pipeline)

- [x] 3.1 Rewrite straight-R: opsx-auto-command, opsx-goal-command (skill names collapse: `openspec-opsx-goal`→`rasen-goal`, `openspec-goal-*`→`rasen-goal-*`), opsx-office-hours-command, opsx-onboard-skill, opsx-orchestration, opsx-retro-command, opsx-ship-command, opsx-verify-skill, goal-loop-workflow, orchestration-handoff, specs-sync-skill, session-relay, pipeline-handoff-config, worker-reuse-config, compact-recovery-hook, investigate-diagnosing-absorption, navigator-router-skill. KEEP capability titles (K6) and `getOpsx*CommandTemplate` code identifiers (K7). Found and fixed a double-brand collapse bug (`openspec-opsx-goal` initially became `rasen-rasen-goal` via independent word matches) — corrected to single `rasen-goal` per code truth (goal-command.ts:99).
- [x] 3.2 Rewrite MIXED: opsx-archive-skill (keep `.openspec.yaml` L140), opsx-pipeline-registry (keep title; rewrite pipeline cmds/paths/prose), opsx-verify-enhanced-command (dirNames→rasen-*), workflow-handoff-command (skill/command paths→rasen), review-cycle-workflow (skills→rasen-*; keep `getOpsxReviewCycleCommandTemplate`; verified `opsx-orchestration` playbook name is a K6 folder-ID xref, kept), review-two-axis-absorption (`openspec-review`→rasen-review; "OpenSpec change"→Rasen change), propose-workflow (keep `.openspec.yaml` L13; rewrite `openspec new change`→rasen new change, `/opsx:propose`→/rasen:propose).
- [x] 3.3 goal-loop-validation: rewrite `openspec pipeline show`→rasen; verified `docs/opsx-workflow-guide.md` still exists under that literal filename in the repo (docs/opsx-workflow-guide.md, docs/zh/opsx-workflow-guide.md) — KEPT reference unchanged (OQ3, matches reality).
- [x] 3.4 `validate --specs` green (113/113) + residual-drift grep clean. Commit deferred to ship stage.

## 4. Batch 4 — expert / skill-integration specs (R3 dirNames dominant)

- [x] 4.1 Rewrite: add-grill-expert-skills (`openspec-codebase-design/tdd/prototype`→rasen-*; `.claude/skills/openspec-*`→rasen-*; kept L39 negative assertion `openspec-domain-modeling`/`openspec-gstack-*` unchanged, K2/K5), skill-sidecar-install (install dirNames→rasen-*), chrome-use-integration (`openspec-chrome-use`→rasen-chrome-use; "OpenSpec package"→Rasen).
- [x] 4.2 Rewrite MIXED carefully: gstack-skills-integration (rewrote `openspec init` + dirNames + "OpenSpec package"; verified and KEPT the gstack→OpenSpec `~/.openspec/` migration refs L72-84 as historical/K4), methodology-expert-fusion (slash/dirNames/prose→rasen; kept `openspec/changes/archive/` exempt-clause L44 and the parallel `openspec-domain-modeling` negative assertion, K4/K5).
- [x] 4.3 skill-name-prefix (careful — this spec IS the rename): rewrote stale purpose L4 and requirement headers L15,43 to `rasen`; **KEPT** the FROM-side of rename mappings L48-51 (`openspec-* → rasen-*`) and negative assertions L41,57 (K5).
- [x] 4.4 expert-template-inlining: grepped `src/` for `__OPENSPEC_PROACTIVE__`/`__OPENSPEC_REPO_MODE__` — code still uses those literal tokens verbatim (src/core/init.ts:662-663) — KEPT L41 unchanged (K7), no edit made.
- [x] 4.5 `validate --specs` green (113/113) + residual-drift grep clean. Commit deferred to ship stage.

## 5. Batch 5 — prose / branding specs (R7 dominant; heavy K3/K5)

- [x] 5.1 Rewrite: ai-tool-paths (L4→Rasen), telemetry-backend (L4→Rasen CLI), profiles (`openspec config profile/update/init`→rasen; `~/.config/openspec/config.json`→rasen).
- [x] 5.2 Rewrite MIXED carefully: branding-migration (L4,32 "OpenSpec branding"→Rasen branding; verified `~/.openspec` L82 against skills/experts/review/greptile-triage.md — code truth confirms this state-directory literal is still unrebranded, kept), telemetry (product prose + `openspec` cmds→rasen; KEPT `RASEN_TELEMETRY` L36 and `edge.openspec.dev` negative L73,141,149), command-generation (prose + generated metadata values 'OpenSpec Explore'/'OpenSpec' category→Rasen — noted the underlying category code literal is actually `'Workflow'`, not OpenSpec/Rasen, a pre-existing behavioral inaccuracy logged to design.md follow-ups, not fixed here; rewrote `openspec init` L132,138; **KEPT** negative assertion L71, `OpenSpec-managed`/`OpenSpec markers` L140,141, and legacy-detection L126), openspec-conventions (meta-spec: KEPT H1 title `# OpenSpec Conventions Specification` verbatim per explicit design instruction; rewrote all self-referential body prose to Rasen + `openspec <verb>` L234-245 + `openspec/` tree L46).
- [x] 5.3 `validate --specs` green (113/113) + residual-drift grep clean. Commit deferred to ship stage.

## 6. Batch 6 — legacy / migration / coexistence specs (K4/K5 heavy — mostly KEEP)

- [x] 6.1 legacy-cleanup (MIXED careful): rewrote invocations `` `openspec init` ``/`` `openspec update` ``→rasen and `/opsx:explore` L133 / "/opsx:*" L146 → /rasen:*, using targeted literal replacement (not blanket regex) to avoid touching detection literals; **KEPT** all detection literals (`.claude/commands/openspec/`, `openspec/AGENTS.md`, `openspec/project.md`, `openspec-gstack-*`, `openspec-*`, `OPENSPEC:START`, "OpenSpec markers" phrases).
- [x] 6.2 store-registration (MIXED): rewrote `openspec/changes/`→rasen/changes/, "OpenSpec store root" L4→Rasen, and `openspec/config.yaml`→rasen/config.yaml (verified stale vs. rest-of-file's consistent rasen/config.yaml usage — not a legacy-detection reference); **KEPT** `.openspec-store` and `~/openspec/<id>` legacy paths.
- [x] 6.3 remove-gstack-upgrade-skill, remove-setup-browser-cookies-skill, remove-parallel-lifecycle-skills (MIXED): rewrote `openspec init/update`→rasen and `/opsx:*`→/rasen:*; **KEPT** all `openspec-gstack-*` retired-dirName asserted-absent tokens (K5) and `openspec/changes/archive/` exempt clauses (K4).
- [x] 6.4 preamble-migration (MIXED careful): rewrote "minimal OpenSpec preamble" prose→Rasen (OQ1 judgment); **KEPT** `pending OpenSpec integration` literal L56 and historical `~/.openspec/bin` L45 (verified as historical/K4 — describes the OLD gstack-slug call being replaced).
- [x] 6.5 KEEP-only audit (zero edits confirmed): workspace-migration, remove-gstack-features, dead-stub-removal, eureka-telemetry-removal. All residual tokens verified as K2/K3/K4/K5 — no accidental changes made.
- [x] 6.6 `validate --specs` green (113/113) + residual-drift grep clean. Commit deferred to ship stage.

## 7. Batch 7 — final KEEP-only audit + out-of-scope log

- [x] 7.1 Audited archive-quality-capture, project-readme, fork-release-preparation, rasen-cli-identity: confirmed NO edits needed (all tokens are K1/K3/K4/K5). Zero drift found; left untouched.
- [x] 7.2 Confirmed the Out-of-Scope Follow-ups (design F1-F3) were NOT touched: `rasen-cli-identity:5` scope text unchanged, no capability folder renamed, no semantic env-var renames beyond the confirmed `OPENSPEC_TELEMETRY`→`RASEN_TELEMETRY`. Appended a newly-discovered F4 (command-generation `category` metadata example value mismatch — code truth is `'Workflow'`, not OpenSpec/Rasen) to design.md's follow-up list.

## 8. Final validation

- [x] 8.1 `node dist/cli/index.js validate --specs` → green (113/113, proves behavior-neutral: no requirement/scenario parse broke).
- [x] 8.2 `node dist/cli/index.js validate specs-brand-rewrite` → "Change 'specs-brand-rewrite' is valid".
- [x] 8.3 Corpus sweep: re-grepped `rasen/specs/*/spec.md` for `openspec|opsx` (case-insensitive) across all 113 capabilities. 44 files retain hits; every one manually spot-checked against the design table's K1-K7 keep classes (or, for `browse-skill-ethos-cleanup` and `openspec-config-extensions` — two files absent from the design's original 86-file survey — adjudicated fresh against the same ruleset). No positive-drift tokens remain outside the KEEP classes.
- [x] 8.4 Full-diff review: no commits were made (implementer does not commit per orchestrator instruction — ship stage owns commits). `git status --short` confirms all 76 modified files are `rasen/specs/**/spec.md`; zero `src/`, `test/`, or template files touched.
