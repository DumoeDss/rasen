/**
 * Human-readable labels for config keys (design D5). The registry has no label
 * field — adding one would widen the just-shipped wire surface for
 * presentation-only data — so this UI-local map turns each dot-path key into a
 * short, scannable title. A key missing from the map falls back to its own
 * dot-path (see {@link labelFor}), so a newly added registry key degrades
 * gracefully instead of rendering blank.
 */
const LABELS: Record<string, string> = {
  profile: 'Profile',
  workflows: 'Installed workflows',
  language: 'Language',
  featureFlags: 'Feature flags',
  proactive: 'Proactive suggestions',
  repoMode: 'Repository mode',
  'telemetry.enabled': 'Anonymous telemetry',
  schema: 'Change schema',
  'autopilot.gates': 'Autopilot gate policy',
  'autopilot.selection': 'Autopilot model selection',
  'archive.timing': 'Archive timing',
  'archive.destination': 'Archive destination',
  'handoff.threshold': 'Handoff threshold',
  'handoff.roles.planner': 'Handoff threshold · Planner',
  'handoff.roles.implementer': 'Handoff threshold · Implementer',
  'handoff.roles.reviewer': 'Handoff threshold · Reviewer',
  'handoff.roles.fixer': 'Handoff threshold · Fixer',
  'handoff.roles.shipper': 'Handoff threshold · Shipper',
  'models.default': 'Default model',
  'models.roles.planner': 'Model · Planner',
  'models.roles.implementer': 'Model · Implementer',
  'models.roles.reviewer': 'Model · Reviewer',
  'models.roles.fixer': 'Model · Fixer',
  'models.roles.shipper': 'Model · Shipper',
  'ui.pinnedSpaces': 'Pinned spaces',
};

/** The human label for a config key, or the dot-path itself when unmapped (graceful degradation, design D5). */
export function labelFor(key: string): string {
  return LABELS[key] ?? key;
}
