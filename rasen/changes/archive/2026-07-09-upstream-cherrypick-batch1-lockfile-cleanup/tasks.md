## 1. Remove the stale npm lockfile

- [x] 1.1 `git rm package-lock.json` (stale ~179 KB npm lockfile; pnpm-only project). *(Deleted from working tree unstaged to keep the shared index clean for sibling implementer-a; ship commits it via pathspec.)*
- [x] 1.2 Add `/package-lock.json` to `.gitignore` under the `# Pnpm` block (between `.pnpm-store/` and `result`).

## 2. Single-source the pnpm version

- [x] 2.1 Add `"packageManager": "pnpm@9.15.9"` to `package.json` after the `"type": "module"` line. Do not touch the `author` field. *(Placed between `"type": "module"` and `"publishConfig"` per design anchor; `author` line above untouched.)*
- [x] 2.2 In `.github/workflows/ci.yml`, remove the `with:` + `version: 9` two-line block from all 3 `pnpm/action-setup@v4` steps (jobs `test_pr`, `test_matrix`, `lint`). **Do not** modify the Nix job or any other step.
- [x] 2.3 In `.github/workflows/deploy-docs.yml`, remove the `with:` + `version: 9` block from its single `pnpm/action-setup@v4` step.
- [x] 2.4 **DROP** the upstream `release-prepare.yml` hunk (file deleted in fork) and the upstream 4th `ci.yml` changesets-gated hunk (job absent in fork).

## 3. Verify (simple)

- [x] 3.1 `CI=true pnpm install --ignore-workspace` — succeeds and `pnpm-lock.yaml` still satisfies `--frozen-lockfile` after the `package.json` edit (repo is nested in an outer pnpm workspace; `--ignore-workspace` is mandatory). *("Lockfile is up to date, resolution step is skipped" / "Already up to date", exit 0, via pnpm v9.15.9 governed by the new `packageManager` field.)*
- [x] 3.2 `pnpm build` — succeeds. *(`pnpm --ignore-workspace build` and `node build.js` both exit 0, `dist/cli/index.js` emitted. Note: the `--ignore-workspace` flag must precede the subcommand; with it after, pnpm re-discovers the outer workspace and errors "packages field missing or empty" — pre-existing environmental quirk, not from this change.)*
- [x] 3.3 `node bin/rasen.js validate upstream-cherrypick-batch1-lockfile-cleanup` — change delta valid. *("Change ... is valid", exit 0.)*
- [x] 3.4 Confirm `package-lock.json` is gone, `.gitignore`/`package.json`/`ci.yml`/`deploy-docs.yml` are the only edited tracked files, and the Nix job in `ci.yml` is byte-unchanged. *(Working-tree status: `D package-lock.json`, `M` on the four; index clean — sibling implementer-a's archive.ts/specs-apply.ts/archive.test.ts are their unstaged work, untouched. ci.yml diff = 3 hunks/6 deletions, zero lines in the Nix region.)*
