import { WORKSPACE_DIR_NAME } from './config.js';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { promises as fsPromises } from 'fs';
import { randomUUID } from 'crypto';
import path from 'path';
import { parse as parseYaml, parseDocument, stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';

import { withProjectRegistryLock, type ProjectPathOptions } from './project-registry.js';
import { isKebabId } from './id.js';
import { thresholdSchema } from './pipeline-registry/types.js';

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

  // Optional: stable machine-local project identity (opaque string; any
  // non-empty JS string is accepted, minted as a UUID by init/first use).
  projectId: z
    .string()
    .optional()
    .describe('Stable project identity used by the machine-wide project registry'),

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

/** Normalized in-memory shape of a referenced store declaration. */
export interface DeclarationEntry {
  id: string;
  /** Clone source rendered into onboarding fixes. */
  remote?: string;
  /** Absent means the store namespace; 'project' addresses store add-project entries. */
  type?: 'store' | 'project';
}

export type ProjectConfig = z.infer<typeof ProjectConfigSchema> & {
  references?: DeclarationEntry[];
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
function parseDeclarationList(raw: unknown): DeclarationEntry[] | undefined {
  const fieldName = 'references';
  if (raw === undefined) {
    return undefined;
  }
  if (!Array.isArray(raw)) {
    console.warn(`Invalid '${fieldName}' field in config (must be an array of store ids)`);
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
    console.warn(`Some '${fieldName}' entries are invalid, ignoring them`);
  }
  if (droppedRemotes) {
    console.warn(
      `Some '${fieldName}' remotes are not non-empty strings; the ids are kept without a clone source`
    );
  }
  return byId.size > 0 ? [...byId.values()] : undefined;
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
export function readProjectConfig(projectRoot: string): ProjectConfig | null {
  const configPath = resolveConfigFilePath(projectRoot);
  if (configPath === null) {
    return null; // No config is OK
  }

  try {
    const content = readFileSync(configPath, 'utf-8');
    return parseProjectConfigContent(content, projectRoot);
  } catch (error) {
    console.warn(
      `Warning: could not parse ${configPathForWarnings(projectRoot)} (${error instanceof Error ? error.message.split('\n')[0] : String(error)}); ignoring it.`
    );
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
function parseProjectConfigContent(content: string, projectRoot: string): ProjectConfig | null {
  const raw = parseYaml(content);

  if (!raw || typeof raw !== 'object') {
    console.warn(`openspec/config.yaml is not a valid YAML object`);
    return null;
  }

  const config: Partial<ProjectConfig> = {};

    // Parse schema field using Zod
    const schemaField = z.string().min(1);
    const schemaResult = schemaField.safeParse(raw.schema);
    if (schemaResult.success) {
      config.schema = schemaResult.data;
    } else if (raw.schema !== undefined) {
      console.warn(`Invalid 'schema' field in config (must be non-empty string)`);
    }

    // Parse context field with size limit
    if (raw.context !== undefined) {
      const contextField = z.string();
      const contextResult = contextField.safeParse(raw.context);

      if (contextResult.success) {
        const contextSize = Buffer.byteLength(contextResult.data, 'utf-8');
        if (contextSize > MAX_CONTEXT_SIZE) {
          console.warn(
            `Context too large (${(contextSize / 1024).toFixed(1)}KB, limit: ${MAX_CONTEXT_SIZE / 1024}KB)`
          );
          console.warn(`Ignoring context field`);
        } else {
          config.context = contextResult.data;
        }
      } else {
        console.warn(`Invalid 'context' field in config (must be string)`);
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
              console.warn(
                `Some rules for '${artifactId}' are empty strings, ignoring them`
              );
            }
          } else {
            console.warn(
              `Rules for '${artifactId}' must be an array of strings, ignoring this artifact's rules`
            );
          }
        }

        if (hasValidRules) {
          config.rules = parsedRules;
        }
      } else {
        console.warn(`Invalid 'rules' field in config (must be object)`);
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
          console.warn(`Some quality-rules are empty strings, ignoring them`);
        }
      } else {
        console.warn(`Invalid 'quality-rules' field in config (must be array of strings)`);
      }
    }

    const references = parseDeclarationList(raw.references);
    if (references) {
      config.references = references;
    }

    // Parse store pointer field: a string, or dropped with a warning.
    // (Root resolution does NOT use this parse — it uses readStorePointer
    // below, which errors on malformed pointers instead of dropping.)
    if (raw.store !== undefined) {
      if (typeof raw.store === 'string') {
        config.store = raw.store;
      } else {
        console.warn(
          `Warning: ignoring invalid store: field in ${configPathForWarnings(projectRoot)} (must be a single store id string).`
        );
      }
    }

    // Parse projectId field: an opaque string identifier, or dropped with a
    // warning (any non-empty JS string is accepted; only non-strings drop).
    if (raw.projectId !== undefined) {
      if (typeof raw.projectId === 'string') {
        config.projectId = raw.projectId;
      } else {
        console.warn(`Invalid 'projectId' field in config (must be string)`);
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
            console.warn(`Invalid 'archive.timing' field in config (must be 'on-merge' or 'in-ship')`);
          }
        }
        if (archiveRaw.destination !== undefined) {
          if (
            archiveRaw.destination === 'in-repo' ||
            archiveRaw.destination === 'external' ||
            archiveRaw.destination === 'prune'
          ) {
            archive.destination = archiveRaw.destination;
          } else {
            console.warn(
              `Invalid 'archive.destination' field in config (must be 'in-repo', 'external', or 'prune')`
            );
          }
        }
        config.archive = archive;
      } else {
        console.warn(`Invalid 'archive' field in config (must be an object)`);
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
            console.warn(`Invalid 'autopilot.gates' field in config (must be 'on' or 'off')`);
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
            console.warn(
              `Invalid 'autopilot.selection' field in config (must be 'classify', 'manual', or 'compose')`
            );
          }
        }
        config.autopilot = autopilot;
      } else {
        console.warn(`Invalid 'autopilot' field in config (must be an object)`);
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
            console.warn(
              `Invalid 'handoff.threshold' field in config (must be a number in (0, 1], or an object { remainingTokens: <positive integer> })`
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
        console.warn(`Invalid 'handoff' field in config (must be an object)`);
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

export interface StorePointerRead {
  /** The declared store id, when present and a string. */
  value?: string;
  /** Set when the pointer cannot be trusted: the config file could not be
   * read as YAML, or the store key is present but not a string. An empty
   * or comments-only config is NOT malformed - it simply has no pointer. */
  malformed?: 'unparseable' | 'non_string';
  /** Absolute path of the config file actually read, or null when none exists. */
  filePath: string | null;
}

/**
 * Warning-silent targeted read of the `store:` pointer. Used by root
 * resolution (which must not re-emit the resilient parser's field
 * warnings) and by `rasen init`'s pointer guard. Unlike
 * `readProjectConfig`, a malformed value is REPORTED, not dropped —
 * a dropped pointer would silently flip where work lands.
 */
export function readStorePointer(projectRoot: string): StorePointerRead {
  const configPath = resolveConfigFilePath(projectRoot);
  if (configPath === null) {
    return { filePath: null };
  }

  try {
    const raw = parseYaml(readFileSync(configPath, 'utf-8'));
    // Empty, comments-only, or non-mapping configs carry no pointer;
    // they are imperfect, not malformed (readProjectConfig owns the
    // field warnings for those).
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { filePath: configPath };
    }
    const value = (raw as Record<string, unknown>).store;
    if (value === undefined) {
      return { filePath: configPath };
    }
    if (typeof value === 'string') {
      return { value, filePath: configPath };
    }
    return { malformed: 'non_string', filePath: configPath };
  } catch {
    return { malformed: 'unparseable', filePath: configPath };
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

/** Human rendering of a malformed pointer reason, shared by every surface. */
export function storePointerProblem(reason: 'unparseable' | 'non_string'): string {
  return reason === 'unparseable'
    ? 'the config file could not be read as YAML'
    : 'the store key must be a single store id string';
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

/**
 * Resolves the effective archive destination, applying the `in-repo`
 * default when the config, the `archive` block, or the `destination` field
 * is absent or was dropped during parsing. Every consumer (status exposure,
 * ship/archive templates, the CLI archive command) MUST resolve through
 * this function so the default is applied identically everywhere. This
 * decides only which value to use — the actual location resolution
 * (`resolveArchiveDestination` in `change-work.ts`) is async and beside
 * this function on purpose (`root.archiveDir` stays sync in-repo).
 */
export function resolveArchiveDestinationValue(
  config: ProjectConfig | null | undefined
): ArchiveDestination {
  return config?.archive?.destination ?? 'in-repo';
}

// -----------------------------------------------------------------------------
// Autopilot gate policy (config axis)
// -----------------------------------------------------------------------------

/** The resolved autopilot gate policy plus which layer produced it. */
export interface ResolvedGatePolicy {
  effective: AutopilotGatePolicy;
  source: 'flag' | 'project' | 'global' | 'default';
}

/** Minimal shape of the global config's `autopilot` block, accepted so this module need not import `GlobalConfig` for one field. */
export interface AutopilotGlobalConfig {
  autopilot?: {
    gates?: 'on' | 'off';
    selection?: 'classify' | 'manual' | 'compose';
  };
}

/**
 * Resolves the effective autopilot gate policy with precedence: the run
 * argument (`--no-gate`) first, then the project config default
 * (`autopilot.gates`), then the global config default (`autopilot.gates`),
 * then the built-in default (gates ON). Every consumer (the `/rasen:auto`
 * gate-policy resolution, run-state recording) MUST resolve through this
 * function so precedence is applied identically everywhere. An absent or
 * previously-dropped `autopilot.gates` value at either scope falls back to
 * the next layer without failing config parsing.
 */
export function resolveAutopilotGatePolicy(
  config: ProjectConfig | null | undefined,
  noGateFlag: boolean,
  globalConfig?: AutopilotGlobalConfig | null
): ResolvedGatePolicy {
  if (noGateFlag) {
    return { effective: 'off', source: 'flag' };
  }
  const projectValue = config?.autopilot?.gates;
  if (projectValue === 'on' || projectValue === 'off') {
    return { effective: projectValue, source: 'project' };
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
  source: 'flag' | 'project' | 'global' | 'default';
}

/**
 * Resolves the effective autopilot pipeline-selection policy with precedence:
 * the run arguments first — `--auto-compose` ahead of `--auto-select` when
 * both are present (compose is the superset policy: classify-first, with
 * composition permitted on no-fit — see `autopilot-composed-pipelines`) —
 * then the project config default (`autopilot.selection`), then the global
 * config default (`autopilot.selection`), then the built-in default
 * (`manual`). Every consumer (the `/rasen:auto` selection-policy resolution)
 * MUST resolve through this function so precedence is applied identically
 * everywhere. An absent or previously-dropped `autopilot.selection` value at
 * either scope falls back to the next layer without failing config parsing.
 * Mirrors `resolveAutopilotGatePolicy`'s shape (same source vocabulary) by
 * design — this is that axis's sibling. Kept as a single resolver (not split
 * by flag) so precedence lives in exactly one place; `autoComposeFlag`
 * defaults to `false` so existing call sites (pre-dating the `compose`
 * policy) are unaffected, and `globalConfig` defaults to `undefined` so
 * existing two/three-argument call sites (pre-dating the global layer) are
 * unaffected.
 */
export function resolveAutopilotSelectionPolicy(
  config: ProjectConfig | null | undefined,
  autoSelectFlag: boolean,
  autoComposeFlag: boolean = false,
  globalConfig?: AutopilotGlobalConfig | null
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
  value: unknown
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
  parseProjectConfigContent(nextContent, projectRoot);

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
