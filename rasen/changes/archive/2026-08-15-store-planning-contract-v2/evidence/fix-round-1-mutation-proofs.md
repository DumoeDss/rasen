# Fix round 1 — mutation proofs for the three coverage Majors

Review round 1 found three requirements that had an implementation but no test able to tell the
implementation from its absence. Each was proven by restoring the original defect and watching the
suite stay GREEN. This records the same experiment run against the **added** tests: defect restored,
suite RED and correctly named, defect reverted byte-exactly, suite GREEN.

## Protocol

- Pristine bytes of every mutated file were copied to a directory **outside the repository** before
  any edit, and restored with `cp` from that copy. `git checkout --` was never used: this repository
  has `core.autocrlf=true`, so a checkout rewrites the working tree to CRLF and produces a spurious
  whole-file diff.
- Note on hashes: for files this commit **added**, the working-tree sha256 equals
  `git show eaefc01b:<path> | sha256sum`, because those files were authored with LF and never
  re-checked-out. For pre-existing files (`src/core/id.ts`, `src/core/index.ts`) the working tree is
  CRLF while the blob is LF, so the two hashes legitimately differ; `git status --porcelain` is the
  authority there and was verified empty for every restored path.

Pristine snapshot (matches the hashes the review report recorded):

```
40ecab21674080d48881699b099df60b0fc507cce4f06666316c92a3be26ec66  src/core/store/planning-layout-v2.ts
14774dedb0a3f7adaa317e5ce55302fa9cd7daba39d4870a2fdecc0d6ce85ca5  src/core/store/planning-catalogs.ts
63346fa9ed0a10a9194b07be7b83f3e77f22497f1d9bfe5c436b27a1a497354e  src/core/store/finalization-v2.ts
8df535575aaf18e3aeca06c281037ce87daa12c4e1bcbbb07cd8e6c0632d266a  src/core/id.ts
```

Every one was `RESTORED-EXACT` against that snapshot after its proof, with
`git status --porcelain -- src test` showing only the intended fix-round edits.

## M1 — drive-less Windows Store root (`planning-layout-v2.ts:93`)

Mutation (the reviewer's own): the drive requirement removed.

```
93: -  return path.win32.parse(storeRoot).root.length > 1;
93: +  return true; // MUTATION: drive requirement removed
```

Before the fix this left all six Layer-0 suites at 174/174 GREEN. With the added cases:

```
 Test Files  1 failed | 5 passed (6)
      Tests  2 failed | 215 passed (217)

 FAIL  test/core/store/planning-layout-v2.test.ts > pure Store planning layout v2 > refuses a drive-less 'forward-slash'-rooted Windows Store root
 FAIL  test/core/store/planning-layout-v2.test.ts > pure Store planning layout v2 > refuses a drive-less 'backslash'-rooted Windows Store root
 AssertionError: expected Error: expected drive-less Windows root '... to be an instance of StorePlanningValidationError
   test/core/store/planning-layout-v2.test.ts:503:23
```

The cases pin the rule at **both** call sites of `isAbsoluteStoreRoot` —
`computeStorePlanningLayoutV2` and `resolveStorePlanningLayoutV2Path` — and assert the typed
`{ code: 'invalid_store_layout_v2', field: 'storeRoot' }`, not merely "it threw". They also assert
`path.win32.isAbsolute(storeRoot) === true` first, so the test states the trap it exists to catch:
absoluteness alone does not make a Windows root self-contained.

Companion positive cases (drive, UNC share, device root) stayed GREEN under the mutation, which is
correct — the mutation only removes a refusal — and they are what keeps the fix from being satisfiable
by refusing everything.

## M2 — display name validated as an identifier (`planning-catalogs.ts:78`)

Mutation: the 0.1.7 defect design Decision 6 says this child fixes.

```
78: -    id: z.string().min(1).optional(),
78: +    id: z.string().min(1).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/u).optional(),
```

Before the fix this left 92/92 GREEN. With the added cases:

```
 Test Files  1 failed (1)
      Tests  2 failed | 53 passed (55)

 FAIL  ... > Store metadata and planning catalogs v2 > carries the human display name Elftia through unvalidated, exactly as the v1 record does
 FAIL  ... > Store metadata and planning catalogs v2 > carries the human display name my app through unvalidated, exactly as the v1 record does
 ZodError: [{ "code": "invalid_format", "path": ["id"], "message": "Invalid string: must match pattern /^[a-z0-9]+(-[a-z0-9]+)*$/u" }]
   validateStoreProjectCatalogV2 src/core/store/planning-catalogs.ts:253:39
```

The cases use the exact values the spec and tasks 2.2/2.7 name (`Elftia`, `my app`), assert the value
survives a serialize/parse round trip unchanged, and assert the **v1 membership record accepts the
same value** — so the test states the general rule rather than the symptom: a migration must never
block on data the schema it migrates FROM accepted.

## M3 — nested capability address (`finalization-v2.ts:198-217`)

Mutation: the 0.1.7 single-kebab capability id.

```
const CapabilityPathSchema = z.string().refine(
  value => /^[a-z0-9]+(-[a-z0-9]+)*$/u.test(value),
  { message: 'MUTATION: single-kebab capability id' }
);
```

Before the fix this left 41/41 GREEN. With the added cases:

```
 Test Files  1 failed (1)
      Tests  2 failed | 51 passed (53)

 FAIL  ... > Archive v2 contract > accepts capability address store/planning-layout-v2 and preserves it verbatim
 FAIL  ... > Archive v2 contract > accepts capability address store/planning/layout-v2 and preserves it verbatim
```

The single-segment `auth` case stayed GREEN under the mutation, which is the point: it is what every
pre-existing fixture used, and it cannot discriminate.

### Control for the negative half

Nine rejection cases were added alongside. Asserting rejection is worthless if nothing could make it
pass, so the opposite mutation was run too — capability validation dropped entirely:

```
const CapabilityPathSchema = z.string(); // MUTATION: accept anything

 Test Files  1 failed (1)
      Tests  9 failed | 44 passed (53)

 FAIL  ... rejects a 'empty' capability address
 FAIL  ... rejects a 'current directory' capability address
 FAIL  ... rejects a 'parent directory' capability address
 FAIL  ... rejects a 'traversal segment' capability address
 FAIL  ... rejects a 'empty inner segment' capability address
 FAIL  ... rejects a 'leading separator' capability address
 FAIL  ... rejects a 'trailing separator' capability address
 FAIL  ... rejects a 'backslash separator' capability address
 FAIL  ... rejects a 'non-canonical case' capability address
```

All nine discriminate; none is decorative.

## Minor-severity guard proofs

The two purity-guard escape vectors (dynamic `import()`, and a forbidden import in an allowlisted
transitive dependency) are proven in `purity-guard-mutation-proof.md`, appended under
"Review round 1: two proven escape vectors, closed".
