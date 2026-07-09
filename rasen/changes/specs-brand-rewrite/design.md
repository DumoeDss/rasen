## Context

CHANGELOG 0.1.1 rebranded every user-facing surface from `openspec`/`opsx` to `rasen`. The code is fully rebranded and shipped; the main specs under `rasen/specs/**` are not. An authoritative re-grep (case-insensitive `openspec|opsx` over `rasen/specs/**/spec.md`) found **907 occurrences across 86 files**. This design adjudicates every file into REWRITE / KEEP / MIXED, decides the edit mechanics, and lists behaviorally-wrong specs as out-of-scope follow-ups.

**Code truth pinned for this change** (all verified against `src/` and `package.json`):
- Binary/package name: `rasen` (`package.json` `bin.rasen`, `name: "rasen"`).
- Slash commands: `/rasen:*` only. `opsx` survives ONLY as `LEGACY_COMMAND_PREFIX` in detection/cleanup (`command-file-id.ts:25-73`).
- Skill dirNames: `rasen-<base>`, double brand segment collapsed (`skill-name-prefix/spec.md:45` SHALL; e.g. `openspec-opsx-ship` → `rasen-ship`).
- Workspace dir: `rasen/` only recognized; legacy `openspec/` detected but never operated on.
- Global config/data dir: `rasen` (`global-config.ts` `GLOBAL_CONFIG_DIR_NAME = 'rasen'`, `GLOBAL_DATA_DIR_NAME = 'rasen'`; `LEGACY_BRAND_DIR_NAME = 'openspec'`).
- Telemetry opt-out env var: `RASEN_TELEMETRY` (`src/telemetry/index.ts:99`); legacy `OPENSPEC_TELEMETRY` SHALL NOT be read (`telemetry/spec.md:36`).
- Intentional keeps (CHANGELOG 0.1.1 "Not rebranded"): `.openspec.yaml` change-metadata filename, `format: 'openspec'`/`'openspec-change'`, legacy-detection literals, `.openspec-store` (still read/copied-forward, never deleted).

## Goals / Non-Goals

**Goals:**
- Make `rasen/specs/**` describe the shipped `rasen` behavior: correct all stale *positive* brand tokens.
- Preserve every intentional-keep literal, upstream/migration reference, and negative assertion.
- Keep the change behavior-neutral: requirement semantics unchanged; `rasen validate --specs` green before and after.

**Non-Goals:**
- No `src/`, template, test, or parity-fixture edits.
- No renaming of capability FOLDER names / spec IDs (that is an identity change, out of scope).
- No fixing of behaviorally-wrong requirements (listed in Out-of-Scope Follow-ups).
- Not renaming internal TS code identifiers referenced in prose (e.g. `getOpsxAutoCommandTemplate`, `isOpenSpecProject`, `__OPENSPEC_PROACTIVE__`) unless a grep confirms the symbol was renamed in code — default KEEP.

## Decisions

### D1 — Mechanics: direct main-spec edit for the bulk rewrite + ONE ADDED governance delta

**Decision:** Edit `rasen/specs/**/spec.md` directly for the bulk brand-token rewrite (no per-capability MODIFIED deltas). Carry exactly one real delta — an ADDED requirement in a new `spec-brand-consistency` capability — as the change's delta-of-record. The proposal's "Modified Capabilities" stays empty; "New Capabilities" lists `spec-brand-consistency`.

**Why this shape:**
1. **Hard system constraint (verified):** `rasen validate <change>` FAILS a change with zero deltas ("Change must have at least one delta"). So the pure zero-delta direct-edit is not a valid change in this system. Per the planning context's own rule — "lean direct-edit ONLY if the workflow supports it, else delta-then-sync" — the workflow does not support zero-delta, so a delta is required.
2. **But full delta-then-sync is the wrong tool for a wording fix.** Delta specs express ADDED/MODIFIED/REMOVED/RENAMED *behavior*. The bulk rewrite alters **no** requirement semantics. Expressing ~78 capabilities as MODIFIED deltas would restate full requirement blocks verbatim under `## MODIFIED Requirements` — doubling the edit surface, inviting silent detail loss (schema warns MODIFIED-with-partial-content drops detail at archive), and misrepresenting a brand fix as behavior change.
3. **Resolution:** the brand corrections land as direct edits to main specs (enumerated in tasks.md), and the mandatory delta is a single *honest* ADDED requirement (`spec-brand-consistency`) that (a) satisfies `rasen validate`, (b) encodes the conformance rule as a durable, testable contract — its scenario IS the corpus-grep gate (tasks 8.3) — and (c) adds lasting value: future brand drift becomes a spec violation. This is not a fake sentinel; it is a real governance requirement directly motivated by this change.
4. Precedent for direct conformance edits: the docs/zh alignment pass and the rebrand itself edited in place rather than through behavioral deltas.

