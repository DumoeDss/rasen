import { WORKSPACE_DIR_NAME } from './config.js';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { promises as fsPromises } from 'fs';
import { randomUUID } from 'crypto';
import path from 'path';
import { parse as parseYaml, parseDocument, stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';

import { withProjectRegistryLock, type ProjectPathOptions } from './project-registry.js';
import {
  makeLockErrorFactory,
  machineLockPath,
  writeFileAtomically,
  withOwnerAwareFileLock,
} from './file-state.js';
import { isKebabId } from './id.js';
import {
  LEAF_EFFORTS,
  LeafEffortSchema,
  thresholdSchema,
  type LeafEffort,
  type ThresholdValue,
} from './pipeline-registry/types.js';
import { THRESHOLD_ROLES } from './threshold-values.js';
import {
  DISPATCH_RUNTIMES,
  PROBE_RUNTIMES,
  hasRuntimeCapability,
  type DispatchRuntime,
} from './runtime-adapters.js';
import { normalizeRetiredEditBoundaryExpertIds } from './retired-edit-boundary.js';
import {
  ThresholdSchemeNameSchema,
  validateThresholdSchemeName,
} from './threshold-schemes.js';
import {
  reportConfigDiagnostic,
  type ConfigDiagnostic,
  type ConfigDiagnosticReporter,
} from './config-diagnostics.js';
import { isValidStoreUid, type StorePointerV2 } from './store/identity-types.js';

/**
 * Zod schema for project configuration.
 *
 * Purpose:
 * 1. Documentation - clearly defines the config file structure
 * 2. Type safety - TypeScript infers ProjectConfig type from schema
 * 3. Runtime validation - uses safeParse() for resilient field-by-field validation
 *
 * Why Zod over manual validation:
 * - Helps understand Rasen's data interfaces at a glance
 * - Single source of truth for type and validation
 * - Consistent with other Rasen schemas
 */
export const ProjectConfigSchema = z.object({
  // Required: which schema to use (e.g., "spec-driven", or project-local schema name)
  schema: z
    .string()
    .min(1)
    .describe('The workflow schema to use (e.g., "spec-driven")'),

  // Optional: project context (injected into all artifact instructions)
  // Max size: 50KB (enforced during parsing)
  context: z
    .string()
    .optional()
    .describe('Project context injected into all artifact instructions'),

  // Optional: per-artifact rules (additive to schema's built-in guidance)
  rules: z
    .record(
      z.string(), // artifact ID
      z.array(z.string()) // list of rules
    )
    .optional()
    .describe('Per-artifact rules, keyed by artifact ID'),

  // Optional: global quality rules applied to all artifacts
  'quality-rules': z
    .array(z.string())
    .optional()
    .describe('Global quality rules applied to all artifacts'),

  // Note: the `references` field (id strings or {id, remote} maps) is
  // deliberately absent here — readProjectConfig parses and normalizes
  // it by hand (see DeclarationEntry below); a schema entry nothing
  // parses would only drift from the real behavior.

  // Optional: the declared default store. Only consulted by root
  // resolution when this openspec/ directory is config-only (no specs/
  // or changes/); a fallback, never an override.
  store: z
    .string()
    .optional()
    .describe('Store id used as the Rasen root when no local planning shape exists'),

  // In-memory normalization of the durable `store: { uid, id?, remote? }`
  // declaration. Never written from here — the config file keeps whichever
  // form the user (or `store upgrade-identity`) put there.
  storeDeclaration: z
    .object({
      uid: z.string(),
      id: z.string().optional(),
      remote: z.string().optional(),
    })
    .optional()
    .describe('Durable store declaration: permanent identity, display alias, credential-free remote'),

  // Optional: stable machine-local project identity (opaque string; any
  // non-empty JS string is accepted, minted as a UUID by init/first use).
  projectId: z
    .string()
    .optional()
    .describe('Stable project identity used by the machine-wide project registry'),

  // Optional: a portable project-knowledge bundle deliberately declared by
  // this project. It is a locator only and is resolved by machine preparation
  // relative to the project root.
  knowledgeBundle: z
    .string()
    .min(1)
    .optional()
    .describe('Project-root-relative portable project-knowledge bundle locator'),

  // Optional: a per-space workflow selection override (space-workflow-enablement
  // spec). When present, this list (plus its dependency closure) is the
  // space's desired workflow set verbatim — it replaces the user-wide
  // profile for this project only. Absent means the space follows the
  // user-wide profile exactly as before this field existed.
  workflows: z
    .array(z.string())
    .optional()
    .describe('Per-space workflow selection override (replaces the user-wide profile for this project)'),

  // Optional: the project's locked profile (init-profile-lock spec). A
  // reference by name — `full`, `core`, or a saved named profile — resolved
  // where the selection is resolved (profiles.ts), not at parse time. A
  // `workflows` override, when present, takes precedence over this lock.
  profile: z
    .string()
    .min(1)
    .optional()
    .describe("The project's locked profile: full, core, or a saved profile name"),

  // Optional: archive behavior configuration. Extensible - future fields
  // join this same map.
  archive: z
    .object({
      timing: z
        .enum(['on-merge', 'in-ship'])
        .optional()
        .describe('When archive runs: on-merge (default) or in-ship'),
      destination: z
        .enum(['in-repo', 'external', 'prune'])
        .optional()
        .describe('Where archive bookkeeping lands: in-repo (default), external, or prune'),
    })
    .optional()
    .describe('Archive behavior configuration'),

  // Optional: autopilot behavior configuration. Extensible - future
  // autopilot fields join this same map.
  autopilot: z
    .object({
      gates: z
        .enum(['on', 'off'])
        .optional()
        .describe(
          'Default autopilot gate policy: on (gates pause, default) or off (ordinary gates auto-approved)'
        ),
      selection: z
        .enum(['classify', 'manual', 'compose'])
        .optional()
        .describe(
          'Default autopilot pipeline-selection policy: classify (adopt the classify suggestion), compose (classify-first, composition permitted on no-fit), or manual (default; explicit-or-small-feature, classify advisory-only)'
        ),
    })
    .optional()
    .describe('Autopilot behavior configuration'),

  // Optional: Run engine policy (ECP-5). Governs which engine owns a NEW Run.
  // Extensible - future run-level fields join this same map.
  runs: z
    .object({
      engine: z
        .enum(['auto', 'reconciler', 'legacy'])
        .optional()
        .describe(
          'Which engine owns a NEW Run: auto (default; reconciler where supported, legacy otherwise), reconciler (force; fail with the support reason when unsupported), or legacy (the reconciler off-switch; `rasen pipeline start` refuses)'
        ),
    })
    .optional()
    .describe('Run engine policy configuration'),

  omnicross: z
    .object({
      endpoint: z.string().min(1).optional(),
      controlTokenEnv: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/).optional(),
      requestTimeoutMs: z.number().int().min(100).max(60_000).optional(),
      leaseTtlSeconds: z.number().int().min(30).max(3_600).optional(),
    })
    .optional()
    .describe('Resident loopback OmniCross daemon connection settings'),

  // Optional: session reuse/handoff/touch/retire policy
  // (session-policy-and-control-parity). Supplies the frozen-action executor's
  // policy block numeric limits with `authored` provenance through the existing
  // config chain (project > store > global > the shipped
  // DEFAULT_EXECUTOR_POLICY_BLOCK default). Mirrors the runs/handoff precedent.
  // Each numeric value is a positive bounded integer; the source resolver
  // re-validates and rejects a safety-disabling value.
  sessionPolicy: z
    .object({
      handoffTokenLimit: z.number().int().positive().max(1_000_000).optional(),
      reuseRoundLimit: z.number().int().positive().max(1_000_000).optional(),
      touchMaxIdleMs: z.number().int().positive().max(24 * 60 * 60 * 1000).optional(),
      retireReasonLabel: z.string().min(1).max(200).optional(),
    })
    .optional()
    .describe('Session reuse/handoff/touch/retire policy configuration'),

  // Optional: context-handoff threshold. Project scope wins over the global
  // config value of the same name (see effective-config.ts); both fall back
  // to the built-in default (0.5) when absent. Dual-form (a bare fraction in
  // (0, 1], or the absolute `{ remainingTokens: N }` headroom form) — reuses
  // the same schema builder as pipeline-registry/types.ts so the two never
  // drift on what a valid threshold looks like.
  handoff: z
    .object({
      threshold: thresholdSchema('threshold').optional(),
      roles: z
        .object({
          planner: thresholdSchema('threshold').optional(),
          implementer: thresholdSchema('threshold').optional(),
          reviewer: thresholdSchema('threshold').optional(),
          fixer: thresholdSchema('threshold').optional(),
          shipper: thresholdSchema('threshold').optional(),
        })
        .optional()
        .describe('Per-role context-handoff threshold overrides (role beats the scalar threshold above)'),
    })
    .optional()
    .describe('Context-handoff threshold configuration'),

  thresholds: z
    .object({
      bindings: z
        .record(z.string(), ThresholdSchemeNameSchema)
        .refine(
          (bindings) =>
            Object.keys(bindings).every(
              (runtime) => runtime === 'default' || PROBE_RUNTIMES.includes(runtime as never)
            ),
          { error: `binding runtime must be default or one of: ${PROBE_RUNTIMES.join(', ')}` }
        )
        .optional()
        .default({}),
    })
    .optional()
    .describe('Runtime threshold-scheme bindings'),

  // Optional: keepalive gate for `rasen agent wait` (cli-agent-wait spec).
  // Only `enabled` and `beatSeconds` are project-settable (the registry marks
  // runtimes/contextFloor global-only — machine-level runtime params); project
  // scope wins over the global config value of the same name (see
  // effective-config.ts). Mirrors the GlobalConfigSchema keepalive block so the
  // two share a shape; runtimes/contextFloor are accepted here only for forward
  // compatibility and are not project-settable.
  keepalive: z
    .object({
      enabled: z.boolean().optional(),
      runtimes: z
        .object({
          claude: z.boolean().optional(),
          codex: z.boolean().optional(),
        })
        .optional(),
      contextFloor: z.number().int().nonnegative().optional(),
      beatSeconds: z.number().int().min(90).max(280).optional(),
    })
    .optional()
    .describe('Keepalive gate configuration (project scope; enabled and beatSeconds are project-settable)'),

  // Optional: per-agent model configuration. `default` is the base model for
  // all roles; `roles` overrides it per role. Project scope wins over the
  // global config value of the same name (see effective-config.ts). Model
  // ids are free strings — never validated against an allow-list.
  models: z
    .object({
      default: z.string().min(1).optional(),
      roles: z
        .object({
          planner: z.string().min(1).optional(),
          implementer: z.string().min(1).optional(),
          reviewer: z.string().min(1).optional(),
          fixer: z.string().min(1).optional(),
          shipper: z.string().min(1).optional(),
        })
        .optional()
        .describe('Per-role model overrides (role beats the base default above)'),
    })
    .optional()
    .describe('Per-agent model configuration'),

  efforts: z
    .object({
      default: LeafEffortSchema.optional(),
      roles: z
        .object({
          planner: LeafEffortSchema.optional(),
          implementer: LeafEffortSchema.optional(),
          reviewer: LeafEffortSchema.optional(),
          fixer: LeafEffortSchema.optional(),
          shipper: LeafEffortSchema.optional(),
        })
        .optional(),
    })
    .optional()
    .describe('Generic per-agent reasoning-effort configuration'),

  // Optional: per-pipeline config overrides keyed by pipeline name — the
  // planning-root storage side of the
  // `pipelines.<name>.{gates,models,handoff}.<stage>` and
  // `pipelines.<name>.runtimes.<role>` config-key families, serving both the
  // project and (a store root's own) store layers. `gates`/`models`/`handoff`
  // are keyed by stage; `runtimes` by role. Inner objects `.passthrough()` so
  // an unknown sub-key survives the schema; the resilient parser below drops
  // invalid leaves with a warning. Shares nothing with the `rasen/pipelines/`
  // directory namespace.
  pipelines: z
    .record(
      z.string(),
      z
        .object({
          gates: z.record(z.string(), z.enum(['on', 'off'])).optional(),
          models: z.record(z.string(), z.string().min(1)).optional(),
          efforts: z.record(z.string(), LeafEffortSchema).optional(),
          handoff: z.record(z.string(), thresholdSchema('threshold')).optional(),
          runtimes: z.record(z.string(), z.enum(DISPATCH_RUNTIMES)).optional(),
        })
        .passthrough()
    )
    .optional()
    .describe('Per-pipeline config overrides keyed by pipeline name'),

  // Optional: the project's authoritative tool-selection manifest
  // (project-install-manifest spec). When present, this list is the sole
  // source of the project's configured tools — on-disk artifact detection
  // cannot add to or remove from it. Each entry MUST be a non-empty tool id
  // string (matching the `value` field of an `AI_TOOLS` entry). An empty
  // array is valid and means "no tools configured."
  tools: z
    .array(z.string().min(1))
    .optional()
    .describe(
      "Authoritative list of tool ids the user selected at 'rasen init' (empty array = no tools configured)"
    ),

  // Optional: update behavior configuration. Extensible - future update
  // fields join this same map. Only `pin` is parsed today; `pin: true`
  // excludes the project from multi-project update prompts and `--all-projects`.
  update: z
    .object({
      pin: z
        .boolean()
        .optional()
        .describe(
          'When true, this project is never offered or touched by multi-project update (direct update is unaffected)'
        ),
    })
    .optional()
    .describe('Update behavior configuration (multi-project opt-out, etc.)'),
});

