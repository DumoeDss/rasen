## Why

The keepalive **Fast (100s) beat preset** was retired in `ui-i18n` (PR #59): the UI's `KeepaliveBeatControl` now offers a single **Economy (270s)** preset. The `pipelines-ui` spec still documents *two* presets (100s fast + 270s economy), so it no longer matches the shipped behavior. This change catches the spec up — spec-only, no code.

## What Changes

- **MODIFIED** the `pipelines-ui` requirement *"The Defaults section offers a keepalive beat control"*: the control offers **one** built-in preset (270s economy), not two. The *"Preset writes the key"* scenario is updated accordingly (activating the 270s economy preset, not the retired 100s fast one). The other scenarios (custom value, out-of-range rejection, informational hint) are unchanged.

## Capabilities

### Modified Capabilities

- `pipelines-ui`: the keepalive beat control requirement reflects the single-preset reality shipped in PR #59.

## Impact

- **Spec-only.** No code change (the code already ships one preset). No tests affected. The MODIFIED requirement keeps its exact title so archive spec-sync replaces it cleanly.