**Consequence for CLI status (expected):** The `specs` artifact now resolves "done" (the `spec-brand-consistency` delta file exists → `artifact-graph/outputs.ts` `artifactOutputExists` returns true), so `tasks` unblocks and the change reaches `isComplete` normally. At archive, `rasen archive` syncs the ONE delta → creates `rasen/specs/spec-brand-consistency/spec.md`. The ~78 directly-edited main specs are not deltas, so sync does not touch them — the direct edits persist, no double-application. The direct edits are performed during the APPLY stage (from tasks.md), which is the deliberate, documented mechanic here.

**Alternatives considered:**
- *Full delta-then-sync (Path A):* rejected — ~78 verbatim MODIFIED restatements, high transcription/detail-loss risk, semantically misrepresents the change.
- *A meaningless one-line sentinel delta:* rejected — dishonest and adds no value. The `spec-brand-consistency` requirement is the honest equivalent.
- *Adding the requirement to the existing `openspec-conventions` meta-spec instead of a new capability:* viable and thematically apt, but `openspec-conventions` is itself being rewritten in Batch 5; a self-contained new capability avoids entangling the delta append with the in-place prose edits.

### D2 — Scope: rewrite ALL positive brand drift (Full), including `openspec <verb>` command examples

**Decision:** Treat `openspec <verb>` command-invocation examples as drift and rewrite them to `rasen <verb>`, alongside the more obvious dirName / slash-command / product-prose drift. Effective touched-file count ≈ 78, larger than the survey's "41 clear-drift" figure, because command-invocation drift is pervasive across the inherited CLI/schema specs.

**Why:** The user's stated drift class explicitly names `openspec init`; the goal is "make specs consistent with rebranded code"; the binary is `rasen`, so every `openspec <verb>` is a false factual claim; and `rasen-cli-identity/spec.md:35` is a normative SHALL that examples use `rasen <verb>`. Full rewrite is the only internally-consistent end state. Planning context authorizes it ("counts approximate; planner's table is truth"; `requiresAffectedAreaSelection: false`).

**Scope dial for the LEAD (optional Narrow mode):** If a smaller diff is preferred, Batches 1–2 (CLI-surface + schema-surface, whose drift is *only* command-invocation examples) can be deferred to a follow-up, leaving the dirName / slash-command / product-prose / env-var rewrites (Batches 3–7, ≈40 files) which match the user's "41" figure. Recommendation: **do Full** — deferring leaves the corpus self-contradictory. The batch structure below makes Narrow a clean cut if the LEAD pulls that dial at review.

### D3 — The adjudication RULESET (apply per token, per file)

REWRITE a token only when it is a **positive claim about current behavior** that is now false:
- `R1` `openspec <verb>` (status, init, update, validate, config, change, spec, show, list, view, archive, feedback, completion, agent context, pipeline, instructions, templates, new change, schema <x>, schemas) → `rasen <verb>`.
- `R2` `/opsx:<cmd>` and `/opsx-<cmd>` → `/rasen:<cmd>` / `/rasen-<cmd>`.
- `R3` skill dirNames `openspec-<base>` / `openspec-opsx-<base>` → `rasen-<base>` (collapse double brand). Also `.claude/skills/openspec-*` install paths and `.claude/commands/opsx/` → `rasen`.
- `R4` current-behavior workspace paths `openspec/{changes,specs,schemas,pipelines,config.yaml,config.yml,AGENTS.md,project.md,retro-latest.md,office-hours}` → `rasen/...`.
- `R5` global config/data paths `~/.config/openspec/…`, `${XDG_*}/openspec/…`, `~/.local/share/openspec/…`, `~/openspec/…` (checkout default) → `rasen`.
- `R6` env var `OPENSPEC_TELEMETRY` → `RASEN_TELEMETRY`. (Other `OPENSPEC_*` env names: verify against `rasen-cli-identity/spec.md:42` list; those appear only inside negative assertions — see K-rules.)
- `R7` product-identity prose "OpenSpec CLI/structure/project/branding/conventions/preamble" describing THIS tool → "Rasen …". Includes the conceptual workflow-family name "OPSX" → "Rasen" when it names the product's own workflow.