/** Valid `archive.timing` values. */
export type ArchiveTiming = 'on-merge' | 'in-ship';

/** Valid `archive.destination` values. */
export type ArchiveDestination = 'in-repo' | 'external' | 'prune';

/** Valid `autopilot.gates` values. */
export type AutopilotGatePolicy = 'on' | 'off';

/** String prefix addressing the project namespace in a `references:` entry. */
export const PROJECT_REFERENCE_PREFIX = 'project:';

/** Valid `autopilot.selection` values. */
export type AutopilotSelectionPolicy = 'classify' | 'manual' | 'compose';

/** Valid `runs.engine` values (ECP-5 engine selection policy). */
export const RUNS_ENGINE_POLICIES = ['auto', 'reconciler', 'legacy'] as const;

/** Valid `runs.engine` values. */
export type RunsEnginePolicy = (typeof RUNS_ENGINE_POLICIES)[number];

function isRunsEnginePolicy(value: unknown): value is RunsEnginePolicy {
  return RUNS_ENGINE_POLICIES.includes(value as RunsEnginePolicy);
}

/** Normalized in-memory shape of a referenced store declaration. */
export interface DeclarationEntry {
  id: string;
  /** Clone source rendered into onboarding fixes. */
  remote?: string;
  /** Absent means the store namespace; 'project' addresses store add-project entries. */
  type?: 'store' | 'project';
}

/** The config key holding the project's Store membership locator hints. */
export const STORE_MEMBERSHIPS_FIELD = 'storeMemberships';

/**
 * A project-side locator for a Store the project belongs to.
 *
 * A HINT and never authority: the Store's own
 * `.rasen-store/projects/<projectId>.yaml` record decides membership, and a
 * hint that disagrees with it is reported as drift rather than believed. Its
 * job is discovery — a fresh clone of the project, on a machine that has never
 * seen these Stores, can still say which Stores it belongs to and how to
 * obtain each one.
 *
 * Nothing machine-specific ever enters it: permanent identity, display alias,
 * and a credential-free remote, and no filesystem path on any platform.
 */
export interface StoreMembershipHint {
  /** The Store's permanent identity. Absent only for a legacy-identity Store. */
  uid?: string;
  /** Display alias, for reading and for naming a Store that has no identity yet. */
  id?: string;
  /** Credential-free clone source. */
  remote?: string;
}

/**
 * De-duplication key: the permanent identity when there is one, else the
 * display alias. Two hints for one Store must collapse even when one of them
 * predates the Store's identity.
 */
export function storeMembershipHintKey(hint: StoreMembershipHint): string {
  return hint.uid !== undefined
    ? `uid:${hint.uid.trim().toLowerCase()}`
    : `id:${(hint.id ?? '').trim().toLowerCase()}`;
}

/** The alias, else the identity — never an empty string. */
export function describeStoreMembershipHint(hint: StoreMembershipHint): string {
  return hint.id ?? hint.uid ?? '(unnamed store)';
}

export type ProjectConfig = z.infer<typeof ProjectConfigSchema> & {
  references?: DeclarationEntry[];
  storeMemberships?: StoreMembershipHint[];
};

/**
 * Parser for `references:` declarations: string entries (bare id, or a
 * `project:<id>` prefixed id addressing the project namespace) or
 * {id, remote, type} maps, normalized to DeclarationEntry[]. Dedup keys on
 * the (type, id) pair — a store and a project sharing an id both survive —
 * and keeps the first position; the first entry carrying a remote supplies
 * it (a later duplicate fills a missing remote, never overrides). Invalid
 * entries drop with a warning like other resilient fields; a `project:`
 * prefix whose id portion fails the id grammar also drops with a warning
 * (unlike a bare id, which is grammar-checked downstream at assembly time).
 * Returns undefined when the field is absent or normalizes to empty.
 */
function warnConfig(
  diagnostic: Omit<ConfigDiagnostic, 'output'>,
  reporter?: ConfigDiagnosticReporter
): void {
  reportConfigDiagnostic({ ...diagnostic, output: 'warn' }, reporter);
}

function parseDeclarationList(
  raw: unknown,
  reporter?: ConfigDiagnosticReporter
): DeclarationEntry[] | undefined {
  const fieldName = 'references';
  if (raw === undefined) {
    return undefined;
  }
  if (!Array.isArray(raw)) {
    warnConfig(
      {
        key: 'invalidReferences',
        fallback: `Invalid '${fieldName}' field in config (must be an array of store ids)`,
      },
      reporter
    );
    return undefined;
  }

  const byId = new Map<string, DeclarationEntry>();
  let droppedEntries = false;
  let droppedRemotes = false;

  for (const entry of raw) {
    let declaration: DeclarationEntry | null = null;
    if (typeof entry === 'string') {
      if (entry.startsWith(PROJECT_REFERENCE_PREFIX)) {
        const idPart = entry.slice(PROJECT_REFERENCE_PREFIX.length);
        if (idPart.length > 0 && isKebabId(idPart)) {
          declaration = { id: idPart, type: 'project' };
        }
        // else: invalid `project:` id — drop with a warning below.
      } else {
        declaration = { id: entry };
      }
    } else if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      const candidate = entry as Record<string, unknown>;
      if (typeof candidate.id === 'string') {
        declaration = { id: candidate.id };
        if (candidate.type === 'project') {
          declaration.type = 'project';
        }
        if (typeof candidate.remote === 'string' && candidate.remote.length > 0) {
          declaration.remote = candidate.remote;
        } else if (candidate.remote !== undefined) {
          droppedRemotes = true; // remote dropped, id kept
        }
      }
    }

    if (!declaration) {
      droppedEntries = true;
      continue;
    }

    const dedupeKey = declaration.type === 'project' ? `project:${declaration.id}` : declaration.id;
    const existing = byId.get(dedupeKey);
    if (!existing) {
      byId.set(dedupeKey, declaration);
    } else if (existing.remote === undefined && declaration.remote !== undefined) {
      existing.remote = declaration.remote;
    }
  }

  if (droppedEntries) {
    warnConfig(
      {
        key: 'invalidReferenceEntries',
        fallback: `Some '${fieldName}' entries are invalid, ignoring them`,
      },
      reporter
    );
  }
  if (droppedRemotes) {
    warnConfig(
      {
        key: 'invalidReferenceRemotes',
        fallback: `Some '${fieldName}' remotes are not non-empty strings; the ids are kept without a clone source`,
      },
      reporter
    );
  }
  return byId.size > 0 ? [...byId.values()] : undefined;
}

/**
 * Resilient parser for `storeMemberships:` — the SAME drop-with-a-warning
 * discipline `references:` uses, and deliberately not a strict schema.
 *
 * That is correct precisely BECAUSE these are locators: losing one hint costs
 * a diagnostic and a rediscovery, while a strict schema would reject the whole
 * file over one bad entry and take every other hint with it. Authority lives
 * in the Store's own record, where strictness belongs.
 *
 * Accepts a bare string (a permanent identity, else a display alias) and the
 * `{uid?, id?, remote?}` map. Entries de-duplicate on permanent identity —
 * falling back to the display alias for a Store that has none — keeping the
 * first position, with a later duplicate filling a field the first left empty.
 * An entry carrying no identity survives with a warning naming the upgrade
 * path: it still locates the Store by name today, and dropping it would lose
 * the only record that the membership exists at all.
 */
function parseStoreMembershipList(
  raw: unknown,
  reporter?: ConfigDiagnosticReporter
): StoreMembershipHint[] | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!Array.isArray(raw)) {
    warnConfig(
      {
        key: 'invalidStoreMemberships',
        fallback: `Invalid '${STORE_MEMBERSHIPS_FIELD}' field in config (must be an array of store references)`,
      },
      reporter
    );
    return undefined;
  }

  const byKey = new Map<string, StoreMembershipHint>();
  let dropped = false;
  let identityless = false;

  for (const entry of raw) {
    let hint: StoreMembershipHint | null = null;

    if (typeof entry === 'string') {
      const value = entry.trim();
      if (isValidStoreUid(value)) {
        hint = { uid: value };
      } else if (isKebabId(value)) {
        hint = { id: value };
      }
    } else if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      const candidate = entry as Record<string, unknown>;
      const uid =
        typeof candidate.uid === 'string' && isValidStoreUid(candidate.uid)
          ? candidate.uid.trim()
          : undefined;
      const id =
        typeof candidate.id === 'string' && candidate.id.length > 0 && isKebabId(candidate.id)
          ? candidate.id
          : undefined;
      const remote =
        typeof candidate.remote === 'string' && candidate.remote.length > 0
          ? candidate.remote
          : undefined;

      if (uid !== undefined || id !== undefined) {
        hint = {
          ...(uid !== undefined ? { uid } : {}),
          ...(id !== undefined ? { id } : {}),
          ...(remote !== undefined ? { remote } : {}),
        };
      }
      // A field this parser could not read (a malformed uid, a non-kebab id,
      // an empty remote) is reported alongside a wholly unreadable entry: in
      // both cases something the user wrote is not being used.
      if (
        hint !== null &&
        ((candidate.uid !== undefined && uid === undefined) ||
          (candidate.id !== undefined && id === undefined) ||
          (candidate.remote !== undefined && remote === undefined))
      ) {
        dropped = true;
      }
    }

    if (!hint) {
      dropped = true;
      continue;
    }
    if (hint.uid === undefined) {
      identityless = true;
    }

    const key = storeMembershipHintKey(hint);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, hint);
      continue;
    }
    if (existing.id === undefined && hint.id !== undefined) existing.id = hint.id;
    if (existing.remote === undefined && hint.remote !== undefined) existing.remote = hint.remote;
    if (existing.uid === undefined && hint.uid !== undefined) existing.uid = hint.uid;
  }

  if (dropped) {
    warnConfig(
      {
        key: 'invalidStoreMembershipEntries',
        fallback: `Some '${STORE_MEMBERSHIPS_FIELD}' entries are invalid; ignoring the unusable entries and fields`,
      },
      reporter
    );
  }
  if (identityless) {
    warnConfig(
      {
        key: 'storeMembershipsWithoutIdentity',
        fallback: `Some '${STORE_MEMBERSHIPS_FIELD}' entries name a store only by display name; run 'rasen update' so the hint survives a rename`,
      },
      reporter
    );
  }

  return byKey.size > 0 ? [...byKey.values()] : undefined;
}

/**
 * Resilient parser for the `pipelines:` block (a map keyed by pipeline name of
 * `gates`/`models`/`handoff` per-stage records). Mirrors the field-by-field
 * drop-with-warning discipline of the blocks above: a non-map pipeline entry,
 * an unknown or non-map axis, or an invalid per-stage leaf is dropped while
 * valid siblings survive. `gates` leaves must be `on`/`off`, `models` leaves a
 * non-empty string, `handoff` leaves the dual-form threshold. Returns
 * undefined when nothing valid remains.
 */
