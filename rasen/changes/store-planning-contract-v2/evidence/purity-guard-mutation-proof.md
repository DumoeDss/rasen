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
