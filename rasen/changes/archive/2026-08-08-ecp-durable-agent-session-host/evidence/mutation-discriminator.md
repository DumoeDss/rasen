# Request-id tombstone mutation discriminator

## Why this evidence exists

The implementation session was interrupted after most production code and tests
already existed, so a truthful historical pre-implementation RED transcript was
not available. No retroactive RED is claimed. Instead, on 2026-08-04 the
implementer ran a reversible production mutation against the safety property
that a pruned terminal request id must never cause a second stdin write.

## Mutation and observed failure

Temporary mutation in `src/core/session-host/registry.ts`:

```ts
export function prunedRequestIdMayExist(/* ... */): boolean {
  if (!record.prunedRequestFilter) return false;
  return false;
}
```

Command:

```text
pnpm exec vitest run test/core/session-host/host.test.ts \
  -t "pruned terminal request id" --maxWorkers=1 --minWorkers=1
```

The command failed exactly one selected test. Expected was
`{ ok: false, code: "turn-outcome-unknown" }`; the mutated implementation
instead returned `{ ok: true }`, proving that the test detects acceptance and
execution of a request id whose detailed terminal record was pruned.

## Restoration and green result

The Bloom-filter membership check was immediately restored with `apply_patch`:

```ts
return bloomIndexes(requestId).every(
  (bit) => (bits[bit >> 3] & (1 << (bit & 7))) !== 0
);
```

The identical focused command then passed 1/1. The mutation is not present in
the retained worktree. Bloom hits are safe refusals (including possible false
positives); terminal ids added to the filter have no false negatives.
