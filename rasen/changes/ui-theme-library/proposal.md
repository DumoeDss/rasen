## Why

Rasen's Editorial/CRT switch is currently a browser-local test affordance rather
than a supported preference, so it cannot follow users across browsers or safely
accept themes they create. Promoting themes into global configuration creates a
durable product surface while keeping styling extensibility bounded and
predictable.

## What Changes

- Add a global-only theme preference under Config > General > Appearance, with
  live switching and early activation on later loads.
- Represent the built-in Editorial and CRT themes as versioned JSON manifests
  using stable design tokens and app-owned, allow-listed declarative effects.
- Add a theme catalog and authenticated import flow that validates a user theme
  before atomically installing it in the user's Rasen data directory.
- Fall back to the built-in Editorial theme when the configured theme is
  missing, invalid, incompatible, or cannot be loaded, without blocking the UI
  or changing the saved preference.
- Remove the fixed lower-corner test toggle and its browser-local persistence as
  the product-facing selection mechanism.
- Localize the theme selector, importer, metadata, success states, and errors in
  the English, Simplified Chinese, and Japanese UI catalogs.
- Reject raw CSS and any manifest content that could introduce arbitrary
  selectors, declarations, imports, scripts, or remote resources.

## Capabilities

### New Capabilities

- `ui-theme-library`: Defines the versioned theme-manifest contract, built-in
  and imported catalog, validation and atomic installation, activation, and safe
  fallback behavior.

### Modified Capabilities

- `global-config`: Adds the durable global `ui.theme` preference while
  preserving existing `ui` fields and forward compatibility.
- `config-key-registry`: Registers `ui.theme` as a global-only Appearance key
  with theme-id validation.
- `config-ui-package`: Replaces the test toggle with the supported General-tab
  selector/import experience and applies selected manifests before and during
  rendering.
- `management-http-api`: Admits authenticated, loopback-only theme catalog and
  import routes with bounded input and the standard error posture.
- `ui-i18n`: Extends complete UI catalog coverage to the theme selection and
  import experience in English, Simplified Chinese, and Japanese.

## Impact

- Affects global config schemas and types, the config-key registry, management
  HTTP routing, machine-data theme storage, and the management UI API client,
  startup, Config page, localization catalogs, and stylesheet token/effect
  rules.
- Replaces the `ThemeToggle`/localStorage startup path with API-backed global
  activation while preserving Editorial as the compatibility default.
- Adds schema, import/storage, routing, config round-trip, startup/fallback, live
  switching, localization, and Config interaction tests; no arbitrary CSS
  execution or new remote styling dependency is introduced.
