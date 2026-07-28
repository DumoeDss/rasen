## Why

E1 (`store-bootstrap-diagnose`, shipped `f11daa1d`) gave the machine a way to ask
"what does this machine still need?" and get the whole answer at once, writing
nothing. E2 (`store-bootstrap-adopt-local`, shipped `9f4286da`) closed every gap
that could be closed from what is already on this machine: registering the
current checkout, registering present-unregistered Stores, preparing the
knowledge location, and writing the durable declaration. Both left one gap open:
a declared Store that is absent from this machine but carries a recorded remote.
E2 reports it as degraded, naming retrieval as the next step — and then stops,
because E2 retrieves nothing.

This change closes that gap. It is the **retrieval half** of Phase E: the only
child that creates new checkouts from the network, and the only one whose
failure mode can **destroy user data**.

## What Changes

- **The project-first apply path obtains declared Stores from their remotes.**
  When bootstrap runs in apply mode from a project checkout and a declared
  Store is absent with a recorded remote, the Store is cloned to the location
  bootstrap previewed and registered through the same path `rasen store
  register` uses. Consent-gated: without `--yes`, each obtain asks; with `--yes`
  (project-first), the Stores the project itself declares are obtained without
  stopping to ask. An obtained Store is then membership-re-verified against its
  now-readable records, exactly as E2 does for a registered one.
- **The Store-first apply path acts.** From a Store checkout, apply mode now
  registers the Store's own checkout and lists its projects with their local
  state. A project is obtained and registered **only** when the user explicitly
  selects it or supplies a path for it. `--yes` does **not** count as selection
  here: a Store's roster is authored by other people and can grow without the
  local user knowing, so `--yes` covers registering the Store's own checkout
  only, never obtaining its projects.
- **Clone target selection is enforced, not just previewed.** E1 previewed
  where a repository would land and reported occupied or checkout-holding
  locations as refused. This change enforces the refusal: bootstrap never clones
  into a directory that already has contents, never overwrites an existing
  checkout, never takes a location from a legacy recorded path, and passes the
  remote as an argument to the version-control operation — never assembled into a
  shell command line. The derived name reuses the same safe-name rules E1
  already validates against.
- **A failed retrieval is cleaned up only when provably safe.** When obtaining
  a repository fails, bootstrap removes the target directory **only** when it
  can establish that this run created that directory and that removing it is
  safe. In every other case — the directory pre-existed, or its provenance
  cannot be proven — it is left exactly as it is and reported, together with
  what to inspect.
- **The never-harvest rule holds even under `--yes`.** A Store can hold a
  hundred projects. Bootstrap never clones every project a Store records, under
  any option. Obtaining is opt-in per project, and `--yes` does not turn "I
  trust my own config" into "obtain whatever this Store now lists."

Out of scope for this change and belonging to E4 (`store-bootstrap-repair-text`):
rewriting the failure text of ordinary commands to name bootstrap, and the
doctor readiness integration. Out of scope for this release: moving knowledge
between machines as an explicit bundle, and resuming an in-flight run on
another machine.

## Capabilities

### New Capabilities

None. The `store-bootstrap` capability was created by E1 and deepened by E2;
this change deepens it further.

### Modified Capabilities

- `store-bootstrap`: the project-first apply path now obtains declared Stores
  from their remotes, the Store-first apply path now registers the Store's
  checkout and obtains explicitly selected projects, clone target selection is
  enforced (not merely previewed), and failed-retrieval cleanup is governed by a
  provable-creation guard. Two requirements are ADDed (clone target
  enforcement, failed-retrieval cleanup) and two are MODIFIED (the project-first
  flow gains the obtain path; the Store-first flow gains the acting half).

## Impact

- **Machine-local state**: a cloned Store or project checkout is registered
  through the existing `rasen store register` path (`registerExistingStore`),
  exactly as E2 registers a present-unregistered Store. The project registry
  and Store registry entries are the same shape every other command produces.
- **Filesystem**: a new checkout directory is created at the location bootstrap
  previewed. This is the first child in the portfolio that creates a directory
  the user did not name character-for-character (the derived name from a remote
  is new), and it is the first that spawns a version-control process
  (`git clone`) on the user's behalf.
- **Code**: extends `src/core/store/bootstrap.ts` (the apply path gains the
  obtain step and the Store-first acting flow), extends
  `src/commands/bootstrap.ts` (the Store-first apply path and explicit project
  selection), and adds a clone capability to `src/core/store/git.ts` (routed
  through the existing `execFileAsync` that already sets `windowsHide` on every
  git spawn). No new command is added.
- **Commands**: `rasen bootstrap --apply` gains meaning from a Store checkout
  (E2 left it producing the read-only listing); the `--path` flag now also
  selects projects to obtain in the Store-first flow.
- **Docs and locales**: `docs/cli.md` gains the obtain flow, the Store-first
  apply model, and the cleanup guarantee; the `en` / `zh-cn` / `ja` CLI locale
  bundles gain every new message and state name.
- **Compatibility**: purely additive. A machine that already resolves
  everything reports exactly that and obtains nothing. Nothing previously
  written becomes unreadable.
- **Depends on** E2's shipped apply path and construction-time `mutates` field
  (`src/core/store/bootstrap.ts`, frozen at `9f4286da`), E1's report shape and
  location selection (`selectBootstrapLocation`, `deriveSafeLocationName`), the
  existing Store registration path (`registerExistingStore`), and the git spawn
  discipline (`src/core/store/git.ts`'s `execFileAsync` with `windowsHide`) —
  all verified present before this was written.
