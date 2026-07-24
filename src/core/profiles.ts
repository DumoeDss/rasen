/**
 * Profile System
 *
 * Defines workflow profiles that control which workflows are installed.
 * Skills are the only delivery format — profiles determine which workflows
 * install, not how.
 */

import type { ConfigDiagnostic } from './config-diagnostics.js';
import type { Profile } from './global-config.js';
// NOTE: named-profiles.ts imports constants from this module, so this is an
// import cycle. It is ESM-safe: neither module dereferences the other's
// bindings during module evaluation (all cross-references happen inside
// functions called at runtime).
import { readNamedProfile } from './named-profiles.js';
import { readProjectConfig } from './project-config.js';
import {
  BUILT_IN_WORKFLOW_IDS,
  CORE_WORKFLOW_IDS,
  RETENTION_RUNNER_WORKFLOW_ID,
  filterKnownWorkflowRoots,
  getBuiltInWorkflowDefinitions,
  getExpertSkillDefinitions,
  resolveWorkflowSelection,
  WorkflowCatalog,
  type BuiltInWorkflowId,
} from './workflow-registry/index.js';

/**
 * Core workflows included in the 'core' profile.
 * These provide the streamlined experience for new users.
 */
export const CORE_WORKFLOWS = CORE_WORKFLOW_IDS;

/**
 * All available workflows in the system.
 */
export const ALL_WORKFLOWS = BUILT_IN_WORKFLOW_IDS;

export type WorkflowId = BuiltInWorkflowId;
export type CoreWorkflowId = (typeof CORE_WORKFLOWS)[number];

/** Every built-in expert id (the `full` profile's default expert set). */
export const ALL_EXPERTS: readonly string[] = getExpertSkillDefinitions().map(
  (expert) => expert.id
);

/**
 * The six quality-floor experts the built-in pipelines fan out to
 * (`full-feature` dispatches all six; `benchmark` is floor-only-by-profile
 * since no workflow's `requires.skills` names it, so closure alone would
 * never install it). This is the `core` profile's default expert set.
 */
export const QUALITY_FLOOR_EXPERTS: readonly string[] = [
  'review',
  'cso',
  'qa',
  'qa-only',
  'benchmark',
  'design-review',
];

/**
 * The current built-in *workflow* ids — catalog entries with
 * `source === 'built-in'` and `kind !== 'expert'` (experts are a disjoint id
 * space, tracked by their own migration marker). This is the source of truth
 * for `GlobalConfig.knownBuiltInWorkflows`: the baseline written when a
 * selection is persisted, and the set `update` diffs against that baseline to
 * surface a genuinely new built-in workflow.
 */
export function getCurrentBuiltInWorkflowIds(): string[] {
  return getBuiltInWorkflowDefinitions()
    .filter(
      (definition) =>
        definition.source === 'built-in' &&
        definition.kind !== 'expert' &&
        // The retention runner is internal and non-selectable — never part of
        // the selectable-workflow baseline.
        definition.id !== RETENTION_RUNNER_WORKFLOW_ID
    )
    .map((definition) => definition.id);
}

export interface GetProfileWorkflowsOptions {
  /**
   * Machine-managed migration marker (`GlobalConfig.expertSelectionExplicit`).
   * `false`/absent (legacy — never explicitly re-selected through the
   * flipped picker): the expert dimension resolves to `ALL_EXPERTS`,
   * profile-independent, so every existing install keeps all 21 experts.
   * `true`: the profile's default expert set (below) governs.
   */
  expertSelectionExplicit?: boolean;
}

