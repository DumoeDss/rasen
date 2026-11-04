# Durability sweep: what would fail on a clean checkout on a different machine

Date: 2026-08-07\
Author: implementer (Section 9), single leaf worker\
Scope: read-only survey. **Nothing was fixed.** Some rows belong to changes neither this worker
nor the LEAD owns.

The question throughout is never "does this pass here". It is **"would this pass on a fresh
clone, on a machine that is not this one"**. Four times in one day this repository produced a
guard, receipt or marker that depended on something not durably in git, and every one was found
by accident rather than by a check. This is the check.

## Method, and what it is worth

| Category | Method | Exhaustive or sampled |
| --- | --- | --- |
| 1. Byte-hash pins | Regex over every `test/**/*.ts` and `scripts/**/*.mjs` for a path-literal mapped to a 64-hex constant, then `git ls-files` + `git check-attr eol` per hit, then the CRLF hash recomputed | **Exhaustive** over that syntactic form. A pin written any other way (built at runtime, split across variables, in a `.json`) is not covered |
| 2. Cited-but-untracked | `git ls-files` for the whole tree, differenced against a walk of `rasen/changes/**` | **Exhaustive** for `rasen/changes/**`. **Sampled** elsewhere: a receipt citing a path outside that tree was not systematically chased |
| 3. Path assumptions | `git grep` for `C:\Users`, `AppData/Local/Temp`, `%TEMP%`, `E:/AI/` over `test`, `scripts`, `.github`, `src` | **Exhaustive** over those four trees and those five needles. Other machine-local shapes (a hardcoded UNC path, a user name that is not `Sayo`) would be missed |
| 4. Platform-conditional silence | `git grep` for `process.platform` comparisons and `skipIf` across `test/**`, then narrowed by hand to the process-authority family | **Exhaustive** over the process-authority family. **Sampled** repo-wide -- there are ~25 further sites, almost all legitimate (`chmod` on POSIX, permission tests that cannot run as admin), and separating those from real coverage gaps needs per-test judgement that was not done |

**Ranking convention.** A row that fails **loudly** on a clean checkout is less dangerous than one
that passes **silently**, because the loud one gets fixed. Silent rows are listed first within
each category.

## Category 1 -- byte-hash pins: 9 of 9 break on a fresh Windows checkout

Nine paths have their sha256 recorded in a test. **All nine exist, all nine are tracked, and not
one has its line endings pinned.** `.gitattributes` pins both native crates and one unrelated
fixture; it pins none of these.

Under `core.autocrlf=true` -- the Git-for-Windows **default**, and the setting this repository
already runs under -- every one of these files checks out CRLF and every recorded hash changes:

| Pinned path | Bytes LF -> CRLF | sha256 now -> on a fresh Windows checkout |
| --- | --- | --- |
| `test/helpers/process-authority-provider-conformance.ts` | 25551 -> 26180 | `b9d8bd4fb639` -> `fc62834498e6` |
| `rasen/specs/process-authority-provider/spec.md` | 24122 -> 24401 | `05257eb1860a` -> `5abbd98d12e9` |
| `native/process-capsule/src/main.rs` | 53587 -> 55198 | `79dc1ad0f19e` -> `a70a7422e603` |
| `native/process-capsule/Cargo.lock` | 165 -> 172 | `f00e64114e06` -> `3393d275b4cf` |
| `scripts/build-process-capsule.mjs` | 5540 -> 5683 | `4117b109bbe5` -> `a2dac56d24d4` |
| `src/core/session-host/process-capsule/native-process-scope.ts` | 19035 -> 19552 | `0848c77b55d4` -> `3115e215b54c` |
| `src/core/session-host/process-capsule/resolver.ts` | 7370 -> 7544 | `a1df4e2ed631` -> `4e1d20c1b312` |
| `test/core/session-host/process-capsule-package.test.ts` | 7636 -> 7796 | `3ed5945c5b17` -> `f890fe3b8977` |
| `test/core/session-host/process-capsule-posix-replacement.test.ts` | 8573 -> 8776 | `894a5119e480` -> `a52cbde10a6a` |

