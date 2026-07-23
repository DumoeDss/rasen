/**
 * Relationship health composition (slice 3.6).
 *
 * One read-only answer to "are the roots this work relates to available
 * on this machine?" — pure composition over inputs the doctor command
 * gathers. The lock's four categories stay separated: root health,
 * store metadata health, and reference health. Nothing here (or
 * downstream) clones, syncs, or repairs.
 */
import { makeStoreDiagnostic, type StoreDiagnostic } from './store/errors.js';
import { sanitizeInline, type ReferenceIndexEntry } from './references.js';
import { storePointerProblem } from './project-config.js';
import { toRootOutput, type ResolvedOpenSpecRoot } from './root-selection.js';

export interface RelationshipHealth {
  root: {
    path: string;
    source: ResolvedOpenSpecRoot['source'];
    store_id?: string;
    healthy: boolean;
    status: StoreDiagnostic[];
  };
  store: {
    id: string;
    metadata: { present: boolean; valid: boolean; remote?: string };
    origin_url?: string;
    status: StoreDiagnostic[];
  } | null;
  references: ReferenceIndexEntry[];
  machineHome: MachineHomeHealth;
  status: StoreDiagnostic[];
}

export interface MachineHomeHealth {
  registered: boolean;
  entry?: { path: string; project_id: string; home: string; last_seen: string };
  /** Registered paths that no longer exist on disk (machine-wide, not just this project). */
  dangling: Array<{ path: string; home: string }>;
  /**
   * Worktree-duplicate registry entries (worktree-aware-spaces D5), machine-
   * wide: a live worktree-keyed entry whose main checkout is itself registered
   * under the same `projectId` — a legacy per-worktree entry `rasen doctor --gc`
   * collapses onto the main entry. Read-only reporting; empty when none.
   */
  worktreeDuplicates: Array<{ path: string; home: string; mainRoot: string }>;
  /** Set when the registry could not be read at all (e.g. corrupt registry.json,
   * MAJOR-2) - `registered`/`dangling` above then reflect no data, not a
   * verified "not registered" fact. */
  error?: { message: string; fix?: string };
  /**
   * Legacy in-repo T3 ephemera eligible for `rasen work migrate`
   * (`migrate-legacy-ephemera` task 3.1, review m1). Present only when the
   * total is greater than zero — a clean project omits this entirely
   * rather than reporting a zero count. `untracked`/`tracked` split the
   * total so the hint never implies the suggested command will move
   * everything when most of it is tracked (needs `--include-tracked`).
   * `splitUnavailable` is true when the split itself could not be
   * determined (non-git root, or the git query failed) — `total` is still
   * accurate; `untracked`/`tracked` are both 0 and must not be read as
   * "nothing tracked."
   */
  migratableEphemera?: {
    total: number;
    untracked: number;
    tracked: number;
    splitUnavailable: boolean;
    hint: string;
  };
  /**
   * Machine-root relocation state (`relocate-machine-home` D4): old-scheme
   * directories still on disk, split by whether their target already has
   * adopted content. Always present (possibly both empty) — read-only,
   * startup owns the adoption re-attempts.
   */
  relocation: {
    lingering: Array<{ path: string; target: string }>;
    pendingOrFailed: Array<{ path: string; target: string }>;
  };
}

export interface InspectRelationshipsInput {
  root: ResolvedOpenSpecRoot;
  rootHealthy: boolean;
  rootStatus?: StoreDiagnostic[];
  /** Store facts for store-backed roots (explicit or declared). */
  storeFacts?: {
    id: string;
    metadataPresent: boolean;
    metadataValid: boolean;
    canonicalRemote?: string;
    originUrl?: string;
  };
  referenceEntries: ReferenceIndexEntry[];
  registryUnreadable: boolean;
  /** A real root whose config also declares a store: pointer (3.2). */
  bothShapesPointer?: { value: string; filePath: string };
  /** A real root whose store: pointer value is malformed (3.2). */
  malformedPointer?: { filePath: string; reason: 'unparseable' | 'non_string' };
  /** Reference declarations in a pointer directory's own config are inert. */
  inertPointerDeclarations?: { filePath: string; fields: string[] };
  /** This project's machine-registry entry (probe-only; never mutated here). */
  machineHomeEntry?: { path: string; projectId: string; home: string; lastSeen: string };
  /** Dangling machine-registry entries, machine-wide. */
  danglingProjectEntries?: Array<{ path: string; home: string }>;
  /** Worktree-duplicate machine-registry entries, machine-wide (worktree-aware-spaces D5). */
  worktreeDuplicateEntries?: Array<{ path: string; home: string; mainRoot: string }>;
  /** Set when the machine registry could not be read (MAJOR-2). */
  machineHomeError?: { message: string; fix?: string };
  /** Migratable-legacy-ephemera counts (read-only scan; never computed for an unregistered project). */
  migratableEphemera?: { total: number; untracked: number; tracked: number; splitUnavailable: boolean };
  /** Machine-root relocation probe results (`checkMachineRootRelocation`), machine-wide, not just this project. */
  machineRootRelocation?: Array<{ path: string; target: string; targetHasContent: boolean }>;
  /**
   * Skill/CLI version mismatch (`delivery-reliability-version-guard`):
   * present when any configured tool's installed skills were generated by a
   * version different from the running CLI, re-derived directly from
   * `getAllToolVersionStatus` — independent of the ambient warning's
   * debounce state, so doctor always reports it regardless of whether that
   * warning already fired earlier in the same session.
   */
  skillVersionMismatch?: { stampVersion: string; cliVersion: string };
}