KEEP a token (do NOT edit) when:
- `K1` Intentional-keep literal: `.openspec.yaml`, `format: 'openspec'`/`'openspec-change'`.
- `K2` Legacy-detection literal: `.openspec-store`, `openspec-gstack-*` retired prefixes, `<!-- OPENSPEC:START/END -->` markers, `OpenSpec-managed` marker references, `openspec_root_missing`-class diagnostic strings, the literal string `pending OpenSpec integration`, hostname `edge.openspec.dev`.
- `K3` Upstream-project attribution: "forked from OpenSpec", "upstream OpenSpec v1.5.0", "@fission-ai/openspec", "OpenSpec Contributors" (copyright), "not affiliated with Fission-AI".
- `K4` Migration/coexistence reference to the legacy `openspec/` workspace or `opsx`/`openspec-*` artifacts being detected/migrated/left-untouched (workspace-migration, store-registration legacy-path recognition, rasen migrate semantics).
- `K5` **Negative assertion**: the requirement asserts an openspec/opsx token is ABSENT or has NO EFFECT (e.g. "no generated file contains `/opsx:`", "no `openspec` executable is installed", "setting `OPENSPEC_CONCURRENCY` has no effect", "no `openspec/` directory is created", the FROM-side of a rename mapping `openspec-browse → rasen-browse`). Rewriting inverts the meaning — never touch.
- `K6` Capability FOLDER name / matching `# <name> Specification` title (spec ID identity — renaming is out of scope).
- `K7` Internal TS code identifier in prose (`getOpsx*CommandTemplate`, `isOpenSpecProject`, `__OPENSPEC_PROACTIVE__`, `__OPENSPEC_REPO_MODE__`) — KEEP unless a `src/` grep confirms the symbol was renamed.

MIXED files contain both R- and K-tokens; edit line-by-line, never blanket-replace.

### D4 — Commit discipline (shared working tree)

Other sessions have uncommitted edits (`archive-change.ts`, `ship.ts`, etc.). Every commit MUST use explicit pathspec scoped to the specs touched in that batch (`git commit -- rasen/specs/<cap>/spec.md …`) and be verified with `git show --stat`. Never `git add -A`. Never stage `src/` files. See tasks.md for per-batch pathspec discipline.

## Per-file adjudication table (authoritative)

Classes: **R** = rewrite (positive drift only), **MIXED** = rewrite some / keep some (careful line-by-line), **KEEP** = audit-only, no edits expected. Batches group work for reviewable commits. "Special" flags the non-obvious keeps/judgment.