Pinned by `test/core/session-host/windows-process-authority-package-ci.test.ts`
(`FROZEN_COMMON_INPUTS`, `LEGACY_PROCESS_CAPSULE_INPUTS`) and
`test/core/session-host/linux-process-authority-boundary-guards.test.ts`.

**Fails loudly.** Both guards go red on the first clean Windows checkout, reporting a digest
mismatch against files nobody touched -- i.e. **as tampering rather than as a line-ending
convention.** That is the same misread the Linux crate's `087d87a5` would have produced before
it was pinned, and it costs an investigation each time.

**The first row is the one to notice.** `b9d8bd4f` is the shared conformance suite -- the hash
that was already rebaselined once in a commit that did not contain the file producing those
bytes. It is now exposed a second time, by a different mechanism, in two test files at once.

**Not a defect in the pins.** The pins are correct and valuable; the missing thing is five lines
of `.gitattributes`. Recorded here rather than fixed because `native/process-capsule/**` and
`rasen/specs/**` belong to other changes, and `.gitattributes` is shared by every worker in this
worktree.

## Category 2 -- cited-but-untracked

### 2a. Sixty files under `rasen/changes/**` exist only in this worktree

| Change | Untracked files | Includes |
| --- | --- | --- |
| `ecp-v2-default-authoring-and-builtins` | 22 | **proposal / tasks / design** |
| `ecp-v2-authoring-loop-vertical-proof` | 20 | **proposal / tasks / design** |
| `ecp-canvas-v2-authoring-parity` | 14 | **proposal / tasks / design** |
| `ecp-shared-bounded-loop-lifecycle` | 3 | `evidence/review-report.md`, `evidence/review-cycle-report.md`, `handoff/implementer-4.md` |
| `foo` | 1 | -- |

**Passes silently, and this is the worst row in the sweep.** Three changes have no ledger in git
at all: their proposal, tasks and design exist on one disk. A `rasen validate`, an archive, or a
reviewer cloning the branch sees a change that is *absent*, not a change that is *broken*. The
fourth row is narrower but sharper in kind: `ecp-shared-bounded-loop-lifecycle` **is** tracked,
and its two review reports and one handoff are not -- so a receipt-bearing change cites evidence
that a fresh checkout does not contain. That is exactly instance 3 from the known list,
recurring.

`foo` is presumably a scratch directory and is listed only because the enumeration is exhaustive.

**Not judged here:** whether those three changes are deliberately un-committed work-in-progress.
That is their owners' call. The durability fact is stated without inferring intent.

### 2b. Three build roots at the repository root are not gitignored

```text
NOT IGNORED  .cargo-target-broker-r4/
NOT IGNORED  .cargo-target-broker-r4-m03/
NOT IGNORED  .cargo-target-linux-apply/
```

**Passes silently until it does not.** These hold **5,534 untracked files** between them, several
with paths long enough that `git status` itself cannot read them (`Filename too long`). Two
consequences: `git status` output is unusable for spotting a genuinely untracked receipt -- which
is how instance 3 stayed invisible -- and any `git add -A` commits the entire build tree.

This also degraded this sweep: the untracked-file direction had to be abandoned for the
cited-path direction because the signal was buried.

## Category 3 -- machine-local paths in tracked files

| File(s) | What is hardcoded | Effect on another machine |
| --- | --- | --- |
| `scripts/token-audit/forensics/*.mjs` -- 9 files | `C:/Users/Sayo/.claude/projects/E--AI-...`, and in `dup-analysis.mjs` an `E:/AI/...` path to a **non-worktree** checkout | Fails loudly and immediately for any other user. These are forensic analysis tools rather than receipt-bearing guards, so nothing depends on them silently |

Two categories of **false positive**, checked and dismissed rather than counted:
`test/core/knowledge-bundle/{schema,export}.test.ts` contain `C:\Users\alice\...` as **test
data** for path-shape validation, and `linux-process-authority-{preparation-delivery,provider}`
use `process.platform === 'win32' ? os.tmpdir() : os.homedir()`, which is a portability
*measure*, not an assumption.

**No receipt in either process-authority change depends on a machine-local path.** The two that
did -- in this worker's own 9.6 generator -- were fixed before it was persisted, and the
persisted copies were re-run from their repository paths to prove it.

