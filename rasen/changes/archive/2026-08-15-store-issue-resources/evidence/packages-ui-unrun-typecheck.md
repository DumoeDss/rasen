# `packages/ui`'s typecheck script is never invoked by `ci.yml`

> **Corrected in session 3. The original title and headline claim said "never invoked by CI",
> full stop. That is false: `release.yml` runs it. See "Correction" at the end — read it before
> relying on anything below, including the "do not block delivery" conclusion.**

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

## Correction (session 3)

Two claims above are wrong, and the second changes the disposition.

**1. The script IS invoked -- by a different workflow.**
`.github/workflows/release.yml:89-90` runs `pnpm --dir packages/ui typecheck` as a named step, and
`release.yml:93` runs the full `pnpm --dir packages/ui test`. `packages/ui/package.json` also wires
`prepublishOnly` to `pnpm run typecheck && pnpm run test && pnpm run build`.

The verification behind the original claim was scoped to `ci.yml` alone, and the conclusion was
stated about CI as a whole. That is this portfolio's own recurring defect -- a check verified
against one file and concluded about all of them -- committed here in the act of writing up an
instance of it.

**2. The error count is 11, not 8.** Measured this session on a clean tree:
`pnpm -C packages/ui exec tsc --noEmit` exits 2 with 11 errors across 3 files --
`src/canvas/ConsultationBindingEditor.tsx` (8), `src/canvas/IssuesDrawer.tsx` (1),
`test/canvas/v2-node-panel-consultation.test.tsx` (2). The file count matches the original record;
the error count does not, and the discrepancy is recorded unexplained rather than reconciled away.

Still confirmed: **not caused by this portfolio.** `git log --oneline origin/dev/0.2.0..HEAD` over
those three paths returns no commits, so all three are unmodified since the merge base `657c546d`.

**What changes.** "They do not block delivery of this child" holds for the pull request this
portfolio opens -- `ci.yml` genuinely never type-checks `packages/ui`. It does **not** hold for the
release workflow, which will fail on these errors at the next publish of 0.2.0. The standing defect
is therefore not "a check nobody runs" but the narrower and more urgent "a check that runs only at
release, where its failure is most expensive and least expected". Disposition for this child is
unchanged -- still out of scope, still owned by whoever owns the canvas/consultation surface -- but
the risk is dated, not latent.

The general lesson the original write-up reached for is still the right one. It just needs the
scope discipline it was describing: **when concluding that nothing runs a check, enumerate the
workflow directory, not the workflow you happen to be reading.**