function parsePipelinesBlock(raw: unknown): ProjectConfig['pipelines'] | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    console.warn(`Invalid 'pipelines' field in config (must be an object)`);
    return undefined;
  }

  type PipelineEntry = NonNullable<ProjectConfig['pipelines']>[string];
  const result: NonNullable<ProjectConfig['pipelines']> = {};

  for (const [pipelineName, pipelineRaw] of Object.entries(raw as Record<string, unknown>)) {
    if (!pipelineRaw || typeof pipelineRaw !== 'object' || Array.isArray(pipelineRaw)) {
      console.warn(`Invalid 'pipelines.${pipelineName}' field in config (must be an object)`);
      continue;
    }
    const entry: PipelineEntry = {};

    for (const [axis, axisRaw] of Object.entries(pipelineRaw as Record<string, unknown>)) {
      if (axis !== 'gates' && axis !== 'models' && axis !== 'efforts' && axis !== 'handoff' && axis !== 'runtimes') {
        console.warn(
          `Unknown 'pipelines.${pipelineName}.${axis}' field in config (expected gates, models, efforts, handoff, or runtimes); ignoring it.`
        );
        continue;
      }
      if (!axisRaw || typeof axisRaw !== 'object' || Array.isArray(axisRaw)) {
        console.warn(`Invalid 'pipelines.${pipelineName}.${axis}' field in config (must be an object)`);
        continue;
      }

      const gates: Record<string, 'on' | 'off'> = {};
      const models: Record<string, string> = {};
      const efforts: Record<string, LeafEffort> = {};
      const handoff: Record<string, ThresholdValue> = {};
      const runtimes: Record<string, DispatchRuntime> = {};
      // `gates`/`models`/`handoff` leaves are keyed by stage; `runtimes` by role.
      for (const [leafKey, leaf] of Object.entries(axisRaw as Record<string, unknown>)) {
        const label = `pipelines.${pipelineName}.${axis}.${leafKey}`;
        if (axis === 'gates') {
          if (leaf === 'on' || leaf === 'off') gates[leafKey] = leaf;
          else console.warn(`Invalid '${label}' field in config (must be 'on' or 'off')`);
        } else if (axis === 'models') {
          if (typeof leaf === 'string' && leaf.length > 0) models[leafKey] = leaf;
          else console.warn(`Invalid '${label}' field in config (must be a non-empty string)`);
        } else if (axis === 'efforts') {
          if (typeof leaf === 'string' && LEAF_EFFORTS.includes(leaf as LeafEffort)) {
            efforts[leafKey] = leaf as LeafEffort;
          } else {
            console.warn(`Invalid '${label}' field in config (must be one of ${LEAF_EFFORTS.join(', ')})`);
          }
        } else if (axis === 'runtimes') {
          if (hasRuntimeCapability(leaf, 'canDispatch')) runtimes[leafKey] = leaf;
          else {
            const expected = DISPATCH_RUNTIMES.map((runtime) => `'${runtime}'`).join(' or ');
            console.warn(`Invalid '${label}' field in config (must be ${expected})`);
          }
        } else {
          const parsed = thresholdSchema('threshold').safeParse(leaf);
          if (parsed.success) handoff[leafKey] = parsed.data;
          else
            console.warn(
              `Invalid '${label}' field in config (must be a number in (0, 1], or an object { remainingTokens: <positive integer> })`
            );
        }
      }
      if (axis === 'gates' && Object.keys(gates).length > 0) entry.gates = gates;
      if (axis === 'models' && Object.keys(models).length > 0) entry.models = models;
      if (axis === 'efforts' && Object.keys(efforts).length > 0) entry.efforts = efforts;
      if (axis === 'handoff' && Object.keys(handoff).length > 0) entry.handoff = handoff;
      if (axis === 'runtimes' && Object.keys(runtimes).length > 0) entry.runtimes = runtimes;
    }

    if (Object.keys(entry).length > 0) result[pipelineName] = entry;
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

export const MAX_CONTEXT_SIZE = 50 * 1024; // 50KB hard limit, shared with the references index

/**
 * Read and parse openspec/config.yaml from project root.
 * Uses resilient parsing - validates each field independently using Zod safeParse.
 * Returns null if file doesn't exist.
 * Returns partial config if some fields are invalid (with warnings).
 *
 * Performance note (Jan 2025):
 * Benchmarks showed direct file reads are fast enough without caching:
 * - Typical config (1KB): ~0.5ms per read
 * - Large config (50KB): ~1.6ms per read
 * - Missing config: ~0.01ms per read
 * Config is read 1-2 times per command (schema resolution + instruction loading),
 * adding ~1-3ms total overhead. Caching would add complexity (mtime checks,
 * invalidation logic) for negligible benefit. Direct reads also ensure config
 * changes are reflected immediately without stale cache issues.
 *
 * @param projectRoot - The root directory of the project (where `openspec/` lives)
 * @returns Parsed config or null if file doesn't exist
 */
/**
 * Discriminated result of reading a project config file, so callers can
 * distinguish "no config file present" from "config file exists but is
 * unparseable." The absent state is the ordinary "no config" signal; the
 * unreadable state carries a diagnostic so a caller never silently treats a
 * corrupt config as a project with no identity.
 */
export type ProjectConfigReadResult =
  | { status: 'absent' }
  | { status: 'ok'; config: ProjectConfig | null }
  | { status: 'unreadable'; path: string; error: string };

export function readProjectConfigWithDiagnostics(
  projectRoot: string,
  options: { reporter?: ConfigDiagnosticReporter } = {}
): ProjectConfigReadResult {
  const configPath = resolveConfigFilePath(projectRoot);
  if (configPath === null) {
    return { status: 'absent' };
  }

  try {
    const content = readFileSync(configPath, 'utf-8');
    const config = parseProjectConfigContent(content, projectRoot, options.reporter);
    return { status: 'ok', config };
  } catch (error) {
    const warnPath = configPathForWarnings(projectRoot);
    const detail = error instanceof Error ? error.message.split('\n')[0] : String(error);
    warnConfig(
      {
        key: 'projectParseFailed',
        values: { path: warnPath, detail },
        fallback: `Warning: could not parse ${warnPath} (${detail}); ignoring it.`,
      },
      options.reporter
    );
    return { status: 'unreadable', path: configPath, error: detail };
  }
}

export function readProjectConfig(
  projectRoot: string,
  options: { reporter?: ConfigDiagnosticReporter } = {}
): ProjectConfig | null {
  const result = readProjectConfigWithDiagnostics(projectRoot, options);
  return result.status === 'ok' ? result.config : null;
}

/**
 * Reads a scope-resolved planning config file directly. Store v2 project
 * configs live at `<projectHome>/config.yaml`, so forcing them through the
 * legacy `<projectRoot>/rasen/config.yaml` lookup would recreate a second
 * root-routing algorithm in every consumer.
 */
export function readProjectConfigAtPath(
  configPath: string,
  options: { reporter?: ConfigDiagnosticReporter } = {}
): ProjectConfig | null {
  try {
    if (!existsSync(configPath)) return null;
    return parseProjectConfigContent(
      readFileSync(configPath, 'utf-8'),
      path.dirname(configPath),
      options.reporter
    );
  } catch {
    return null;
  }
}

/**
 * Resilient field-by-field parse of raw YAML config content into a
 * `ProjectConfig`, shared by `readProjectConfig` (reads the file from disk)
 * and `updateProjectConfigKey`'s post-write sanity check (parses the
 * in-memory document string before it is trusted). Never throws on invalid
 * YAML content passed in as a string — that only happens via
 * `readProjectConfig`'s own try/catch, since `parseYaml` can throw.
 */
function parseProjectConfigContent(
  content: string,
  projectRoot: string,
  reporter?: ConfigDiagnosticReporter
): ProjectConfig | null {
  const raw = parseYaml(content);

  if (!raw || typeof raw !== 'object') {
    warnConfig(
      {
        key: 'projectNotObject',
        fallback: 'openspec/config.yaml is not a valid YAML object',
      },
      reporter
    );
    return null;
  }

  const config: Partial<ProjectConfig> = {};

    // Parse schema field using Zod
    const schemaField = z.string().min(1);
    const schemaResult = schemaField.safeParse(raw.schema);
    if (schemaResult.success) {
      config.schema = schemaResult.data;
    } else if (raw.schema !== undefined) {
      warnConfig(
        {
          key: 'invalidSchema',
          fallback: `Invalid 'schema' field in config (must be non-empty string)`,
        },
        reporter
      );
    }

    // Parse context field with size limit
    if (raw.context !== undefined) {
      const contextField = z.string();
      const contextResult = contextField.safeParse(raw.context);

      if (contextResult.success) {
        const contextSize = Buffer.byteLength(contextResult.data, 'utf-8');
        if (contextSize > MAX_CONTEXT_SIZE) {
          const size = (contextSize / 1024).toFixed(1);
          const maximum = MAX_CONTEXT_SIZE / 1024;
          warnConfig(
            {
              key: 'contextTooLarge',
              values: { size, maximum },
              fallback: `Context too large (${size}KB, limit: ${maximum}KB)`,
            },
            reporter
          );
          warnConfig(
            {
              key: 'ignoringContext',
              fallback: 'Ignoring context field',
            },
            reporter
          );
        } else {
          config.context = contextResult.data;
        }
      } else {
        warnConfig(
          {
            key: 'invalidContext',
            fallback: `Invalid 'context' field in config (must be string)`,
          },
          reporter
        );
      }
    }

    // Parse rules field using Zod
    if (raw.rules !== undefined) {
      const rulesField = z.record(z.string(), z.array(z.string()));

      // First check if it's an object structure (guard against null since typeof null === 'object')
      if (typeof raw.rules === 'object' && raw.rules !== null && !Array.isArray(raw.rules)) {
        const parsedRules: Record<string, string[]> = {};
        let hasValidRules = false;

        for (const [artifactId, rules] of Object.entries(raw.rules)) {
          const rulesArrayResult = z.array(z.string()).safeParse(rules);

          if (rulesArrayResult.success) {
            // Filter out empty strings
            const validRules = rulesArrayResult.data.filter((r) => r.length > 0);
            if (validRules.length > 0) {
              parsedRules[artifactId] = validRules;
              hasValidRules = true;
            }
            if (validRules.length < rulesArrayResult.data.length) {
              warnConfig(
                {
                  key: 'emptyArtifactRules',
                  values: { artifactId },
                  fallback: `Some rules for '${artifactId}' are empty strings, ignoring them`,
                },
                reporter
              );
            }
          } else {
            warnConfig(
              {
                key: 'invalidArtifactRules',
                values: { artifactId },
                fallback: `Rules for '${artifactId}' must be an array of strings, ignoring this artifact's rules`,
              },
              reporter
            );
          }
        }

        if (hasValidRules) {
          config.rules = parsedRules;
        }
      } else {
        warnConfig(
          {
            key: 'invalidRules',
            fallback: `Invalid 'rules' field in config (must be object)`,
          },
          reporter
        );
      }
    }

    // Parse quality-rules field using Zod
    if (raw['quality-rules'] !== undefined) {
      const qualityRulesField = z.array(z.string());
      const qualityRulesResult = qualityRulesField.safeParse(raw['quality-rules']);

      if (qualityRulesResult.success) {
        // Filter out empty strings
        const validRules = qualityRulesResult.data.filter((r) => r.length > 0);
        if (validRules.length > 0) {
          config['quality-rules'] = validRules;
        }
        if (validRules.length < qualityRulesResult.data.length) {
          warnConfig(
            {
              key: 'emptyQualityRules',
              fallback: 'Some quality-rules are empty strings, ignoring them',
            },
            reporter
          );
        }
      } else {
        warnConfig(
          {
            key: 'invalidQualityRules',
            fallback: `Invalid 'quality-rules' field in config (must be array of strings)`,
          },
          reporter
        );
      }
    }

    const references = parseDeclarationList(raw.references, reporter);
    if (references) {
      config.references = references;
    }

    // Store membership locator hints. Parsed like `references:` and for the
    // same reason — they are hints, so one bad entry costs a diagnostic, not
    // the whole list.
    const storeMemberships = parseStoreMembershipList(raw[STORE_MEMBERSHIPS_FIELD], reporter);
    if (storeMemberships) {
      config.storeMemberships = storeMemberships;
    }

    // Parse store declaration: the legacy id string, the durable
    // `{ uid, id?, remote? }` form, or dropped with a warning.
    // (Root resolution does NOT use this parse — it uses readStorePointer
    // below, which errors on malformed declarations instead of dropping.)
    if (raw.store !== undefined) {
      const durable = parseDurableStoreDeclaration(raw.store);
      if (typeof raw.store === 'string') {
        config.store = raw.store;
      } else if (durable) {
        config.storeDeclaration = durable;
        if (durable.id !== undefined) {
          config.store = durable.id;
        }
      } else {
        const configPath = configPathForWarnings(projectRoot);
        warnConfig(
          {
            key: 'invalidStore',
            values: { path: configPath },
            fallback: `Warning: ignoring invalid store: field in ${configPath} (must be a single store id string).`,
          },
          reporter
        );
      }
    }

    // Parse projectId field: an opaque string identifier, or dropped with a
    // warning (any non-empty JS string is accepted; only non-strings drop).
    if (raw.projectId !== undefined) {
      if (typeof raw.projectId === 'string') {
        config.projectId = raw.projectId;
      } else {
        warnConfig(
          {
            key: 'invalidProjectId',
            fallback: `Invalid 'projectId' field in config (must be string)`,
          },
          reporter
        );
      }
    }

    // Parse the portable knowledge-bundle declaration independently. A bad
    // locator drops only this field; every valid sibling remains usable.
    if (raw.knowledgeBundle !== undefined) {
      if (
        typeof raw.knowledgeBundle === 'string' &&
        raw.knowledgeBundle.trim().length > 0
      ) {
        config.knowledgeBundle = raw.knowledgeBundle;
      } else if (reporter !== undefined) {
        // Bundle-aware callers collect this into their structured result. A
        // generic config read must not emit an out-of-band English warning
        // that can corrupt localized or JSON command output.
        warnConfig(
          {
            key: 'invalidKnowledgeBundle',
            fallback: `Invalid 'knowledgeBundle' field in config (must be a non-empty string)`,
          },
          reporter
        );
      }
    }

    // Parse workflows field: an optional per-space workflow selection
    // override (array of strings). Non-array -> dropped with a warning;
    // valid siblings still parse.
    if (raw.workflows !== undefined) {
      const workflowsResult = z.array(z.string()).safeParse(raw.workflows);
      if (workflowsResult.success) {
        config.workflows = normalizeRetiredEditBoundaryExpertIds(
          workflowsResult.data
        );
      } else {
        warnConfig(
          {
            key: 'invalidWorkflows',
            fallback: `Invalid 'workflows' field in config (must be an array of strings)`,
          },
          reporter
        );
      }
    }

    // Parse profile field: an optional locked-profile name (non-empty
    // string). The value is opaque here — whether it resolves to an
    // available profile is decided at selection-resolution time
    // (profiles.ts), never during config loading. Non-string or empty ->
    // dropped with a warning; valid siblings still parse.
    if (raw.profile !== undefined) {
      if (typeof raw.profile === 'string' && raw.profile.length > 0) {
        config.profile = raw.profile;
      } else {
        warnConfig(
          {
            key: 'invalidProfile',
            fallback: `Invalid 'profile' field in config (must be a non-empty profile name string)`,
          },
          reporter
        );
      }
    }

    // Parse tools field: an optional array of non-empty tool id strings
    // (project-install-manifest spec). Non-array -> whole field dropped
    // with a warning. A non-string or empty-string entry -> that entry is
    // dropped with a warning, valid siblings survive. An empty array is
    // valid and means "no tools configured."
    if (raw.tools !== undefined) {
      if (Array.isArray(raw.tools)) {
        const tools: string[] = [];
        let droppedEntries = false;
        for (const entry of raw.tools) {
          if (typeof entry === 'string' && entry.length > 0) {
            tools.push(entry);
          } else {
            droppedEntries = true;
          }
        }
        config.tools = tools;
        if (droppedEntries) {
          warnConfig(
            {
              key: 'invalidToolsEntries',
              fallback: `Some 'tools' entries are invalid (must be non-empty strings); ignoring them`,
            },
            reporter
          );
        }
      } else {
        warnConfig(
          {
            key: 'invalidTools',
            fallback: `Invalid 'tools' field in config (must be an array of tool id strings)`,
          },
          reporter
        );
      }
    }

    // Parse update field: an optional map with an optional `pin` boolean
    // field (project-install-manifest spec). Non-map -> whole block
    // dropped with a warning. An invalid `pin` -> that field dropped with
    // a warning, siblings (future fields) still parse.
    if (raw.update !== undefined) {
      if (raw.update && typeof raw.update === 'object' && !Array.isArray(raw.update)) {
        const updateRaw = raw.update as Record<string, unknown>;
        const update: ProjectConfig['update'] = {};
        if (updateRaw.pin !== undefined) {
          if (typeof updateRaw.pin === 'boolean') {
            update.pin = updateRaw.pin;
          } else {
            warnConfig(
              {
                key: 'invalidUpdatePin',
                fallback: `Invalid 'update.pin' field in config (must be a boolean)`,
              },
              reporter
            );
          }
        }
        config.update = update;
      } else {
        warnConfig(
          {
            key: 'invalidUpdate',
            fallback: `Invalid 'update' field in config (must be an object)`,
          },
          reporter
        );
      }
    }

    // Parse archive field: an optional map with optional `timing` and
    // `destination` fields. Non-map -> whole block dropped with a warning.
    // An invalid field -> that field dropped with a warning, siblings
    // (and future fields) still parse.
    if (raw.archive !== undefined) {
      if (raw.archive && typeof raw.archive === 'object' && !Array.isArray(raw.archive)) {
        const archiveRaw = raw.archive as Record<string, unknown>;
        const archive: ProjectConfig['archive'] = {};
        if (archiveRaw.timing !== undefined) {
          if (archiveRaw.timing === 'on-merge' || archiveRaw.timing === 'in-ship') {
            archive.timing = archiveRaw.timing;
          } else {
            warnConfig(
              {
                key: 'invalidArchiveTiming',
                fallback: `Invalid 'archive.timing' field in config (must be 'on-merge' or 'in-ship')`,
              },
              reporter
            );
          }
        }
        if (archiveRaw.destination !== undefined) {
          if (
            archiveRaw.destination === 'in-repo' ||
            archiveRaw.destination === 'external' ||
            archiveRaw.destination === 'prune'
          ) {
            // DEPRECATED and non-behavioral (`archive-destination` /
            // `config-loading` capabilities): the value is still exposed so
            // legacy-archive discovery and child B's migrator can see it, but
            // it never routes a write. A non-default value gets a loud
            // deprecation warning — silently changing behavior for an
            // `external`/`prune` user would be worse.
            archive.destination = archiveRaw.destination;
            if (archiveRaw.destination !== 'in-repo') {
              warnConfig(
                {
                  key: 'deprecatedArchiveDestination',
                  fallback: `'archive.destination' is deprecated and no longer selects a destination: archive bookkeeping always lands in the planning root. Remove the key; run 'rasen archive relocate --to in-repo' to consolidate existing archives.`,
                },
                reporter
              );
            }
          } else {
            warnConfig(
              {
                key: 'invalidArchiveDestination',
                fallback: `Invalid 'archive.destination' field in config (must be 'in-repo', 'external', or 'prune')`,
              },
              reporter
            );
          }
        }
        config.archive = archive;
      } else {
        warnConfig(
          {
            key: 'invalidArchive',
            fallback: `Invalid 'archive' field in config (must be an object)`,
          },
          reporter
        );
      }
    }

    // Parse autopilot field: an optional map with optional `gates` and
    // `selection` fields. Non-map -> whole block dropped with a warning. An
    // invalid field -> that field dropped with a warning, siblings (and
    // future fields) still parse.
    if (raw.autopilot !== undefined) {
      if (raw.autopilot && typeof raw.autopilot === 'object' && !Array.isArray(raw.autopilot)) {
        const autopilotRaw = raw.autopilot as Record<string, unknown>;
        const autopilot: ProjectConfig['autopilot'] = {};
        if (autopilotRaw.gates !== undefined) {
          if (autopilotRaw.gates === 'on' || autopilotRaw.gates === 'off') {
            autopilot.gates = autopilotRaw.gates;
          } else {
            warnConfig(
              {
                key: 'invalidAutopilotGates',
                fallback: `Invalid 'autopilot.gates' field in config (must be 'on' or 'off')`,
              },
              reporter
            );
          }
        }
        if (autopilotRaw.selection !== undefined) {
          if (
            autopilotRaw.selection === 'classify' ||
            autopilotRaw.selection === 'manual' ||
            autopilotRaw.selection === 'compose'
          ) {
            autopilot.selection = autopilotRaw.selection;
          } else {
            warnConfig(
              {
                key: 'invalidAutopilotSelection',
                fallback: `Invalid 'autopilot.selection' field in config (must be 'classify', 'manual', or 'compose')`,
              },
              reporter
            );
          }
        }
        config.autopilot = autopilot;
      } else {
        warnConfig(
          {
            key: 'invalidAutopilot',
            fallback: `Invalid 'autopilot' field in config (must be an object)`,
          },
          reporter
        );
      }
    }

    // Parse runs field (ECP-5 engine selection policy): an optional map with an
    // optional `engine` field. Resilient exactly like `autopilot` above — a
    // non-map drops the whole block with a warning, an invalid value drops that
    // field and leaves siblings (and future fields) parsing.
    if (raw.runs !== undefined) {
      if (raw.runs && typeof raw.runs === 'object' && !Array.isArray(raw.runs)) {
        const runsRaw = raw.runs as Record<string, unknown>;
        const runs: ProjectConfig['runs'] = {};
        if (runsRaw.engine !== undefined) {
          if (isRunsEnginePolicy(runsRaw.engine)) {
            runs.engine = runsRaw.engine;
          } else {
            warnConfig(
              {
                key: 'invalidRunsEngine',
                fallback: `Invalid 'runs.engine' field in config (must be ${RUNS_ENGINE_POLICIES.map((value) => `'${value}'`).join(', ')})`,
              },
              reporter
            );
          }
        }
        config.runs = runs;
      } else {
        warnConfig(
          {
            key: 'invalidRuns',
            fallback: `Invalid 'runs' field in config (must be an object)`,
          },
          reporter
        );
      }
    }

    // Parse OmniCross connection settings leaf-by-leaf. The control credential
    // itself is deliberately not a config field; only its environment-variable
    // name is persisted.
    if (raw.omnicross !== undefined) {
      if (raw.omnicross && typeof raw.omnicross === 'object' && !Array.isArray(raw.omnicross)) {
        const omniRaw = raw.omnicross as Record<string, unknown>;
        const omnicross: NonNullable<ProjectConfig['omnicross']> = {};
        if (omniRaw.endpoint !== undefined) {
          if (typeof omniRaw.endpoint === 'string' && omniRaw.endpoint.trim().length > 0) {
            omnicross.endpoint = omniRaw.endpoint;
          } else {
            console.warn(`Invalid 'omnicross.endpoint' field in config (must be a non-empty string)`);
          }
        }
        if (omniRaw.controlTokenEnv !== undefined) {
          if (
            typeof omniRaw.controlTokenEnv === 'string' &&
            /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(omniRaw.controlTokenEnv)
          ) {
            omnicross.controlTokenEnv = omniRaw.controlTokenEnv;
          } else {
            console.warn(`Invalid 'omnicross.controlTokenEnv' field in config (must be an environment variable name)`);
          }
        }
        if (omniRaw.requestTimeoutMs !== undefined) {
          if (
            typeof omniRaw.requestTimeoutMs === 'number' &&
            Number.isInteger(omniRaw.requestTimeoutMs) &&
            omniRaw.requestTimeoutMs >= 100 &&
            omniRaw.requestTimeoutMs <= 60_000
          ) {
            omnicross.requestTimeoutMs = omniRaw.requestTimeoutMs;
          } else {
            console.warn(`Invalid 'omnicross.requestTimeoutMs' field in config (must be an integer between 100 and 60000)`);
          }
        }
        if (omniRaw.leaseTtlSeconds !== undefined) {
          if (
            typeof omniRaw.leaseTtlSeconds === 'number' &&
            Number.isInteger(omniRaw.leaseTtlSeconds) &&
            omniRaw.leaseTtlSeconds >= 30 &&
            omniRaw.leaseTtlSeconds <= 3_600
          ) {
            omnicross.leaseTtlSeconds = omniRaw.leaseTtlSeconds;
          } else {
            console.warn(`Invalid 'omnicross.leaseTtlSeconds' field in config (must be an integer between 30 and 3600)`);
          }
        }
        config.omnicross = omnicross;
      } else {
        console.warn(`Invalid 'omnicross' field in config (must be an object)`);
      }
    }

    // Parse sessionPolicy field (session-policy-and-control-parity): an optional
    // map supplying the executor policy block numeric limits. Resilient exactly
    // like `runs` — a non-map drops the whole block with a warning; an obviously
    // malformed leaf (non-integer, non-positive, non-string) is dropped with a
    // warning and siblings still parse. The authoritative bounded validation
    // (and the safety-disabling rejection) lives in `resolveSessionPolicySource`
    // (`src/core/session-policy-parity/policy-source.ts`), which re-validates
    // the selected value; this parser only drops what is clearly malformed so a
    // hand-edited config never fails parsing.
    if (raw.sessionPolicy !== undefined) {
      if (
        raw.sessionPolicy &&
        typeof raw.sessionPolicy === 'object' &&
        !Array.isArray(raw.sessionPolicy)
      ) {
        const spRaw = raw.sessionPolicy as Record<string, unknown>;
        const sessionPolicy: ProjectConfig['sessionPolicy'] = {};
        if (spRaw.handoffTokenLimit !== undefined) {
          if (
            Number.isInteger(spRaw.handoffTokenLimit) &&
            (spRaw.handoffTokenLimit as number) > 0
          ) {
            sessionPolicy.handoffTokenLimit = spRaw.handoffTokenLimit as number;
          } else {
            warnConfig(
              {
                key: 'invalidSessionPolicyHandoffTokenLimit',
                fallback: `Invalid 'sessionPolicy.handoffTokenLimit' in config (must be a positive integer)`,
              },
              reporter
            );
          }
        }
        if (spRaw.reuseRoundLimit !== undefined) {
          if (
            Number.isInteger(spRaw.reuseRoundLimit) &&
            (spRaw.reuseRoundLimit as number) > 0
          ) {
            sessionPolicy.reuseRoundLimit = spRaw.reuseRoundLimit as number;
          } else {
            warnConfig(
              {
                key: 'invalidSessionPolicyReuseRoundLimit',
                fallback: `Invalid 'sessionPolicy.reuseRoundLimit' in config (must be a positive integer)`,
              },
              reporter
            );
          }
        }
        if (spRaw.touchMaxIdleMs !== undefined) {
          if (
            Number.isInteger(spRaw.touchMaxIdleMs) &&
            (spRaw.touchMaxIdleMs as number) > 0
          ) {
            sessionPolicy.touchMaxIdleMs = spRaw.touchMaxIdleMs as number;
          } else {
            warnConfig(
              {
                key: 'invalidSessionPolicyTouchMaxIdleMs',
                fallback: `Invalid 'sessionPolicy.touchMaxIdleMs' in config (must be a positive integer)`,
              },
              reporter
            );
          }
        }
        if (spRaw.retireReasonLabel !== undefined) {
          if (typeof spRaw.retireReasonLabel === 'string' && spRaw.retireReasonLabel.length > 0) {
            sessionPolicy.retireReasonLabel = spRaw.retireReasonLabel;
          } else {
            warnConfig(
              {
                key: 'invalidSessionPolicyRetireReasonLabel',
                fallback: `Invalid 'sessionPolicy.retireReasonLabel' in config (must be a non-empty string)`,
              },
              reporter
            );
          }
        }
        config.sessionPolicy = sessionPolicy;
      } else {
        warnConfig(
          {
            key: 'invalidSessionPolicy',
            fallback: `Invalid 'sessionPolicy' field in config (must be an object)`,
          },
          reporter
        );
      }
    }

    // Parse handoff field: an optional map with an optional dual-form
    // `threshold` field (a bare fraction in (0, 1], or the absolute
    // `{ remainingTokens: N }` headroom form), plus an optional `roles` map
    // of per-role dual-form threshold overrides. Non-map -> whole block
    // dropped with a warning. An invalid threshold (either form, at either
    // the scalar or a per-role field) -> that field dropped with a warning,
    // siblings still parse.
    if (raw.handoff !== undefined) {
      if (raw.handoff && typeof raw.handoff === 'object' && !Array.isArray(raw.handoff)) {
        const handoffRaw = raw.handoff as Record<string, unknown>;
        const handoff: ProjectConfig['handoff'] = {};
        if (handoffRaw.threshold !== undefined) {
          const parsedThreshold = thresholdSchema('threshold').safeParse(handoffRaw.threshold);
          if (parsedThreshold.success) {
            handoff.threshold = parsedThreshold.data;
          } else {
            warnConfig(
              {
                key: 'invalidHandoffThreshold',
                fallback: `Invalid 'handoff.threshold' field in config (must be a number in (0, 1], or an object { remainingTokens: <positive integer> })`,
              },
              reporter
            );
          }
        }
        if (handoffRaw.roles !== undefined) {
          if (handoffRaw.roles && typeof handoffRaw.roles === 'object' && !Array.isArray(handoffRaw.roles)) {
            const rolesRaw = handoffRaw.roles as Record<string, unknown>;
            const roles: NonNullable<ProjectConfig['handoff']>['roles'] = {};
            for (const role of ['planner', 'implementer', 'reviewer', 'fixer', 'shipper'] as const) {
              if (rolesRaw[role] === undefined) continue;
              const parsedRoleThreshold = thresholdSchema('threshold').safeParse(rolesRaw[role]);
              if (parsedRoleThreshold.success) {
                roles[role] = parsedRoleThreshold.data;
              } else {
                console.warn(
                  `Invalid 'handoff.roles.${role}' field in config (must be a number in (0, 1], or an object { remainingTokens: <positive integer> })`
                );
              }
            }
            if (Object.keys(roles).length > 0) {
              handoff.roles = roles;
            }
          } else {
            console.warn(`Invalid 'handoff.roles' field in config (must be an object)`);
          }
        }
        config.handoff = handoff;
      } else {
        warnConfig(
          {
            key: 'invalidHandoff',
            fallback: `Invalid 'handoff' field in config (must be an object)`,
          },
          reporter
        );
      }
    }

    // Runtime threshold bindings preserve syntactically valid scheme names
    // even when the referenced machine-local scheme is absent. Resolution
    // reports dangling names; parsing only rejects invalid rows/keys.
    if (raw.thresholds !== undefined) {
      if (raw.thresholds && typeof raw.thresholds === 'object' && !Array.isArray(raw.thresholds)) {
        const thresholdsRaw = raw.thresholds as Record<string, unknown>;
        const bindingsRaw = thresholdsRaw.bindings;
        if (bindingsRaw === undefined) {
          config.thresholds = { bindings: {} };
        } else if (
          bindingsRaw &&
          typeof bindingsRaw === 'object' &&
          !Array.isArray(bindingsRaw)
        ) {
          const bindings: Record<string, string> = {};
          for (const [runtime, schemeName] of Object.entries(
            bindingsRaw as Record<string, unknown>
          )) {
            const validRuntime =
              runtime === 'default' || hasRuntimeCapability(runtime, 'canProbeContext');
            const validScheme =
              typeof schemeName === 'string' &&
              validateThresholdSchemeName(schemeName) === null;
            if (validRuntime && validScheme) {
              bindings[runtime] = schemeName;
            } else {
              console.warn(
                `Invalid 'thresholds.bindings.${runtime}' field in config (runtime must be default or one of ${PROBE_RUNTIMES.join(', ')} and value must be a valid non-reserved scheme name)`
              );
            }
          }
          config.thresholds = { bindings };
        } else {
          console.warn(`Invalid 'thresholds.bindings' field in config (must be an object)`);
        }
      } else {
        console.warn(`Invalid 'thresholds' field in config (must be an object)`);
      }
    }

    // Parse keepalive field resiliently so project-scoped enabled/beat values
    // participate in effective-config resolution without invalid siblings
    // discarding the whole block.
    if (raw.keepalive !== undefined) {
      if (raw.keepalive && typeof raw.keepalive === 'object' && !Array.isArray(raw.keepalive)) {
        const keepaliveRaw = raw.keepalive as Record<string, unknown>;
        const keepalive: NonNullable<ProjectConfig['keepalive']> = {};
        if (keepaliveRaw.enabled !== undefined) {
          if (typeof keepaliveRaw.enabled === 'boolean') {
            keepalive.enabled = keepaliveRaw.enabled;
          } else {
            console.warn(`Invalid 'keepalive.enabled' field in config (must be a boolean)`);
          }
        }
        if (keepaliveRaw.runtimes !== undefined) {
          if (
            keepaliveRaw.runtimes &&
            typeof keepaliveRaw.runtimes === 'object' &&
            !Array.isArray(keepaliveRaw.runtimes)
          ) {
            const runtimesRaw = keepaliveRaw.runtimes as Record<string, unknown>;
            const runtimes: NonNullable<NonNullable<ProjectConfig['keepalive']>['runtimes']> = {};
            for (const runtime of ['claude', 'codex'] as const) {
              if (runtimesRaw[runtime] === undefined) continue;
              if (typeof runtimesRaw[runtime] === 'boolean') {
                runtimes[runtime] = runtimesRaw[runtime];
              } else {
                console.warn(`Invalid 'keepalive.runtimes.${runtime}' field in config (must be a boolean)`);
              }
            }
            if (Object.keys(runtimes).length > 0) keepalive.runtimes = runtimes;
          } else {
            console.warn(`Invalid 'keepalive.runtimes' field in config (must be an object)`);
          }
        }
        if (keepaliveRaw.contextFloor !== undefined) {
          if (
            typeof keepaliveRaw.contextFloor === 'number' &&
            Number.isInteger(keepaliveRaw.contextFloor) &&
            keepaliveRaw.contextFloor >= 0
          ) {
            keepalive.contextFloor = keepaliveRaw.contextFloor;
          } else {
            console.warn(`Invalid 'keepalive.contextFloor' field in config (must be a non-negative integer)`);
          }
        }
        if (keepaliveRaw.beatSeconds !== undefined) {
          if (
            typeof keepaliveRaw.beatSeconds === 'number' &&
            Number.isInteger(keepaliveRaw.beatSeconds) &&
            keepaliveRaw.beatSeconds >= 90 &&
            keepaliveRaw.beatSeconds <= 280
          ) {
            keepalive.beatSeconds = keepaliveRaw.beatSeconds;
          } else {
            console.warn(`Invalid 'keepalive.beatSeconds' field in config (must be an integer between 90 and 280)`);
          }
        }
        config.keepalive = keepalive;
      } else {
        console.warn(`Invalid 'keepalive' field in config (must be an object)`);
      }
    }

    // Parse models field: an optional map with an optional `default` string
    // and an optional `roles` map of per-role model strings. Non-map -> whole
    // block dropped with a warning. An invalid field -> that field dropped
    // with a warning, siblings still parse. Model ids are free strings — any
    // non-empty string is accepted, never validated against an allow-list.
    if (raw.models !== undefined) {
      if (raw.models && typeof raw.models === 'object' && !Array.isArray(raw.models)) {
        const modelsRaw = raw.models as Record<string, unknown>;
        const models: ProjectConfig['models'] = {};
        if (modelsRaw.default !== undefined) {
          if (typeof modelsRaw.default === 'string' && modelsRaw.default.length > 0) {
            models.default = modelsRaw.default;
          } else {
            console.warn(`Invalid 'models.default' field in config (must be a non-empty string)`);
          }
        }
        if (modelsRaw.roles !== undefined) {
          if (modelsRaw.roles && typeof modelsRaw.roles === 'object' && !Array.isArray(modelsRaw.roles)) {
            const rolesRaw = modelsRaw.roles as Record<string, unknown>;
            const roles: NonNullable<ProjectConfig['models']>['roles'] = {};
            for (const role of ['planner', 'implementer', 'reviewer', 'fixer', 'shipper'] as const) {
              if (rolesRaw[role] === undefined) continue;
              if (typeof rolesRaw[role] === 'string' && (rolesRaw[role] as string).length > 0) {
                roles[role] = rolesRaw[role] as string;
              } else {
                console.warn(`Invalid 'models.roles.${role}' field in config (must be a non-empty string)`);
              }
            }
            if (Object.keys(roles).length > 0) {
              models.roles = roles;
            }
          } else {
            console.warn(`Invalid 'models.roles' field in config (must be an object)`);
          }
        }
        config.models = models;
      } else {
        console.warn(`Invalid 'models' field in config (must be an object)`);
      }
    }

    if (raw.efforts !== undefined) {
      if (raw.efforts && typeof raw.efforts === 'object' && !Array.isArray(raw.efforts)) {
        const effortsRaw = raw.efforts as Record<string, unknown>;
        const efforts: ProjectConfig['efforts'] = {};
        if (effortsRaw.default !== undefined) {
          const parsed = LeafEffortSchema.safeParse(effortsRaw.default);
          if (parsed.success) efforts.default = parsed.data;
          else console.warn(`Invalid 'efforts.default' field in config (must be one of ${LEAF_EFFORTS.join(', ')})`);
        }
        if (effortsRaw.roles !== undefined) {
          if (effortsRaw.roles && typeof effortsRaw.roles === 'object' && !Array.isArray(effortsRaw.roles)) {
            const rolesRaw = effortsRaw.roles as Record<string, unknown>;
            const roles: NonNullable<ProjectConfig['efforts']>['roles'] = {};
            for (const role of THRESHOLD_ROLES) {
              if (rolesRaw[role] === undefined) continue;
              const parsed = LeafEffortSchema.safeParse(rolesRaw[role]);
              if (parsed.success) roles[role] = parsed.data;
              else console.warn(`Invalid 'efforts.roles.${role}' field in config (must be one of ${LEAF_EFFORTS.join(', ')})`);
            }
            if (Object.keys(roles).length > 0) efforts.roles = roles;
          } else {
            console.warn(`Invalid 'efforts.roles' field in config (must be an object)`);
          }
        }
        config.efforts = efforts;
      } else {
        console.warn(`Invalid 'efforts' field in config (must be an object)`);
      }
    }

    // Parse pipelines field: an optional map keyed by pipeline name, each
    // value an optional map of `gates`/`models`/`handoff` per-stage records —
    // the storage side of the `pipelines.<name>.{gates,models,handoff}.<stage>`
    // config-key families. Resilient like every block above: a non-map, an
    // invalid axis, or an invalid per-stage leaf is dropped with a warning
    // while valid siblings survive. Unknown axes (not gates/models/handoff)
    // are ignored with a warning, never a hard error.
    if (raw.pipelines !== undefined) {
      const pipelines = parsePipelinesBlock(raw.pipelines);
      if (pipelines) {
        config.pipelines = pipelines;
      }
    }

  // Return partial config even if some fields failed
  return Object.keys(config).length > 0 ? (config as ProjectConfig) : null;
}

function configPathForWarnings(projectRoot: string): string {
  return resolveConfigFilePath(projectRoot) ?? path.join(projectRoot, WORKSPACE_DIR_NAME, 'config.yaml');
}

/**
 * Validate artifact IDs in rules against a schema's artifacts.
 * Called during instruction loading (when schema is known).
 * Returns warnings for unknown artifact IDs.
 *
 * @param rules - The rules object from config
 * @param validArtifactIds - Set of valid artifact IDs from the schema
 * @param schemaName - Name of the schema for error messages
 * @returns Array of warning messages for unknown artifact IDs
 */
export function validateConfigRules(
  rules: Record<string, string[]>,
  validArtifactIds: Set<string>,
  schemaName: string
): string[] {
  const warnings: string[] = [];

  for (const artifactId of Object.keys(rules)) {
    if (!validArtifactIds.has(artifactId)) {
      const validIds = Array.from(validArtifactIds).sort().join(', ');
      warnings.push(
        `Unknown artifact ID in rules: "${artifactId}". ` +
          `Valid IDs for schema "${schemaName}": ${validIds}`
      );
    }
  }

  return warnings;
}

/**
 * Suggest valid schema names when user provides invalid schema.
 * Uses fuzzy matching to find similar names.
 *
 * @param invalidSchemaName - The invalid schema name from config
 * @param availableSchemas - List of available schemas with their type (built-in or project-local)
 * @returns Error message with suggestions and available schemas
 */
export function suggestSchemas(
  invalidSchemaName: string,
  availableSchemas: { name: string; isBuiltIn: boolean }[]
): string {
  // Simple fuzzy match: Levenshtein distance
  function levenshtein(a: string, b: string): number {
    const matrix: number[][] = [];
    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }
    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }
    return matrix[b.length][a.length];
  }

  // Find closest matches (distance <= 3)
  const suggestions = availableSchemas
    .map((s) => ({ ...s, distance: levenshtein(invalidSchemaName, s.name) }))
    .filter((s) => s.distance <= 3)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 3);

  const builtIn = availableSchemas.filter((s) => s.isBuiltIn).map((s) => s.name);
  const projectLocal = availableSchemas.filter((s) => !s.isBuiltIn).map((s) => s.name);

  let message = `Schema '${invalidSchemaName}' not found in openspec/config.yaml\n\n`;

  if (suggestions.length > 0) {
    message += `Did you mean one of these?\n`;
    suggestions.forEach((s) => {
      const type = s.isBuiltIn ? 'built-in' : 'project-local';
      message += `  - ${s.name} (${type})\n`;
    });
    message += '\n';
  }

  message += `Available schemas:\n`;
  if (builtIn.length > 0) {
    message += `  Built-in: ${builtIn.join(', ')}\n`;
  }
  if (projectLocal.length > 0) {
    message += `  Project-local: ${projectLocal.join(', ')}\n`;
  } else {
    message += `  Project-local: (none found)\n`;
  }

  message += `\nFix: Edit openspec/config.yaml and change 'schema: ${invalidSchemaName}' to a valid schema name`;

  return message;
}

