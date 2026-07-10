## Why

The `rasen change ...` and `rasen spec ...` noun command groups have been deprecated for several releases — they already print runtime warnings steering users to the verb-first commands (`rasen list`, `rasen show`, `rasen validate`). Keeping deprecated wrappers around adds surface area, test burden, and doc drift with no user benefit; the user has decided to remove them outright rather than leave them marked deprecated.

Separately, CI has been red on `main` (run 29086744907, commit 486daf0) across every OS leg with three distinct, pre-existing test defects that block the release gate. These are test-environment bugs and one genuine product bug (a first-run notice written to stdout), not regressions from this change — but they must be green before any PR can merge, so they are fixed here in the same unit of work.

## What Changes

- **BREAKING:** Remove the `rasen change` command group (`change show`, `change list`, `change validate`) and the `rasen spec` command group (`spec show`, `spec list`, `spec validate`). Verb-first `rasen show`, `rasen validate`, and `rasen list` fully cover these, including interactive selection (a superset — verb-first prompts for type then item). The underlying `ChangeCommand`/`SpecCommand` classes stay; only the noun-command wrappers are removed.
- Port the one capability that lived only on the noun path — the `--long` flag on `change list`/`spec list` (human-readable title + counts) — onto `rasen list` so no capability is lost.
- Remove the noun-command shell-completion entries (`command-registry.ts`, zsh templates) and sweep doc references (`docs/`, `docs/zh/`) to verb-first.
- Migrate or delete the noun-command tests (4 interactive tests, `spec.test.ts`, `change-initiative-link.test.ts`); verb-first interactive coverage already exists in `show`/`validate` specs and tests.
- **CI fix — POSIX legs:** `doctor.test.ts` D4 relocation tests hardcode win32 old-scheme paths (`AppData/Local/rasen`), so on POSIX (`.local/share/rasen`) the fixture is never found and the notes never render. Make the fixtures platform-aware. Production code is already correct on both platforms.
- **CI fix — Windows leg:** `artifact-workflow.test.ts` archive.timing tests compare `archiveDir` against a raw `tempDir`, but the CLI canonicalizes `root.path` (expanding Windows 8.3 short names like `RUNNER~1`). Canonicalize the expected path in the assertions, matching the sibling workDir tests. Production output is already correct.
- **CI/local fix — telemetry notice (genuine product bug):** the first-run telemetry notice is written to stdout via `console.log`, polluting text-format command output (surfaces in `spec.test.ts` locally). Move it to stderr so machine-readable and text stdout are never contaminated regardless of telemetry state.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `cli-change`: retire the `rasen change` command surface — all noun-command requirements removed.
- `cli-spec`: retire the `rasen spec` command surface — noun-command requirements removed (the capability-independent Zod schema modeling stays in main specs, untouched).
- `cli-list`: add a `--long` flag that prints per-item title and counts for changes and specs, porting the noun-command capability.
- `telemetry`: the first-run usage notice SHALL be written to stderr, never stdout, so it cannot corrupt command output.

## Impact

- Code: `src/cli/index.ts` (remove `change` group + `registerSpecCommand`), `src/commands/spec.ts` (remove `registerSpecCommand`; keep `SpecCommand`), top-level `list` command + `src/core/list.ts` (`--long`), `src/telemetry/index.ts` (notice → stderr), `src/core/completions/command-registry.ts` and zsh templates.
- Tests: remove `change.interactive-show`, `change.interactive-validate`, `spec.interactive-show`, `spec.interactive-validate`, `spec.test.ts`, `change-initiative-link.test.ts` (or migrate surviving coverage to verb-first); fix `doctor.test.ts` D4 and `artifact-workflow.test.ts` archive.timing assertions.
- Docs: `docs/agent-contract.md`, `docs/opsx-workflow-guide.md`, `docs/stores-beta/user-guide.md` and their `docs/zh/` mirrors.
- Specs: delta specs for `cli-change`, `cli-spec`, `cli-list`, `telemetry`; dangling `rasen change show`/`rasen spec show` cross-references in `cli-show`/`cli-validate` swept to verb-first.
- No version bump (stays 0.1.1). Divergence from upstream (which keeps the noun groups) is accepted, precedent: browse→chrome-use.
