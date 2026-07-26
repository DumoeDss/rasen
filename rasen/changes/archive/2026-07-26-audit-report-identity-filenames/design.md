## Context

`src/core/token-audit/audit.ts` currently computes the default report path before writing with `session-audit-${sid.slice(0, 8)}.json`. Claude session ids have historically made that prefix convenient, but Codex uses UUIDv7 thread ids whose leading bits encode time. Different Codex sessions created within the same short interval can therefore share the first eight hexadecimal characters and write to the same path.

All audit variants already build an `AuditResult` containing the canonical `session.runtime` and `session.id`. The analytics management service discovers direct JSON files by content rather than depending on the legacy eight-character basename. The implementation must run on Windows, macOS, and Linux and must keep an individual filename component within practical filesystem limits.

## Goals / Non-Goals

**Goals:**

- Give every canonical `(runtime, session id)` pair a deterministic default report filename.
- Preserve the complete human-readable id for the normal lowercase ASCII identifiers emitted by Claude, Codex, and Zed.
- Safely handle unexpected characters, case-sensitive identifiers, empty identifiers, and identifiers too long for a portable filename component.
- Keep repeat audits of one session intentionally idempotent at the path level.
- Preserve explicit `--out` behavior and existing report discovery.

**Non-Goals:**

- Migrating, renaming, deleting, or deduplicating reports already in `analytics`.
- Recovering reports that were overwritten before this change.
- Changing the audit JSON schema, session discovery, runtime detection, or analytics inventory API.
- Preventing a caller from deliberately overwriting a file selected with `--out`.

## Decisions

### 1. Derive the default path from the completed report

Change the report writer to compute the default filename from `result.session.runtime` and `result.session.id`, rather than accepting a separately supplied `sid`. This makes the serialized report's canonical identity the single source of truth and removes three runtime-specific call-site arguments that could drift from report contents.

Alternative considered: keep passing `sid` and add a runtime argument at every call site. This duplicates identity already present in `AuditResult` and permits a filename/report mismatch.

### 2. Use a readable direct form for normal canonical ids and a digest fallback otherwise

Introduce a pure filename helper with two forms:

- For a non-empty id made only of lowercase ASCII letters, digits, dots, underscores, and hyphens, use `session-audit-<runtime>-<complete-id>.json` when the complete basename stays within a conservative UTF-8 byte budget.
- For any unusual or overlong id, use `session-audit-<runtime>-sha256-<digest>.json`, where the digest is the full lowercase SHA-256 of a length-delimited canonical identity containing both runtime and the original id.

The direct form covers the shipped runtimes' UUID, numeric, and slug-like identifiers, retains the complete id, and fixes prefix collisions without making ordinary filenames opaque. The fallback avoids Windows-invalid characters, path separators, case-folding collisions, Unicode normalization ambiguity, and filename-component length failures. Including the runtime both visibly and in the digest preserves cross-runtime separation. A full SHA-256 digest provides stable, practically collision-resistant identity without sequence-number or directory-state dependence.

Define the basename byte budget as a named constant and calculate it with `Buffer.byteLength`; do not truncate an id into an ambiguous prefix. The helper should be exported from the internal token-audit module for focused pure-function regression tests, without adding it to the package's public root exports.

Alternatives considered:

- Taking a different fixed substring (such as the last eight UUID characters) remains probabilistic and loses the canonical identity.
- Appending `-1`, `-2`, and so on depends on filesystem state and makes rerun paths unstable.
- Replacing forbidden characters with `_` creates deterministic collisions between different source ids.
- Percent-encoding every unusual id is reversible but can expand long Unicode identifiers beyond component limits and requires more complex byte-safe truncation.
- Hashing every id is safe but unnecessarily removes useful session identity from ordinary filenames.

### 3. Preserve overwrite semantics only for identical canonical identity or explicit output

The writer continues to use the existing write operation. Because the default path is deterministic, rerunning the same canonical session refreshes its own report. Different canonical identities receive different direct paths or full-digest fallback paths. An explicit `options.outPath` continues to bypass the default helper exactly as today.

### 4. Verify with focused token-audit tests

Extend the focused `test/core/token-audit/audit.test.ts` coverage (or a narrowly scoped sibling test) to prove:

- two Codex UUIDv7 ids with the same first eight characters produce different names;
- the same runtime and session id produce the same name on repeat;
- the same id under different runtimes produces different names;
- unsafe and overlong ids select stable, portable digest names;
- an explicit `--out` path remains unchanged;
- the existing default-path integration assertion expects the new readable full-identity form.

Run only the focused token-audit test file(s), not the repository-wide suite.

## Risks / Trade-offs

- [Risk] Existing automation may have assumed `session-audit-<sid8>.json` even though the management service does not. → Document the user-visible rename in the delta spec and keep old JSON files discoverable without migration.
- [Risk] Directly readable filenames are limited to the canonical lowercase ASCII shape. → Use a deterministic full-digest fallback for every other shape rather than attempting lossy sanitization.
- [Risk] SHA-256 introduces a crypto import and opaque names for unusual ids. → Use Node's built-in `node:crypto`; ordinary shipped runtime ids remain readable and no dependency is added.
- [Risk] A conservative component-byte budget does not solve an already overlong parent directory. → Bound the generated basename; parent-directory path length remains the existing machine-data configuration constraint.

## Migration Plan

Ship the new naming logic without scanning the analytics directory. New audits use the new deterministic name; old reports stay where they are and remain discoverable by JSON content. Rollback restores the old default naming for future writes but does not require data rollback.

## Open Questions

None. The exact conservative basename byte budget may be selected during implementation as a named constant below common 255-byte component limits, while the observable contract remains “bounded and cross-platform safe.”
