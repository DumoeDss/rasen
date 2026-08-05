# Implementation report

## Outcome

The config command now rejects a nearest planning-root candidate unless the existing project config-path resolver identifies a path that exists as a file. An ambient ancestor containing only an unrelated `rasen/` directory therefore remains outside-project.

The implementation is config-specific. General planning-home discovery is unchanged.

## Product delta

- Added `findInitializedConfigProjectRoot()` in `src/commands/config.ts`.
- The helper first calls the existing nearest planning-root finder.
- It then calls `resolveConfigFilePath(candidate)` and accepts the candidate only when the resolved path is a file.
- Using `resolveConfigFilePath` preserves existing `config.yaml` and `config.yml` compatibility; no filename is hard-coded in the new predicate.
- Explicit project-scope operations, the non-TTY effective view, and the interactive editor all use the same helper.

## Regression delta

`test/commands/config-editor.test.ts` now creates a self-owned fixture with this shape:

```text
ambient-root/
  rasen/                 # unrelated directory; no config.yaml/config.yml
  nested/workspace/      # command cwd
```

Through the public interactive editor seam, the test proves:

- outside-project guidance is shown;
- `archive.timing` is disabled with project-required guidance;
- a both-scope key falls back to global without an additional project-scope prompt.

The separate RED receipt is recorded in `evidence/red-regression.md`.

## RED to GREEN

### RED

```text
pnpm exec vitest run test/commands/config-editor.test.ts -t 'treats an unrelated ancestor rasen directory without project config as outside-project' --maxWorkers=1 --minWorkers=1 --reporter=verbose
```

- Exit code `1`
- `1 failed | 19 skipped`
- `archive.timing.disabled` was `undefined`

### GREEN

The same command passed after the config-specific resolver was added:

- Exit code `0`
- `1 passed | 19 skipped`
- Duration `10.71s`

The first post-implementation rerun exposed only an inaccurate wording guess in the new test (`outside` versus the existing public wording `not inside`). The assertion was aligned to the existing localized English message; no additional product behavior was added.

## Verification

### Valid project and ambient behavior

Focused three-test command covering the ambient fixture, an enabled project-only row in a valid project, and the both-scope project prompt:

- Exit code `0`
- `3 passed | 17 skipped`
- Duration `12.27s`

### Original four-symptom Windows loop

The original environment remained unchanged:

```text
TEMP=C:\Users\Sayo\AppData\Local\Temp
TMP=C:\Users\Sayo\AppData\Local\Temp
```

The four-test filter for Japanese and Simplified Chinese outside-project guidance, project-only disabling, and no outside-project scope prompt passed:

- Exit code `0`
- `4 passed | 16 skipped`
- Duration `12.46s`

### Complete config regression

```text
pnpm exec vitest run test/commands/config-editor.test.ts test/commands/config.test.ts --maxWorkers=1 --minWorkers=1 --reporter=verbose
```

- Exit code `0`
- `2 passed` test files
- `88 passed` tests
- Duration `52.60s`

### Build and static gates

- `pnpm run build`: PASS
- `pnpm run lint`: PASS
- `pnpm exec tsc --noEmit`: PASS
- `git diff --check -- src/commands/config.ts test/commands/config-editor.test.ts rasen/changes/config-project-root-ambient-collision`: PASS
- `pnpm exec rasen validate config-project-root-ambient-collision --strict`: PASS

### Agent ownership isolation

```text
pnpm exec vitest run test/cli-e2e/agent-dispatch.test.ts -t 'enforces exact-session ownership across concurrent CLI processes' --maxWorkers=1 --minWorkers=1 --reporter=verbose
```

- Exit code `0`
- `1 passed | 15 skipped`
- Exact test duration `6.982s`
- No source or test file in the config fix crosses the agent-dispatch seam.

## Scope audit

Product/test edits are limited to:

- `src/commands/config.ts`
- `test/commands/config-editor.test.ts`

Additional writes are confined to this Change's tasks, evidence, and handoff. No foundation artifact, run-state, portfolio, general planning-home, native/macOS/MMAC area, stash, or temporary-output directory was changed.
