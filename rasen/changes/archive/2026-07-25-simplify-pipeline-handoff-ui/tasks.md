## 1. Simplify Pipelines configuration surfaces

- [x] 1.1 Remove the page-level `AdvancedOverrides` rendering and the Threshold Policy Workbench's legacy coexistence/migration link path without writing, deleting, or rewriting any stored legacy handoff value.
- [x] 1.2 Extend the existing Defaults → Keepalive lifecycle area to render the explicit runtime-gate and context-floor keys in Global mode with their existing registry-driven controls, validation, source badges, and unset behavior.
- [x] 1.3 Remove the per-pipeline Advanced stage threshold disclosure and `StageHandoffControl` while verifying Configure still exposes stage gate, stage model, and per-role runtime controls.
- [x] 1.4 Keep the Pipelines registry group excluded from generic Config, update its ownership comments/tests as needed, and verify no Pipelines-group key becomes unreachable after the keepalive move.

## 2. Add durable Canvas stage handoff authoring

- [x] 2.1 Add a pure nested draft helper that sets or clears `stage.handoff.threshold`, preserves unexposed `maxRelays`/`stallLimit`, and removes only a truly empty handoff block; cover all three behaviors in `canvas/draft` tests.
- [x] 2.2 Add the StagePanel's inherit/fraction/remaining-tokens handoff control using catalog-provided threshold constraints and valid form seeds, with field-level validation/issue styling consistent with the existing panel.
- [x] 2.3 Add Canvas integration tests proving both threshold forms mark the draft dirty, survive validate/save/reload as pipeline-definition data, and clearing the threshold preserves other handoff fields without invoking config-key writes.
- [x] 2.4 Verify built-in pipelines remain read-only and require the existing Duplicate flow before a stage handoff definition can be edited.

## 3. Align presentation and localization

- [x] 3.1 Remove obsolete Advanced Overrides, stage-instance, and migration locale keys; revise Defaults/Keepalive copy and add any Canvas handoff copy in English, Japanese, and Simplified Chinese with catalog-parity coverage.
- [x] 3.2 Remove styles used only by the deleted page/stage Advanced surfaces and migration notice, then add compact responsive styles for the rehomed lifecycle rows and Canvas handoff field.
- [x] 3.3 Update live locale-switch tests so the visible Keepalive lifecycle and Canvas handoff labels change without remounting.

## 4. Regression coverage and verification

- [x] 4.1 Update Pipelines page tests to assert the Advanced surfaces and stage handoff instance controls are absent, lifecycle keys appear only in valid scope modes, and gate/model/runtime Configure controls still work.
- [x] 4.2 Run the focused UI component, Canvas draft, Canvas page, Config grouping, and i18n catalog tests, then run the UI package typecheck and build.
- [x] 4.3 Run the existing core stage-override and threshold-resolution tests to confirm legacy machine and per-stage handoff inputs still resolve unchanged.
- [x] 4.4 Validate the change artifacts and inspect the final diff for unrelated dirty-worktree overlap before handoff.
