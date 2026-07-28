# Tasks — keepalive-single-preset

> Spec-only catch-up: the keepalive Fast (100s) preset was retired in `ui-i18n` (PR #59); this aligns the `pipelines-ui` spec with the single-preset reality. No code, no tests.

- [x] 1. Delta spec `specs/pipelines-ui/spec.md`: MODIFIED *"The Defaults section offers a keepalive beat control"* — one built-in preset (270s economy); updated the *"Preset writes the key"* scenario (270s economy, not 100s fast); other scenarios (custom / out-of-range / hint) carried over unchanged.
- [ ] 2. `rasen validate keepalive-single-preset` passes — the MODIFIED title matches the main spec exactly (a title drift would pass validate but bomb at archive spec-sync).
- [ ] 3. Archive (syncs the MODIFIED requirement into `rasen/specs/pipelines-ui/spec.md`) + commit narrow footprint + push to dev/0.1.5.
