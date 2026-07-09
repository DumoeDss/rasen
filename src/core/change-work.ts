/**
 * Change work-directory resolution (design `externalize-artifacts-t3-workdir`,
 * D1): bridges an already-resolved planning root to the frozen
 * `resolveProjectHome` API (`./project-home.js`, shipped in
 * `externalize-artifacts-machine-home`) to answer one question — where does
 * this change's process ephemera (run-state, handoff docs, reports,
 * ship-log) live external to the repo?
 *
 * Probe-first, mint-once: every already-registered project (the common case,
 * every status/instructions call after the first) resolves via a pure,
 * lock-free read. Only a project with no machine identity yet, and only when
 * the caller opts into `ensure: true`, pays the one-time mint/register cost.
 * This keeps read-only commands (`status`, `pipeline resume`, `context`)
 * write-free by construction, while `instructions`/apply-instructions (the
 * designated mutation boundary, D2) can mint on demand.
 */
import path from 'path';
import { WORKSPACE_DIR_NAME } from './config.js';
import { resolveProjectHome, type ResolveProjectHomeOptions } from './project-home.js';
import {
  readProjectConfig,
  resolveArchiveDestinationValue,
  type ArchiveDestination,
} from './project-config.js';

export interface ResolveChangeWorkDirOptions {
  /** Test/DI override; forwarded to `resolveProjectHome`. */
  globalDataDir?: string;
  /**
   * false (default): probe only — never mints identity, registers the
   * project, or creates the home directory. true: mint-once when the probe
   * misses (per D2, only the instructions surfaces pass this).
   */
  ensure?: boolean;
}

/**
 * Resolves the absolute work directory for `changeName` under `projectRoot`'s
 * machine home, or null when no home can be resolved (unregistered project
 * and `ensure` not requested, `ensure` requested but resolution still
 * failed, or resolution hit an error). Never pre-creates the directory — the
 * CLI reports the path, agents create the files they write (matches child
 * 1's resolver contract: consumers create what they use).
 *
 * The ENTIRE body — probe and ensure alike — swallows any error
 * `resolveProjectHome` throws (e.g. a corrupt machine-global registry.json
 * on the probe path, no `rasen/config.yaml` on disk yet, or a write failure
 * minting `projectId` on the ensure path) and degrades to null rather than
 * letting it propagate: T3 work-dir placement is an enhancement, never a
 * requirement for a workflow command to succeed (same "never break a user
 * command" contract as `touchProjectRegistry`). Registry-corruption
 * reporting stays intact elsewhere — `doctor`'s machine-registry health
 * check reads the registry through its own path, independent of this
 * resolver.
 */
export async function resolveChangeWorkDir(
  projectRoot: string,
  changeName: string,
  options: ResolveChangeWorkDirOptions = {}
): Promise<string | null> {
  try {
    const probeOptions: ResolveProjectHomeOptions = {
      ensure: false,
      ...(options.globalDataDir !== undefined ? { globalDataDir: options.globalDataDir } : {}),
    };

    const probed = await resolveProjectHome(projectRoot, probeOptions);
    if (probed) {
      return probed.workDir(changeName);
    }

    if (!options.ensure) {
      return null;
    }

    const ensured = await resolveProjectHome(projectRoot, {
      ...(options.globalDataDir !== undefined ? { globalDataDir: options.globalDataDir } : {}),
      ensure: true,
    });
    return ensured ? ensured.workDir(changeName) : null;
  } catch {
    return null;
  }
}

export interface ResolveArchiveDestinationOptions {
  /** Test/DI override; forwarded to `resolveProjectHome`. */
  globalDataDir?: string;
  /**
   * false (default): probe only for `external` — never mints identity,
   * registers the project, or creates the home directory. true: mint-once
   * when the probe misses (only the CLI archive command's write path passes
   * this — archiving IS the home-needing write).
   */
  ensure?: boolean;
}

export interface ResolvedArchiveDestination {
  destination: ArchiveDestination;
  /**
   * The concrete bookkeeping location: the in-repo archive directory for
   * `in-repo`, the machine-home archive for `external` when it resolves,
   * or null (`external` unresolvable, or `prune`).
   */
  archiveDir: string | null;
}

/**
 * Resolves the effective archive destination axis (design D1):
 * `root.archiveDir` KEEPS its sync in-repo meaning everywhere it already
 * exists (legacy reads, default writes, scaffolding) — this async resolver
 * is the one place that maps config to a concrete bookkeeping location.
 * `in-repo` -> the in-repo archive directory (same path constants as
 * `makeRoot`); `external` -> `resolveProjectHome(...).archiveDir`
 * (probe-first; ensure only when `options.ensure` is true — child 2's
 * mint-once pattern); `prune` -> null. Every consumer resolves through this
 * function; nothing re-derives home paths (child 1's frozen-API rule). The
 * `external` branch's `resolveProjectHome` call is wrapped in try/catch and
 * degrades to a null `archiveDir` rather than throwing — destination
 * resolution is never allowed to break a workflow command (same contract as
 * `resolveChangeWorkDir`, though here only the `external` branch needs the
 * wrapping: `readProjectConfig`, used to determine `destination` itself,
 * already never throws — it returns null on a missing/unparseable config).
 * Reads `archive.destination` from `projectRoot`'s config itself (via
 * `readProjectConfig`) so every caller resolves the axis identically.
 */
export async function resolveArchiveDestination(
  projectRoot: string,
  options: ResolveArchiveDestinationOptions = {}
): Promise<ResolvedArchiveDestination> {
  const destination = resolveArchiveDestinationValue(readProjectConfig(projectRoot));

  if (destination === 'in-repo') {
    return {
      destination,
      archiveDir: path.join(projectRoot, WORKSPACE_DIR_NAME, 'changes', 'archive'),
    };
  }

  if (destination === 'prune') {
    return { destination, archiveDir: null };
  }

  // destination === 'external'
  try {
    const probeOptions: ResolveProjectHomeOptions = {
      ensure: false,
      ...(options.globalDataDir !== undefined ? { globalDataDir: options.globalDataDir } : {}),
    };
    const probed = await resolveProjectHome(projectRoot, probeOptions);
    if (probed) {
      return { destination, archiveDir: probed.archiveDir };
    }

    if (!options.ensure) {
      return { destination, archiveDir: null };
    }

    const ensured = await resolveProjectHome(projectRoot, {
      ...(options.globalDataDir !== undefined ? { globalDataDir: options.globalDataDir } : {}),
      ensure: true,
    });
    return { destination, archiveDir: ensured ? ensured.archiveDir : null };
  } catch {
    return { destination, archiveDir: null };
  }
}
