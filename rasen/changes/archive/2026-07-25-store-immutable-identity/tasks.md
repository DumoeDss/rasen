## 1. Identity vocabulary and readers (no behavior change yet)

- [x] 1.1 Add `src/core/store/identity-types.ts` (or a typed section of the new identity module) exporting `StoreIdentityRef`, `ProjectIdentityRef`, `GlobalIdentityRef`, `DurableOwnerRef`, `ResolvedStoreRef`, `ResolvedProjectCheckoutRef` per design D3; durable refs carry no root.
- [x] 1.2 Add UID helpers: mint with `crypto.randomUUID()`, validate any RFC 4122 textual form, and normalize (trim + lowercase) for comparison (design D8). Reject a malformed `uid` as `invalid_store_metadata`.
- [x] 1.3 Extend `src/core/store/foundation.ts` metadata parsing to a version-discriminated union: v1 `{version:1,id,remote?}` unchanged, v2 `{version:2,uid,id,remote?}`. Add `StoreMetadataStateV2` and keep `parseStoreMetadataState` returning a discriminated result.
- [x] 1.4 Extend registry parsing in `foundation.ts` to a version-discriminated union: v1 keys are aliases (and `project:<id>`), v2 store keys MUST parse as a UUID with `id` inside the entry (design D2/D7). Key grammar is chosen by the file's `version`, never inferred from the key text.
- [x] 1.5 Make `parseRegistryKey`/`registryKeyFor` version-aware instead of adding a second inference rule; keep `project:` prefix behavior identical in both versions.
- [x] 1.6 Extend `readStorePointer()` in `src/core/project-config.ts` to parse the object form `{ uid, id?, remote? }` alongside the string form, preserving today's contract that a malformed pointer is REPORTED (never dropped). Add `StorePointerV2` and a discriminated `StorePointerRead`.
- [x] 1.7 Add the credential-bearing-remote check by `new URL()` parsing (design D9): reject userinfo carrying a password/token, allow the scp-style `git@host:path` form, pass an unparseable string through unchanged. Add a shared redaction renderer used by every human and JSON surface.
- [x] 1.8 Unit tests for 1.1–1.7: v1/v2 metadata round-trip, v1/v2 registry round-trip, string/object pointer parse, UUID accept/reject and case-insensitive compare, credential reject/allow/redact. No writer exists yet — assert reads leave files byte-identical.

## 2. The single Store identity resolver

- [x] 2.1 Create `src/core/store/identity.ts` exporting `resolveStoreBinding()` returning the tri-state `StoreBindingResolution` (`absent` | `resolved` | `unavailable`) with `reason`, `diagnostics`, and an ordered `repair` command list (design D1/D3). Never return a bare nullable.
- [x] 2.2 Implement UID-first resolution (design D5 path 1): registry lookup by UID, metadata UID verification, `uid-mismatch` / `not-registered` / `metadata-missing` / `root-unhealthy` reasons; alias drift as warning, remote divergence as info — neither blocks.
- [x] 2.3 Implement legacy alias resolution with explicit arity (design D5 path 2): 0 → `not-registered`, 1 → `resolved` + `store_pointer_legacy` info, N → `alias-ambiguous` listing every candidate UID, alias, and root.
- [x] 2.4 Implement `pointer-malformed` for an unreadable or unusable declaration, and `absent` for no declaration at all.
- [x] 2.5 Reuse the existing `inspectRegisteredStore()` health stage rather than forking a second health path; extend it to report the metadata UID.
- [x] 2.6 Preserve no-transitivity: a root that is itself a registered Store resolves `absent` for its own declaration (UID-compared after this change, replacing the alias/path compare in `isRegisteredStoreRoot`).
- [x] 2.7 Define the Phase A diagnostic codes from design D13 in one place with stable code, message, and repair, and export them for reuse by sibling changes.
- [x] 2.8 Unit tests: every tri-state branch, every `unavailable` reason, exhaustiveness guard, alias arity 0/1/N, legacy-metadata Store resolves with `store_metadata_legacy`, resolver performs zero writes on every path.

## 3. Consumer migration (Phase A file set only)

- [x] 3.1 `src/core/root-selection.ts`: consume `resolveStoreBinding()` and map each `unavailable` reason onto its `RootSelectionError`; delete the local `listStoreRegistryEntries().find(...)` path. Notices state whether a UID or an alias resolved.
- [x] 3.2 `src/core/effective-config.ts`: change `resolveConfigStoreLayer()` from `Promise<StoreConfigLayer | null>` to the tri-state and surface `unavailable` from `resolveEffectiveConfig()` — the `if (!store) return null` fall-through is removed, not guarded.
- [x] 3.3 `src/core/config-api/project-addressing.ts`: resolve store spaces through the resolver, keeping the existing `space_not_found` / `space_unavailable` HTTP result vocabulary mapped from the tri-state reasons.
- [x] 3.4 `src/core/relationship-health.ts`: extend `RelationshipHealth.store` with the resolved identity, the pointer shape, and the identity diagnostics; keep it pure composition with no I/O.
- [x] 3.5 `src/commands/doctor.ts`: report the new identity findings, stay read-only, and keep running (exit non-zero) when the binding is `unavailable` — design D4's carve-out. Assert human/JSON parity.
- [x] 3.6 `src/commands/store.ts`: `store doctor` and `store list` keep working on an unavailable binding; `store doctor` reports identity, alias arity, and remote divergence.
- [x] 3.7 Add a guard test asserting no file in the Phase A set imports `listRegisteredStores` (design D12), and doc-comment each compat export with the sibling change that retires it.
- [x] 3.8 Verify the four deferred consumers (`learned-skills/context.ts`, `management-api/spaces.ts`, `management-api/session-launch-context.ts`, `config-api/config-context.ts`) still compile and pass unchanged against the compat reader.

