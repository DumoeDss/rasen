# `packages/ui`'s typecheck script is never invoked by CI

## The finding

`packages/ui/package.json` declares three scripts (line 25-28):

```json
"build": "vite build",
"test": "vitest run",
"typecheck": "tsc --noEmit"
```

`.github/workflows/ci.yml`'s `ui_build` job (lines 296-331) runs exactly two
of them: `pnpm build` and `pnpm test`. **`pnpm typecheck` is never invoked by
any CI job.** `vite build` does not type-check (esbuild/Rollup transpile
without full TS diagnostics), and `vitest run` runs tests, not `tsc`.

## Why this matters

This child's own worktree carries 8 pre-existing `tsc --noEmit` errors under
`packages/ui`, predating this branch and unrelated to this child's changes.
They do **not** block delivery of this child — no CI job would ever fail on
them, confirmed directly against both files above.

But the interesting defect is not the 8 errors — it is that **a check exists
in the repo and nothing runs it.** That is the same shape as two other
findings elsewhere in this portfolio: `assertStoreLockOrderAgreesWithWorkspace`
(`locks.ts`, task 7.5) asserts something that is always true by construction
under a partial port, and the pre-strengthening `satisfies`-fixture tripwire
(`evidence/wire-type-mirror-absence-mutation-proof.md`) was silent on the
exact failure mode it existed to catch. A check that exists but is never
exercised — whether never invoked, structurally unable to fail, or blind to
the case that matters — is not a check; it is documentation that looks like
one.

## Disposition

Out of scope for this child to fix (wiring `pnpm typecheck` into CI, or
fixing the 8 pre-existing errors, touches `packages/ui`'s CI job and
existing type errors unrelated to Store Issues). Recorded here as a standing
defect for whoever next touches `packages/ui`'s CI configuration — it is one
line to add (`pnpm typecheck` as a CI step) once someone decides to also
clear the 8 pre-existing errors it would then start catching.