## Category 4 -- platform-conditional silence

Exhaustive over the process-authority family. **Ten sites return early on `win32`** inside the
Linux TypeScript suite:

```text
linux-process-authority-package-ci.test.ts      :259 :459 :487 :530 :565 :674
linux-process-authority-provider.test.ts        :309
linux-process-authority-publication-ledger.test.ts  :332
linux-process-authority-artifact-resolver.test.ts   :153 :171   (return unless linux)
```

**Passes silently.** On a Windows developer machine, and on a `windows-latest` runner, each of
these reports as a **passing test having asserted nothing**. The known instance -- a
`providers.json` literal never executed on win32 -- is `package-ci`; it is one of six in that
file alone.

Two sites are the honest opposite and are noted so they are not mistaken for the same thing:
`linux-process-authority-{wsl-oracles,daemon-lifetime}.test.ts` gate on
`process.platform === 'linux' && RASEN_ACTUAL_WSL_ORACLE === '1'`, and the second **documents its
own gate in a header comment** saying what running it from Windows does. That is the pattern the
other ten want.

The four Windows crate integration test files each carry `#![cfg(windows)]`, which is the
compile-time equivalent: on a non-Windows host they contribute **zero** tests to the count rather
than passing vacuously. That is the safer form -- a missing test is visible in a count, a
vacuously-passing one is not.

**Repo-wide this category is sampled, not exhaustive.** Roughly 25 further `skipIf` sites exist
across completions, file-state and archive tests. Spot-reading them suggests they are legitimate
(`chmod` is a no-op on Windows; permission-denied cases cannot be staged as admin), but each
needs a judgement about whether anything cites it as coverage, and that was not done.

## Ranking: what a clean checkout on a fresh machine actually does

| # | Row | Loud or silent | What actually happens |
| --- | --- | --- | --- |
| 1 | 3 changes' proposal/tasks/design untracked | **silent** | The changes do not exist. Nothing fails; there is simply nothing there |
| 2 | `ecp-shared-bounded-loop-lifecycle` review reports + handoff untracked | **silent** | A tracked change cites evidence the clone does not contain |
| 3 | 10 win32 early-returns in the Linux TS suite | **silent** | Green tests that asserted nothing, on exactly the platform this repo is developed on |
| 4 | 3 build roots not gitignored | **silent, then loud** | `git status` unusable; `git add -A` commits 5,534 build files |
| 5 | 9 byte-hash pins unpinned for line endings | **loud** | Two guard suites red on first clone, reading as tampering |
| 6 | 9 forensics scripts with hardcoded user paths | **loud** | Immediate failure for any other user; nothing depends on them |

**The ordering is the point.** The only row that fails loudly is the one most likely to be fixed
quickly, and it is the least dangerous. The three silent rows at the top would survive a clean
clone, a CI run and a review without producing a single red signal.

## What this sweep does NOT establish

- **Nothing was fixed, and nothing was verified as fixable.** No `.gitattributes` line was added,
  no file was committed, no test was changed.
- **Category 1 is exhaustive only over one syntactic form.** A hash pin computed at runtime,
  assembled from variables, or stored in JSON would not appear. `.rasen/**` run-state was not
  scanned for pins at all.
- **Category 2 is exhaustive only inside `rasen/changes/**`.** A committed receipt elsewhere
  citing an untracked script or fixture would not have been found; the known instance-1 and
  instance-3 shapes were both of that kind, and only the `rasen/changes` half is closed here.
- **Category 4's repo-wide half is sampled and unjudged**, as stated above.
- **The CRLF column is computed, not observed.** Byte lengths and hashes are derived by applying
  the LF->CRLF transform in memory. It is the same method that correctly predicted the Linux
  marker's two unpinned entries, but **no actual second checkout was performed**, on this machine
  or any other. A real clone into a scratch repository would be a stronger receipt and is the
  obvious next step for anyone acting on Category 1.
- **Author == verifier.** One worker chose the categories, wrote the queries, and graded the
  results. A category nobody thought of is invisible to this sweep, and the honest reading of
  "four instances of one shape in one day" is that the shape is common enough that a fifth
  category probably exists.
