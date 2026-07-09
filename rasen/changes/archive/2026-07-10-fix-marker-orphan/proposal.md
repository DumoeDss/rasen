## Why

`fix-brand-residuals` (archived 2026-07-10) taught the shell-completion installers to recognize a pre-existing legacy `OPENSPEC` marker block alongside the current `RASEN` one, so upgrades and uninstalls keep working for users who installed under the old brand. Every recognition site does this by finding the first matching family and stopping there. When a profile ends up with a block under **both** families at once (e.g. a partial or interrupted upgrade, or a manual edit), reconfigure and uninstall only ever touch the first one found and silently leave the other behind forever — an orphaned block that no future `rasen completion` command will ever clean up.

## What Changes

- Fix `src/utils/file-system.ts`'s `updateFileWithMarkers()` (bash/zsh reconfigure path) so that when a profile contains recognized blocks under more than one marker family, it replaces the first one in place with fresh `RASEN`-branded content and removes every other recognized block, instead of only acting on whichever family it happens to find first.
- Fix `bash-installer.ts`'s and `zsh-installer.ts`'s uninstall paths (`removeBashrcConfig()` / `removeZshrcConfig()`, currently each pick one preferred family via a private `resolvePresentMarkers()`) to remove every recognized marker-family block present, not just one.
- Fix `powershell-installer.ts`'s `findManagedBlockRange()` — used by both `configureProfile()` and `removeProfileConfig()` — so it discovers every recognized block across both families instead of returning on the first match; reconfigure dedupes to one block, uninstall removes all of them.
- Add regression coverage per installer for the both-families-present case on both reconfigure and uninstall.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `rasen-cli-identity`: adds a requirement making explicit that shell-completion installers leave no orphaned marker block behind when a profile contains managed blocks under more than one recognized marker family — reconfigure dedupes to exactly one block, uninstall removes all of them.

## Impact

- `src/utils/file-system.ts` — `updateFileWithMarkers()` gains multi-block-aware search/dedupe; adds a new exported helper for finding every recognized marker block in a string.
- `src/core/completions/installers/bash-installer.ts`, `zsh-installer.ts` — uninstall paths generalized to remove every present marker family, not just one.
- `src/core/completions/installers/powershell-installer.ts` — `findManagedBlockRange()` replaced with multi-block discovery; `configureProfile()` and `removeProfileConfig()` updated to dedupe / remove-all respectively.
- `test/core/completions/installers/{bash,zsh,powershell}-installer.test.ts` — new both-families-present regression cases for reconfigure and uninstall.
- `rasen/specs/rasen-cli-identity/spec.md` — one added requirement with two scenarios.
- No change to the single-block fresh-install, upgrade, or uninstall behavior already covered by `fix-brand-residuals` — those paths and their existing tests are unaffected.
