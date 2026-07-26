# Direction Workflow Roadmap

## Now

### Active: `phase-1-skill`

Deliver and dogfood the opt-in built-in `rasen-direction` skill while keeping
ordinary Rasen work unchanged. The Slice remains open until its observable
contract, independent review, and delivery evidence are resolved.

## Later — Evidence-triggered, not precommitted phases

- Tighten prompt wording or artifact examples when real use exposes ambiguity.
- Propose structural validation only after repeated malformed-reference or
  invariant failures show a prompt-only guard is insufficient.
- Propose a read-only projection only after Git artifacts are useful but hard
  to inspect at realistic scale.

Each item requires its own evidence-backed proposal. Their ordering is not a
commitment.

## Not Now

- Direction CLI/domain model or stable manifest schema.
- Database, daemon scheduler, dashboard, or Roadmap UI.
- Mandatory Direction adoption, multiple active Slices, or automatic North
  Star mutation.

## Reconciliation Note

The current Result is `partial`: build, focused tests, parity, and isolated
generation evidence exist, while lint, the full suite, independent review, PR,
merge, and cross-platform CI evidence are not yet all available.