// -----------------------------------------------------------------------------
// Store pointer (declared default store)
// -----------------------------------------------------------------------------

/**
 * Normalizes a `store:` value in the durable object form, or null when it is
 * not one. Shared by the resilient parser and the targeted pointer read so the
 * two can never disagree on what counts as a usable declaration.
 */
function parseDurableStoreDeclaration(value: unknown): StorePointerV2 | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (!isValidStoreUid(raw.uid)) return null;

  const id = typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : undefined;
  const remote = typeof raw.remote === 'string' && raw.remote.length > 0 ? raw.remote : undefined;

  return {
    uid: raw.uid,
    ...(id !== undefined ? { id } : {}),
    ...(remote !== undefined ? { remote } : {}),
  };
}

/** How a project declared its Store, before any resolution is attempted. */
export type StorePointerShape = 'absent' | 'alias' | 'durable' | 'malformed';

export type StorePointerProblem = 'unparseable' | 'non_string' | 'invalid_object';

export interface StorePointerRead {
  /** Discriminates the declaration form actually found on disk. */
  shape: StorePointerShape;
  /**
   * The declared display alias: the whole value for the legacy string form,
   * and the `id` field for the durable object form. Absent for a durable
   * declaration that records only a permanent identity.
   */
  value?: string;
  /** The durable declaration, when the `store:` value is the object form. */
  durable?: StorePointerV2;
  /** Set when the pointer cannot be trusted: the config file could not be
   * read as YAML, the store key is neither a string nor a store declaration,
   * or the declaration carries no usable permanent identity. An empty
   * or comments-only config is NOT malformed - it simply has no pointer. */
  malformed?: StorePointerProblem;
  /** Absolute path of the config file actually read, or null when none exists. */
  filePath: string | null;
}

