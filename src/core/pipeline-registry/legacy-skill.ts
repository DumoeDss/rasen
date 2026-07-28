/**
 * Legacy skill-ID recognition for pipeline resume.
 *
 * Every skill now carries a single hyphen identity (`rasen-<x>`, name == dirName).
 * Two earlier naming eras still surface in project-local (`rasen/pipelines/`) or
 * user-override pipelines authored before their respective sweeps:
 *   openspec-opsx-<x>  ->  rasen-<x>   (double-prefix collapse)
 *   openspec-<x>       ->  rasen-<x>
 *   openspec:<x>       ->  rasen-<x>   (upstream colon namespace)
 *   rasen:<x>          ->  rasen-<x>   (retired colon namespace, commands era)
 *
 * Package-bundled pipelines were swept to the hyphen IDs in the same change, but
 * when `pipeline resume` loads a pre-sweep pipeline this maps the stale ID to its
 * current form so the resumer can print an actionable old->new hint instead of
 * silently dispatching an ID no installed skill answers to.
 */

const LEGACY_SKILL_PREFIX = 'openspec-';
const LEGACY_DOUBLE_PREFIX = 'openspec-opsx-';
const LEGACY_OPENSPEC_NAMESPACE = 'openspec:';
const LEGACY_RASEN_NAMESPACE = 'rasen:';
const NEW_SKILL_PREFIX = 'rasen-';

/**
 * Returns the current (`rasen-`) skill ID for a legacy skill ID, or null when
 * the ID carries no legacy brand token (already migrated or unrelated).
 */
export function mapLegacySkillId(skillId: string): string | null {
  if (skillId.startsWith(LEGACY_DOUBLE_PREFIX)) {
    return NEW_SKILL_PREFIX + skillId.slice(LEGACY_DOUBLE_PREFIX.length);
  }
  if (skillId.startsWith(LEGACY_SKILL_PREFIX)) {
    return NEW_SKILL_PREFIX + skillId.slice(LEGACY_SKILL_PREFIX.length);
  }
  if (skillId.startsWith(LEGACY_OPENSPEC_NAMESPACE)) {
    return NEW_SKILL_PREFIX + skillId.slice(LEGACY_OPENSPEC_NAMESPACE.length);
  }
  if (skillId.startsWith(LEGACY_RASEN_NAMESPACE)) {
    return NEW_SKILL_PREFIX + skillId.slice(LEGACY_RASEN_NAMESPACE.length);
  }
  return null;
}
