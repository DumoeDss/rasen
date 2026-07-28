## Context

This child is primarily documentation and spec corrections, with two small code changes (Minor 2 config reader, Minor 4 portability gate). The evidence artifact (M5) establishes a traceable reconciliation for the round-2 portfolio so the acceptance review's "evidence chain is unverifiable" finding is resolved.

## Goals / Non-Goals

**Goals:**
- M5: independent evidence artifact that the reviewer can verify without trusting self-reported PASS/CLEAN.
- Minor 1-5: each specific issue corrected with a regression test where code changes.
- `git diff --check` clean after this child.

**Non-Goals:**
- Retroactively fixing the old `pr88-rf-*` ledgers (the review forbids "事后伪造历史勾选").
- Reviewing every spec in the portfolio (only the cited issues are fixed).
- Full bootstrap diagnostic overhaul (Minor 2 stays scoped to the config reader).

## Decisions

### D1: M5 — Evidence reconciliation artifact

Create `docs/audits/pr88-round2-evidence-reconciliation.md`. Structure:
- Table of each round-2 child (1-8), its finding IDs, its artifact paths, its review-report path (produced by reviewer stage — referenced, not authored here), and its test verdict (filled when implementation completes).
- Explicit statement that old `pr88-rf-*` ledgers are NOT re-audited.
- Corrected roadmap references (head, toolchain — Minor 3).

### D2: Minor 2 — readProjectConfig distinct diagnostics

Current: `readProjectConfig` catches ALL errors (including YAML parse errors) and returns `null` with only a `warnConfig` side-channel. Callers cannot distinguish "file absent" from "file unreadable."

Fix: Add an overload or a new return shape `ProjectConfigRead` that discriminates:
- `{ status: 'absent' }` — no config file (ENOENT)
- `{ status: 'ok', config }` — parsed successfully
- `{ status: 'unreadable', path, error }` — file exists but cannot be parsed

Keep the existing `readProjectConfig` signature returning `ProjectConfig | null` for backward compatibility, but add a new `readProjectConfigWithDiagnostics` that returns the discriminated shape. Callers that need to distinguish (bootstrap, effective-config) migrate to the new function; others stay unchanged.

### D3: Minor 4 — Portability gate coverage

Current `assertPortableHintValue` (project-config.ts:2041-2049) checks: `path.isAbsolute(value)`, `windowsDrive` (`/^[A-Za-z]:[\\/]/`), `uncPath` (`value.startsWith('\\\\')`), `value.startsWith('/')`.

Missing on POSIX:
- `\Users\foo` — single backslash, root-relative on Windows. Not caught by any current check on POSIX.
- `\??\C:\foo` — NT namespace. Not caught.
- `\\?\C:\foo` — Win32 device namespace. Caught by `uncPath` (starts with `\\`), but worth documenting explicitly.

Fix: Replace the fragmented checks with a unified `value.startsWith('\\')` (covers single-backslash root-relative, UNC `\\server`, and `\\?\` device paths). Add `value.startsWith('/??/')` and the `value.startsWith('\\??\\')` form for NT-namespace paths. Use `path.win32.isAbsolute()` as an additional cross-platform check (it knows Windows absolute forms regardless of the current platform).

### D4: Minor 1 — Scenario title

The scenario at `session-runtime-context/spec.md:219` titled "A project the Store records only by its own declaration is a valid choice" has a body that rejects the declaration. Rename the title to: "A project the Store records only by its own declaration is rejected" to match the body semantics.

## Risks / Trade-offs

- **[New function signature]** → `readProjectConfigWithDiagnostics` is additive; existing callers are unaffected. Migration is opt-in.
- **[Portability gate stricter]** → The added checks reject more path forms. Since the function already refuses ALL machine-specific paths, this is consistent, not a behavior change for legitimate users.