function readDurableStorePointer(
  raw: Record<string, unknown>,
  configPath: string
): StorePointerRead {
  const durable = parseDurableStoreDeclaration(raw);
  if (!durable) {
    return { shape: 'malformed', malformed: 'invalid_object', filePath: configPath };
  }

  return {
    shape: 'durable',
    ...(durable.id !== undefined ? { value: durable.id } : {}),
    durable,
    filePath: configPath,
  };
}

/**
 * Warning-silent targeted read of the `store:` declaration. Used by root
 * resolution (which must not re-emit the resilient parser's field
 * warnings) and by `rasen init`'s pointer guard. Unlike
 * `readProjectConfig`, a malformed value is REPORTED, not dropped —
 * a dropped pointer would silently flip where work lands. Both the legacy
 * single-name form and the durable `{ uid, id?, remote? }` form are read.
 */
export function readStorePointer(projectRoot: string): StorePointerRead {
  const configPath = resolveConfigFilePath(projectRoot);
  if (configPath === null) {
    return { shape: 'absent', filePath: null };
  }

  try {
    const raw = parseYaml(readFileSync(configPath, 'utf-8'));
    // Empty, comments-only, or non-mapping configs carry no pointer;
    // they are imperfect, not malformed (readProjectConfig owns the
    // field warnings for those).
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { shape: 'absent', filePath: configPath };
    }
    const value = (raw as Record<string, unknown>).store;
    if (value === undefined) {
      return { shape: 'absent', filePath: configPath };
    }
    if (typeof value === 'string') {
      return { shape: 'alias', value, filePath: configPath };
    }
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      return readDurableStorePointer(value as Record<string, unknown>, configPath);
    }
    return { shape: 'malformed', malformed: 'non_string', filePath: configPath };
  } catch {
    return { shape: 'malformed', malformed: 'unparseable', filePath: configPath };
  }
}

