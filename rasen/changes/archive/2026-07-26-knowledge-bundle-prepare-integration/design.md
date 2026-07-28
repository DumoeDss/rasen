## Context

This is Phase F child F4, the last child of the portable-project-knowledge chain. F1/F2 landed the closed bundle schema, export, and Store transport. F3 landed and archived `importKnowledgeBundle(options)`, the only authority for complete validation, deterministic preview, conflict policy, project-owned destination projection, and all-or-nothing add-only apply. F4 chooses which declared bundle to offer and whether consent permits it; it does not parse, classify, or persist bundle records itself.

The acting machine-preparation flow is also present. `buildBootstrapReport()` has project-first and Store-first flows, `BootstrapConsent` distinguishes blanket confirmation from interactive callbacks, and `confirmAction()` already implements the trust rule that `--yes` covers what the project's own declaration implies but not what only a Store says. `BootstrapReport.knowledge` means only that the empty canonical knowledge directories were prepared; its comment and renderer already reserve portable import as a separate step.

Two landed persistence surfaces can carry the declaration:

- project-owned committed configuration is parsed by `readProjectConfig()` from `rasen/config.yaml`;
- a Store's strict, serialized `.rasen-store/projects/<projectId>.yaml` record is projected through `StoreMembershipRecord`.

The collapsing invariant is: preparation offers only bundle paths one of those durable declarations names, and imports none without confirmation.

## Goals / Non-Goals

**Goals:**

- Add one minimal portable-bundle locator to project configuration and Store project records.
- Resolve every locator relative to the durable file's owning repository, without permitting an absolute path, parent traversal, or symlink escape.
- Report declared bundle imports as distinct actions for the project they target, in both project-first and Store-first preparation.
- Preserve the settled `--yes` asymmetry and make the trust source visible in the report.
- Reuse F3 directly for preview and apply, carrying its complete plan, conflict, warning, and changed-state facts.
- Let an unavailable, invalid, or conflicting bundle degrade its action while all unrelated preparation steps continue.
- Keep existing bootstrap human/JSON facts aligned and localized.

**Non-Goals:**

- Any change to F3 validation, classification, transaction, ownership, source, evidence, or conflict policy.
- Any Store catalog, membership, metadata, Git index, commit, push, or publication mutation caused by import.
- Doctor/readiness work, including the E4 `knowledgeBundlePrepared` extension note.
- Any Phase E behavior change beyond composing the already-landed preparation flow.
- Interactive conflict reconciliation, automatic synchronization, or portable run checkpoints.

## Decisions

### D1 — One verbatim ADDED requirement, zero MODIFIED blocks

F4 adds the original requirement *Preparing a machine imports a declared bundle only as a separate, confirmed step* verbatim, with all seven original scenarios. It modifies no existing requirement.

The title is disjoint from every F1–F3 title. This keeps F4 in Phase F's collision-safe ADDED class, but `validate` still cannot prove the cross-change merge. A scratch archive rehearsal remains the structural gate, and the existing `portable-project-knowledge` Purpose is preserved verbatim.

### D2 — The declaration is one optional `knowledgeBundle` locator on each landed owner

Both durable owners gain the same minimal field:

```ts
interface ProjectConfig {
  knowledgeBundle?: string;
}

interface StoreProjectRecord {
  // existing version remains 1
  knowledgeBundle?: string;
}
```

The value is a non-empty repository-relative file locator, not a URL, Store selector, bundle identity, owner, or publication declaration.

- In `rasen/config.yaml`, `knowledgeBundle` resolves against the project root.
- In `.rasen-store/projects/<projectId>.yaml`, `knowledgeBundle` resolves against that Store's root.

The project parser adds a resilient field-level parse and diagnostic. The Store project-record schema remains strict and its named serializer includes the optional field in fixed order. Existing records do not rewrite merely because the optional field exists, and all membership projections carry the locator explicitly rather than object-spreading future fields.

Alternatives rejected:

