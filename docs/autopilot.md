# Autopilot Policies: Engine, Gates, Selection, and Composed Pipelines

`/rasen-auto` has two **opt-in policy axes** that control how much the LEAD decides on its own, plus one **always-resolved** axis (the Run engine) that decides *who owns mechanical progression*. All three default to OFF — with no flags and no config, autopilot behaves exactly as documented in [artifact-workflow-guide.md §2](artifact-workflow-guide.md#2-run-the-entire-workflow-with-one-command-rasenauto): gates pause, the pipeline defaults to `small-feature`, classification is advisory-only.

| Axis | Run flag | Config key (project `rasen/config.yaml` AND global config) | Values | Built-in default |
|---|---|---|---|---|
| **Gate policy** | `--no-gate` | `autopilot.gates` | `on` / `off` | `on` (gates pause) |
| **Selection policy** | `--auto-select` / `--auto-compose` | `autopilot.selection` | `classify` / `compose` / `manual` | `manual` |
| **Run engine** | `--engine <reconciler|legacy>` (on `rasen pipeline start`) | `runs.engine` (project / Store / global) | `auto` / `reconciler` / `legacy` | `auto` |

Precedence on every axis: **run flag > project config > global config > built-in default** (the engine axis additionally has a Store layer between project and global: **flag > project > Store > global > default**). Both `autopilot.gates` and `autopilot.selection` are settable at BOTH the project and the global (machine-wide) scope — project always wins over global. An absent or unrecognized config value at either scope falls back to the next layer with a warning — it never breaks config parsing, and sibling fields still parse.

The resolved policies are **displayed at run start with their source** (e.g. `Gate policy: off (--no-gate)` / `Selection policy: classify (project)` / `Engine: reconciler (auto)`), so a run is never silent about how it will behave.

```
/rasen-auto [--pipeline <name>] [--no-gate] [--auto-select] [--auto-compose]
            [--review-plan] [--planner claude|codex] [... other role flags] <task>
```

---

## 0. Run engine — `runs.engine` / `--engine`

The engine decides **who owns mechanical progression**: the canonical reconciler Run, or the LEAD reading its own `auto-run.json`. Unlike the other two axes it is not opt-in — every run resolves an engine, and `auto` (the default) means *the reconciler wherever it is supported*.

- **`auto` (default)** — the **reconciler** engine when capability discovery reports the pipeline supported; otherwise the **legacy** playbook path, with the support reason displayed so the fallback is never silent.
- **`reconciler`** — forced. If the pipeline is unsupported, `rasen pipeline start` fails with the support reason and **no Run is created under either engine**. There is no silent substitution: you asked for the engine by name.
- **`legacy`** — the reconciler off-switch. `rasen pipeline start` refuses with `engine_disabled_by_config` naming the deciding config layer, and launchers run the legacy playbook branch instead.

`rasen pipeline show <name> --json` reports the whole resolution already computed — `enginePolicy: { configured, source, effectiveEngine }` beside `availableEngines` and `reconcilerSupport: { supported, reason, profileDigest }`. Autopilot reads it from there rather than re-deriving the precedence chain, exactly as it reads `effectiveGate` rather than re-masking gates. The human `pipeline show` output renders the same analysis as product copy.

### What changes under the reconciler engine

The canonical Run owns round counting, the `maxRounds` cap, phase order, actor separation, result validation, and the clean/escalated outcome — each with a real rejection path in the Record. Autopilot's Step E therefore **drives** the Run (`pipeline start` -> `pipeline resume-run` -> dispatch one worker per granted action -> `pipeline complete`) and reads progress from the run view's `review-cycle` section. It keeps no second copy of any of those rules. Selection, launch, worker staffing, briefing, relays, and honest reporting stay the LEAD's.

Under the legacy engine, the full LEAD-owned Step E protocol runs exactly as before. One playbook with one engine branch — not two documents.

### The run-state boundary

For a **legacy-engine** run, `auto-run.json` is the authoritative record of progression, unchanged.

For a **reconciler-engine** run it is bounded to what the kernel does not model: the engine and its deciding source, worker handles and transcripts, the gate-policy freeze, the retention mode, `strategyAttempts`, and the session-relay generation. Stage status, rounds, phases, findings and outcomes are read from the canonical run view; anything mirrored into run-state is a **labeled projection** and is never read back to make a decision the Run owns. `goal-run.json` and generated Markdown reports are compatibility projections by the same rule.

Resume follows ownership: a reconciler-engine run resumes from the canonical frontier (`rasen pipeline resume-run`), while `rasen pipeline resume`'s artifact heuristic remains the legacy-engine resume surface. A run is never resumed under a different engine than the one that owns it.

---

## 1. Gate policy — `--no-gate`

By default, stages marked `gate: true` pause the run: the LEAD summarizes what was done and waits for you to Continue / Stop / switch to Manual. When you want autopilot to run unattended — instead of saying "no gates, don't stop" every time — pass `--no-gate` (or set `autopilot.gates: off` as the project or global default):

- **Ordinary gates are auto-approved**: the run proceeds past each `gate: true` stage without pausing.
- **Nothing is silently skipped**: every auto-approved gate is recorded in run-state as an explicit gate decision naming the policy source (e.g. `auto-approved (--no-gate)`). The audit trail shows the stage advanced by auto-approval, not by a human Continue.
- **Resume inherits the policy**: the resolved gate policy is persisted in run-state, so `rasen pipeline resume` continues to auto-approve without re-passing the flag.
- **Decomposed portfolios**: a parent `--no-gate` directive auto-approves ordinary child-pipeline gates too (parent directive > child gate).

### Vet gates are never auto-approved

A stage may mark its gate as **`gate: 'vet'`** instead of `true`. A vet gate means *a human must vet this stage* — it always pauses, under `--no-gate`, under `autopilot.gates: off`, and under a parent portfolio directive alike.

The canonical example is the goal-loop `define-goal` stage: its output can include an arbitrary-shell measure command that later rounds will execute repeatedly. That is a self-authored command the LEAD would otherwise approve for itself — so it is vetted by a human before any round runs, no matter the gate policy.

Existing pipeline YAML is unaffected: `gate: true`, `gate: false`, and omitted `gate` parse and behave exactly as before; `rasen pipeline show --json` reports whichever value a stage carries.

---

## 2. Selection policy — `--auto-select`

Classic behavior (`manual`): explicit selection wins, otherwise the pipeline is `small-feature`, and `rasen pipeline classify` is only ever a suggestion the LEAD may show you.

With `--auto-select` (or `autopilot.selection: classify`), the LEAD **adopts** the classification suggestion:

- It runs `rasen pipeline classify "<task>" --json` and adopts the suggested pipeline when it is among the available pipelines.
- The choice is displayed **with its basis**: the matched indicators for a keyword-driven suggestion (e.g. `bug-fix — matched: fix, crash`), or the default basis when nothing matched (which lands on `small-feature`). Classify's JSON output carries this as `basis: 'keyword' | 'default'`.
- **You can still change it** before execution proceeds — adoption is a starting choice, not a lock.
- The LEAD adopts the suggestion *exactly as returned* — it never escalates or substitutes a different pipeline by its own judgment.
- **Fallback**: if classification is unavailable, fails, returns no suggestion, or suggests an unknown pipeline, the LEAD falls back to `small-feature` and displays the fallback with its cause. Selection never errors out.

### Explicit selection always wins

`--pipeline <name>` or a leading known-pipeline token (`/rasen-auto full-feature <task>`) sits **above** the whole policy axis: when present, classification is not consulted and `--auto-select` / `--auto-compose` have no effect. This holds for config defaults too.

### Why no confidence score?

Classification is a deterministic keyword heuristic. `basis` + the matched indicators tell you exactly *why* a pipeline was suggested; a numeric confidence would be fake precision.

---

## 3. Composed pipelines — `--auto-compose`

The `compose` policy is the superset of `classify` (when both flags are present, `--auto-compose` wins): classification still runs first and a keyword-basis suggestion is always adopted. Composition is **permitted only when no registered pipeline fits** — the suggestion came back on the default basis and the LEAD judges the task doesn't fit the default either. Then the LEAD MAY assemble a new pipeline from the existing stage library instead of forcing a poor fit.

A composition is not a special runtime mode — it is an **ordinary project pipeline**:

- Named with a **`composed-` prefix**, collision-checked against every registered pipeline name — an existing pipeline is **never overwritten**.
- Written to the project pipelines directory (`rasen/pipelines/<name>/pipeline.yaml`) and stamped **`origin: composed`** so its provenance is inspectable (`rasen pipeline show` reports it).
- Because it is a registered pipeline, `rasen pipeline list / show / resume` and run-state all inherit for free — resuming a run on a composed pipeline works exactly like any other.

### The machine-enforced quality floor

A pipeline marked `origin: composed` **cannot load at all** unless it contains at least one reviewer-role stage AND at least one `review-cycle` loop stage. This is enforced at the single parse choke point every load path funnels through (validate, show, resume) — so a LEAD can never compose a pipeline that skips its own review, and a hand-tampered composed YAML fails loudly rather than running unverified. Pipelines *without* the `origin` marker (yours, and all built-ins) are completely unaffected — built-in `bug-fix` has no review-cycle loop and stays valid.

### Validation gates execution

Before a composed pipeline runs, it must pass `rasen validate <name> --type pipeline` — full schema validation plus the registry guards (and the quality floor, via the marker). On failure the LEAD gets **one bounded fix attempt**; if that also fails, the run **falls back to `small-feature`** and the invalid pipeline directory is cleaned up. The autopilot only ever executes registered, validated pipelines.

Like selection, the composition is **displayed before execution** — stages, the basis for composing, the validation verdict — and you can replace it with any registered pipeline before anything runs.

### Non-goal: freeform runtime DAGs

Composition happens **before the run, as data, validated by the same machinery as every other pipeline**. The LEAD inventing or mutating stages mid-run is explicitly rejected — it would break resume and audit semantics. Runtime dynamism already has two sanctioned forms: `decompose` fan-out (runtime-decided child changes) and goal-loop iteration (runtime-decided rounds).

---

## 4. Putting it together

Project config for a hands-off default posture:

```yaml
# rasen/config.yaml
runs:
  engine: auto      # reconciler where supported, legacy otherwise (the default)
autopilot:
  gates: off        # ordinary gates auto-approve (vet gates still pause)
  selection: classify  # adopt the classify suggestion; use `compose` to also allow composition
```

Fully unattended one-shot, composition allowed:

```
/rasen-auto --no-gate --auto-compose implement rate limiting for the webhook API
```

What still stops an unattended run: **vet gates** (always), open **Blocker/Major findings** at ship (the finding gate is not a pause gate — it is never waived), and escalations from the orchestration ladder (see the playbook's Step H).

Compatibility guarantee: with all axes at their defaults, behavior is byte-identical to before these capabilities existed — `runs.engine: auto` resolves to exactly the engine `pipeline start` already used.

Related reading: [artifact-workflow-guide.md §2](artifact-workflow-guide.md#2-run-the-entire-workflow-with-one-command-rasenauto) (the autopilot chapter), §2.6 (writing custom pipelines by hand — composition's manual sibling), §9 (goal-driven iteration and its vet-gated `define-goal`).