/** Shared .yaml/.yml probe used by readProjectConfig and readStorePointer. */
export function resolveConfigFilePath(projectRoot: string): string | null {
  const yamlPath = path.join(projectRoot, WORKSPACE_DIR_NAME, 'config.yaml');
  if (existsSync(yamlPath)) {
    return yamlPath;
  }
  const ymlPath = path.join(projectRoot, WORKSPACE_DIR_NAME, 'config.yml');
  return existsSync(ymlPath) ? ymlPath : null;
}

/**
 * True when the config declares a store in ANY usable form. Every guard that
 * asks "is this repo's planning externalized?" MUST go through this — checking
 * `value` alone silently misses a durable declaration that records only the
 * permanent identity.
 */
export function hasStoreDeclaration(pointer: StorePointerRead): boolean {
  return pointer.shape === 'alias' || pointer.shape === 'durable';
}

/** The store a declaration names, for display: its alias, else its identity. */
export function describeStoreDeclaration(pointer: StorePointerRead): string | undefined {
  if (!hasStoreDeclaration(pointer)) return undefined;
  return pointer.value ?? pointer.durable?.uid;
}

/** Human rendering of a malformed pointer reason, shared by every surface. */
export function storePointerProblem(reason: StorePointerProblem): string {
  switch (reason) {
    case 'unparseable':
      return 'the config file could not be read as YAML';
    case 'invalid_object':
      return 'the store declaration must carry a well-formed permanent store identity as uid';
    case 'non_string':
      return 'the store key must be a single store id string';
  }
}

export interface OpenSpecDirClassification {
  /** True when openspec/specs or openspec/changes exists as a directory. */
  hasPlanningShape: boolean;
  pointer: StorePointerRead;
}

/**
 * One classification for "real root vs config-only pointer dir", shared
 * by root resolution and the init pointer guard so they can never
 * disagree (slice 3.2).
 */
export function classifyOpenSpecDir(projectRoot: string): OpenSpecDirClassification {
  const openspecDir = path.join(projectRoot, WORKSPACE_DIR_NAME);
  const hasPlanningShape =
    isDirectorySync(path.join(openspecDir, 'specs')) ||
    isDirectorySync(path.join(openspecDir, 'changes'));
  return { hasPlanningShape, pointer: readStorePointer(projectRoot) };
}

function isDirectorySync(candidatePath: string): boolean {
  try {
    return statSync(candidatePath).isDirectory();
  } catch {
    return false;
  }
}

// -----------------------------------------------------------------------------
// Project identity (lazy projectId minting)
// -----------------------------------------------------------------------------

/**
 * Reads (or mints) the project's stable `projectId`.
 *
 * If the config already carries a `projectId` (any string), it is returned
 * unchanged (a lock-free read - the common case after the first run).
 * Otherwise a new `crypto.randomUUID()` is minted and APPENDED to the config
 * file as a single `projectId: <uuid>` line, preserving the file's existing
 * content and comments verbatim. Minting is serialized under the project
 * registry lock (MINOR-3): two concurrent first-ever runs would otherwise
 * both mint distinct ids and race their appends, leaving the config and the
 * registry permanently divergent. The append always lands on its own line (a
 * guaranteed leading newline, regardless of the file's trailing whitespace),
 * and the write is re-read and validated; a failed validation reverts the
 * file to its original content.
 *
 * Throws when no config file exists (`rasen init` has not run) or when the
 * config file cannot be written.
 */
export async function ensureProjectIdInConfig(
  projectRoot: string,
  options: ProjectPathOptions = {}
): Promise<string> {
  const configPath = resolveConfigFilePath(projectRoot);
  if (configPath === null) {
    throw new Error(
      `No Rasen config found at ${path.join(projectRoot, WORKSPACE_DIR_NAME)}; run 'rasen init' first.`
    );
  }

  const existingContent = await fsPromises.readFile(configPath, 'utf-8');
  const existingId = extractProjectIdField(existingContent);
  if (existingId !== undefined) {
    return existingId;
  }

  return withProjectRegistryLock(async () => {
    // Re-read under the lock: another process may have minted and written
    // between the fast-path read above and this process acquiring the lock.
    const contentUnderLock = await fsPromises.readFile(configPath, 'utf-8');
    const idUnderLock = extractProjectIdField(contentUnderLock);
    if (idUnderLock !== undefined) {
      return idUnderLock;
    }

    const projectId = randomUUID();
    const trimmed = contentUnderLock.replace(/\n+$/u, '');
    const appended =
      trimmed.length > 0 ? `${trimmed}\nprojectId: ${projectId}\n` : `projectId: ${projectId}\n`;

    try {
      await fsPromises.writeFile(configPath, appended, 'utf-8');
    } catch (error) {
      throw new Error(
        `Could not write projectId to ${configPath} (${error instanceof Error ? error.message : String(error)}).`
      );
    }

    const verifyContent = await fsPromises.readFile(configPath, 'utf-8');
    if (extractProjectIdField(verifyContent) !== projectId) {
      // The append did not validate (e.g. an unexpected YAML edge case) -
      // revert rather than leave a config the parser cannot trust.
      await fsPromises.writeFile(configPath, contentUnderLock, 'utf-8');
      throw new Error(
        `Adding projectId to ${configPath} did not validate after write; reverted the file. Add 'projectId: <id>' manually or fix the file's YAML.`
      );
    }

    return projectId;
  }, options);
}