/**
 * Resolves which workflows AND experts should be active for a given profile
 * configuration. Workflow ids and expert ids share one id space in the
 * returned array (D1: unified storage, no parallel `config.experts` field).
 *
 * - 'full' profile always returns ALL_WORKFLOWS (+ ALL_EXPERTS once explicit)
 * - 'core' profile always returns CORE_WORKFLOWS (+ QUALITY_FLOOR_EXPERTS once explicit)
 * - 'custom' profile returns the provided customWorkflows verbatim (already
 *   includes whatever expert ids the user selected)
 *
 * Until `options.expertSelectionExplicit` is `true`, the expert dimension is
 * profile-independent (`ALL_EXPERTS` always) — the non-regressive migration
 * guarantee (design.md D4): an existing install never silently loses an
 * expert on the first `update` after this behavior lands.
 */
export function getProfileWorkflows(
  profile: Profile,
  customWorkflows?: string[],
  options: GetProfileWorkflowsOptions = {}
): readonly string[] {
  if (profile === 'custom') {
    const workflows = customWorkflows ?? [];
    if (options.expertSelectionExplicit) return workflows;
    return [...new Set([...workflows, ...ALL_EXPERTS])];
  }
  if (profile === 'core') {
    return options.expertSelectionExplicit
      ? [...CORE_WORKFLOWS, ...QUALITY_FLOOR_EXPERTS]
      : [...CORE_WORKFLOWS, ...ALL_EXPERTS];
  }
  return [...ALL_WORKFLOWS, ...ALL_EXPERTS];
}

export interface ResolveDesiredWorkflowSelectionResult {
  /** Fully resolved install-set ids (workflows + experts), in catalog order. */
  ids: string[];
  /** Stored ids the catalog no longer recognizes (e.g. a retired built-in). */
  unknown: string[];
  /**
   * Present when the user-wide profile named a saved profile that could not be
   * resolved on this machine, so resolution fell back to the `full` profile.
   * Callers (update, init) print it as a diagnostic; resolution never writes.
   */
  profileWarning?: UserWideProfileWarning;
}

/**
 * Why the user-wide (global) profile could not govern resolution: it names a
 * saved profile whose definition is missing or invalid on this machine.
 * Mirrors the `unresolvable` shape of {@link ProfileLockWarning}; resolution
 * falls back to the default `full` profile and carries this on the result.
 */
export type UserWideProfileWarning = { kind: 'unresolvable'; profile: string; detail: string };

/**
 * The un-expanded base workflow list the user-wide `profile` setting denotes,
 * the global-scope analogue of {@link resolveLockedProfileBase}: `full`,
 * `core`, and `custom` behave exactly as before (via `getProfileWorkflows`,
 * with `custom` reading the global `workflows` list); any other string reads
 * the saved definition's stored ids verbatim. An unresolvable saved name
 * returns a warning — callers fall back to the default `full` profile, never a
 * hard error, mirroring the project-lock fallback so a machine missing a
 * profile file keeps working. Shared by `resolveDesiredWorkflowSelection` and
 * the management API's base-selection reads so none can disagree about what a
 * user-wide profile means.
 */
