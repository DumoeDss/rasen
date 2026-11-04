## 1. Re-verify dependencies

- [ ] 1.1 Re-verify child D2's FINAL exported surface — proposed only when this was planned. Confirm `src/core/project-knowledge-home.ts`, the canonical location resolver, and the record shape it stores. If absent, the group-2 seam falls back to today's per-clone catalog location.
- [ ] 1.2 Re-verify child D1's FINAL state: what a Store catalog record is and where a Store's knowledge lives, so the transport location is reserved somewhere the catalog never reads.
- [ ] 1.3 Re-verify child A's final surface (signatures, not names): `resolveStoreBinding` and its tri-state, `hasStoreDeclaration`, `writeDurablePointer`, and `src/core/store/identity-diagnostics.ts`.
- [ ] 1.4 Re-verify child E's FINAL state: the preparation report shape and its three end states, and where a separate plan action is added. If absent, the group-8 step is simply not offered.
- [ ] 1.5 Confirm `portable-project-knowledge` is still unclaimed by `rasen/specs/` and by every other active change directory.
- [ ] 1.6 Note which files this change migrates off by-id Store lookup and add each to `PHASE_A_FILES` in `test/core/store/identity-boundaries.test.ts`.

## 2. Bundle shape and readers (readers before writers)

- [ ] 2.1 New `src/core/knowledge-bundle/schema.ts`: a strict, versioned bundle schema — `version`, `bundleId`, `projectId`, `createdAt`, `baseProjectCommit`, `records[]`.
- [ ] 2.2 Each record carries `id`, `knowledgeKey`, `contentDigest`, the managed manifest, and **the record's canonical content** (design D4 — the plan's sketch omits it and a digest cannot reconstruct a record).
- [ ] 2.3 The permitted-field list is an explicit named list of what is copied, never a scrub of what to remove (design D3). One place, referenced by both writer and reader.
- [ ] 2.4 `assertNoMachinePath()`: reject Windows drive-letter, Windows network-share, and POSIX absolute forms — all three on every platform. Failure names the record and the field.
- [ ] 2.5 Reader that parses and validates a bundle without writing anything, including refusal by version for a newer schema.
- [ ] 2.6 Tests: schema round-trip; an unknown field is a parse error; each of the three absolute-path forms is rejected on both platform shapes; a newer version is refused by version and not partially read.

## 3. Export

- [ ] 3.1 New `src/core/knowledge-bundle/export.ts`. Resolve the project from `<projectId|root>`; **the resolved identity is what enters the bundle, never the root**.
- [ ] 3.2 Read the project's own catalog through the knowledge-location seam (task 1.1). Include retired records with their status preserved.
- [ ] 3.3 Exclude Store-owned and machine-wide knowledge; exclude ownership records for generated files, generated tool files, and any token/session/run state — by not reading them, per 2.3.
- [ ] 3.4 Record `baseProjectCommit`; when no commit can be determined, record it as unavailable rather than inventing one.
- [ ] 3.5 Run the machine-path assertion over the serialized bundle before writing; fail naming the record and the field, producing no file.
- [ ] 3.6 Write atomically (temp then rename). **Refuse an occupied destination**, naming the existing file.
- [ ] 3.7 Human and JSON report the same project, record count, destination, and warnings.
- [ ] 3.8 Tests: two checkouts of one project produce bundles naming the same identity and neither checkout; a retired record round-trips with its status; Store and machine-wide knowledge are absent; an occupied destination writes nothing; the catalog is byte-identical after export.

## 4. Store transport

- [ ] 4.1 Resolve the target Store through `resolveStoreBinding` and its tri-state — never a by-id registry lookup.
- [ ] 4.2 Derive the in-Store location under a reserved transport directory, keyed so two exports never collide (design D5; §34 leaves this path to this change). Compose with `path.join()`.
- [ ] 4.3 Place the bundle file only. Do **not** write the Store's catalog, its project records, or its metadata.
- [ ] 4.4 Stage, commit, and push nothing; print the files the user needs to commit.
- [ ] 4.5 An unavailable Store fails with the reason and a copy-pasteable repair, and is never read as a Store containing nothing. Every printed hint names a selector that resolves unambiguously on this machine — the permanent identity when a display name matches more than one Store.
- [ ] 4.6 Tests: the Store's catalog records and project records are byte-identical after placement; git status in the Store fixture shows only an untracked file; an unavailable Store writes nothing; a second export leaves the first bundle present and unchanged; membership is unchanged.

