/**
 * Human-readable labels for config keys (design D5). The registry has no label
 * field — adding one would widen the just-shipped wire surface for
 * presentation-only data — so this UI-local map turns each dot-path key into a
 * short, scannable title. A key missing from the map falls back to its own
 * dot-path (see {@link labelFor}), so a newly added registry key degrades
 * gracefully instead of rendering blank.
 *
 * (ui-i18n) The label TEXT is now translated: each config key maps to an i18n
 * catalog key (`config.label.*`), and {@link labelFor} resolves it through the
 * locale store's current locale via `tNow`. This is the non-component read path
 * design D5 calls out — `labelFor` is called during a component's render (which
 * already re-renders on locale change via `useT`), so reading the module store
 * here returns the fresh locale. The map stays UI-local presentation data — the
 * registry is NOT widened.
 */
import { tNow } from '../i18n/store.js';

/** Config dot-path key → i18n catalog key for its human label. */
const LABEL_KEYS: Record<string, string> = {
  profile: 'config.label.profile',
  workflows: 'config.label.workflows',
  language: 'config.label.language',
  featureFlags: 'config.label.feature_flags',
  proactive: 'config.label.proactive',
  repoMode: 'config.label.repo_mode',
  'telemetry.enabled': 'config.label.telemetry_enabled',
  schema: 'config.label.schema',
  'autopilot.gates': 'config.label.autopilot_gates',
  'autopilot.selection': 'config.label.autopilot_selection',
  'archive.timing': 'config.label.archive_timing',
  'archive.destination': 'config.label.archive_destination',
  'handoff.threshold': 'config.label.handoff_threshold',
  'handoff.roles.planner': 'config.label.handoff_roles_planner',
  'handoff.roles.implementer': 'config.label.handoff_roles_implementer',
  'handoff.roles.reviewer': 'config.label.handoff_roles_reviewer',
  'handoff.roles.fixer': 'config.label.handoff_roles_fixer',
  'handoff.roles.shipper': 'config.label.handoff_roles_shipper',
  'models.default': 'config.label.models_default',
  'models.roles.planner': 'config.label.models_roles_planner',
  'models.roles.implementer': 'config.label.models_roles_implementer',
  'models.roles.reviewer': 'config.label.models_roles_reviewer',
  'models.roles.fixer': 'config.label.models_roles_fixer',
  'models.roles.shipper': 'config.label.models_roles_shipper',
  'ui.pinnedSpaces': 'config.label.ui_pinned_spaces',
};

/**
 * The human label for a config key in the current locale, or the dot-path
 * itself when unmapped (graceful degradation, design D5).
 */
export function labelFor(key: string): string {
  const catalogKey = LABEL_KEYS[key];
  return catalogKey ? tNow(catalogKey) : key;
}