## 4. Writers, explicitly gated

- [x] 4.1 `store setup`: mint a UID for a NEW Store and write v2 metadata. Existing Stores are untouched.
- [x] 4.2 `store register`: read and verify identity; never take a UID from a flag; never overwrite an existing identity with `--id`. Keep today's `store_metadata_id_mismatch` for alias mismatch.
- [x] 4.3 Move identity verification ahead of every write in `commitStoreRegistration()` so a UID mismatch throws having written nothing (design D6).
- [x] 4.4 Add `rasen store upgrade-identity <store> [--dry-run] [--apply] [--json]`: plan/apply, atomic temp-write-then-rename, Store metadata first then registry then (when addressable) the project pointer; on partial failure the Store metadata stands and the output names the remaining write.
- [x] 4.5 Registry v2 writer: emit v2 only after an explicit mutation; refuse the rewrite (naming the entries) when any store entry lacks a resolvable UID, keeping the file as v1 rather than inventing identities.
- [x] 4.6 Alias rename path: re-registering a Store whose metadata `id` was edited updates that entry's `id` in place, found by the unchanged UID (no command rewrites the metadata alias in Phase A — design D11); assert canonical identity and every UID-bearing pointer still resolve.
- [x] 4.7 All-digit alias warning on newly assigned aliases only (design D10); existing numeric aliases stay quiet.
- [x] 4.8 Never auto-commit or auto-push any Store or project Git file; print the files the user needs to commit.

## 5. Tests

- [x] 5.1 Registry-write proof for the UID-mismatch path: snapshot registry file bytes and Store metadata around the failing call and assert both unchanged (spec "A mismatch writes nothing").
- [x] 5.2 Read-only proof: run `doctor`, `store doctor`, `store list`, `list`, `show`, `status` against a v1 Store and assert metadata + registry are byte-identical afterwards.
- [x] 5.3 Effective-config regression: a project whose declared Store is unregistered reports unavailable with reason and repair — and does NOT report global/default values (the bug this change exists to fix).
- [x] 5.4 Alias arity 0/1/N, including two registered Stores sharing an alias.
- [x] 5.5 Alias rename safety and legacy-Store compatibility (v1 metadata, v1 registry, string pointer) end to end.
- [x] 5.6 Credential remote reject/redact, including JSON output, and the scp-style allow case.
- [x] 5.7 Human/JSON diagnostic parity for every Phase A code.
- [x] 5.8 "No machine-absolute path enters Git": assert the written Store metadata and the written project pointer contain no absolute path, asserted with `path.isAbsolute()` over the parsed values rather than a string scan.
- [x] 5.9 Windows path scenarios: registry `local_path` differing from the resolved pointer only by drive-letter case or separator form still matches; a UID mismatch is not produced by path-form difference alone. Build every expected path with `path.join()`.
- [x] 5.10 `upgrade-identity --dry-run` writes nothing and its plan matches what `--apply` then writes; the upgrade is idempotent on a second run.
- [x] 5.11 Full suite green: `pnpm lint`, `pnpm build`, `pnpm test`.

## 6. Docs and locales

- [x] 6.1 `docs/cli.md`: `store setup` / `register` / `doctor` / new `upgrade-identity`, the structured Store declaration, and the arity rules.
- [x] 6.2 Store troubleshooting: one entry per `unavailable` reason with its repair command.
- [x] 6.3 Migration guide: the fail-closed behavior break, what changes on disk, and how to upgrade metadata, registry, and pointer.
- [x] 6.4 JSON examples for the new diagnostics and the tri-state as rendered by `doctor --json`.
- [x] 6.5 CLI completion registry entry for `store upgrade-identity` and its flags.
- [x] 6.6 Locale bundles `en`, `zh-cn`, `ja`: every new message, warning, diagnostic, and repair string — no English fallback for the new keys.
- [x] 6.7 Localization test asserting the new keys exist in all three catalogs and that identifiers (UIDs, aliases, paths, remotes) are data and stay untranslated.

## 7. Verification and integration

- [x] 7.1 Confirm Windows CI covers this change's path-sensitive tests; add the job matrix entry if the affected test files are not already included.
- [x] 7.2 Re-read the delta specs against the main specs: MODIFIED requirement and scenario titles match exactly, and the REMOVED requirement's replacement is named in its Migration note.
- [x] 7.3 `node bin/rasen.js validate store-immutable-identity --changes --strict --json` clean.
- [x] 7.4 **Restated** by `stabilize-store-context-foundation` (design D6, review round 1). Original wording, kept visible: "Rehearse the spec merge (`rasen archive --json --yes` dry-run path) before ship, since `validate --changes` does not apply deltas to the main specs." **The rehearsal this gate names was never performed**, so it cannot be ticked as written. The gate this child was actually responsible for: **the spec merge for this change is proven to succeed.** Settled by the archive that actually ran — `5d4ccb8d` ("archive store-immutable-identity and sync Store identity into main specs") — which performed the very merge the rehearsal was a proxy for, and succeeded. A completed merge is strictly stronger evidence than a rehearsal of it; recording the substitution here rather than ticking silently is the point. Follow-up `c910cc76` restored the NEW capability Purpose that archiving discards; both are ancestors of `HEAD`.
- [x] 7.5 Confirm the untracked working-tree files (`docs/handoff/`, both `rasen/explorations/*.md`) are untouched and not staged.
- [x] 7.6 Confirm no version number in `package.json` was changed by this work.