### Batch 1 — CLI-surface specs (R1 command-invocation dominant; R4 paths; R7 prose)
| File | Class | Special |
|---|---|---|
| cli-agent-context | R | `rasen agent context` |
| cli-artifact-workflow | R | paths→rasen/; "OpenSpec CLI" L304→Rasen |
| cli-archive | MIXED | `.openspec.yaml` L237,241 **K1**; `openspec-conventions` spec-ID xref L71,84,192 **K6** |
| cli-completion | R | script/identifier names tied to bin (`_openspec`,`openspec.fish`,`complete -c openspec`,`-CommandName openspec`,`__complete`)→rasen; `isOpenSpecProject` **K7 verify** |
| cli-change | R | |
| cli-config | R | `~/.config/openspec/config.json`→rasen if present |
| cli-feedback | MIXED | **R6** `OPENSPEC_TELEMETRY`→`RASEN_TELEMETRY` L118,170; "OpenSpec CLI version" L92,95,168,169→Rasen |
| cli-show | R | |
| cli-list | R | "OpenSpec's philosophy" L104→Rasen |
| cli-init | R | `/opsx:*` L58-60,199-201,214,224,293-301→/rasen:*; "OpenSpec structure/project" prose→Rasen |
| cli-spec | R | |
| cli-update | MIXED **high-touch** | generated file/command names `openspec-proposal.md`, `/openspec:archive`, `openspec/proposal.md`→rasen-*; `OPENSPEC:START`/`OpenSpec-managed` markers **K2**; legacy-detection L311,317,320,332,334 (`opsx`,`openspec-*`,legacy `openspec/`) **K4**; L323-334 already rewritten — leave |
| cli-validate | MIXED | `rasen validate` + paths→rasen/; `OPEN_SPEC_INTERACTIVE` L207 **verify env** (KEEP if code unchanged) |
| cli-view | R | error message "No openspec directory found" L329 reflects current output→rasen |
| change-creation | R | `openspec/changes/`→rasen/changes/ |
| config-loading | R | `openspec/config.yaml`→rasen/config.yaml (workspace is rasen/) |
| graceful-status-empty | R | `openspec new change` message→rasen new change |
| global-config | MIXED | legacy `openspec` config dir L108 (detection) **K4**; "OpenSpec resolves" L5 prose→Rasen |
| context-injection | R | `openspec/config.yaml`→rasen/config.yaml |
| docs-agent-instructions | R | `openspec/AGENTS.md`→rasen/AGENTS.md; `openspec validate`→rasen validate |
| ci-nix-validation | R | "install and use OpenSpec"→Rasen; nix build outputs the `rasen` binary L15,28→rasen binary |
| safety-hook | R | "distributed with OpenSpec" L13→Rasen; `openspec init`→rasen init |

### Batch 2 — schema-surface specs (R1 `openspec schema`; R4 `openspec/schemas`; R5 XDG)
| File | Class | Special |
|---|---|---|
| schema-enhance-field | R | `openspec instructions`→rasen instructions |
| schema-context-from-field | R | |
| schema-provider-field | R | |
| schema-fork-command | R | `openspec/schemas/`→rasen/schemas/ |
| schema-init-command | R | `openspec/schemas/`, `openspec/config.yaml`→rasen/… |
| schema-validate-command | R | `openspec validate` L82→rasen validate |
| schema-which-command | R | |
| schema-resolution | MIXED | `.openspec.yaml` L118,171 **K1**; `./openspec/schemas`, `~/.local/share/openspec`, `openspec/config.yaml`→rasen/…; "Edit openspec/config.yaml" L155 message→rasen |
| artifact-graph | R | `${XDG_DATA_HOME}/openspec/schemas/` L132→rasen/schemas/ |

