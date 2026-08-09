# Upgrade-path asset audit: is decision 13's retention claim true in git?

Date: 2026-08-08. Auditor: independent reviewer (author of the cutover reviews and both
decision13 re-grades; self-locked from closure/host re-reviews and not an author of any
audited asset). Audited at HEAD `30dcb345`, branch
`wip/ecp-shared-bounded-loop-lifecycle-resume`.

Locked decision 13 and parent roadmap 13.2 assert the Linux/Windows kernel-enforced
authority machinery is "retained in git as upgrade-path assets, nothing deleted, known
defects recorded". This repository has three recorded instances of the opposite failure
(guard-depended files not in git, surfacing on a fresh clone as phantom tampering), so the
claim was verified rather than trusted. Every digest below was recomputed by this auditor
from COMMITTED bytes (`git show` / git blobs), never from the shared dirty working tree.

## Verdict up front

**The retention claim is TRUE, with one Minor documentation finding** (the Windows freeze
marker still names the superseded digest pair as current). No untracked asset, no
unreproducible digest, no orphaned production import, and every byte-pinned guard input is
`.gitattributes`-protected so a fresh clone on any platform passes the pin guards.

## Manifest

| Asset | Tracked? | Digest reproduces from committed bytes? | Restart-entry pointer |
| --- | --- | --- | --- |
| `rasen/changes/ecp-linux-process-authority-provider/**` (proposal/design/tasks/specs/evidence/handoff) | YES - 90/90 files, `git ls-files` identical to recursive listing | n/a | `evidence/activate-reference-invalid-investigation.md` (D4/D2 repairs); `handoff/lead-6.md` |
| `rasen/changes/ecp-windows-process-authority-provider/**` | YES - 15/15 files identical | n/a | `evidence/windows-native-assembly.md` (verb refusal); `evidence/section-9-oracle-discrimination.md` (current freeze) |
| `native/linux-process-authority/**` (frozen crate) | YES - fully tracked incl. 17 test files (`/target/` gitignored per-crate, build output) | **YES** - `89f6c1d5270c3ad301f84edde1ae1f67541ac81ca271eb8eaef7871715aba643`, 26 files, reproduced exactly via the guard's own convention against git blobs | fix D4/D2 first; convention: sorted(Cargo.lock, Cargo.toml, THIRD_PARTY.md, src/**), each `path\0bytes\0` |
| `native/windows-process-authority/**` (frozen crate) | YES - fully tracked incl. all 4 test files (`windows_section9_discrimination.rs` present) | **YES** - `fc49a7c2c5f9642fa976d16f06e167a39bdbe3c751686f417722273aea891c27`, 22 files, same convention, reproduced exactly | add the frame-verbatim runtime verb first (see below) |
| Windows packaged helper `367666f6...` (258560 B) | NO - `dist/native/**` is build output, untracked BY DESIGN | NOT REPRODUCIBLE, and correctly so: cross-machine Windows build reproducibility is recorded OPEN in the freeze marker, and decision 12 retired byte-reproducibility as a provenance claim | receipt recorded in tracked evidence (`section-9-oracle-discrimination.md:479-485`); restart rebuilds via `scripts/build-windows-process-authority.mjs` and re-receipts |
| Guard byte-pins (`FROZEN_COMMON_INPUTS` x2, `LEGACY_PROCESS_CAPSULE_INPUTS` x2, `LINUX_CRATE_SOURCE_DIGEST`) | YES - every pinned file tracked | **YES** - all nine pinned file hashes plus the crate digest verified against committed bytes (this audit + review round 2) | pins live in `linux-process-authority-boundary-guards.test.ts` / `windows-process-authority-package-ci.test.ts`, both with lineage-comment conventions |

## 1. Tracking completeness

For each of the two parked change directories and both crates, `git ls-files <dir>` was
diffed against a recursive filesystem listing (crates: excluding the per-crate gitignored
`/target/` build dirs, whose exclusion is itself tracked - each crate carries its own
`.gitignore` containing `/target/`). All four diffs are empty: **no untracked artifact
anywhere in the audited set.** The historical failure mode (native/ once entirely
untracked) is not present.

## 2. Frozen digests reproduce from COMMITTED bytes

The digest convention was taken from the guard that enforces it
(`windows-process-authority-package-ci.test.ts:85-95` `crateSourceDigest`): sorted
union of the roots (`Cargo.lock`, `Cargo.toml`, `THIRD_PARTY.md`) and `src/**`
(tests/ excluded), each file contributing `relative-path + NUL + bytes + NUL` into one
SHA-256. This auditor reimplemented it reading `git show HEAD:<path>` blobs instead of the
working tree:

- Linux: **26 files -> `89f6c1d5...aba643`** - exact match to the pin and to the lineage
  annotation "(current, 26 files)".
- Windows: **22 files -> `fc49a7c2...891c27`** - exact match to the Section 9 freeze record.

