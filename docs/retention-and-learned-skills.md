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
<store repo>/rasen/learned-skills/<id>/        # store scope
```

Each canonical directory holds a strict `learned-skill.yaml` manifest (identity, stable knowledge key, scope, status, generated-ownership marker, content digest, applicability, evidence references, timestamps) and a generated `SKILL.md`. A project-scoped write requires a registered project with a resolved machine home — there is no in-repository fallback; an unregistered project gets `rasen init` guidance instead.

A **Store's** catalog is the one exception to "never in the repository", and deliberately so: a Store's knowledge exists to be shared, so it lives in the Store's own repo beside its planning content and travels with a clone. Nothing else Rasen writes for a Store goes there — the mutation lock lives under the machine data directory, so reading or writing knowledge never leaves an untracked file in the team's `git status`.

Planning location is not knowledge ownership. A store-backed pointer project can
plan in `store:team` while its private learned skills remain owned by
`project:web`. `rasen knowledge --project <id>` and `--store <id>` select that
typed owner only; they never relocate the change. The flags are mutually
exclusive, same bare ids remain distinct across namespaces, and direct store
launches refuse to guess a member project.

## A Store's knowledge catalog

A Store can hold learned knowledge that its member projects draw on — the layer that was missing between "one project only" and "this machine, everywhere".

**Everything durable names the Store permanently.** A record's ownership, its provenance, and every source it names key on the Store's permanent identity; the display name travels alongside for readability and is never what anything is keyed on. Two Stores that share a display name keep distinct, separately attributable catalogs, and **renaming a Store changes nothing already recorded**. A Store whose metadata predates permanent identities cannot own records at all — publication refuses and names `rasen store upgrade-identity`, rather than writing ownership keyed on a name that can move.

**Records are versioned, and older ones keep working.** A version 1 record is read, normalized in memory, and used; its file is left byte-identical. The newer shape is written only by a mutation that needs it — a Store record always, a project or global record never just because a release happened. Reading a catalog never rewrites it, and never brings one into existence.

**Publishing into a Store requires independent member-project evidence:**

1. the publication names the **exact managed records** it draws on, and each is resolved, checked for the same stable knowledge key, and digested — a shared id is not shared knowledge;
2. those records come from at least **two distinct projects** (the same project contributing repeatedly counts once);
3. every contributing project is one the **Store's own membership records** name as a knowledge member — not merely a project that happens to plan in the Store; and
4. approval is **explicit and names the Store** (`--approve-store <store>`, or the interactive prompt).

Membership comes from `<store>/.rasen-store/projects/<projectId>.yaml`. A project the Store records for *planning only* is reported differently from one it has no record for at all, because the two need different repairs — the refusal names the missing membership and the `rasen store add-project` command that adds it.

**Promotion beyond a Store** — making knowledge machine-wide — needs the same independence: exact source records from more than one project, homogeneous, carrying the knowledge key being promoted.

**Approval is bound to what it approves.** An approval for one Store never authorizes another, never authorizes the global scope, and is never inferred — not from a previous approval, not from silence, and not from the knowledge already existing at a narrower scope.

**A refusal writes nothing at all.** No record, no file, no ownership entry: reporting the evidence held and the evidence missing is the whole output.

**Mutations are exact, atomic, and never touch the index.** A catalog mutation changes only records the catalog declares it owns; a file the user authored at a catalog path is left exactly as it was. Writes are staged and renamed into place, so an interruption leaves no partial record and the catalog reads exactly as it did before. Rasen stages, commits, and pushes nothing — it prints the files you need to commit yourself.

Retain/codify freezes a versioned `{planningRoot, owner}` identity in
`auto-run.json`. Only typed ids are persisted; canonical paths are re-resolved
and revalidated on resume by passing pipeline resume's absolute `runStateDir`
to project-scope knowledge commands as `--run-state-dir`. Existing run-state without the field remains
readable and gains the context conservatively at its first knowledge operation.

## Scope and global promotion

An accepted candidate defaults to **project scope** in the owning project's machine home. A **global** create or promotion is gated:

1. the **exact managed source records** it draws on, each resolved and verified to carry the same stable knowledge key,
2. from at least **two distinct stable project ids** (multiple changes or clones sharing one id count once),
3. applicability that carries no project-private path/name/domain/policy, and
4. explicit user approval at the `rasen knowledge apply` seam (interactive prompt, or `--approve-global` in a non-interactive run).

An active `codify` profile authorizes project-scope create/rewrite/retire without an extra prompt, but never authorizes a store or global operation.

A **store** publication is gated the same way, with membership added and the approval bound to the named Store — see [A Store's knowledge catalog](#a-stores-knowledge-catalog) above.

### A store candidate

Store publication uses the version 2 candidate, which names its owner and its exact sources:

```json
{
  "version": 2,
  "operation": "upsert",
  "scope": "store",
  "owner": { "type": "store", "uid": "9f0c1e2a-...", "id": "team" },
  "id": "go-sql-transaction-locking",
  "knowledgeKey": "go-sql-tx-locking",
  "description": "Lock rows in a transaction with SELECT ... FOR UPDATE.",
  "instructions": "## When\nConcurrent updates.\n## Steps\nUse FOR UPDATE.\n## Done\nNo lost update.",
  "applicability": { "mode": "all", "markers": ["go.mod"] },
  "evidence": [],
  "sources": [
    { "owner": { "type": "project", "projectId": "1b8f…" }, "id": "go-sql-transaction-locking", "knowledgeKey": "go-sql-tx-locking" },
    { "owner": { "type": "project", "projectId": "77ac…" }, "id": "go-sql-transaction-locking", "knowledgeKey": "go-sql-tx-locking" }
  ]
}
```

A refusal reports what it found and what is missing, and writes nothing:

```json
{
  "ok": false,
  "plan": {
    "action": "blocked",
    "identity": { "owner": { "type": "store", "uid": "9f0c1e2a-…", "id": "team" }, "id": "go-sql-transaction-locking" },
    "scope": "store"
  },
  "block": {
    "code": "store_membership_invalid",
    "message": "store 'team' has no membership record for 77ac…. Evidence from a project the store does not record as a knowledge member does not count.",
    "repair": ["rasen store add-project team --project 77ac…"]
  }
}
```

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