## 5. Import validation

- [ ] 5.1 New `src/core/knowledge-bundle/import.ts`. Validate schema version, structure, project identity match, and per-record digest and managed-record validity — **all before any write**.
- [ ] 5.2 Re-run the machine-path assertion on import: a bundle is untrusted input and its producer may be older or hand-edited.
- [ ] 5.3 A project-identity mismatch is refused naming both identities.
- [ ] 5.4 Every failure names what failed and which record it belongs to, and writes nothing.
- [ ] 5.5 Tests: bundle for another project; a record whose content does not match its digest; a malformed file; a bundle whose last record is invalid imports none of the earlier ones — asserted by a whole-tree snapshot.

## 6. Import planning, conflict, and apply

- [ ] 6.1 Classify each record against the project's stored knowledge: new · identical · conflicting. Identical means the same content, not the same knowledge key.
- [ ] 6.2 **Retired on one side and active on the other is a conflict**, never an overwrite.
- [ ] 6.3 Any conflict stops the **whole** import (design D2): nothing is written, including records that would have imported cleanly. The report names each conflicting identifier and describes both sides.
- [ ] 6.4 Import only ADDS. It never removes, retires, or modifies a record the bundle does not carry, and it never rewrites an identical record.
- [ ] 6.5 `--dry-run` runs every check and comparison and reports **every** conflict rather than the first — this is what makes all-or-nothing tolerable and is a spec scenario, not a nicety.
- [ ] 6.6 Apply writes atomically; a second import of the same bundle reports everything already present and writes nothing.
- [ ] 6.7 Tests: new records added; an identical record left byte-identical; one conflict among five prevents all five; unrelated local records untouched; retired-vs-active conflicts; re-run after resolution completes; dry-run leaves a whole-tree snapshot unchanged; dry-run and apply reach identical decisions.

## 7. Ownership boundary — transport grants nothing

- [ ] 7.1 Imported records are stored as the project's own, owned by the project's identity. **Assert what lands on disk, not what the message says.**
- [ ] 7.2 No Store is recorded as a source of an imported record, whatever route the bundle travelled.
- [ ] 7.3 Import writes nothing into any Store catalog and does not make the project a contributor to one.
- [ ] 7.4 An imported record's evidence counts exactly as recorded; the receiving machine is not added as a further independent source, so an import cannot inflate the distinct-project count a wider scope requires.
- [ ] 7.5 Tests: a bundle retrieved from a Store repository imports as project knowledge with the project as owner on disk; no Store appears as a source; the Store's catalog is unchanged; a promotion attempt after import still requires the evidence and approval D1 states.

## 8. Machine-preparation integration

