/**
 * Retention policy — the single closed machine value a profile resolves to for
 * the `rasen-retain` stage.
 *
 * - `off`    — no retention output; learned-skill state is left unchanged.
 * - `report` — preserve retrospective reporting (the former `retro` behavior).
 * - `codify` — evaluate a completed change for managed learned-skill creation,
 *              rewrite, retirement, or a successful no-op.
 *
 * `report` and `codify` are mutually exclusive within one automated run — a
 * profile carries exactly one retention mode, never a combination.
 *
 * This module is intentionally dependency-free so the profile schema
 * (`named-profiles.ts`), the global config type (`global-config.ts`), the
 * config-key registry, and the effective-config resolver can all import it
 * without an import cycle.
 */

export const RETENTION_MODES = ['off', 'report', 'codify'] as const;

export type RetentionMode = (typeof RETENTION_MODES)[number];

/**
 * Retention when a profile carries no explicit value — a new user, a `custom`
 * selection, or a v1 profile without `retro-command`. Coupled to the "new user
 * behaves as core" default: `core` resolves to `off`.
 */
export const DEFAULT_RETENTION_MODE: RetentionMode = 'off';

/**
 * The retired retro workflow id that v1→v2 profile normalization strips. Its
 * presence in a v1 `workflows` selection maps to retention `report`; its
 * absence maps to `off` (see {@link resolveMigratedRetention}). Kept as a named
 * constant so migration never matches by prefix or substring.
 */
export const RETIRED_RETRO_WORKFLOW_ID = 'retro-command';

export function isRetentionMode(value: unknown): value is RetentionMode {
  return typeof value === 'string' && (RETENTION_MODES as readonly string[]).includes(value);
}

/**
 * The retention a built-in profile resolves to when it is applied: `full` →
 * `report`, `core` → `off`. Any other profile (custom or a saved name) has no
 * built-in retention default and resolves to {@link DEFAULT_RETENTION_MODE}.
 * This coupling is applied at profile-application time (the value is then
 * persisted), never re-derived on every read.
 */
export function builtInProfileRetention(profile: string): RetentionMode {
  return profile === 'full' ? 'report' : DEFAULT_RETENTION_MODE;
}

/**
 * The retention a v1 selection migrates to: `report` when it contained the
 * retired `retro-command`, `off` otherwise. Shared by current-config migration
 * and named-profile v1 normalization so the two can never disagree.
 */
export function resolveMigratedRetention(workflows: readonly string[]): RetentionMode {
  return workflows.includes(RETIRED_RETRO_WORKFLOW_ID) ? 'report' : DEFAULT_RETENTION_MODE;
}