// -----------------------------------------------------------------------------
// Archive timing (config axis)
// -----------------------------------------------------------------------------

/**
 * Resolves the effective archive timing, applying the `on-merge` default
 * when the config, the `archive` block, or the `timing` field is absent or
 * was dropped during parsing. Every consumer (status exposure, ship and
 * archive templates) MUST resolve through this function so the default is
 * applied identically everywhere.
 */
export function resolveArchiveTiming(config: ProjectConfig | null | undefined): ArchiveTiming {
  return config?.archive?.timing ?? 'on-merge';
}

// `resolveArchiveDestinationValue` was deleted with the destination axis
// (`archive-destination` capability). Nothing routes on the value any more, so
// defaulting an absent key to `'in-repo'` would assert a choice that no longer
// exists. `archive.destination` is still PARSED and left on the config object
// for legacy discovery only — child B's migrator reads the raw field directly.

// -----------------------------------------------------------------------------
// Autopilot gate policy (config axis)
// -----------------------------------------------------------------------------

/** The resolved autopilot gate policy plus which layer produced it. */
export interface ResolvedGatePolicy {
  effective: AutopilotGatePolicy;
  source: 'flag' | 'project' | 'store' | 'global' | 'default';
}

/** Minimal shape of the global config's `autopilot` block, accepted so this module need not import `GlobalConfig` for one field. */
export interface AutopilotGlobalConfig {
  autopilot?: {
    gates?: 'on' | 'off';
    selection?: 'classify' | 'manual' | 'compose';
  };
}

// -----------------------------------------------------------------------------
// Run engine policy (ECP-5 config axis)
// -----------------------------------------------------------------------------

/** The resolved `runs.engine` policy plus which layer decided it. */
export interface ResolvedEnginePolicy {
  effective: RunsEnginePolicy;
  source: 'flag' | 'project' | 'store' | 'global' | 'default';
}

/** Minimal shape of the global config's `runs` block (same rationale as {@link AutopilotGlobalConfig}). */
export interface RunsGlobalConfig {
  runs?: {
    engine?: RunsEnginePolicy;
  };
}

/**
 * Resolves the effective Run engine policy with precedence: the `--engine`
 * run flag first, then the project config default (`runs.engine`), then the
 * inherited store config default (when a store layer is active — see
 * `store-config-inheritance`), then the global config default, then the
 * built-in default `auto`. Deliberately the same shape and source vocabulary
 * as {@link resolveAutopilotGatePolicy} — it is that axis's sibling, and every
 * consumer (CLI `pipeline start` enforcement, the `rasen-auto` engine line)
 * MUST resolve through this one function so precedence is applied identically.
 * An absent or invalid `runs.engine` at any scope falls through to the next
 * layer without failing config parsing.
 *
 * This resolves the policy for a NEW Run only. It never re-homes an existing
 * Run: engine ownership of a Run in flight is decided by
 * `assertSingleEngineOwner` from what is actually on disk, not by config.
 */
export function resolveRunsEnginePolicy(
  config: ProjectConfig | null | undefined,
  engineFlag: string | undefined,
  globalConfig?: RunsGlobalConfig | null,
  storeConfig?: ProjectConfig | null
): ResolvedEnginePolicy {
  if (engineFlag !== undefined) {
    if (!isRunsEnginePolicy(engineFlag)) {
      throw new Error(
        `Invalid --engine value "${engineFlag}" (must be ${RUNS_ENGINE_POLICIES.map((value) => `'${value}'`).join(', ')}).`
      );
    }
    return { effective: engineFlag, source: 'flag' };
  }
  const projectValue = config?.runs?.engine;
  if (isRunsEnginePolicy(projectValue)) {
    return { effective: projectValue, source: 'project' };
  }
  const storeValue = storeConfig?.runs?.engine;
  if (isRunsEnginePolicy(storeValue)) {
    return { effective: storeValue, source: 'store' };
  }
  const globalValue = globalConfig?.runs?.engine;
  if (isRunsEnginePolicy(globalValue)) {
    return { effective: globalValue, source: 'global' };
  }
  return { effective: 'auto', source: 'default' };
}

/**
 * Resolves the effective autopilot gate policy with precedence: the run
 * argument (`--no-gate`) first, then the project config default
 * (`autopilot.gates`), then the inherited store config default (when a store
 * layer is active — see `store-config-inheritance`), then the global config
 * default (`autopilot.gates`), then the built-in default (gates ON). Every
 * consumer (the `/rasen-auto` gate-policy resolution, run-state recording)
 * MUST resolve through this function so precedence is applied identically
 * everywhere. An absent or previously-dropped `autopilot.gates` value at any
 * scope falls back to the next layer without failing config parsing.
 * `storeConfig` defaults to `undefined` so existing three-argument call sites
 * (pre-dating the store layer) are unaffected.
 */
export function resolveAutopilotGatePolicy(
  config: ProjectConfig | null | undefined,
  noGateFlag: boolean,
  globalConfig?: AutopilotGlobalConfig | null,
  storeConfig?: ProjectConfig | null
): ResolvedGatePolicy {
  if (noGateFlag) {
    return { effective: 'off', source: 'flag' };
  }
  const projectValue = config?.autopilot?.gates;
  if (projectValue === 'on' || projectValue === 'off') {
    return { effective: projectValue, source: 'project' };
  }
  const storeValue = storeConfig?.autopilot?.gates;
  if (storeValue === 'on' || storeValue === 'off') {
    return { effective: storeValue, source: 'store' };
  }
  const globalValue = globalConfig?.autopilot?.gates;
  if (globalValue === 'on' || globalValue === 'off') {
    return { effective: globalValue, source: 'global' };
  }
  return { effective: 'on', source: 'default' };
}

// -----------------------------------------------------------------------------
// Autopilot selection policy (config axis)
// -----------------------------------------------------------------------------

/** The resolved autopilot pipeline-selection policy plus which layer produced it. */
export interface ResolvedSelectionPolicy {
  effective: AutopilotSelectionPolicy;
  source: 'flag' | 'project' | 'store' | 'global' | 'default';
}

/**
 * Resolves the effective autopilot pipeline-selection policy with precedence:
 * the run arguments first — `--auto-compose` ahead of `--auto-select` when
 * both are present (compose is the superset policy: classify-first, with
 * composition permitted on no-fit — see `autopilot-composed-pipelines`) —
 * then the project config default (`autopilot.selection`), then the global
 * config default (`autopilot.selection`), then the built-in default
 * (`manual`). Every consumer (the `/rasen-auto` selection-policy resolution)
 * MUST resolve through this function so precedence is applied identically
 * everywhere. An absent or previously-dropped `autopilot.selection` value at
 * either scope falls back to the next layer without failing config parsing.
 * Mirrors `resolveAutopilotGatePolicy`'s shape (same source vocabulary) by
 * design — this is that axis's sibling. Precedence: run flags first
 * (`--auto-compose` ahead of `--auto-select`), then the project config, then
 * the inherited store config (when a store layer is active — see
 * `store-config-inheritance`), then the global config, then the built-in
 * default (`manual`). Kept as a single resolver (not split by flag) so
 * precedence lives in exactly one place; `autoComposeFlag` defaults to `false`
 * so existing call sites (pre-dating the `compose` policy) are unaffected,
 * `globalConfig` defaults to `undefined` so existing two/three-argument call
 * sites (pre-dating the global layer) are unaffected, and `storeConfig`
 * defaults to `undefined` so existing four-argument call sites (pre-dating
 * the store layer) are unaffected.
 */
export function resolveAutopilotSelectionPolicy(
  config: ProjectConfig | null | undefined,
  autoSelectFlag: boolean,
  autoComposeFlag: boolean = false,
  globalConfig?: AutopilotGlobalConfig | null,
  storeConfig?: ProjectConfig | null
): ResolvedSelectionPolicy {
  if (autoComposeFlag) {
    return { effective: 'compose', source: 'flag' };
  }
  if (autoSelectFlag) {
    return { effective: 'classify', source: 'flag' };
  }
  const projectValue = config?.autopilot?.selection;
  if (projectValue === 'classify' || projectValue === 'manual' || projectValue === 'compose') {
    return { effective: projectValue, source: 'project' };
  }
  const storeValue = storeConfig?.autopilot?.selection;
  if (storeValue === 'classify' || storeValue === 'manual' || storeValue === 'compose') {
    return { effective: storeValue, source: 'store' };
  }
  const globalValue = globalConfig?.autopilot?.selection;
  if (globalValue === 'classify' || globalValue === 'manual' || globalValue === 'compose') {
    return { effective: globalValue, source: 'global' };
  }
  return { effective: 'manual', source: 'default' };
}

// -----------------------------------------------------------------------------
// Project-scope config writes (`rasen config set/unset --scope project`)
// -----------------------------------------------------------------------------

export interface UpdateProjectConfigKeyResult {
  configPath: string;
  /** For an unset (value === undefined): whether the key existed before the write. */
  existed: boolean;
}

/**
 * Sets or removes (`value === undefined`) a registry-validated key in the
 * project's `rasen/config.yaml`, preserving comments, key ordering, and every
 * unrelated field. Uses the `yaml` package's `parseDocument`/`setIn`/`deleteIn`
 * document-tree API rather than parse-mutate-`stringifyYaml(object)`, which
 * would destroy comments and ordering in a file documented as hand-editable.
 * Intermediate maps are created automatically for nested paths.
 *
 * Requires an existing `rasen/config.yaml` (or `.yml`) — this never creates
 * one; a config-less project fails with guidance instead, matching D4.
 * Callers MUST validate the key/value against the config-key registry
 * BEFORE calling this function; as a post-write sanity check, the written
 * content is re-parsed through the resilient `parseProjectConfigContent` so a
 * document-tree edit that somehow produces unparseable or schema-invalid YAML
 * is still surfaced (it should not happen once the registry has validated,
 * but the check is cheap and mirrors the validate-before-save pattern used by
 * the global `config set`).
 */
export function updateProjectConfigKey(
  projectRoot: string,
  keyPath: string,
  value: unknown,
  options: { reporter?: ConfigDiagnosticReporter } = {}
): UpdateProjectConfigKeyResult {
  const configPath = resolveConfigFilePath(projectRoot);
  if (configPath === null) {
    throw new Error(
      `No rasen/config.yaml found at ${path.join(projectRoot, WORKSPACE_DIR_NAME)}. Create the file (e.g. run 'rasen init') before setting project-scope config.`
    );
  }

  const originalContent = readFileSync(configPath, 'utf-8');
  const doc = parseDocument(originalContent);
  const keys = keyPath.split('.');

  let existed = false;
  if (value === undefined) {
    existed = doc.hasIn(keys);
    if (existed) {
      doc.deleteIn(keys);
    }
  } else {
    doc.setIn(keys, value);
  }

  const nextContent = String(doc);

  let reparsedRaw: unknown;
  try {
    reparsedRaw = parseYaml(nextContent);
  } catch (error) {
    throw new Error(
      `Writing "${keyPath}" would produce invalid YAML in ${configPath}; the file was not modified (${
        error instanceof Error ? error.message.split('\n')[0] : String(error)
      }).`
    );
  }
  void reparsedRaw;

  writeFileSync(configPath, nextContent, 'utf-8');

  // Post-write sanity check via the resilient reader (warnings, if any, are
  // real signal at this point — the registry validated the value already).
  parseProjectConfigContent(nextContent, projectRoot, options.reporter);

  return { configPath, existed };
}

/** One key edit for {@link updateProjectConfigKeys}: `value === undefined` removes the key, any other value sets it. */
export interface ProjectConfigKeyEdit {
  keyPath: string;
  value: unknown;
}