- [ ] 8.1 Read a declared bundle from the project's own configuration and from a Store's record for the project — two sources, tracked separately because they are trusted differently.
- [ ] 8.2 List the import as its **own** action in the preparation report, distinct from obtaining and registering.
- [ ] 8.3 Never import without confirmation.
- [ ] 8.4 **The `--yes` asymmetry (design D7, child E's adjudication):** a blanket confirmation covers a bundle the project's own committed configuration names, and **never** one named only by a Store's record. Do not unify the two behind one predicate.
- [ ] 8.5 A missing or unreadable declared bundle reports degraded with its repair and does not stop preparation.
- [ ] 8.6 An import performed here obeys every rule from groups 5–7, including refusing on conflict.
- [ ] 8.7 The whole step sits behind one seam and is simply not offered when child E has not landed.
- [ ] 8.8 Tests: no declaration means nothing listed and nothing imported; project-declared is listed and requires confirmation; `--yes` imports the project-declared bundle; `--yes` with only a Store-named bundle lists it and imports nothing; a missing bundle degrades; a conflicting bundle imports nothing and the conflict appears in the preparation result.

## 9. Command surface

- [ ] 9.1 `rasen knowledge bundle export --project <projectId|root> --to <path> [--to-store <store>] [--json]` in `src/commands/knowledge.ts`, reusing the existing owner-selector option helper where it fits.
- [ ] 9.2 `rasen knowledge bundle import <bundle> --project <projectId|root> [--dry-run] [--json]`.
- [ ] 9.3 Add both subcommands and every flag to `src/core/completions/command-registry.ts`.
- [ ] 9.4 New messages go through `src/commands/knowledge-messages.ts` — no inline English strings.
- [ ] 9.5 Tests: flag parsing; incompatible combinations rejected before any work; JSON shape stable and matching the human output's facts.

## 10. Acceptance tests (plan §26 Phase F, §28.6, §29 Gate 6)

- [ ] 10.1 Two-machine fixture with separate machine data directories: export on machine A, import on machine B, and the same records resolve there.
- [ ] 10.2 Bundle whitelist proven by assertion over a produced bundle: no machine path, no ownership record, no generated file, no token/session/run state (§28.6, Gate 6 "bundle 白名单", "无 transient state").
- [ ] 10.3 Divergence: a record that differs on the receiving machine blocks the import and overwrites nothing (Gate 6 "divergence", "import 不覆盖冲突数据").
- [ ] 10.4 Store-as-transport end to end: place on machine A, clone the Store on machine B, import from it — and the result is project knowledge with no Store ownership anywhere.
- [ ] 10.5 A bundle produced on one platform imports on the other; expected paths built with `path.join()`.
- [ ] 10.6 Windows: destination composition, the occupied-destination guard under a path differing only by drive-letter case or separator form, the derived in-Store location, and all three absolute-path forms rejected.
- [ ] 10.7 Line-ending divergence between checkouts does not make an identical record read as a conflict.
- [ ] 10.8 Confirm Windows CI covers this change's path-sensitive test files.
- [ ] 10.9 Full suite green: `pnpm lint`, `pnpm build`, `pnpm test`.

## 11. Docs and locales (§32)

- [ ] 11.1 `docs/cli.md`: both subcommands, every flag, what a bundle contains and what it deliberately does not.
- [ ] 11.2 `docs/retention-and-learned-skills.md`: the three-way distinction stated plainly — Store knowledge is shared by cloning the Store, a project's knowledge is machine-local by default, and it crosses machines only through an explicit export and import.
- [ ] 11.3 Migration guide: how to carry a project's knowledge to a new machine, and what to do when the import reports a conflict.
- [ ] 11.4 State that `baseProjectCommit` is provenance and never a gate, and that resuming an in-flight run across machines is not in this release — so nobody reads a bundle as a checkpoint.
- [ ] 11.5 JSON examples for an export, a clean import, a dry-run with conflicts, and a refused import.
- [ ] 11.6 CLI locale bundles `src/locales/{en,zh-cn,ja}.json`: every new message, state name, refusal reason, and repair string; no English fallback for new keys.
- [ ] 11.7 Release-note text for the Gate 6 claim: `0.1.5` includes portable project knowledge via explicit export/import, and does **not** include portable run checkpoints.

## 12. Verification and integration

- [ ] 12.1 Diff scenario SETS, not just requirement titles, for anything that becomes a MODIFIED block during implementation.
- [ ] 12.2 Re-run the portfolio-wide collision sweep over ALL active change directories, reporting both shared capabilities and any requirement with more than one MODIFIED owner. This change carries zero MODIFIED blocks and claims one capability; confirm that still holds.
- [ ] 12.3 `node bin/rasen.js validate portable-project-knowledge --changes --strict --json` clean.
- [ ] 12.4 Rehearse the spec merge (`rasen archive --json --yes`) before ship.
- [ ] 12.5 Confirm the concurrent session's files are untouched and unstaged: `packages/ui/**`, `rasen/config.yaml`, `rasen/changes/simplify-pipeline-handoff-ui/`, `docs/handoff/`, `rasen/explorations/*`, sibling change dirs.
- [ ] 12.6 Confirm no version number in `package.json` was changed by this work.