function warning(code: string, message: string, fix: string): StoreDiagnostic {
  return makeStoreDiagnostic('warning', code, message, { target: 'relationships', fix });
}

export function inspectRelationships(input: InspectRelationshipsInput): RelationshipHealth {
  const status: StoreDiagnostic[] = [];

  if (input.registryUnreadable) {
    status.push(
      warning(
        'relationship_registry_unreadable',
        'The store registry is unreadable; reference health cannot be checked.',
        'Run: rasen store doctor'
      )
    );
  }

  if (input.bothShapesPointer) {
    status.push(
      warning(
        'root_pointer_ignored',
        `${input.bothShapesPointer.filePath} declares store '${input.bothShapesPointer.value}', but this directory is a real Rasen root; the declaration is ignored.`,
        `Remove the store: line from ${input.bothShapesPointer.filePath}, or move the planning files into the store.`
      )
    );
  }

  if (input.malformedPointer) {
    status.push(
      warning(
        'root_pointer_invalid',
        `${input.malformedPointer.filePath} declares a store: pointer that cannot be used (${storePointerProblem(input.malformedPointer.reason)}).`,
        `Fix or remove the store: line in ${input.malformedPointer.filePath}.`
      )
    );
  }

  if (input.skillVersionMismatch) {
    status.push(
      warning(
        'skill_version_mismatch',
        `Installed skills were generated by rasen v${input.skillVersionMismatch.stampVersion}; the running CLI is v${input.skillVersionMismatch.cliVersion}.`,
        'rasen update'
      )
    );
  }

  if (input.inertPointerDeclarations && input.inertPointerDeclarations.fields.length > 0) {
    status.push(
      warning(
        'pointer_declarations_inert',
        `${input.inertPointerDeclarations.filePath} declares ${input.inertPointerDeclarations.fields.join(' and ')}, but commands read the resolved store's config — these declarations are inert.`,
        `Move the ${input.inertPointerDeclarations.fields.join('/')} declarations into the store's openspec/config.yaml.`
      )
    );
  }

  // Store section: metadata facts + the divergence info note.
  let store: RelationshipHealth['store'] = null;
  if (input.storeFacts) {
    const storeStatus: StoreDiagnostic[] = [];
    if (
      input.storeFacts.canonicalRemote &&
      input.storeFacts.originUrl &&
      input.storeFacts.canonicalRemote !== input.storeFacts.originUrl
    ) {
      storeStatus.push(
        makeStoreDiagnostic(
          'info',
          'store_remote_divergence',
          `The store.yaml remote (${sanitizeInline(input.storeFacts.canonicalRemote, 200)}) differs from the checkout's origin (${sanitizeInline(input.storeFacts.originUrl, 200)}).`,
          { target: 'store.metadata' }
        )
      );
    }
    store = {
      id: input.storeFacts.id,
      metadata: {
        present: input.storeFacts.metadataPresent,
        valid: input.storeFacts.metadataValid,
        ...(input.storeFacts.canonicalRemote
          ? { remote: input.storeFacts.canonicalRemote }
          : {}),
      },
      ...(input.storeFacts.originUrl ? { origin_url: input.storeFacts.originUrl } : {}),
      status: storeStatus,
    };
  }

  const relocationChecks = input.machineRootRelocation ?? [];
  const machineHome: MachineHomeHealth = {
    registered: input.machineHomeEntry !== undefined,
    ...(input.machineHomeEntry
      ? {
          entry: {
            path: input.machineHomeEntry.path,
            project_id: input.machineHomeEntry.projectId,
            home: input.machineHomeEntry.home,
            last_seen: input.machineHomeEntry.lastSeen,
          },
        }
      : {}),
    dangling: input.danglingProjectEntries ?? [],
    worktreeDuplicates: input.worktreeDuplicateEntries ?? [],
    ...(input.machineHomeError ? { error: input.machineHomeError } : {}),
    ...(input.migratableEphemera && input.migratableEphemera.total > 0
      ? {
          migratableEphemera: {
            total: input.migratableEphemera.total,
            untracked: input.migratableEphemera.untracked,
            tracked: input.migratableEphemera.tracked,
            splitUnavailable: input.migratableEphemera.splitUnavailable,
            hint: 'rasen work migrate',
          },
        }
      : {}),
    relocation: {
      lingering: relocationChecks
        .filter((check) => check.targetHasContent)
        .map((check) => ({ path: check.path, target: check.target })),
      pendingOrFailed: relocationChecks
        .filter((check) => !check.targetHasContent)
        .map((check) => ({ path: check.path, target: check.target })),
    },
  };

  return {
    root: {
      ...toRootOutput(input.root),
      healthy: input.rootHealthy,
      status: input.rootStatus ?? [],
    },
    store,
    references: input.referenceEntries,
    machineHome,
    status,
  };
}
