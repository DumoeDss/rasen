## Context

Every other change in this release made the model *declarative*: a project records its planning Store by permanent identity, its Store membership hints, and credential-free remotes; a Store records which projects belong to it. All of it is designed so a machine that has never seen any of it can be told what to obtain.

Nothing does the telling. Today the user discovers gaps one command at a time, and each failure repairs exactly one of them. This change adds the command that reads the declarations, computes the whole gap, and either reports it or closes it.

Dependency state when this was planned: **child A is implemented** and in final review; **children B, C, D1, and D2 are proposed only**. Their specs are the contract here — no symbol from any of them may be assumed to exist. This change's **implementation must re-verify every dependency's final exported surface (names *and* signatures) before starting**, and each dependency lookup sits behind a seam that falls back to current behavior so bootstrap is never blocked on one of them landing.

Two conventions from child A are load-bearing here and are worth naming, because bootstrap is the command most likely to violate them:

- **`writeDurablePointer` (exported from `upgrade-identity.ts`) is THE single durable-declaration writer.** Bootstrap writes pointers. Child A's most expensive defect was a bare string written into a Git-tracked file that then could not resolve.
- The three-way identity rule: **display → resolved name; re-resolution → `uid ?? id`; durable record → object form when an identity exists.**

## Goals / Non-Goals

**Goals:**

- One command that computes the complete set of what a machine is missing for a project.
- `--check` and `--dry-run` as two *separately specified* guarantees, not one loosely-defined "safe mode".
- Project-first and Store-first flows, each explicit about what it will and will not obtain.
- Clone target selection by stated priority, with the forbidden cases enumerated rather than implied.
- Idempotent rerun that reports what was already in place.
- Ordinary commands that name bootstrap as the repair instead of leaving the user to guess.

**Non-Goals:**

- Cross-machine knowledge bundle export/import (the following change) and run checkpoints (not this release).
- Automatic `git pull` / `git push`, distributed locks, or credential handling of any kind.
- Re-litigating the failure semantics child A settled. Bootstrap is the repair those failures point at; it does not change when they fire.
- Cloning anything the user did not ask for.

## Decisions

### D1 — Spec surface: one NEW capability, zero MODIFIED blocks

`store-bootstrap` is unclaimed in both `rasen/specs/` and every active change directory. Everything here is `ADDED` against it.

Deliberately **not** modified: child A's `store-identity`, which already requires every unavailable-Store failure to carry a copy-pasteable repair. That the repair string becomes `rasen bootstrap` is this change satisfying A's existing contract, not amending it — so no second `MODIFIED` block on a requirement A owns, and this change stays order-independent with respect to A's review and the outstanding archive debt.

Likewise untouched: `cli-completion` (adding a completion entry is an implementation task, exactly as child A did for `upgrade-identity`) and `project-registry` (bootstrap reads and registers through existing behavior).

### D2 — `--check` and `--dry-run` are different promises and are specified separately

| | reads | resolves remotes and target paths | creates directories | runs git | writes registry / pointer |
|---|---|---|---|---|---|
| `--check` | yes | **no** | no | no | no |
| `--dry-run` | yes | **yes** | no | no | no |
| (apply) | yes | yes | yes | yes | yes |

Collapsing these into one "safe mode" would be the natural implementation and would be wrong: `--check` is the mode a user runs when they do not yet trust the tool with their network, and it must not reach out. `--dry-run` is the mode that answers "exactly where would this land?", which cannot be answered without resolving the remote and the target path. Each gets its own requirement and its own zero-write assertion.

### D3 — Project-first is a state machine that reports, and only acts when asked

Following §19.2: read and verify the project identity → read the planning Store declaration in either form → read the membership hints → build the expected Store set → classify each Store → register the current checkout → verify each Store's record of this project → prepare the project's knowledge location → plan any explicit bundle import separately → report.

Each Store lands in exactly one class, and the class determines the offer:

| Store state | Offer |
|---|---|
| registered, identity and root verify | nothing to do |
| cloned but not registered | register it |
| not cloned, remote known | clone it, then register |
| not cloned, no remote | **demand** a path or metadata — nothing can be inferred |

The last row is the one that must not degrade into a guess. With no remote and no path there is no honest answer, and inventing one from a display name or a sibling directory is how a bootstrap ends up pointing at the wrong repository.

The final report is one of three states — complete, degraded, blocked — because "partially worked" is the normal outcome on a fresh machine and needs a name the user and the JSON consumer can both act on.

### D4 — Store-first lists; it does not harvest

Following §19.3: verify the Store's identity → register the checkout → read its project records → show which projects are already local and which could be obtained → clone and register **only** on explicit selection or an explicit path.

**Never clone every project in the Store.** A Store can hold a hundred projects; a bootstrap that obtained all of them would consume disk and network the user never agreed to, and would register checkouts they then have to clean up. The listing is the product here; obtaining is opt-in per project.

### D5 — Clone target priority, and the forbidden list as scenarios

Priority: an explicit `--store-path` / `--project-path` → `--clone-root` plus a safe basename derived from the source → interactive selection.

Forbidden, each written as its own spec scenario rather than left as implementation care, because each is a plausible shortcut with an expensive failure:

