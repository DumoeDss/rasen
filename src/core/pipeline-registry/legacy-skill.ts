/**
 * Legacy skill-ID recognition for pipeline resume.
 *
 * The rebrand collapsed the upstream/legacy skill namespace onto `rasen`:
 *   openspec-opsx-<x>  ->  rasen-<x>   (double-prefix collapse)
 *   openspec-<x>       ->  rasen-<x>
 *   openspec:<x>       ->  rasen:<x>
 *
 * Package-bundled pipelines were swept to the new IDs in the same change, but a
 * project-local (`rasen/pipelines/`) or user-override pipeline authored before
 * the rebrand can still reference a legacy skill ID. When `pipeline resume`
 * loads such a pipeline, this maps the stale ID to its new form so the resumer
 * can print an actionable old->new hint instead of silently dispatching an ID
 * no installed skill answers to.
 */

const LEGACY_SKILL_PREFIX = 'openspec-';
const LEGACY_DOUBLE_PREFIX = 'openspec-opsx-';
const LEGACY_SKILL_NAMESPACE = 'openspec:';
const NEW_SKILL_PREFIX = 'rasen-';
const NEW_SKILL_NAMESPACE = 'rasen:';

/**
 * Returns the new (`rasen`-namespaced) skill ID for a legacy skill ID, or null
 * when the ID carries no legacy brand token (already migrated or unrelated).
 */
export function mapLegacySkillId(skillId: string): string | null {
  if (skillId.startsWith(LEGACY_DOUBLE_PREFIX)) {
    return NEW_SKILL_PREFIX + skillId.slice(LEGACY_DOUBLE_PREFIX.length);
  }
  if (skillId.startsWith(LEGACY_SKILL_PREFIX)) {
    return NEW_SKILL_PREFIX + skillId.slice(LEGACY_SKILL_PREFIX.length);
  }
  if (skillId.startsWith(LEGACY_SKILL_NAMESPACE)) {
    return NEW_SKILL_NAMESPACE + skillId.slice(LEGACY_SKILL_NAMESPACE.length);
  }
  return null;
}