- A machine-local registry field: it would not travel with the project or Store declaration.
- An absolute path: it would describe the declaring machine, not a portable route.
- Embedding a bundle or Store ownership data in either record: the bundle format and ownership boundary already have their own authorities.
- A second declaration object with one field: it adds shape without adding a decision; a versioned object can replace the string in a later change if declarations acquire real metadata.

### D3 — One resolver proves relative containment on every platform

A named `resolveDeclaredKnowledgeBundle(ownerRoot, locator)` seam is the only path authority for both declaration sources.

It:

1. rejects empty values and every Windows drive-letter, Windows network-share, or POSIX absolute form using the landed cross-platform machine-path detector;
2. computes the candidate with `path.resolve(ownerRoot, locator)`;
3. proves the lexical candidate remains under the resolved owner root using path segments, never string prefix comparison;
4. when the candidate exists, canonicalizes both root and candidate and proves the real target still remains under the real root, preventing a symlink from escaping the repository;
5. returns a structured unsafe, missing, unreadable, or usable result with the declaration path and repair.

A missing target is still a valid declaration and therefore remains listed; it degrades with the exact resolved path to restore or the durable declaration to edit. Unsafe or unreadable locators are never passed to F3.

### D4 — Declarations become deterministic, de-duplicated action entries

The bootstrap report gains a distinct optional `bundleImports` collection. It does not overload `knowledge`, `stores`, `projects`, or `declaration`.

Each entry names:

- a stable action key and target project identity/root;
- the declared locator and safely resolved bundle path;
- every durable source that named that path (`project-config` and/or `store-record`, with the declaring file and Store identity where applicable);
- trust (`project-config` or `store-record-only`);
- availability and action outcome;
- F3 preview/result or structured refusal facts;
- repair and whether any knowledge changed.

Entries are de-duplicated by canonical resolved path for the same project. If the project config and a Store record name the same path, one action retains both sources and has project-config trust, because the project's own committed configuration genuinely names it. Different resolved paths remain separate listed actions; no declaration silently overrides another. Entries sort project-config-trusted first, then Store-only entries by project identity and portable code-point path order.

This is precedence only for trust and duplicate display, never for bundle contents: F3 remains the sole authority over whether a selected bundle matches the project and local catalog.

### D5 — Project-first and Store-first feed the same preparation seam

Project-first preparation collects:

- the project's `knowledgeBundle`, if present;
- the `knowledgeBundle` field from every readable Store project record for that permanent project identity.

Store-first preparation collects the current Store record's locator for each listed project and, when that project's local checkout is present or has just been explicitly obtained, its committed project-config locator too. A Store-record locator can be listed even while its project checkout is absent; it cannot be imported until the permanent target project resolves locally, and its repair is the already-reported project obtain step.

Apply orders the bundle step after existing registration/obtain and knowledge-directory preparation, then re-reads project and membership declarations. That lets a Store obtained earlier in the same run reveal its record without freezing the pre-apply view. Check and preview only use declarations readable at the time and perform no registration, obtain, directory creation, or import apply.

No declaration means `bundleImports` is absent or empty and no F3 call is made.

### D6 — Existing consent machinery enforces the settled asymmetry

`BootstrapConsentRequest` gains an `import-bundle` action carrying the target project, bundle path, and trust source. The existing decision remains explicit:

- an action whose de-duplicated sources include the project's own committed config is covered by blanket `--yes`;
- an action named only by one or more Store project records is never covered by blanket `--yes`;
- interactive mode asks for each action; no callback or a negative answer leaves it listed as not confirmed.

The Store-only branch is not unified behind the project-trusted predicate. Under `--yes`, it is reported with the explicit choice that would import it, but F3 apply is not called.

Multiple distinct actions are independent explicit imports. Each confirmed action previews immediately before confirmation and applies through F3 immediately after confirmation. F3 re-resolves and re-proves its plan under the project lock, so a change between preview and apply refuses that action rather than importing stale decisions.

### D7 — F3 is called directly and the declaration route grants nothing

For a usable, locally targetable action, preparation calls:

```ts
importKnowledgeBundle({
  bundle: resolvedBundlePath,
  project: projectIdOrRegisteredRoot,
  dryRun: true
})
```