export function resolveUserWideProfileBase(
  profile: string,
  customWorkflows: string[] | undefined,
  expertSelectionExplicit: boolean
): { ok: true; workflows: string[] } | { ok: false; warning: UserWideProfileWarning } {
  if (profile === 'full' || profile === 'core' || profile === 'custom') {
    return {
      ok: true,
      workflows: [...getProfileWorkflows(profile, customWorkflows, { expertSelectionExplicit })],
    };
  }
  try {
    return { ok: true, workflows: [...readNamedProfile(profile).workflows] };
  } catch (error) {
    return {
      ok: false,
      warning: {
        kind: 'unresolvable',
        profile,
        detail: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

/**
 * The single desired-set resolver shared by `init` and `update` (design.md
 * D3): resolves the profile's default workflow+expert ids — through
 * {@link resolveUserWideProfileBase} so a saved profile name is first-class at
 * global scope (unresolvable → `full` with a warning on the result) — drops
 * any the catalog no longer recognizes, then closes over `requires.workflows`
 * AND (opt-in here) `requires.skills` so a lean profile still installs the
 * experts its selected workflows require. Threading one resolved array to
 * both the install path (`getSkillTemplates`) and the removal seam
 * (`removeUnselectedSkillDirs`/drift) keeps them from ever disagreeing.
 */
export function resolveDesiredWorkflowSelection(
  catalog: WorkflowCatalog,
  profile: string,
  customWorkflows: string[] | undefined,
  expertSelectionExplicit: boolean
): ResolveDesiredWorkflowSelectionResult {
  const baseResult = resolveUserWideProfileBase(profile, customWorkflows, expertSelectionExplicit);
  const base = baseResult.ok
    ? baseResult.workflows
    : [...getProfileWorkflows('full', undefined, { expertSelectionExplicit })];
  const { known, unknown } = filterKnownWorkflowRoots(catalog, base);
  const ids = resolveWorkflowSelection(catalog, known, { includeSkillDependencies: true }).map(
    (definition) => definition.id
  );
  return { ids, unknown, ...(baseResult.ok ? {} : { profileWarning: baseResult.warning }) };
}

/**
 * Why a project's `profile` lock could not govern resolution: shadowed by a
 * `workflows` override, pointing at the non-lockable `custom`, or naming a
 * definition that is missing or invalid on this machine. Carried on the
 * resolution result so callers (update, init) decide how to print it —
 * resolution itself never writes to the console.
 */
export type ProfileLockWarning =
  | { kind: 'shadowed-by-override'; profile: string }
  | { kind: 'custom-lock' }
  | { kind: 'unresolvable'; profile: string; detail: string };

/**
 * The un-expanded base workflow list a project's `profile` lock denotes
 * (init-profile-lock spec): a built-in lock resolves that profile's default
 * sets with the expert migration marker honored (design D3, non-regressive);
 * a named lock is the saved definition's stored ids verbatim. Shared by the
 * selection seam below, drift detection, and the management API's base-
 * selection read so none of them can disagree about what a lock means.
 */
export function resolveLockedProfileBase(
  lockedProfile: string,
  expertSelectionExplicit: boolean
):
  | { ok: true; workflows: string[] }
  | { ok: false; warning: Exclude<ProfileLockWarning, { kind: 'shadowed-by-override' }> } {
  if (lockedProfile === 'custom') {
    return { ok: false, warning: { kind: 'custom-lock' } };
  }
  if (lockedProfile === 'full' || lockedProfile === 'core') {
    return {
      ok: true,
      workflows: [...getProfileWorkflows(lockedProfile, undefined, { expertSelectionExplicit })],
    };
  }
  try {
    return { ok: true, workflows: [...readNamedProfile(lockedProfile).workflows] };
  } catch (error) {
    return {
      ok: false,
      warning: {
        kind: 'unresolvable',
        profile: lockedProfile,
        detail: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

/**
 * Maps a {@link ProfileLockWarning} to the localized config-diagnostic it is
 * reported as. Shared by `update` and `init` so both surface identical
 * messages for the same lock condition.
 */
export function profileLockWarningToDiagnostic(warning: ProfileLockWarning): ConfigDiagnostic {
  switch (warning.kind) {
    case 'shadowed-by-override':
      return {
        key: 'profileLockShadowedByOverride',
        values: { profile: warning.profile },
        fallback: `Note: the locked profile '${warning.profile}' is shadowed by this project's workflows override.`,
        output: 'warn',
      };
    case 'custom-lock':
      return {
        key: 'profileLockCustom',
        fallback: `Warning: 'custom' cannot be a locked profile; using the user-wide profile instead.`,
        output: 'warn',
      };
    case 'unresolvable':
      return {
        key: 'profileLockUnresolvable',
        values: { profile: warning.profile, detail: warning.detail },
        fallback: `Warning: locked profile '${warning.profile}' could not be resolved (${warning.detail}); using the user-wide profile instead.`,
        output: 'warn',
      };
  }
}

/**
 * Maps a {@link UserWideProfileWarning} to its localized config-diagnostic —
 * the global-scope analogue of {@link profileLockWarningToDiagnostic}. Surfaced
 * by `update`/`init` when the user-wide profile named an unresolvable saved
 * profile and resolution fell back to `full`.
 */
export function userWideProfileWarningToDiagnostic(
  warning: UserWideProfileWarning
): ConfigDiagnostic {
  return {
    key: 'userWideProfileUnresolvable',
    values: { profile: warning.profile, detail: warning.detail },
    fallback: `Warning: user-wide profile '${warning.profile}' could not be resolved (${warning.detail}); using the default 'full' profile instead.`,
    output: 'warn',
  };
}

/** Result of {@link resolveProjectWorkflowSelection}, naming which layer produced the set. */
export interface ResolveProjectWorkflowSelectionResult extends ResolveDesiredWorkflowSelectionResult {
  /**
   * `'override'` when the project carries its own `workflows` selection;
   * `'locked-profile'` when its `profile` lock governed; `'profile'` when
   * the user-wide profile did.
   */
  mode: 'profile' | 'override' | 'locked-profile';
  /** The lock name that governed resolution (mode `'locked-profile'` only). */
  lockedProfile?: string;
  /** Present when a `profile` lock exists but did not govern resolution. */
  lockWarning?: ProfileLockWarning;
}

/**
 * The per-project entry point (design.md D1/D3, space-workflow-enablement,
 * init-profile-lock): when the project's own `rasen/config.yaml` carries a
 * `workflows` override, that list resolves verbatim plus dependency closure
 * — bypassing the `expertSelectionExplicit` migration entirely, since an
 * override is always an explicit, individually-authored list, never a
 * legacy all-experts install. Otherwise a `profile` lock, when present and
 * resolvable, governs the same way via `resolveLockedProfileBase`; an
 * unresolvable lock falls back to the user-wide profile with a warning on
 * the result (never a thrown error — a shared config.yaml may name a
 * profile this machine does not have). When neither is present, resolution
 * is unchanged: the user-wide profile path
 * (`resolveDesiredWorkflowSelection`) governs. Used by `update.ts`,
 * `profile-sync-drift.ts`, and the management API so install, removal, and
 * drift can never disagree about which space is following what.
 */
export function resolveProjectWorkflowSelection(
  catalog: WorkflowCatalog,
  projectRoot: string,
  profile: string,
  customWorkflows: string[] | undefined,
  expertSelectionExplicit: boolean
): ResolveProjectWorkflowSelectionResult {
  const projectConfig = readProjectConfig(projectRoot);
  const override = projectConfig?.workflows;
  const lockedProfile = projectConfig?.profile;

  if (override !== undefined) {
    const { known, unknown } = filterKnownWorkflowRoots(catalog, override);
    const ids = resolveWorkflowSelection(catalog, known, { includeSkillDependencies: true }).map(
      (definition) => definition.id
    );
    return {
      ids,
      unknown,
      mode: 'override',
      ...(lockedProfile !== undefined
        ? { lockWarning: { kind: 'shadowed-by-override', profile: lockedProfile } }
        : {}),
    };
  }

  if (lockedProfile !== undefined) {
    const lockBase = resolveLockedProfileBase(lockedProfile, expertSelectionExplicit);
    if (lockBase.ok) {
      const { known, unknown } = filterKnownWorkflowRoots(catalog, lockBase.workflows);
      const ids = resolveWorkflowSelection(catalog, known, { includeSkillDependencies: true }).map(
        (definition) => definition.id
      );
      return { ids, unknown, mode: 'locked-profile', lockedProfile };
    }
    const fallback = resolveDesiredWorkflowSelection(
      catalog,
      profile,
      customWorkflows,
      expertSelectionExplicit
    );
    return { ...fallback, mode: 'profile', lockWarning: lockBase.warning };
  }

  const result = resolveDesiredWorkflowSelection(catalog, profile, customWorkflows, expertSelectionExplicit);
  return { ...result, mode: 'profile' };
}
