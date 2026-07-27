## Context

The management UI already has a complete Editorial token layer and a
test-only CRT variant in `packages/ui/src/style.css`. `ThemeToggle.tsx` writes a
`warm | crt` value to localStorage and stamps `data-theme-variant`; `main.tsx`
reads it before render. This proves live token switching but makes the choice
browser-local, exposes a test affordance as the only selector, and hard-codes
theme content into the stylesheet.

Configuration is registry-driven and the global schema already has a
passthrough `ui` block containing `pinnedSpaces`. The management server is
loopback-only and bearer-authenticated, and the Audit surface demonstrates a
browser file-picker/upload interaction. Theme work crosses the root CLI/server
package and the independently built static UI package, so the manifest boundary
must remain explicit and testable on both sides.

## Goals / Non-Goals

**Goals:**

- Make one machine-wide theme choice available under Config > General >
  Appearance and apply it before the first application frame.
- Express Editorial, CRT, and imported themes through one versioned,
  declarative model whose extensibility is limited to stable tokens and named
  effects.
- Validate before writing, install atomically beneath the resolved machine data
  root, and recover to Editorial without making Config unavailable.
- Preserve Editorial and CRT's current appearance closely, including system
  light/dark behavior for Editorial and CRT's small set of structural effects.
- Keep theme selection/import reachable through authenticated local APIs and
  fully localized in English, Simplified Chinese, and Japanese.

**Non-Goals:**

- Arbitrary CSS, selectors, declarations, scripts, imports, remote URLs,
  images, webfonts, or theme-provided component markup.
- Making internal component class names or DOM structure part of the theme API.
- Per-project, per-store, per-browser, or per-route themes.
- A theme marketplace, remote download, deletion, in-place replacement,
  editor, preview sandbox, or automatic migration of the old test localStorage
  value.
- Changing the independently released UI package relationship or adding a
  runtime styling dependency.

## Decisions

### D1. Use a closed, version-1 JSON manifest and normalize over Editorial

The manifest envelope is:

```json
{
  "schemaVersion": 1,
  "id": "example-theme",
  "name": "Example Theme",
  "description": "Optional short text",
  "mode": "adaptive",
  "tokens": {
    "light": {},
    "dark": {}
  },
  "effects": []
}
```

`id` is lowercase ASCII matching `[a-z][a-z0-9-]{0,63}`; names and
descriptions have bounded lengths. `mode` is `adaptive`, `light`, or `dark`.
Adaptive manifests may provide light and dark overrides; fixed manifests
provide the matching set. Token sets are partial overrides normalized over the
corresponding Editorial baseline, so every applied theme is complete and
switching never inherits from the previous selection. Unknown envelope fields,
token keys, effects, and schema versions are errors rather than silently
ignored.

A single explicit `THEME_TOKEN_DEFINITIONS` lookup defines the supported
semantic keys, destination variables, and validators. Version 1 covers:

- semantic colors (canvas/surfaces, text, borders, accent, focus, and status
  roles) as hex RGB/RGBA values;
- heading, body, and monospace families as named bundled system-stack choices,
  never author-provided font-family text;
- bounded numeric type sizes and radii; and
- elevation as an app-owned named preset (`flat`, `ring`, or `soft`).

Spacing, images, gradients, raw shadows, transition/easing strings, SVG/data
URLs, and arbitrary CSS values are not author-controlled. The initial effect
allow-list is `scanlines`, `uppercase-headings`, `terminal-navigation`, and
`uppercase-metadata`. Each is implemented by Rasen-owned CSS keyed from
explicit root attributes. Editorial and CRT are checked-in JSON manifests under
the UI package and pass the same UI validator used for imported data.

This closed typed model is chosen over JSON fields containing CSS custom
property values because even a nominal token API would otherwise admit remote
resources and CSS grammar. Normalizing partial tokens over Editorial keeps
authoring approachable without making previous-theme residue or component
selectors part of the contract.

### D2. Put persistence and trust enforcement behind a root theme-library module

A root deep module owns `validateThemeManifest`, `listImportedThemes`,
`installTheme`, and `resolveThemesDir`. It uses the existing machine-data-root
resolver and native `path.join`/`path.resolve` operations. User manifests live
as direct `<id>.json` files under `<machine-data-root>/themes`; lowercase IDs
and case-insensitive collision checks make the library portable across Windows,
macOS, and Linux.

Import is capped at 256 KiB. The module parses and fully validates in memory,
writes normalized JSON to a uniquely named temporary file in the target
directory, syncs/closes it, and renames it to the final path only when that path
does not already exist. Built-in IDs and any existing imported ID are reserved,
so implementation never needs a cross-platform overwrite sequence. Failure
removes the known temporary file and leaves configuration untouched. Listing
reads only direct regular `.json` files, rejects symlinks and invalid content,
and reports skipped entries as diagnostics rather than breaking the catalog.

This module is chosen over letting the browser name a destination or write a
file because the server must own containment, collision, size, and atomicity.
Rejecting replacement is chosen over platform-specific overwrite semantics;
updates can be designed later with an explicit version/removal flow.

### D3. Merge bundled built-ins with freshly listed imported manifests

The static UI package owns the Editorial fallback and the two built-in JSON
assets, which keeps the app renderable when the API is unavailable. The root
theme library owns validation and storage for user imports. `GET /api/v1/themes`
returns freshly validated imported manifests plus skipped-entry diagnostics;
the UI theme service validates the wire data again and merges it with its
explicit built-in list (`editorial`, `crt`). Built-ins win any identifier
collision.

