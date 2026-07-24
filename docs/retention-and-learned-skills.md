# Retention and learned skills

Rasen turns what a completed change *taught* into guidance future work can reuse. Two pieces cooperate: a **retention policy** on the active profile that decides whether (and how) a finished change is retained, and a **learned-skill registry** that stores the durable, evidence-gated results as managed Agent Skills.

This page covers the retention model, the profile v2 format and its downgrade limits, where learned skills live, how project and global scope work, applicability markers, ownership safeguards, context budgets, and the archive behavior break. The command surface is `rasen knowledge` (see [CLI reference](cli.md#rasen-knowledge)).

## The retention policy

Every profile resolves to exactly one retention mode — a closed machine value:

| Mode | What runs | Learned-skill state |
|------|-----------|---------------------|
| `off` | nothing — no retrospective, no codification | unchanged |
| `report` | the retrospective reporting contract (writes `retro.md`) | unchanged |
| `codify` | evaluates the change's evidence for managed learned-skill create / rewrite / retire / no-op | may change (project scope by default) |

`report` and `codify` are **mutually exclusive** within one automated run — a profile carries one mode, never a combination. The built-in `full` profile resolves to `report`; `core` resolves to `off`. A new user (or a `custom` selection with no explicit value) defaults to `off`.

The full-feature pipeline tail is:

```text
ship → retain → archive
```

`rasen-retain` is a single stable runner. Its small skill reads the effective retention mode (or the mode already frozen in run-state) and loads only the branch it needs — the report body, the codify body, or neither for `off`. Retention completes before archive; archive never reports or codifies.

`rasen-retro` remains for one migration window only, as a **user-invoked compatibility alias** that forces `report` mode. It is not profile-selectable and not model-invoked; prefer profile retention `report` with `rasen-retain`.

## Profile definition v2 and downgrade limits

Profiles are strict snapshots. Version 2 adds the `retention` field:

```yaml
version: 2
workflows:
  - apply
  - review
retention: codify
```

Compatibility rules:

- **Version 1 is still read indefinitely.** A v1 profile that selected the retired `retro-command` maps to `retention: report`; its absence maps to `off`. Every other valid id is preserved. Reading a v1 profile never rewrites it — v2 is written only on an explicit profile write or export.
- **Self-contained package exports** stamp the minimum supporting Rasen version so an older CLI fails clearly rather than silently mis-reading retention.
- **Downgrade** to an older CLI: export or edit profiles back to version 1 by removing `retention` (and, for report semantics, restoring `retro-command`). Learned-skill canonical stores are additive machine-local data and simply lie dormant under an older CLI. Existing `quality-rules` need no rollback.

## Where learned skills live

Learned skills are **registry records, not workflows.** They never appear in a profile's workflow list, the profile picker, or a workflow dependency closure. They are stored canonically outside the repository, so shipping a change never dirties the worktree:

```text
<global data dir>/learned-skills/<id>/         # global scope
<project machine home>/learned-skills/<id>/    # project scope
```

Each canonical directory holds a strict `learned-skill.yaml` manifest (identity, stable knowledge key, scope, status, generated-ownership marker, content digest, applicability, evidence references, timestamps) and a generated `SKILL.md`. A project-scoped write requires a registered project with a resolved machine home — there is no in-repository fallback; an unregistered project gets `rasen init` guidance instead.

## Scope and global promotion

An accepted candidate defaults to **project scope** in the owning project's machine home. A **global** create or promotion is gated:

1. equivalent accepted evidence carrying the same stable knowledge key,
2. from at least **two distinct stable project ids** (multiple changes or clones sharing one id count once),
3. applicability that carries no project-private path/name/domain/policy, and
4. explicit user approval at the `rasen knowledge apply` seam (interactive prompt, or `--approve-global` in a non-interactive run).

An active `codify` profile authorizes project-scope create/rewrite/retire without an extra prompt, but never authorizes a global operation.

## Applicability markers

Every learned skill declares an explicit `path-exists` applicability contract — portable, root-relative marker paths composed with `all` or `any`:

```yaml
applicability:
  mode: all
  markers:
    - go.mod
    - internal/db
```

No glob, regex, shell expansion, or arbitrary detector runs. Markers are validated with the same portable-path rules the workflow registry uses (no absolute paths, `.`/`..`, backslashes, device names, or case/NFC collisions) and resolved with platform path primitives, so a Windows separator and its case-insensitive alias produce the same result.

Materialization uses applicability to decide what to install into a project-local tool home: a global skill installs only where the project matches; a project-scoped skill installs only for its owning project when the project matches. A **global-only tool home** (currently Hermes) cannot enforce project applicability at install time, so it reconciles every active approved global skill through a machine-global ledger and skips project-scoped skills with a warning.

## Ownership: Rasen never overwrites human skills

Materialization and codification are exact, never name-based. Rasen refreshes or removes a materialized copy **only** when its artifact ledger records that exact path as Rasen's generated copy *and* the on-disk bytes still match what Rasen wrote. A human-authored directory, or a generated copy the user has since edited, blocks the operation and is preserved byte-for-byte with a diagnostic naming the skill, tool, and path. Ownership lives in the manifest's `generatedBy` marker and the ledger — never in an id prefix — so a similarly named skill is treated as unowned.

Canonical mutations replace the complete managed `SKILL.md` and manifest atomically (never append), lock per registry, re-verify the staged digest, and roll back on failure. Retirement flips status to `retired`, preserves provenance, and makes recorded materializations eligible for exact ledger-based removal.

## Context budgets

Codification enforces named budgets **before** any state changes, and never silently truncates:

- `LEARNED_SKILL_CONTEXT_BUDGET` — total bytes of an accepted candidate's evidence set.
- `LEARNED_SKILL_CONTENT_BUDGET` — one skill's description + instructions.
- `LEARNED_SKILL_ACTIVE_DESCRIPTION_BUDGET` — always-loaded descriptions across one project-local materialization set.

An exceeded limit fails planning with an actionable error naming the limit and the affected candidate/evidence set, and recommends narrowing, splitting, merging, or retiring guidance.

## Untrusted evidence

Planning artifacts, reports, logs, tests, and comments are treated as untrusted data. Codify **synthesizes** bounded procedural guidance rather than copying source instructions verbatim, so prompt-like source text cannot select global scope, claim ownership, change budgets, request command execution, or override policy. In v1, generated learned skills contain no executable sidecars or scripts.

## The archive behavior break

Archive is no longer a codification step. It keeps quality-artifact scanning, quality-metric extraction, archive metadata, and normal movement, but it:

- no longer parses `[RULE]` markers as reusable guidance (they are ordinary archived content),
- no longer appends to the project's `quality-rules`, and
- no longer reports an extracted-rule count.

Existing `quality-rules` are preserved exactly and keep participating in instruction injection; Rasen cannot safely reconstruct which entries were generated versus human-authored, so it converts nothing automatically. Use `codify` mode for new evidence-derived guidance.