Only after consent does it call the same function with apply enabled. It never invokes the CLI, reads bundle JSON itself, copies F3's conflict predicate, or constructs a learned-skill manifest.

The declaration source is deliberately not part of `ImportKnowledgeBundleOptions`. A Store record chooses a file to offer and nothing more: it never becomes owner, source, evidence, membership, or publication authority. F3 continues to project the permanent project owner and an empty transport-source list.

F3 conflict, validation, transaction, rollback, and cleanup-warning results are preserved in the action:

- conflict or ordinary refusal: degraded, `changed: false`;
- verified import or all-already-present result: complete for that action;
- `staging_cleanup_deferred`: successful import with a warning;
- unverifiable rollback: degraded with `changed: "unknown"` and every retained path reported.

One failed action does not stop Store registration, repository obtain, directory hydration, declaration upgrade, or the reporting of other bundle actions.

### D8 — Bundle actions extend end-state and output without changing hydration

`computeBootstrapEndState()` gains bundle-action facts. Existing blockers remain blockers. A declared bundle action that is missing, unreadable, unsafe, unconfirmed, conflicting, or otherwise refused makes the report degraded, never blocked by itself. A successful or already-present action adds no degradation. With no declared action, existing end-state behavior is byte-for-byte unchanged.

Human output renders the same source, trust, path, status, plan counts/conflicts, warning, repair, and changed-state facts JSON carries. New prompts, state names, refusals, and repairs live in `bootstrap-messages.ts` and all three locale catalogs. The existing provisional `knowledgeBundleStep` line is replaced by real action rendering; it is not left as a second, content-free claim.

The bootstrap command gains no new flag. Its apply/`--yes` help and completion descriptions are updated to state the bundle asymmetry.

### D9 — Verification stays focused and the archive merge is rehearsed

Focused serial tests cover project-config parsing, Store record round-trip/strictness, membership projection, path safety, both bootstrap origins, trust de-duplication, consent asymmetry, F3 conflict propagation, no-declaration no-op, and human/JSON/locales. Run `pnpm lint` and `pnpm build`; do not run an unnecessary full test suite.

Strict validation must show exactly one ADDED requirement, seven scenarios, and zero MODIFIED requirements. Before ship, rehearse archive from a temporary root containing only `rasen/config.yaml`, `rasen/specs/`, and this change, and prove the merged Purpose remains exact with zero `TBD - created by archiving` occurrences.

## Risks / Trade-offs

- **A Store can declare a bundle for a project that is not local yet.** → List the action and its obtain repair; import only after the permanent target project resolves.
- **Two declarations can name different bundles.** → Keep both visible and independently confirmed; never choose one silently.
- **Two declarations can spell one path differently.** → De-duplicate on the safely resolved canonical path and retain both sources.
- **A relative locator can escape through `..` or a symlink.** → Apply lexical containment to every value and canonical containment to existing targets before F3 sees the path.
- **Preview can become stale before consent.** → F3 apply re-resolves and recomputes under its existing owner lock.
- **Extending a strict Store record can drift from membership projection.** → Update schema, serializer, parser, equality/write paths, and `fromStoreProjectRecord` together, with an on-disk round-trip test.
- **A failed bundle could accidentally stop preparation.** → Keep refusal facts on the bundle action, extend end-state as degraded, and continue every unrelated preparation step.

## Migration Plan

1. Add the optional locator to both durable schemas and preserve it through Store membership reads.
2. Add the shared safe resolver and deterministic declaration/action planning.
3. Add the bundle action/result to project-first and Store-first bootstrap reports without changing `knowledge`.
4. Extend consent and call F3 preview/apply directly.
5. Add human/JSON rendering, prompts, completion/help text, locales, docs, and focused acceptance coverage.
6. Strictly validate and rehearse the one-requirement archive merge.

Rollback removes declaration handling and action rendering. Existing optional declaration keys become inert data, imported records remain ordinary valid project-owned records, and no pre-existing file format is rewritten.

## Open Questions

None. Doctor readiness, interactive conflict reconciliation, and richer declaration metadata remain deliberately deferred.