The server and UI keep small parallel decoders because the UI package must stay
self-contained. Shared contract fixtures and tests run both decoders against
the built-in manifests and accepted/rejected cases to prevent drift. This is
preferred to importing root source into `packages/ui` or making the root
package depend on optional UI assets, either of which would violate the package
boundary.

### D4. Add exact authenticated theme routes

The management router admits `GET /api/v1/themes` and
`POST /api/v1/themes/import` at exact depth with the established loopback bind,
bearer token, identity headers, trailing-slash handling, and error envelope.
The import body is `application/json`; request streaming enforces the 256 KiB
cap before parse. The server passes bytes to the theme-library module and maps
validation, conflict, size, and persistence failures to stable error codes.
There is no endpoint that accepts a path, CSS, URL, or arbitrary destination.

The theme catalog/import routes are separate from generic config endpoints:
`ui.theme` continues to round-trip through the registry-driven config API,
while library mutation has distinct validation and storage semantics.

### D5. Store only the stable theme ID in global config

The additive global field is `ui.theme`, defaulting to `editorial`. Its registry
entry is a global-only Appearance string with the same portable-ID syntax as
the manifest. Registry validation deliberately checks syntax, not current
availability: a missing imported file or a hand-edited future value remains
observable and recoverable instead of causing global config loading to fail.
Availability is resolved by the theme service.

The selector is a custom renderer for `ui.theme`, analogous to other
UI-managed special keys: its options come from the theme catalog rather than a
static registry enum. Writes still use the generic config API and its global
scope. Store/project writes remain invalid.

This keeps configuration stable and small and avoids embedding theme content or
a mutable dynamic enum in config metadata.

### D6. Apply Editorial synchronously, then resolve the configured theme before render

The UI theme runtime exposes a small boundary:
`initializeTheme()`, `getThemeCatalog()`, and `activateTheme(manifest)`.
Startup applies bundled Editorial synchronously, then concurrently reads the
effective global `ui.theme` and imported catalog. It uses the existing launch
space fallback for the config read. After validating and resolving the selected
manifest, it clears all theme-owned root properties/effect attributes, applies
the normalized light/dark token sets through the explicit token map, and only
then mounts the application.

Startup requests use an abort timeout so server or decoding failures cannot
hold a blank page indefinitely. Every failure path keeps Editorial active and
allows rendering to continue. A media-query listener re-applies adaptive themes
when system color preference changes. Fixed light/dark themes set the root
color-scheme explicitly.

Awaiting initialization is preferred to rendering and patching later because it
prevents a visible Editorial-to-selected-theme flash. Bundled Editorial is
preferred to an empty/un-themed fallback because it also covers total API
failure.

### D7. Replace the corner toggle with a Global-mode theme control

Config dispatches the `ui.theme` row to a theme-specific control in General >
Appearance. It displays built-in and valid imported metadata, retains an
unavailable configured ID as a marked current option, and offers a JSON file
picker. Import success refreshes the catalog but does not select the new theme;
selection is a separate deliberate action. On successful config write, the
control resolves and activates the selected manifest immediately. Write or
activation failure surfaces an inline error and falls back to Editorial without
inventing another saved value.

`ThemeToggle`, its layout mount, test-only CSS, and all reads/writes of
`rasen-ui-theme-variant` are removed. The stale localStorage entry is ignored,
not migrated or used as precedence.

### D8. Localize by stable error category, not server prose

All labels, metadata for built-ins, states, warnings, and recovery guidance use
UI catalog keys. The API returns stable error codes plus field paths/details;
the UI maps those categories to English, Simplified Chinese, and Japanese
messages. Theme state stores codes/details so changing `language` re-renders an
already-visible error instead of retaining prose from the previous language.
Unknown codes use the existing English fallback and a generic safe message.

## Risks / Trade-offs

- [Parallel validators drift across the package boundary] → Keep the manifest
  grammar small, centralize each decoder locally, and run shared accepted and
  rejected contract fixtures plus both built-in manifests through both.
- [A bad token combination can reduce readability even when syntactically safe]
  → Validate bounded types and required contrast-critical roles, keep Editorial
  as immediate fallback, and leave richer accessibility scoring to a later
  change.
- [Startup waits on local API reads] → Apply Editorial synchronously, fetch in
  parallel, abort after a short bound, and always render on failure.
- [Imported files can be hand-edited or corrupted after installation] → Re-read
  and validate on every catalog request, skip invalid entries with diagnostics,
  and make activation independently validate.
- [Partial manifests inherit Editorial choices] → Treat that baseline as part
  of schema version 1 and require a future schema version for incompatible token
  semantics.
- [No replacement/deletion makes iteration less convenient] → Preserve simple
  atomic cross-platform semantics now; authors can use a new ID, while explicit
  lifecycle operations remain a future feature.

## Migration Plan

1. Add the manifest validators, built-in JSON assets, user-library module, and
   authenticated routes without changing current activation.
2. Add `ui.theme` to global config and the registry with the default
   `editorial`; older configs load without a rewrite.
3. Add UI catalog/runtime bootstrap and theme-specific Config control, then
   convert the existing Editorial/CRT CSS into token baselines and named
   application-owned effects.
4. Remove `ThemeToggle`, its layout/styles, and the localStorage startup path.
   Existing `rasen-ui-theme-variant` values are ignored; users explicitly choose
   CRT through Config if desired.
5. Rollback removes the new UI/route behavior while old binaries continue to
   preserve the unknown passthrough `ui.theme` field. Imported JSON files remain
   inert user data and need not be deleted.

## Open Questions

None for this change. Theme replacement/deletion, author tooling, previews, and
additional manifest versions are deliberately deferred.