### Batch 3 — opsx-* / workflow specs (R2 slash; R3 dirNames; R4 paths; R1 pipeline)
| File | Class | Special |
|---|---|---|
| opsx-auto-command | R | title L1 **K6**; `getOpsxAutoCommandTemplate` **K7**; `openspec pipeline`→rasen pipeline |
| opsx-archive-skill | MIXED | `.openspec.yaml` L140 **K1**; `/opsx:archive`,`/opsx:sync`→/rasen:*; `openspec/changes/archive/`→rasen/… |
| opsx-goal-command | R | skill names `openspec-opsx-goal`→rasen-goal, `openspec-goal-*`→rasen-goal-* (R3 collapse) |
| opsx-office-hours-command | R | `/opsx:*`, `openspec/changes/`, `openspec/office-hours/`, `openspec init`→rasen |
| opsx-onboard-skill | R | "OpenSpec workflow/initialized" prose→Rasen |
| opsx-orchestration | R | `openspec pipeline/status/agent context`→rasen; "OpenSpec root"→Rasen root |
| opsx-pipeline-registry | MIXED | title **K6**; `openspec pipeline/validate`→rasen; `openspec/pipelines/`,XDG→rasen; "OpenSpec uses for schemas" L25 / "same OpenSpec root" L70→Rasen |
| opsx-retro-command | R | `openspec/changes/<n>/retro.md`,`openspec/retro-latest.md`→rasen/… |
| opsx-ship-command | R | `getOpsxShipCommandTemplate` **K7**; `openspec/changes/`→rasen/… |
| opsx-verify-skill | R | `openspec/changes/<n>/specs/`→rasen/… |
| opsx-verify-enhanced-command | MIXED | dirNames `openspec-verify-change`,`openspec-verify-enhanced`→rasen-*; `openspec init`→rasen init |
| goal-loop-validation | R | `openspec pipeline show`→rasen; `docs/opsx-workflow-guide.md` **verify doc filename** |
| goal-loop-workflow | R | `openspec pipeline list`→rasen |
| orchestration-handoff | R | `openspec agent context`→rasen; `/opsx:auto`→/rasen:auto |
| workflow-handoff-command | MIXED | skill `openspec-handoff`→rasen-handoff; `/opsx:handoff`→/rasen:handoff; `.claude/commands/opsx/handoff.md`→rasen/; `openspec pipeline resume`→rasen |
| review-cycle-workflow | R | skill `openspec-review-cycle`→rasen-review-cycle, `openspec-review`→rasen-review; `getOpsxReviewCycleCommandTemplate` **K7**; `opsx-orchestration` playbook-name **verify** |
| review-two-axis-absorption | MIXED | `openspec-review` skill→rasen-review; "OpenSpec change" L4,16,19→Rasen change |
| specs-sync-skill | R | `/opsx:sync`→/rasen:sync; `openspec/changes|specs/`→rasen/… |
| propose-workflow | MIXED | `.openspec.yaml` L13 **K1**; `/opsx:propose`→/rasen:propose; `openspec new change`→rasen new change |
| session-relay | R | verify omitted lines |
| pipeline-handoff-config | R | `openspec validate/pipeline`→rasen |
| worker-reuse-config | R | `openspec validate/pipeline`→rasen |
| compact-recovery-hook | R | `openspec pipeline resume`,`openspec init`→rasen |
| investigate-diagnosing-absorption | R | `openspec-investigate` entry→rasen-investigate |
| navigator-router-skill | R | `dirName: 'openspec-navigator'`→'rasen-navigator'; `/opsx:*`→/rasen:*; "OPSX main flow"→Rasen (R7 judgment) |

### Batch 4 — expert / skill-integration specs (R3 dirNames dominant)
| File | Class | Special |
|---|---|---|
| add-grill-expert-skills | R | `openspec-codebase-design/tdd/prototype`→rasen-*; `.claude/skills/openspec-*`→rasen-*; `openspec init`→rasen init |
| gstack-skills-integration | MIXED **careful** | `openspec init`, dirName `openspec-<name>`→rasen-*, "OpenSpec package" L12→Rasen; gstack→OpenSpec `~/.openspec/` migration L72,76,80,82,83 **K4 historical — verify before touching** |
| methodology-expert-fusion | MIXED | `/opsx:*`→/rasen:*; dirNames L68,69→rasen-*; "OPSX/OpenSpec change context"→Rasen; `openspec/changes/archive/` exempt-clause L44 **K4**; `openspec instructions`→rasen |
| skill-name-prefix | MIXED **careful — this spec IS the rename** | L4 purpose + L15,43 requirement headers "openspec:/openspec- prefix"→rasen (stale; body L45 already rasen); L48-51 mapping FROM-side `openspec-* → rasen-*` **K5**; L41,57 negative assertions **K5** |
| skill-sidecar-install | R | install dirNames `openspec-review/investigate/qa/browse`→rasen-*; `openspec init/update`→rasen |
| chrome-use-integration | MIXED | dirName `openspec-chrome-use`→rasen-chrome-use; `openspec init/update`→rasen; "OpenSpec package" L32→Rasen |
| expert-template-inlining | KEEP/verify | `__OPENSPEC_PROACTIVE__`,`__OPENSPEC_REPO_MODE__` L41 **K7 — install-time token literals, verify src before any edit; default KEEP** |

