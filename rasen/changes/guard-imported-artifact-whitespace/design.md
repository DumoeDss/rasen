# Design: guard-imported-artifact-whitespace

## D1. Why not normalize during absorption

The obvious fix — have the archiver strip trailing whitespace as it absorbs evidence — was rejected after reading the engine. `archive-engine.ts` copies each reserved entry with `copyFile(..., COPYFILE_EXCL)` and immediately calls `verifyReservedArchiveEntry` against the identity captured in the plan; `archive-accounting.ts` then records a sha256 per evidence file. Those two mechanisms exist so that archived evidence can be proven unaltered after the fact. A normalizer inside that path would be a silent byte rewrite in the one place the system promises not to rewrite bytes.

The single documented exception is `finalizeStagedShipLog`, which appends an `## Archive` provenance footer — and even that is transactional and idempotent per `transactionId`.

So the guard reports; it never edits. Fixing the file is the author's action, taken **before** the bytes are staged and hashed.

## D2. The hook delegates to git, not to our own scanner

The pre-commit hook runs `git diff --cached --check`, which is the same command the CI lint job runs (`git diff --check "${BASE_SHA}...HEAD"`). Reimplementing the rules (`blank-at-eol`, `space-before-tab`, `blank-at-eof`, and whatever `core.whitespace` is configured to) would create a second definition that drifts from the one that actually gates the branch, and would silently ignore per-path `.gitattributes` whitespace settings.

Consequence worth stating: the hook inherits the repository's `core.whitespace` configuration exactly. If that configuration changes, both checks move together.

## D3. Hook installation is opt-in-by-install, not committed config

Git does not run hooks from a cloned `.git/hooks` unless they are placed there, and `core.hooksPath` is local configuration that cannot be committed. The installer sets `core.hooksPath` to the tracked `.githooks/` directory, and is invoked from `prepare` so a normal `pnpm install` arms it.

The installer is a no-op — never a failure — when:
- the working directory is not a git work tree (installed as a dependency, tarball checkout),
- `CI` is set (CI checks the same rules in its own job; mutating runner git config buys nothing),
- `RASEN_SKIP_GIT_HOOKS` is set (explicit local opt-out),
- `core.hooksPath` is already set to something else (never clobber a developer's own hook setup).

## D4. What the hook runs, and what it deliberately does not

Runs: `git diff --cached --check`, then ESLint over the staged JavaScript/TypeScript files that fall inside the lint scope. Both are fast and both mirror CI.

Does not run: `tsc --noEmit` or the test suite. A type check on this repository is tens of seconds; paying that on every commit would push developers toward `--no-verify`, which costs more than it saves. Type errors remain a CI-job concern.

## D5. Preflight scope and the escape hatch

The preflight inspects the change directory's text files at plan time — the same set the archive is about to reserve — and skips anything that looks binary (a NUL byte in the leading bytes). It reports every offending `file:line` rather than the first, because fixing them one CI cycle at a time is the exact failure mode being removed.

`--no-whitespace-check` exists because trailing whitespace is occasionally the content: a report quoting terminal output, or a fixture that documents whitespace-significant behavior. The flag is explicit and appears in the archive's recorded output, so an archive produced with the guard disabled says so.

## D6. Markdown hard breaks are the author's call, not the tool's

Trailing double-space is a real Markdown hard break. The guard names the lines; it does not choose a replacement, because the two reasonable fixes (delete the spaces, or convert to a backslash hard break) render differently and only the author knows which was meant. The failure message names both options.
