# Verification and the open macOS gate (Section 8)

## This change is NON-TERMINAL

Section 7 (7.1-7.6) requires a real macOS host. **No macOS host exists in this
environment**, so all six tasks are untouched and unticked. Nothing in Sections
1-6 or 8 substitutes for them, and the Linux/WSL receipts are labelled
non-acceptance inside their own evidence file. The change cannot be accepted
until a macOS host runs Section 7.

## 8.1 - validate and the whitespace gate

`rasen validate ecp-macos-process-authority-provider --strict`:

```
Change 'ecp-macos-process-authority-provider' is valid
```

Whitespace gate checked **on bytes**, not via `git diff --check`: every file
this change adds or edits was read as a Buffer and asserted to contain no `0x0D`
byte, no `[ \t]+` before a newline, a final newline, and no trailing blank line
at EOF.

One pre-existing exception, **not introduced by this change** and reported to
the LEAD rather than fixed:

- `src/core/management-api/router.ts` is **CRLF in the working tree** while the
  same file at HEAD is LF. All 1576 lines carry `\r`; the two lines this change
  touches (43 and 639) simply inherited the file's existing line ending. If this
  file is committed as-is it produces a whole-file churn diff and trips the CI
  whitespace gate. Normalising it would be a 1576-line edit to a file other
  concurrent work is touching, so it is left alone.

## 8.2 - DAG: no edge from this change into closure

Verified read-only (no `.rasen/**` write). From the portfolio run-state
`.rasen/changes/ecp-session-execution-and-self-hosting/ephemera/portfolio-run.json`:

```json
{"id":"ecp-macos-process-authority-provider","dependsOn":["ecp-platform-process-authority-foundation"]}
{"id":"ecp-native-process-capsule-closure","dependsOn":["ecp-linux-process-authority-provider","ecp-windows-process-authority-provider"]}
```

Closure's `dependsOn` is exactly `[linux, windows]`. This change declares no
outgoing edge anywhere, and none of its files or artifacts references closure as
a dependency. The single edge Replan 4 cut stays cut.

## 8.3 - design D2 re-read against the current constant

`RECURSIVE_PROCESS_SCOPE_SEMANTICS` is byte-identical to the value recorded in
`implementation-baseline.md`; `replacement-recovery` is still present, so
**neither pending contract edit has landed yet**. D2 therefore has not been
tested against a landed edit - it has only been re-confirmed true under the
current wording.

The claim D2 makes is that the declaration survives either outcome, and the
mechanical reason it survives is stronger than a wording argument: this change
declares no entry of that array at all, and no file in this change reads,
imports, or references the constant. Verified by search. The three files the
concurrent `process-authority-scope-semantics-wording` change targets -
`process-authority/types.ts`, `process-authority/registry.ts`,
`process-authority/manifest.ts` - are untouched by this change (`git status`
reports them unmodified).

A reviewer should still re-run this check after the wording change lands, as
design.md's Open Questions asks.

## 8.4 - NOT CLOSED: cross-platform CI was not run

Deliberately left unticked. What was actually run:

- **Windows (this host)**: `test/core/session-host/`,
  `test/core/management-api/`, `test/cli-e2e/session-host.test.ts` ->
  **88 files, 1115 passed, 8 skipped, 0 failed** (148.6s). This is the change's
  full blast radius plus the hosted-session end-to-end path.
- **Linux (WSL2)**: the compiled production module was exercised against a real
  kernel by the Section 6 oracles - see `posix-preflight-oracles.md`. That is
  real POSIX behaviour but it is **not** a CI run.
- **Not run**: the full repository suite, on either OS. This worktree is shared
  with several concurrent changes and currently carries ~130 modified and ~40
  new files from other work; a full-suite failure could not be honestly
  attributed to this change.
- `node:path` discipline: the only path operation this change adds is
  `path.isAbsolute` in the darwin scope, imported from `node:path`. No string
  path concatenation is introduced anywhere.

Closing 8.4 needs a real CI run on both OSes.

## 8.5 - evidence completeness

| Green claim | Its demonstrated failing counterpart |
| --- | --- |
| escalation keyed off whole-group emptiness (5.1) | mutation (a) deterministic + `6.1-mutant` on a real Linux kernel |
| signals address the group, not the leader (3.3) | mutation (b) deterministic + `6.2-mutant` on a real Linux kernel |
| never cleanly cancelled / never proven-empty (5.2) | mutation (c) |
| declaration-gated release, terminate path (5.3) | mutation (d) |
| declaration-gated release, observation path (4.2) | mutation (e) |
| declaration recorded before activation (2.3) | mutation (f) |
| darwin selects the best-effort tier (4.1) | mutation (g) |
| all three construction sites route through the selector (4.1) | mutation (h) |
| non-absolute command refused before any process (3.1) | mutation (i) |
| the setsid escape keeps the record honest (6.3) | the escapee is observed alive on a real kernel while the group reads empty; the receipt is quoted verbatim |

Every mutation went RED and named the guard that caught it; full output in
`mutation-receipts.md`.

**Missing from this table, and it is the important row:** no line of it is
macOS. Tasks 7.1-7.6 have no receipts at all.
