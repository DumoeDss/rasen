# Review round 1 fix

Finding: Major — an unavailable/prepared hybrid object could be accepted as prepared.

Resolution:

- Added a focused mutation carrying `state: authority-unavailable`, `diagnostic`, a valid provider reference, and a callable activation function.
- Confirmed RED: the coordinator returned `prepared-inert`.
- Replaced the sequential unavailable parser followed by prepared parser with one accessor-safe `snapshotProviderPreparation` discriminator.
- Once the single captured `state` is `authority-unavailable`, exact keys and bounded diagnostic are mandatory; failure returns invalid and cannot fall through to reference/activation capture.
- Added an alternating getter mutation proving the discriminator is captured once and cannot change before prepared parsing.
- Confirmed GREEN at the end of round 1: focused + shared 50/50; established common process-authority 175/175; no-emit TypeScript, path ESLint, build, and strict Change validation pass.

No Linux provider file was modified by this fix.
