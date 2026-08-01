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
import * as fs from 'node:fs';
import { WORKSPACE_DIR_NAME } from './config.js';
import { resolveProjectHome, type ResolveProjectHomeOptions } from './project-home.js';

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
}

export interface ResolvedArchiveDestination {
  /**
   * The bookkeeping location — ALWAYS the in-repo archive directory. The
   * destination axis is retired (`archive-destination` capability), so this
   * is no longer nullable and no longer varies with configuration.
   */
  archiveDir: string;
}

/**
 * Resolves the archive bookkeeping location. There is exactly one:
 * `<planningRoot>/rasen/changes/archive` (the same path constants
 * `makeRoot` uses). No configuration branch remains — `archive.destination`
 * is a deprecated compat-read key that never routes a write
 * (`archive-destination` / `config-loading` capabilities).
 *
 * Kept as a function (rather than inlining `archiveBookkeepingDir`) so the
 * existing callers keep one seam to resolve through, and so the contrast
 * with `legacyExternalArchiveDir` — the READ-ONLY discovery probe for
 * archives written by the retired `external` destination — stays explicit.
 */
export function resolveArchiveDestination(projectRoot: string): ResolvedArchiveDestination {
  return {
    archiveDir: path.join(projectRoot, WORKSPACE_DIR_NAME, 'changes', 'archive'),
  };
}

/**
 * READ-ONLY discovery probe for archives written by the retired `external`
 * destination: the machine home's archive directory when a home resolves by
 * probe AND that directory actually exists on disk, else null. Never a write
 * target — it exists so `list`/`show`/`view` keep seeing the union of archive
 * locations, and so already-archived detection recognizes a change archived
 * there, until child B's migrator consolidates them into the planning root.
 *
 * Probe-only and error-swallowing by construction: legacy discovery must
 * never mint identity and must never break a command.
 */
export async function legacyExternalArchiveDir(
  projectRoot: string,
  options: ResolveArchiveDestinationOptions = {}
): Promise<string | null> {
  try {
    const probeOptions: ResolveProjectHomeOptions = {
      ensure: false,
      ...(options.globalDataDir !== undefined ? { globalDataDir: options.globalDataDir } : {}),
    };
    const probed = await resolveProjectHome(projectRoot, probeOptions);
    if (!probed) {
      return null;
    }
    return fs.existsSync(probed.archiveDir) ? probed.archiveDir : null;
  } catch {
    return null;
  }
}