### Batch 5 — prose / branding specs (R7 dominant; heavy K3/K5)
| File | Class | Special |
|---|---|---|
| branding-migration | MIXED **careful** | L4,32 "OpenSpec branding" → Rasen branding (user explicitly flagged L4); `~/.openspec` L82 **R5 verify** |
| ai-tool-paths | R | L4 "generate OpenSpec skills and commands"→Rasen (user flagged L4) |
| telemetry | MIXED | L5,10 "OpenSpec collects/version"→Rasen; L13,17,28 `openspec` cmd→rasen; L36 `RASEN_TELEMETRY` already correct **KEEP**; `edge.openspec.dev` **K2 negative** |
| telemetry-backend | R | L4 "OpenSpec CLI usage events"→Rasen CLI |
| command-generation | MIXED **careful** | L4 "OpenSpec command files"→Rasen; L15 'OpenSpec Explore'/L17 'OpenSpec' category (generated metadata values)→Rasen; L71 negative assertion **K5**; L126,132,138 legacy detection→**K4** but `openspec init` invocation→rasen; L140,141 `OpenSpec-managed` markers **K2** |
| openspec-conventions | MIXED **careful — meta-spec** | folder/title `openspec-conventions` **K6**; body "OpenSpec conventions/project/CLI/specifications" self-referential→Rasen; `openspec list/spec/change/show/validate` L234-245→rasen; `openspec/` tree L46,532→rasen/ |
| profiles | R | `openspec config profile/update/init`→rasen; `~/.config/openspec/config.json`→rasen |

### Batch 6 — legacy / migration / coexistence specs (K4/K5 heavy — mostly KEEP)
| File | Class | Special |
|---|---|---|
| legacy-cleanup | MIXED **careful** | invocations `openspec init/update`→rasen; `/opsx:explore` L133, "/opsx:*" L146→/rasen:*; ALL detection literals (`.claude/commands/openspec/`, `openspec/AGENTS.md`, `openspec/project.md`, `openspec-gstack-*`, `openspec-*`, `OPENSPEC:START`) **K2/K4 keep** |
| workspace-migration | KEEP | all `openspec/` = legacy-workspace literals **K4**; "upstream OpenSpec" **K3**; `OPENSPEC:START` L79 **K2**; audit-only |
| store-registration | MIXED | `.openspec-store` L32,38,42,44 **K1/K2**; `~/openspec/<id>` L48,57,70 legacy path **K4**; `openspec/config.yaml` store-pointer L62 **verify legacy vs current**; `openspec/changes/` L82,86,92→rasen/changes/; "OpenSpec store root" L4→Rasen |
| remove-gstack-features | KEEP | `~/.openspec/sessions/` L29,33 negative assertion **K5** |
| remove-gstack-upgrade-skill | MIXED | `openspec init`→rasen init; `openspec-gstack-upgrade/` L19 retired-dirName asserted-absent **K5** |
| remove-setup-browser-cookies-skill | MIXED | `openspec init`→rasen init; `openspec-gstack-setup-browser-cookies` L15,18 **K5** |
| remove-parallel-lifecycle-skills | MIXED | `/opsx:auto,ship,retro` L4→/rasen:*; `openspec update`→rasen update; `openspec-gstack-*` L12,64 **K5**; `openspec/changes/archive/` L67 exempt **K4** |
| dead-stub-removal | KEEP | `pending OpenSpec integration` literal asserted-absent **K2/K5** |
| eureka-telemetry-removal | KEEP | `~/.openspec/analytics/eureka.jsonl` negative assertions **K5** |
| preamble-migration | MIXED **careful** | "minimal OpenSpec preamble" L4,6→Rasen (judgment); `pending OpenSpec integration` L56 **K2**; `~/.openspec/bin` L45 historical **K4/verify** |

### Batch 7 — KEEP-only audit files (expect NO edits; confirm intentional keeps intact)
| File | Class | Special |
|---|---|---|
| archive-quality-capture | KEEP | `.openspec.yaml` L42,46,87 **K1** only |
| project-readme | KEEP | all "OpenSpec"/`@fission-ai/openspec` = upstream attribution **K3**; rasen surfaces already correct |
| fork-release-preparation | KEEP | upstream attribution + copyright **K3**; `openspec` bin-conflict note **K3** |
| rasen-cli-identity | KEEP + **follow-up** | negative assertions + coexistence **K5/K3/K4**; **L5 scope text is behaviorally stale — see Out-of-Scope F1** |

