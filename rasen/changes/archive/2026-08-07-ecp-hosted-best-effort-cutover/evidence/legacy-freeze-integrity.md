# Legacy freeze integrity - ecp-hosted-best-effort-cutover

Task 5.1. Computed after all of this change's code was committed.

- Baseline commit: `b3edf5bc9254499f28ef4d81dbe0c93426c45219`
- Post-implementation commit: `af21ba8d1ef45248ee6242030fba683be21f6034`

Every digest below comes from the COMMIT (`git show <commit>:<file> | sha256sum`),
never from the working tree. This worktree is shared, was dirty during the wave,
and `core.autocrlf` is `true` - a working-tree hash here would be neither stable
nor true.

## Result: no rebaseline. All twelve legacy-capsule pins are byte-identical.

### Pin list A - `linux-process-authority-boundary-guards.test.ts` LEGACY_PROCESS_CAPSULE_INPUTS

| File | Baseline (b3edf5bc) | After (af21ba8d) | Moved? |
| --- | --- | --- | --- |
| `native/process-capsule/src/main.rs` | `79dc1ad0…f0f41c8d` | `79dc1ad0…f0f41c8d` | no |
| `native/process-capsule/Cargo.lock` | `f00e6411…1d32db8793` | `f00e6411…1d32db8793` | no |
| `scripts/build-process-capsule.mjs` | `4117b109…653f599ef92` | `4117b109…653f599ef92` | no |
| `src/core/session-host/process-capsule/resolver.ts` | `a1df4e2e…5624bbf91` | `a1df4e2e…5624bbf91` | no |
| `src/core/session-host/process-capsule/native-process-scope.ts` | `0848c77b…07209588fa` | `0848c77b…07209588fa` | no |
| `test/core/session-host/process-capsule-package.test.ts` | `3ed5945c…528a759e1` | `3ed5945c…528a759e1` | no |
| `test/core/session-host/process-capsule-posix-replacement.test.ts` | `894a5119…2f4f0e64e047` | `894a5119…2f4f0e64e047` | no |

Full digests are in `implementation-baseline.md`; every character matched on
re-computation, including the two adapter files (`resolver.ts`,
`native-process-scope.ts`) that the win32 wrapper delegates to. That is the
central claim of design D3: the wrapper adds a translation layer above the
capsule and changes nothing inside it.

### Pin list B - `windows-process-authority-package-ci.test.ts` LEGACY_PROCESS_CAPSULE_INPUTS

The same first five files with byte-identical constants. All five unchanged.

### Frozen provider crates

```
$ git diff --stat b3edf5bc..af21ba8d -- native/
(no output)
```

`native/linux-process-authority/**`, `native/windows-process-authority/**` and
`native/process-capsule/**` received not one byte across the entire change.

### The four surfaces task 1.3 promised not to edit

```
$ git diff --stat b3edf5bc..af21ba8d -- src/core/session-host/host.ts \
    src/core/management-api/router.ts src/core/session-host/claude-backend.ts \
    src/core/session-host/registry.ts
(no output)
```

Unchanged, as predicted. (`host.ts` was mutated transiently during the mutation
wave to prove the release guards discriminate, then restored byte-exactly; see
`mutation-receipts.md`.)

## FINDING - a different pinned constant is already RED, and not from this change

Running both guard suites does not produce two clean greens, and this receipt
would be dishonest if it stopped at the digests above:

```
$ npx vitest run test/core/session-host/linux-process-authority-boundary-guards.test.ts \
    test/core/session-host/windows-process-authority-package-ci.test.ts

 ✓ Linux process-authority implementation boundary guards > keeps the legacy ProcessCapsule protocol-v2 PGID implementation unchanged
 FAIL  Linux process-authority implementation boundary guards > consumes the accepted common spec and shared conformance suite byte-for-byte
 FAIL  Windows Change boundary guards > consumes the accepted common spec and shared conformance suite byte-for-byte

-   "rasen/specs/process-authority-provider/spec.md": "05257eb1860aa40ce06a2289b63348e21a81187f4df4fd4aff346e7e8ac57d5a",
+   "rasen/specs/process-authority-provider/spec.md": "359db6d9f268700bce6591cc26067c6b79025a87e99d3fc48042f76e71452ef9",

 Test Files  2 failed (2)
      Tests  2 failed | 19 passed (21)
```

What this is:

- The failing constant is `FROZEN_COMMON_INPUTS`, **not** `LEGACY_PROCESS_CAPSULE_INPUTS`. The legacy-capsule assertion that this change is accountable for passes.
- The file that moved is `rasen/specs/process-authority-provider/spec.md`, changed by commit **`2961848b` "docs(specs): replace archived Purpose placeholder in process-authority-provider"** - a LEAD commit that landed between this change's proposal commit and the implementation wave. It replaced the `TBD - created by archiving …` Purpose placeholder with real prose.
- This change touches neither that spec nor `test/helpers/process-authority-provider-conformance.ts` (whose pin still matches).

```
$ git log --oneline b3edf5bc..af21ba8d -- rasen/specs/process-authority-provider/spec.md
2961848b docs(specs): replace archived Purpose placeholder in process-authority-provider
```

What I did about it: **nothing, deliberately.** A rebaseline is a LEAD decision,
never an implementer side effect, and silently swapping the constant would turn
the guard green while the sentence it encodes - "the accepted common spec is
consumed byte-for-byte" - became false. That is precisely the failure mode these
pin lists exist to catch. Escalated to the LEAD instead; see
`handoff/implementer-1.md`.

Note for whoever resolves it: `2961848b` is a legitimate content fix (the archive
Purpose placeholder is a known defect class in this repo), so the likely
resolution is an authorised rebaseline of the two `FROZEN_COMMON_INPUTS`
constants **with lineage recorded**, not a revert of the docs fix. Both pin-list
files carry an existing convention for recording lineage on a moved digest.

## Task 5.2 contingency

Not triggered. No pinned file required modification at any point, so no
rebaseline was requested, granted, or performed by this change. Neither frozen
provider crate was touched.