/**
 * Applies several project-config key edits (set and/or unset) in ONE
 * read→parse→write cycle of `rasen/config.yaml`, so a group of related keys can
 * never be left in a partial state by a crash (or a Windows EBUSY-class error)
 * between two separate single-key writes. This is the multi-key counterpart to
 * {@link updateProjectConfigKey} — same comment/ordering preservation via the
 * document-tree API and the same post-write re-parse sanity check; the ONLY
 * difference is that every edit lands in a single `writeFileSync`. Edits are
 * applied in order (a later edit to the same key wins). Callers MUST validate
 * every key/value against the config-key registry BEFORE calling this.
 * `existed` reports whether ANY unset edit removed a present key.
 */
export function updateProjectConfigKeys(
  projectRoot: string,
  edits: ProjectConfigKeyEdit[],
  options: { reporter?: ConfigDiagnosticReporter } = {}
): UpdateProjectConfigKeyResult {
  const configPath = resolveConfigFilePath(projectRoot);
  if (configPath === null) {
    throw new Error(
      `No rasen/config.yaml found at ${path.join(projectRoot, WORKSPACE_DIR_NAME)}. Create the file (e.g. run 'rasen init') before setting project-scope config.`
    );
  }

  const originalContent = readFileSync(configPath, 'utf-8');
  const doc = parseDocument(originalContent);

  let existed = false;
  for (const edit of edits) {
    const keys = edit.keyPath.split('.');
    if (edit.value === undefined) {
      if (doc.hasIn(keys)) {
        existed = true;
        doc.deleteIn(keys);
      }
    } else {
      doc.setIn(keys, edit.value);
    }
  }

  const nextContent = String(doc);

  try {
    parseYaml(nextContent);
  } catch (error) {
    const keyList = edits.map((edit) => `"${edit.keyPath}"`).join(', ');
    throw new Error(
      `Writing ${keyList} would produce invalid YAML in ${configPath}; the file was not modified (${
        error instanceof Error ? error.message.split('\n')[0] : String(error)
      }).`
    );
  }

  writeFileSync(configPath, nextContent, 'utf-8');

  // Post-write sanity check via the resilient reader (same rationale as the
  // single-key path: the registry validated the values already).
  parseProjectConfigContent(nextContent, projectRoot, options.reporter);

  return { configPath, existed };
}

// -----------------------------------------------------------------------------
// References append (store add-project)
// -----------------------------------------------------------------------------

export interface AppendStoreReferenceResult {
  configPath: string;
  /** False when the id was already present; nothing was written. */
  changed: boolean;
}

/** Renders a parsed declaration back to its raw YAML form, namespace-preserving. */
function declarationToRaw(entry: DeclarationEntry): string | Record<string, unknown> {
  if (entry.remote) {
    return entry.type === 'project'
      ? { id: entry.id, remote: entry.remote, type: 'project' }
      : { id: entry.id, remote: entry.remote };
  }
  return entry.type === 'project' ? `${PROJECT_REFERENCE_PREFIX}${entry.id}` : entry.id;
}

/**
 * Appends `storeId` to `targetRoot`'s `references:` list, preserving every
 * other config field. Follows the raw-YAML round-trip pattern used for the
 * quality-rules append (archive.ts:905-915): parse the full document, mutate
 * the one field, `stringifyYaml` back — never a schema-typed rewrite that
 * could silently drop unknown keys. De-dupes on the (type, id) pair (a no-op
 * when already present); a config-less root gets a minimal file containing
 * only `references:`. `options.type` selects the namespace of the appended
 * entry (absent means store, matching the pre-split behavior).
 */
export function appendStoreReference(
  targetRoot: string,
  storeId: string,
  options: { type?: 'store' | 'project' } = {}
): AppendStoreReferenceResult {
  const type = options.type ?? 'store';
  const existingPath = resolveConfigFilePath(targetRoot);
  const configPath = existingPath ?? path.join(targetRoot, WORKSPACE_DIR_NAME, 'config.yaml');

  const existingReferences = readProjectConfig(targetRoot)?.references ?? [];
  if (existingReferences.some((entry) => entry.id === storeId && (entry.type ?? 'store') === type)) {
    return { configPath, changed: false };
  }

  const rawConfig: Record<string, unknown> = existingPath
    ? ((parseYaml(readFileSync(existingPath, 'utf-8')) as Record<string, unknown>) || {})
    : {};

  rawConfig.references = [
    ...existingReferences.map(declarationToRaw),
    type === 'project' ? `${PROJECT_REFERENCE_PREFIX}${storeId}` : storeId,
  ];

  mkdirSync(path.dirname(configPath), { recursive: true });
  writeFileSync(configPath, stringifyYaml(rawConfig), 'utf-8');

  return { configPath, changed: true };
}

// -----------------------------------------------------------------------------
// Store membership hints (store add-project / store adopt)
// -----------------------------------------------------------------------------

export interface AppendStoreMembershipHintResult {
  configPath: string;
  /** False when an equivalent hint was already present; nothing was written. */
  changed: boolean;
  /** The hint list as it stands after the append. */
  hints: StoreMembershipHint[];
}

/** Renders a hint back to raw YAML, carrying only portable fields. */
function membershipHintToRaw(hint: StoreMembershipHint): Record<string, unknown> {
  return {
    ...(hint.uid !== undefined ? { uid: hint.uid } : {}),
    ...(hint.id !== undefined ? { id: hint.id } : {}),
    ...(hint.remote !== undefined ? { remote: hint.remote } : {}),
  };
}

/**
 * Refuses anything that looks like a location on this machine. The hint list
 * is committed and shared, so a path here would be wrong on every other
 * machine — and `path.isAbsolute` alone answers only for the CURRENT platform,
 * which is not the platform the file will be read on.
 */
function assertPortableHintValue(field: string, value: string): void {
  // path.isAbsolute catches the CURRENT platform's absolute forms;
  // path.win32.isAbsolute catches Windows forms regardless of platform
  // (drive-letter paths, UNC, POSIX-style root). A leading backslash covers
  // single-backslash root-relative (\Users\...), UNC (\\server\share),
  // device namespace (\\?\C:\...), and NT-namespace (\??\C:\...) forms.
  // /??/ is the POSIX-slash NT-namespace variant. All are machine-specific.
  if (
    path.isAbsolute(value) ||
    path.win32.isAbsolute(value) ||
    value.startsWith('\\') ||
    value.startsWith('/??/')
  ) {
    throw new Error(
      `Refusing to write a filesystem path into a store membership hint (${field}: ${value}). Membership hints are shared through git and carry only a permanent identity, a display name, and a credential-free remote.`
    );
  }
}

/**
 * Appends one Store membership hint to the project's config, preserving every
 * other field AND the file's comments (`parseDocument`, not a schema-typed
 * rewrite). De-duplicates on the Store's permanent identity, falling back to
 * its display alias for a Store that has none, and fills a field an existing
 * hint left empty rather than adding a second entry for the same Store.
 *
 * Written atomically: temp file in the same directory, then rename, so an
 * interrupted write never leaves a half-written config behind.
 *
 * Throws when the project has no config file — that is a repair the caller
 * reports, never a file this function invents (a config carrying nothing but
 * `storeMemberships` would not be a Rasen project).
 */
/**
 * Lock-error factory for the project-side membership hint append. Same shape
 * as the registry / membership-record factories. The lock lives in
 * `os.tmpdir()` (never inside the project git repo) so concurrent rasen
 * commands appending hints for DIFFERENT Stores serialize against each other
 * instead of one silently clobbering the other's non-overlapping append.
 */
const projectMembershipHintLockError = makeLockErrorFactory({
  createSubject: 'the project membership hint lock file',
  busyMessage: 'The project membership hint list is busy.',
  code: 'project_membership_hint_busy',
  target: 'project.config',
});

export async function appendStoreMembershipHint(
  projectRoot: string,
  hint: StoreMembershipHint
): Promise<AppendStoreMembershipHintResult> {
  if (hint.uid === undefined && hint.id === undefined) {
    throw new Error(
      'A store membership hint must name the store by permanent identity or display name.'
    );
  }
  if (hint.remote !== undefined) assertPortableHintValue('remote', hint.remote);
  if (hint.id !== undefined) assertPortableHintValue('id', hint.id);

  const configPath = resolveConfigFilePath(projectRoot);
  if (configPath === null) {
    throw new Error(
      `No rasen/config.yaml found at ${path.join(projectRoot, WORKSPACE_DIR_NAME)}; run 'rasen init' in the project before recording store membership.`
    );
  }

  // Wrap the read-modify-write so a concurrent append for a DIFFERENT Store
  // sees this write and adds its own next to it. The lock is keyed by the
  // absolute config path and lives under `os.tmpdir()`; it is never committable.
  return withOwnerAwareFileLock(
    {
      lockPath: machineLockPath(path.resolve(configPath)),
      errorFor: projectMembershipHintLockError,
      holder: 'project-membership-hint',
    },
    async () => {
      // Re-read INSIDE the lock so we see any append a concurrent caller
      // committed just before we acquired. The snapshot taken before the
      // lock was the root cause of the lost-write bug.
      const existing = readProjectConfig(projectRoot)?.storeMemberships ?? [];
      const key = storeMembershipHintKey(hint);
      const match = existing.find((entry) => storeMembershipHintKey(entry) === key);

      if (match) {
        const merged: StoreMembershipHint = {
          ...match,
          ...(match.uid === undefined && hint.uid !== undefined ? { uid: hint.uid } : {}),
          ...(match.id === undefined && hint.id !== undefined ? { id: hint.id } : {}),
          ...(match.remote === undefined && hint.remote !== undefined ? { remote: hint.remote } : {}),
        };
        if (
          merged.uid === match.uid &&
          merged.id === match.id &&
          merged.remote === match.remote
        ) {
          return { configPath, changed: false, hints: existing };
        }
        const hints = existing.map((entry) =>
          storeMembershipHintKey(entry) === key ? merged : entry
        );
        await writeStoreMembershipHints(configPath, hints);
        return { configPath, changed: true, hints };
      }

      const hints = [...existing, hint];
      await writeStoreMembershipHints(configPath, hints);
      return { configPath, changed: true, hints };
    }
  );
}

/**
 * Backfills a permanent identity into existing identityless `storeMemberships`
 * entries that name the store by display alias. A NEW writer (not
 * `appendStoreMembershipHint`) because the dedup key changes from `id:<alias>`
 * to `uid:<uid>` when a uid is added — the existing appender would fail to
 * match the old entry and append a duplicate, leaving the identityless entry
 * in place (still firing the warning). This writer matches by
 * `entry.uid === undefined && entry.id === match.id`, sets `entry.uid`, and
 * writes back through the same yaml-AST + owner-aware-lock approach.
 */
export async function backfillStoreMembershipUid(
  projectRoot: string,
  match: { id: string; uid: string }
): Promise<{ configPath: string; changed: boolean }> {
  const configPath = resolveConfigFilePath(projectRoot);
  if (configPath === null) {
    return { configPath: '', changed: false };
  }

  return withOwnerAwareFileLock(
    {
      lockPath: machineLockPath(path.resolve(configPath)),
      errorFor: projectMembershipHintLockError,
      holder: 'project-membership-hint',
    },
    async () => {
      // Re-read INSIDE the lock so concurrent backfills see each other's
      // writes, same discipline as `appendStoreMembershipHint`.
      const existing = readProjectConfig(projectRoot)?.storeMemberships ?? [];
      let changed = false;
      const updated = existing.map((entry) => {
        if (entry.uid === undefined && entry.id === match.id) {
          changed = true;
          return { ...entry, uid: match.uid };
        }
        return entry;
      });

      if (!changed) {
        return { configPath, changed: false };
      }

      await writeStoreMembershipHints(configPath, updated);
      return { configPath, changed: true };
    }
  );
}

async function writeStoreMembershipHints(
  configPath: string,
  hints: StoreMembershipHint[]
): Promise<void> {
  const doc = parseDocument(readFileSync(configPath, 'utf-8'));
  doc.setIn([STORE_MEMBERSHIPS_FIELD], hints.map(membershipHintToRaw));
  const nextContent = String(doc);

  try {
    parseYaml(nextContent);
  } catch (error) {
    throw new Error(
      `Writing "${STORE_MEMBERSHIPS_FIELD}" would produce invalid YAML in ${configPath}; the file was not modified (${
        error instanceof Error ? error.message.split('\n')[0] : String(error)
      }).`
    );
  }

  await writeFileAtomically(configPath, nextContent);
}

/** Extracts a valid string `projectId` field from raw config content, or undefined. */
function extractProjectIdField(content: string): string | undefined {
  let raw: unknown;
  try {
    raw = parseYaml(content);
  } catch {
    return undefined;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }
  const value = (raw as Record<string, unknown>).projectId;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