## Out-of-Scope Follow-ups (behaviorally wrong — do NOT fix in this change)

- **F1 — `rasen-cli-identity/spec.md:5` scope contradiction.** Its purpose text says the rename must NOT touch "the `openspec/` project directory, the `opsx:` command prefix". That was the phase-1 (CLI-only) rename boundary. Phase-2 (CHANGELOG 0.1.1) DID move the workspace to `rasen/` and commands to `/rasen:*`. So this spec's scope statement now contradicts `workspace-migration` and `skill-name-prefix`. Fixing it is a **semantic** reconciliation (what the rename covers), not a brand-token swap — defer to a dedicated change.
- **F2 — env-var name verification.** `cli-validate/spec.md:207` `OPEN_SPEC_INTERACTIVE` and any residual `OPENSPEC_*` non-telemetry env names: if code renamed them to `RASEN_*`, that is a behavioral correction; only the confirmed `OPENSPEC_TELEMETRY→RASEN_TELEMETRY` (already code-verified) is in scope here. Others → verify-then-defer if semantic.
- **F3 — capability folder renames.** Folders `openspec-conventions`, `openspec-config-extensions` keep `openspec-` in their IDs. Renaming them is an identity/behavior change (breaks spec references, sync, archives) — defer.
- Any spec whose REQUIREMENT (not just a brand token) asserts behavior the code does not implement, discovered mid-edit → log to this list, do not fix.
- **F4 — `command-generation/spec.md:17` `category` example value is stale independent of branding.** The spec's `CommandContent` example says `category: grouping category (e.g., 'OpenSpec')`. Code truth (`src/core/templates/workflows/explore.ts:310`) shows the actual generated value is `category: 'Workflow'` — neither `'OpenSpec'` nor `'Rasen'`. This change applied the literal brand-token swap instructed by design (`'OpenSpec'`→`'Rasen'`) since that is the documented mechanic here, but the resulting `'Rasen'` example is still factually wrong relative to code. Fixing the example to match the real `'Workflow'` value is a behavioral correction, not a brand-token rewrite — defer to a dedicated change.

## Risks / Trade-offs

- **[Blanket find-replace inverts negative assertions]** → Ruleset K5 + the per-file Special column; reviewer must diff every MIXED/careful file line-by-line, never `sed` a whole file. The negative-assertion files (command-generation, rasen-cli-identity, skill-name-prefix mapping side, remove-* asserted-absent dirNames, dead-stub/eureka literals) are the highest-risk.
- **[Direct main-spec edits happen at APPLY, outside the delta/sync path]** → intentional per D1. The lone `spec-brand-consistency` delta is the change's delta-of-record; the ~78 brand corrections are direct in-place edits. Sync at archive touches only the delta (creates `spec-brand-consistency/spec.md`), never the directly-edited files → no double-application. Reviewer must confirm the direct edits are present in main specs after apply, since they will NOT appear in `rasen show <change> --deltas-only`.
- **[Over-rewriting historical migration specs]** → gstack→OpenSpec migration specs (gstack-skills-integration, preamble-migration, eureka, dead-stub) describe a PAST migration; their `~/.openspec/` and `OpenSpec` tokens are often historical/negative → default KEEP, verify before touching.
- **[Shared working tree pollution]** → D4 pathspec discipline; `git show --stat` after every commit; never stage `src/`.
- **[Behavior-neutrality regression]** → `rasen validate --specs` must be green after each batch AND at the end; a broken requirement/scenario parse means a structural edit slipped in.

## Open Questions

- **OQ1 (resolved → REWRITE):** treat the conceptual "OPSX" workflow-family name as a brand token → "Rasen". Reviewer may downgrade specific instances if "OPSX" is used as a stable historical label; default is rewrite.
- **OQ2 (LEAD dial):** Full vs Narrow scope (D2). Planner recommends Full.
- **OQ3:** doc filenames referenced in specs (`docs/opsx-workflow-guide.md`, playbook name `opsx-orchestration`) — verify the actual file/skill still carries `opsx-` or was renamed to `rasen-`/`opsx-` before rewriting the reference; if the file is still named `opsx-*`, KEEP the reference (K7-like: match reality).
