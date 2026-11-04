# Review round 2 fix

Finding: Blocker — a non-enumerable `authority-unavailable` discriminator could bypass the enumerable-key gate and be accepted as a prepared authority.

Resolution:

- Added a focused mutation with a non-enumerable unavailable discriminator, valid provider reference, and callable activation function.
- Confirmed RED: the coordinator returned `prepared-inert`, so publication and activation remained reachable.
- Changed the unified snapshot to read `state` once for every object before prepared parsing. A captured unavailable discriminator must still have the exact enumerable `diagnostic` and `state` keys; non-enumerable and inherited variants are invalid and cannot fall through.
- Confirmed GREEN: focused + shared common conformance 51/51; combined supporting and real Linux conformance 79/79; established common process-authority 176/176; no-emit TypeScript, path ESLint, build, and strict Change validation pass.

No Linux provider file was modified by this fix.
