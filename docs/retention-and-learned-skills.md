# Retention and learned skills

Rasen turns what a completed change *taught* into guidance future work can reuse. Two pieces cooperate: a **retention policy** on the active profile that decides whether (and how) a finished change is retained, and a **learned-skill registry** that stores the durable, evidence-gated results as managed Agent Skills.

This page covers the retention model, profile downgrade limits, versioned learned-skill records, project/store/global scope, verified publication evidence, applicability, ownership safeguards, and budgets. The command surface is `rasen knowledge` (see [CLI reference](cli.md#rasen-knowledge)).

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
<registered store root>/rasen/learned-skills/<id>/ # store scope, shared/reviewable
```

Each canonical directory holds a strict `learned-skill.yaml` manifest (identity, stable knowledge key, scope, status, generated-ownership marker, content digest, applicability, evidence references, timestamps) and a generated `SKILL.md`. A project-scoped write requires a registered project with a resolved machine home — there is no in-repository fallback; an unregistered project gets `rasen init` guidance instead.

Planning location is not knowledge ownership. A store-backed pointer project can
plan in `store:team` while its private learned skills remain owned by
`project:web`. `rasen knowledge --project <id>` and `--store <id>` select that
typed owner only; they never relocate the change. The flags are mutually
exclusive, same bare ids remain distinct across namespaces, and direct store
launches refuse to guess a member project. Store reads and mutations always
address one explicit registered store; they never enumerate all stores. A
successful store mutation reports the store root and exact changed canonical
files, and never commits, fetches, or pushes that repository.

Retain/codify freezes a versioned `{planningRoot, owner}` identity in
`auto-run.json`. Only typed ids are persisted; canonical paths are re-resolved
and revalidated on resume by passing pipeline resume's absolute `runStateDir`
to project-scope knowledge commands as `--run-state-dir`. Existing run-state without the field remains
readable and gains the context conservatively at its first knowledge operation.

## Version 1 / version 2 compatibility

Strict candidate and manifest version 1 remains the exact project/global
compatibility shape. Reads normalize its project evidence and canonical owner
to typed in-memory records without rewriting any bytes. Project/global
mutations whose meaning remains v1-representable continue to write v1.

Version 2 adds typed owners, typed evidence, exact source-record locators, and
store scope. Store records and global records with store provenance require
v2. Both versions reject unknown fields. Older CLIs leave v2 data untouched
but cannot manage it; downgrade by retaining the v2 canonical directories and
using a supporting CLI when management is needed.

## Scope and publication

An accepted candidate defaults to **project scope** in the owning project's
machine home. Cross-owner publication never trusts contributor claims in the
candidate. Every named source must resolve to the exact active Rasen-managed
record, typed owner, skill id, knowledge key, and stored content digest.

A **store** create or rewrite requires:

1. at least two distinct stable project owners,
2. exact active source records with the same knowledge key,
3. a current explicit `project:` membership edge from the target store to each
   source project (no unprefixed or transitive membership), and
4. store-specific informed approval (`--approve-store` outside a TTY).

A **global** create or promotion requires:

1. exact active sources from at least two distinct projects or at least two
   distinct stores,
2. one homogeneous source class (project/store mixing is rejected),
3. one stable knowledge key and valid stored digests, and
4. global-specific informed approval (`--approve-global` outside a TTY).

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

Materialization evaluates applicability before precedence. For each learned-skill
ID, the effective order is **project > store > global**. Rasen reverse-discovers
every healthy registered store that explicitly lists the resolved typed project
as a `project:` member. The planning store and the project's `store:` config
pointer do not become exclusive knowledge parents, unprefixed/store references
do not count as project membership, and membership is not followed
transitively.

When several member stores publish the same effective ID, Rasen produces one
copy only if the stable knowledge key and verified canonical bytes/digest are
identical. The copy records every sorted `store:<id>` source; no store is named
the winner. Any divergence produces one complete order-independent conflict and
blocks all project-local learned file and ledger writes for that init/update
run. An applicable project winner may shadow that disagreement; it is then
reported as latent rather than used to choose a store. The active-description
budget is calculated after applicability, precedence, and exact store
deduplication, so equivalent sources count once.

A **global-only tool home** (currently Hermes) is deliberately independent: it
reconciles every active approved global skill through a machine-global typed
ledger, ignores project markers/member stores/project-local conflicts, and
excludes project and store records. One project's update therefore cannot prune
a shared Hermes copy because of local membership or applicability.

## Ownership: Rasen never overwrites human skills

Materialization and codification are exact, never name-based. Project-local
copies use the dedicated strict
`rasen/.learned-skill-materializations.json` ledger, separate from workflow
ownership in `rasen/.workflow-artifacts.json`. Each learned entry records its
effective scope, every typed canonical source, resolution digest, and exact
target path/digest. The generated `SKILL.md` frontmatter carries the same
effective scope, sorted source identities, and resolution digest. A
provenance-only transition is therefore visible even when the guidance body is
unchanged.

On first successful reconciliation, legacy learned sections are migrated by
writing the new ledger atomically before clearing only those sections from the
workflow ledger. If a crash leaves both representations, the new ledger is
authoritative and retry clears the duplicate without reclaiming or deleting the
file. Modified legacy files are never claimed. Older CLIs still read the
preserved workflow entries and see migrated learned copies as untracked, so
they leave them alone.

Rasen refreshes or removes a materialized copy **only** when its typed ledger
records that exact path as Rasen's generated copy *and* the on-disk bytes still
match what Rasen wrote. A human-authored directory, symlink/reparse occupant,
non-regular file, missing copy, or locally edited generated copy is preserved
with a diagnostic. An unavailable store is never treated as empty: if prior
typed ownership, the config pointer, or frozen planning facts say it may matter,
same-layer replacement/removal is deferred. A new applicable project winner may
still replace that unknown lower layer, and unrelated unavailable stores do not
block unaffected additions.

Canonical mutations replace the complete managed `SKILL.md` and manifest atomically (never append), use machine-data per-owner locks, stage beside the target for same-volume replacement, re-verify ownership/source/membership and content digests under lock, and roll back on failure. Retirement flips status to `retired` while preserving provenance.

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
