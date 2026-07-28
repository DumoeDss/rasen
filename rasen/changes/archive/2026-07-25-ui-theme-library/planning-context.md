# Planning context: UI theme library

## User intent

The user requested a small product update that promotes the existing test-only UI
theme switcher into a supported feature:

1. Add a global theme selector under Config > Global > General.
2. Replace hard-coded theme variants with loadable theme files.
3. Let users import themes they create themselves.
4. Use the agreed architecture: **versioned JSON + design tokens + allow-listed
   effects**, explicitly not arbitrary CSS.

The current right-bottom test toggle should no longer be the product-facing
selection mechanism.

## Decisions already made

- Theme manifests are versioned JSON and validated before installation.
- Theme styling is expressed through stable design tokens.
- Non-token behavior is limited to a fixed allow-list of declarative effects,
  sufficient to preserve the existing CRT identity (for example scanlines and
  uppercase headings).
- Arbitrary selectors, declarations, remote URLs, imports, scripts, and raw CSS
  are outside the supported theme format.
- Built-in Editorial and CRT themes use the same manifest model as imported
  themes.
- The active theme is a machine-wide/global UI preference shown on the General
  tab.
- Import must validate first, install atomically into user-owned Rasen data, and
  leave the current theme unchanged on failure.
- Invalid, missing, or incompatible configured themes fall back safely to the
  default built-in theme without preventing the Config page from loading.

## Existing code findings

- `packages/ui/src/components/ThemeToggle.tsx` owns the test toggle, a
  `warm | crt` union, localStorage persistence, and the root
  `data-theme-variant` attribute.
- `packages/ui/src/main.tsx` applies the localStorage choice before rendering to
  avoid a flash.
- `packages/ui/src/style.css` defines the Editorial tokens in `:root`; the CRT
  block starts at `:root[data-theme-variant="crt"]`, mainly overrides tokens,
  and adds a small set of structural effects such as scanlines, uppercase
  headings, and compact terminal-style navigation.
- The configuration UI is registry-driven. `language` already demonstrates a
  global-only Appearance entry rendered in Config > General.
- Global config supports an additive `ui` block and already stores
  `ui.pinnedSpaces`; schemas use passthrough for forward compatibility.
- The management server binds to `127.0.0.1` and uses an in-memory bearer token,
  but static responses currently have no CSP. The token is scrubbed from the URL
  and never enters local/session storage.
- The Audit page already demonstrates a browser file picker and upload flow that
  can inform the theme-import interaction.

## Product and engineering constraints

- Do not accept or inject arbitrary CSS.
- Preserve existing built-in visual appearance as closely as possible.
- Theme import and selection must be localized consistently with the existing
  English, Chinese, and Japanese UI catalogs.
- Theme configuration must survive browser changes because it is global Rasen
  config, not browser localStorage.
- Avoid making internal component class names a public theme API.
- Theme activation must happen early enough to avoid a visible flash, while
  retaining a safe fallback path.
- Tests should cover schema validation, storage/import behavior, config registry
  round-trips, initial activation, live switching, failure fallback, and the
  Config UI interaction.

## Run setup

- Worktree:
  `E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\OpenSpec-code-ui-theme-import`
- Branch: `feat/ui-theme-import`
- Pipeline: `small-feature`
- Gate policy: `off` from global configuration.
- All role workers run as Codex subagents in this host.
- Ship and archive use model `gpt-5.6-luna` at medium reasoning effort.

## Durable planning decisions

- Version 1 theme IDs are lowercase portable ASCII identifiers; Editorial and
  CRT IDs are reserved, imports are capped at 256 KiB, and existing IDs are not
  replaced so atomic installation has consistent semantics on Windows, macOS,
  and Linux.
- Imported manifests are normalized over the Editorial baseline. Themeable
  values are closed, typed semantic colors, named bundled font stacks, bounded
  type/radius values, and named elevation presets; the initial effect allow-list
  is scanlines, uppercase headings, terminal navigation, and uppercase metadata.
- The static UI bundles Editorial/CRT and merges them with freshly validated
  user manifests from authenticated theme routes. The retired test
  localStorage value is ignored rather than migrated, and a successful import
  adds an option without changing the active theme.