- cloning into a directory that already has contents;
- overwriting an existing checkout;
- taking a path from a legacy source-path record (another machine's absolute path — the thing child B removed);
- passing a remote through a shell (§28.6: clone must not go through a shell, so the remote is an argument, never a concatenated string);
- deleting a failed clone's directory unless bootstrap can show it created that directory during this run and it is safe to remove.

The last one is the subtle one. "Clean up after a failure" is the instinct, and it deletes a user's existing directory when the clone failed *because* the directory was already there.

### D6 — Idempotence is asserted, not assumed

A rerun with the same identity and the same checkout: rewrites no identity, creates no duplicate registration, changes no recorded path, re-imports nothing. JSON reports `already_registered` and `already_hydrated` so a caller can distinguish "did nothing because it was already right" from "did nothing because it failed". A drifted display name or remote is **reported and not corrected** — auto-fixing a declaration during what the user asked to be a setup step is exactly the silent rewrite this release spent four changes eliminating.

### D7 — Inherited traps from child A's deferred table: decided, not inherited silently

Child A left a deferred table; bootstrap touches two rows, and because bootstrap is the command that *creates* the declarations those rows misread, it must not emit data that walks into them.

**Row B — a uid-only declaration reads as a mismatch in session launch (409).** Bootstrap's decision: when it writes a durable declaration, it records the object form **including the display name whenever the Store has a resolvable one**, alongside the permanent identity. That keeps the stale comparison in the session-launch path satisfied while the durable identity is still the authority. A Store with no display name at all still produces a uid-only declaration — bootstrap reports that as a known limitation with the repair, rather than silently creating a project that cannot launch a Store session. The real fix belongs to the file child C owns; this change refuses to *manufacture* instances of the bug.

**Row D13 — next-step hints suggest `--store <name>`, which fails for exactly the user who typed a permanent identity.** Bootstrap's decision: every hint bootstrap emits names an **unambiguous** selector — the permanent identity when that display name matches more than one Store on this machine, the display name otherwise. Bootstrap knows the arity at the moment it prints, because it just resolved every Store; a hint that fails when pasted is worse than no hint.

Both decisions are scoped to bootstrap's own output and writes. Neither touches another child's file, so neither creates a collision.

### D8 — Dependency seams

Membership verification (does this Store's record include this project?) goes through **one** seam backed by child B's provider when present. The knowledge-location preparation goes through **one** seam backed by child D2's knowledge home when present. Both fall back to reporting "cannot verify here" rather than failing, so bootstrap's core — resolve, classify, report — works before either lands. The `hasStoreDeclaration` / durable-comparison discipline applies to every pointer read, never `pointer.value`.

### D9 — Cross-platform

Every path is composed with `path.join()`; clone targets resolve with `path.resolve()` and are compared canonically through `FileSystemUtils.canonicalizeExistingPath` with the established `path.resolve` fallback, so a drive-letter or separator difference never reads as a different target and never defeats the non-empty-directory guard. Git is invoked with an argument vector and `windowsHide`, matching the existing spawn discipline — never a shell string. The safe basename derived from a remote is validated against the same filesystem-safety rules used elsewhere (no separators, no traversal, no reserved device names). Tests build expected paths with `path.join()`.

## Risks / Trade-offs

- **Bootstrap is the first command that clones and writes on the user's behalf.** → Everything destructive is behind explicit consent, `--check` reaches no network at all, `--dry-run` shows the exact target first, and the forbidden list is enumerated as scenarios rather than trusted to care.
- **"Clean up the failed clone" deletes user data when the failure was a pre-existing directory.** → Removal requires proof that this run created the directory and that it is safe to remove; anything else is left and reported.
- **Store-first could quietly become a mass clone.** → Explicit selection or an explicit path per project, stated as its own requirement with its own scenario.
- **Four dependencies are proposed but not implemented.** → Two seams, each falling back to a report rather than a failure, and a re-verification task before implementation starts.
- **Bootstrap writes a durable declaration, which is where child A lost the most time.** → It goes through `writeDurablePointer` exclusively, records the object form with the display name when one exists (D7), and a test asserts what lands in the file rather than what the message says.
- **A degraded result may be mistaken for success.** → Three named end states, present in both human and JSON output, with the degraded one naming what is missing and its repair.

## Migration Plan

1. **Readers and classification.** The state machine, Store classification, and the report shape land as pure computation over what already exists. `--check` is fully functional at this point and nothing is written anywhere.
2. **`--dry-run`.** Remote and target-path resolution, with the zero-write guarantee asserted.
3. **Apply.** Clone, register, and prepare the knowledge location, each behind consent, in the order the state machine states.
4. **Store-first.** The project listing and per-project opt-in.
5. **Ordinary-command repair text and doctor.** Failures name bootstrap; doctor reports readiness read-only.
6. **Docs and locales**, including the bootstrap troubleshooting section.

Rollback: reverting removes a command and some message text. Bootstrap writes only registrations and declarations that the existing commands already write and already understand, so nothing it produces becomes unreadable.

## Open Questions

- ~~Whether `--yes` should cover cloning as well as registering.~~ **Adjudicated by the LEAD, narrower than first assumed** — moved out of open questions. `--yes` confirms actions the user's own committed configuration already implies, and never expands scope to what only the remote side knows. **Project-first: it MAY obtain**, because the expected Store set comes from the project's own pointer and membership hints, which the user committed to their own repository, and a scripted setup that stops halfway is unusable. **Store-first: it MUST NOT obtain projects** — a Store's roster is authored by other people and can grow without the local user knowing, so `--yes` must never turn "I trust my own config" into "obtain whatever this Store now lists"; it covers registering the Store's own checkout and other non-expanding confirmations only. This keeps the never-harvest rule true even under `--yes`, which the wider reading would not have. The two flows must not be unified behind one predicate.
- Whether bootstrap should offer to write the project's membership hint when a Store records the project but the project does not declare it. It is the natural place to repair that drift, but it is child B's write path and belongs to whichever change owns that decision.
