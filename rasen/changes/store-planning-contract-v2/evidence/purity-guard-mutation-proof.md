# Task 5.4: purity guard mutation proof

Guard under test: `test/core/store/planning-foundation-purity.test.ts`, which reads the five
Layer-0 Store-planning v2 modules from disk and asserts (a) every import specifier is in an
explicit allowlist and (b) no forbidden filesystem/process/registry pattern appears in source.

A guard never observed to fail is not evidence. This records one deliberate mutate-observe-revert
cycle against `src/core/store/planning-validation.ts`, one of the five modules the guard scans.

## Pristine state

```
sha256(src/core/store/planning-validation.ts) = 5627d7c57ffed212e47b771b8f78b710f10eb22b010228495fb9c76968df8192
```

## Mutation

Inserted a forbidden import as the second line of the file, immediately after the existing
`import { isKebabId } from '../id.js';`:

```ts
import * as fs from 'node:fs';
```

## RED — `pnpm exec vitest run test/core/store/planning-foundation-purity.test.ts`

```
 Test Files  1 failed (1)
      Tests  2 failed | 13 passed (15)

 FAIL  test/core/store/planning-foundation-purity.test.ts > Store planning v2 Layer-0 purity > imports only allowlisted specifiers in planning-validation.ts
 AssertionError: expected false to be true // Object.is equality

 FAIL  test/core/store/planning-foundation-purity.test.ts > Store planning v2 Layer-0 purity > contains no filesystem, process, or registry access in planning-validation.ts
 AssertionError: planning-validation.ts must not reference node:fs: expected true to be false // Object.is equality
```

Both failures correctly named `planning-validation.ts` as the offending file. The other four
Layer-0 modules' rows stayed green (13/15 passed), confirming the guard is file-scoped, not a
blanket failure. `it.each` parameterization discriminates the mutated file from its four siblings.

## Revert

Removed the inserted line, restoring the file to its pristine byte content.

```
sha256(src/core/store/planning-validation.ts) = 5627d7c57ffed212e47b771b8f78b710f10eb22b010228495fb9c76968df8192
```

Byte-identical to the pristine hash above — confirmed restored exactly, not merely "close".

## GREEN — `pnpm exec vitest run test/core/store/planning-foundation-purity.test.ts`

```
 Test Files  1 passed (1)
      Tests  15 passed (15)
```

## Conclusion

The purity guard discriminates: it goes RED on a forbidden `node:fs` import injected into a
Layer-0 module, names the offending file, and returns to GREEN once the import is removed and the
file is restored byte-exactly. Task 5.4 is satisfied.

---

# Review round 1: two proven escape vectors, closed

Everything above still holds for the class it tested. Independent review then found two ways past
the guard, each proven GREEN with the guard as originally written. Both are now closed; the guard's
count changed from **15** to **39** tests as a result (it now covers an 11-file closure rather than
5 files). The proofs below were run by the fixer against committed bytes, restoring every mutation
by `cp` from an out-of-repo pristine copy — never `git checkout --`, which `core.autocrlf=true`
would rewrite to CRLF.

## Escape vector 1 — dynamic `import()` was never collected

`importSpecifiers()` required whitespace after `import`, so `import('...')` was invisible to it, and
the forbidden-pattern list names modules rather than siblings. A Layer-0 module could therefore
reach `node:fs`, the Store registry, and the global data dir through one line.

Probe, appended to `src/core/store/finalization-v2.ts`:

```ts
export async function reviewProbe() {
  const m = await import('./foundation.js');
  return m;
}
```

- **Guard as written:** 15/15 GREEN (recorded by the reviewer).
- **Guard as fixed:** RED, precisely named.

```
 Test Files  1 failed (1)
      Tests  1 failed | 38 passed (39)

 FAIL  test/core/store/planning-foundation-purity.test.ts > Store planning v2 Layer-0 purity > imports only allowlisted specifiers in 'core/store/finalization-v2.ts'
 AssertionError: core/store/finalization-v2.ts must not import './foundation.js': expected false to be true
```

Restored: `sha256(src/core/store/finalization-v2.ts) = 63346fa9ed0a10a9194b07be7b83f3e77f22497f1d9bfe5c436b27a1a497354e`
(matches the pristine snapshot taken before the mutation).

## Escape vector 2 — the allowlist's transitive soundness was prose only

Design Decision 9 claimed the allowlist is transitively sound because each dependency had been read
by hand. Nothing encoded that, so a forbidden import added to an allowlisted dependency falsified the
Layer-0 purity claim without touching a Layer-0 file.

Probe, inserted as line 1 of `src/core/id.ts` (an allowlisted dependency):

```ts
import * as fs from 'node:fs';
```

- **Guard as written:** 15/15 GREEN (recorded by the reviewer).
- **Guard as fixed:** RED on both axes, naming the dependency.

```
 Test Files  1 failed (1)
      Tests  2 failed | 37 passed (39)

 FAIL  ... > imports only allowlisted specifiers in 'core/id.ts'
 AssertionError: core/id.ts must not import 'node:fs': expected false to be true

 FAIL  ... > contains no filesystem, process, or registry access in 'core/id.ts'
 AssertionError: core/id.ts must not reference node:fs: expected true to be false
```

Restored: `sha256(src/core/id.ts) = 8df535575aaf18e3aeca06c281037ce87daa12c4e1bcbbb07cd8e6c0632d266a`
(unchanged by this change; matches its pre-existing content).

## Current GREEN

```
pnpm exec vitest run test/core/store/planning-foundation-purity.test.ts
 Test Files  1 passed (1)
      Tests  39 passed (39)
```

The walked closure is the 5 Layer-0 modules plus the 6 dependencies the allowlist reaches:
`core/canonical-json.ts`, `core/id.ts`, `core/zod-issues.ts`, `core/store/errors.ts`,
`core/store/identity-types.ts`, `core/store/remote.ts`. A dedicated case asserts the walk actually
reaches all eleven, so "transitively sound" cannot become vacuous by the walk quietly reaching
nothing.