The Windows helper hash `367666f6...` (and guardian `d571f148...`) are receipts about
build artifacts, not git assets; the binaries live under untracked `dist/`. That is
consistent with decision 12 (byte reproducibility retired as provenance; manifest-adjacent
integrity retained) and with the freeze marker's own recorded limitation ("cross-machine
reproducibility for Windows remains OPEN"). A restart cannot and need not reproduce the
byte-identical helper; it rebuilds through the authoritative route and re-receipts.

## 3. Defect records are written, findable, and quotable

- **Linux D4** (the 2 s dead bridge):
  `ecp-linux-process-authority-provider/evidence/activate-reference-invalid-investigation.md:411-414`.
  Restart entry, one line: *"stop discarding `open-runtime`'s `--deadline-ms`
  (`main.rs:141`) and give `open_runtime` a budget that is not `CONTROL_TIMEOUT`, so the
  streaming socket's read timeout is the caller's bound rather than a control round
  trip's."*
- **Linux D2** (activate `reference-invalid` mislabel): same file, `:403-409`. Restart
  entry, one line: *"move the generic `Failure` check above the activate-specific shape
  check in `control_on_until`, so a guardian refusal keeps its own typed code"*
  (`primary.rs:315-318` must run before `:294-299`). The file also records the reading
  rule that holds until then: a Linux `activate` `reference-invalid` means "guardian
  refused, cause unknown".
- **Windows missing frame-preserving verb**:
  `ecp-windows-process-authority-provider/evidence/windows-native-assembly.md:192-208`.
  Refusal rationale: `control --verb run` de-multiplexes workload output onto the helper's
  own stdout mixed with `RWA1-OBSERVATION` lines, so a bridge over it is a receipt-forgery
  surface (a workload printing `RWA1-OBSERVATION 0404...` could forge exact-scope-empty).
  Restart entry, one line: *"What the crate needs is the Linux sibling's shape: a verb that
  copies protocol frames verbatim between the authenticated endpoint and its own stdio,
  leaving de-multiplexing to this layer"* (task 5.5; completes Section 9.8 Leg D).

## 4. Guard byte-pins survive a fresh clone

The determinant is `.gitattributes`, and it covers the complete pinned set with `text
eol=lf`: both crate trees (`native/linux-process-authority/**` wholesale;
`native/windows-process-authority/` roots + `src/**` + `tests/**`), the WSL-oracle
test/fixture pair whose digests the Linux freeze marker records, and all nine
`FROZEN_COMMON_INPUTS` / `LEGACY_PROCESS_CAPSULE_INPUTS` files - each rule annotated with
exactly the phantom-tampering failure it prevents. Every pinned hash equals the committed
bytes (verified in this audit and in the cutover review round 2, including the two
authorized rebaselines `0f7eda09` and `0e86380f`, both carrying lineage). The working-tree
suites pass here (21/21 in this auditor's round-2 run), and because the checkout form is
pinned, a fresh clone on Windows-default `autocrlf=true` produces the same bytes the pins
name. **No pin depends on an untracked file and none would go red on first clone.**

## 5. No orphaned production dependency

- Zero imports of `process-authority/linux` or `process-authority/windows` anywhere in
  `src/` outside the provider tree itself; zero relative importers from session-host code.
- The only occurrences of "process-authority" in shipping capsule/scope code are the
  `process-authority-uncertain` error-code string (6 in `native-process-scope.ts`) - not
  imports.
- The parked provider TS modules are constructed only by their own platform test suites
  under `test/core/session-host/` (retention-by-guard, not a shipping dependency), and the
  hosted production path routes exclusively through `hosted-process-scope.ts`
  (POSIX/win32 best-effort tiers), as verified in the cutover reviews. The parked Windows
  factory remains inert by construction; nothing constructs it in production.

## Finding

### A1 [Minor] The authoritative Windows freeze marker still names the superseded freeze

`ecp-windows-process-authority-provider/evidence/win-crate-freeze-marker.md` presents
itself as the authoritative marker but records `sourceSha256 2b3fabd9...` (and helper
`2aebab69...`) as current. The actual current freeze is `fc49a7c2...` / helper
`367666f6...`, recorded in `section-9-oracle-discrimination.md` ("The new freeze",
`:475-485`) - whose own follow-up table (`:537`) lists the marker update as **owed** ("new
digest, lineage entry `fc49a7c2`, new helper hash, fourth `testFiles` entry for
`windows_section9_discrimination.rs`") and it was never delivered. Decision 13, Replan 6,
and the roadmap all cite the correct `fc49a7c2`/`367666f6` pair, and the digest reproduces
from git, so nothing is lost - but a restart reader who follows the marker's "authoritative"
framing binds to the superseded pair. Fix: append the owed superseded-by amendment to the
marker (a dated note, not a rewrite), whenever a worker next touches the parked Windows
change. No 0.2.0 gate depends on it.

## Authority statement

This audit verifies retention facts; it closes no finding and re-grades nothing. The
parked changes stay parked; the one Minor above is bookkeeping inside a parked asset and
does not block the cutover ship, closure, or any 0.2.0 gate.
