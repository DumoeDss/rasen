## Why

CI's lint job runs `git diff --check "${BASE_SHA}...HEAD"` over the whole pull-request diff. Nothing catches those errors earlier, so they are always discovered after a push, one CI cycle at a time.

The recurring source is not hand-written repository code — it is **files authored outside the repository and later imported into it**: evidence reports and handoff documents that agents write into the artifact store (`~/.rasen/projects/<project>/changes/<change>/`), then carried into `rasen/changes/**` by archiving or by hand. Those files have never been subject to the repository's whitespace gate, so Markdown hard breaks (trailing double-space), CRLF, and blank lines at EOF ride in unnoticed.

This has already cost real cycles twice: the 0.1.5 release turned `main` red on `init.test.ts` CRLF plus EOF blank lines, and archiving `session-cache-optimization` (PR #139) failed on twelve trailing-whitespace lines inside an imported `verification-report.md`. The second case was expensive beyond the CI cycle: `archive.json` records a sha256 per evidence file, so the fix could not be made in place — the whole archive had to be re-run to keep the accounting self-consistent.

Archiving cannot solve this by normalizing content on the way in. The archive engine copies reserved entries with `COPYFILE_EXCL` and then verifies the copied identity, and the recorded evidence hashes exist precisely so archived evidence can be proven unaltered. Silently rewriting bytes during absorption would contradict that guarantee. The fix belongs at the two boundaries where imported content actually enters: the commit, and the archive preflight.

## What Changes

- Add an installable `pre-commit` hook that rejects staged content carrying whitespace errors, using git's own `git diff --cached --check` so the local check and the CI check cannot drift, plus ESLint over staged JavaScript/TypeScript.
- Add a hook installer wired into `prepare`, so a normal `pnpm install` arms the hook, while CI and non-git checkouts are skipped.
- Add a whitespace preflight to `rasen archive` that inspects the change's text artifacts **before** they are staged, copied, and hashed, and blocks with a `file:line` list instead of producing an archive that CI will reject.
- Keep the archive engine's byte-preservation and evidence-hash guarantees untouched: the preflight reports, it never rewrites.

## Capabilities

### New Capabilities

- `repository-whitespace-hygiene`: Reject whitespace errors at the two boundaries where externally authored artifacts enter the repository — the commit and the archive preflight.

### Modified Capabilities

None. The archive engine's existing copy, verification, and accounting behavior is unchanged; the preflight runs before it.

## Impact

- New repository tooling under `.githooks/` and `scripts/repo-hygiene/`, plus a `prepare` step that installs the hook.
- New preflight in the archive planning path and a `--no-whitespace-check` escape hatch for artifacts that legitimately contain trailing whitespace (for example a report quoting whitespace-significant output).
- No change to published CLI behavior beyond the new archive block and its opt-out, and no new runtime dependency.
