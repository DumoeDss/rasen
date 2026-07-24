/**
 * Temporary `rasen-retro` compatibility wrapper (design D1 / opsx-retro-command).
 *
 * The standalone, profile-selectable, model-invoked retro workflow is retired:
 * its behavior is the `report` branch of `rasen-retain`. This wrapper remains
 * for ONE migration window so a user who types `rasen-retro` still gets a
 * retrospective. It:
 *   - carries `disable-model-invocation: true` (user-invoked only), and
 *   - forces the `report` branch regardless of the active profile retention,
 *     forwarding the user's scope/change argument.
 *
 * It is NOT a selectable workflow definition: it does not appear in
 * `BUILT_IN_WORKFLOW_IDS`, participate in dependency closure, or receive a
 * catalog kind. init/update materialize and later retire it by its exact named
 * identity ({@link RETRO_COMPAT_WRAPPER_DIR_NAME}), never by a prefix scan.
 */
import type { SkillTemplate } from '../types.js';

/** Exact installed directory name of the compatibility wrapper (for materialization + retirement). */
export const RETRO_COMPAT_WRAPPER_DIR_NAME = 'rasen-retro';

const RETRO_WRAPPER_INSTRUCTIONS = `Temporary compatibility alias for \`rasen-retain\` **report** mode. Retro as a standalone workflow is retired; this wrapper exists only so \`rasen-retro\` keeps working during the migration window.

## Behavior

- Forward the user's scope/change argument unchanged:
  - \`rasen-retro <change-name>\` → change-scoped report
  - \`rasen-retro\` (no args) → prompt for change-scoped or general
  - \`rasen-retro global\` → global report
- Run **only** the report branch of \`rasen-retain\` (read its \`report.md\` sidecar), forcing \`report\` mode regardless of the active profile's retention mode.
- Do NOT create, update, promote, or retire a learned skill, and do NOT change the saved profile retention mode.

## Migration

Use profile retention \`report\` with \`rasen-retain\` for the canonical workflow. This alias is user-invoked only and will be removed after its announced migration window.`;

/**
 * The compatibility-wrapper skill template. Retains the historical export name
 * so init/update generation can reference it, but it now returns the
 * user-invoked, report-forcing wrapper rather than the retired workflow.
 */
export function getRetroCommandSkillTemplate(): SkillTemplate {
  return {
    name: RETRO_COMPAT_WRAPPER_DIR_NAME,
    description:
      'Temporary compatibility alias for rasen-retain report mode (user-invoked only).',
    instructions: RETRO_WRAPPER_INSTRUCTIONS,
    disableModelInvocation: true,
    license: 'MIT',
    compatibility: 'Requires rasen CLI.',
    metadata: { author: 'rasen', version: '1.0' },
  };
}
