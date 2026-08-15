/**
 * Target-line and partition consistency checks for Store layout v2.
 *
 * Git can bypass Rasen entirely, so a Change, an Archive entry, or a canonical
 * spec can reach a Store ref without any Rasen operation having placed it
 * there. Doctor detects and reports the resulting inconsistencies without
 * rewriting history, moving an entry, replaying a spec delta, or merging
 * anything. Every finding names both disagreeing values and chooses neither.
 *
 * This module is purely read-only: it creates, moves, deletes, and rewrites
 * nothing. It contacts no network and repairs nothing.
 *
 * See `specs/store-v2-consistency-gates` for the requirements this implements.
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { parse as parseYaml } from 'yaml';

import { WORKSPACE_DIR_NAME } from '../config.js';
import { makeStoreDiagnostic, type StoreDiagnostic } from './errors.js';
import { readStoreLayoutState } from './layout-write-guard.js';

export interface ConsistencyDiagnosisInput {
  readonly storeId: string;
  readonly storeUid?: string;
  readonly storeRoot: string;
}

/**
 * Read-only consistency diagnosis over a Store's committed planning facts.
 * Returns findings for:
 * - An Archive entry whose recorded target line disagrees with its holding partition
 * - An Archive entry whose recorded project disagrees with its holding partition
 * - An entry naming a target line for which the Store has no catalog
 * - A target-line catalog whose declared storeRef does not resolve
 * - An active Change whose recorded project disagrees with its holding partition
 * - An active Change naming a target line for which the Store has no catalog
 *
 * Never repairs, never synthesizes a fact, never replays a spec delta.
 */
export async function diagnoseConsistency(
  input: ConsistencyDiagnosisInput
): Promise<StoreDiagnostic[]> {
  const state = await readStoreLayoutState(input.storeRoot);
  // Consistency checks only apply to Stores that declare layout version 2.
  if (state.declared !== 2) return [];

  const findings: StoreDiagnostic[] = [];
  const storeRoot = input.storeRoot;

  // Read declared target-line catalogs from `.rasen-store/target-lines/`.
  const catalogs = await readTargetLineCatalogs(storeRoot);
  const declaredTargetLineIds = new Set(catalogs.map((c) => c.id));

  // Check: each catalog's declared storeRef must resolve in the Store's Git
  // repository. An unresolvable ref means the release line points to nothing
  // — the first operation that tries to use it fails at runtime, and doctor
  // must report that before it happens.
  for (const catalog of catalogs) {
    if (catalog.storeRef === undefined) continue; // Malformed — reported elsewhere.
    const resolves = await gitRefResolves(storeRoot, catalog.storeRef);
    if (!resolves) {
      findings.push(
        makeStoreDiagnostic(
          'warning',
          'target_line_ref_unresolved',
          `Target-line catalog '${catalog.id}' declares storeRef '${catalog.storeRef}', but no such ref exists in the Store's Git repository.`,
          {
            target: catalog.path,
            fix: `Create '${catalog.storeRef}' in ${storeRoot}, or re-point the locator with 'rasen store target-line set-ref ${catalog.id} --store-ref <ref>'. Resolution never falls back to HEAD or to a similar ref.`,
          }
        )
      );
    }
  }

  // Walk project partitions: `rasen/projects/<projectId>/`
  const projectsDir = path.join(storeRoot, WORKSPACE_DIR_NAME, 'projects');
  let projectIds: string[] = [];
  try {
    projectIds = await listSubdirectories(projectsDir);
  } catch {
    return findings; // No project partitions — nothing else to check.
  }

  for (const projectId of projectIds) {
    const changesBase = path.join(projectsDir, projectId, 'changes');

    // Walk active Changes: `rasen/projects/<projectId>/changes/<changeId>/`
    await checkActiveChanges(
      changesBase,
      projectId,
      declaredTargetLineIds,
      input,
      findings
    );

    // Walk archive partitions: `rasen/projects/<projectId>/changes/archive/<targetLineId>/`
    const archiveBase = path.join(changesBase, 'archive');
    let targetLineDirs: string[] = [];
    try {
      targetLineDirs = await listSubdirectories(archiveBase);
    } catch {
      continue; // No archive partitions for this project.
    }

    for (const targetLineId of targetLineDirs) {
      const targetLinePartition = path.join(archiveBase, targetLineId);

      // Check: a target-line partition with no declared catalog.
      if (!declaredTargetLineIds.has(targetLineId)) {
        findings.push(
          makeStoreDiagnostic(
            'warning',
            'target_line_not_declared',
            `Project '${projectId}' holds an archive partition for target line '${targetLineId}', but the Store has no target-line catalog for it.`,
            {
              target: `${projectId}/changes/archive/${targetLineId}`,
              fix: `Add target line '${targetLineId}' with 'rasen store target-line add --store ${input.storeId} --project ${projectId} --target-line ${targetLineId}', or remove the partition if it was placed here by mistake.`,
            }
          )
        );
      }

      // Walk archive entries within this target-line partition.
      let entryDirs: string[] = [];
      try {
        entryDirs = await listSubdirectories(targetLinePartition);
      } catch {
        continue;
      }

      for (const entryName of entryDirs) {
        const archiveJsonPath = path.join(targetLinePartition, entryName, 'archive.json');
        let raw: string;
        try {
          raw = await fs.readFile(archiveJsonPath, 'utf8');
        } catch {
          continue; // No archive.json — not an Archive v2 entry.
        }

        // Parse the Archive v2 record. A corrupt record is reported by the
        // layout-migration diagnostics, not here; we only check consistency of
        // records that parse cleanly.
        let record: { projectId?: string; targetLineId?: string; changeId?: string };
        try {
          record = JSON.parse(raw);
        } catch {
          continue; // Corrupt JSON — reported elsewhere.
        }

        // Check: recorded target line disagrees with holding partition.
        if (
          record.targetLineId !== undefined &&
          record.targetLineId !== targetLineId
        ) {
          findings.push(
            makeStoreDiagnostic(
              'warning',
              'target_line_mismatch',
              `Archive entry '${entryName}' in project '${projectId}' records target line '${record.targetLineId}' but is held under target line '${targetLineId}'.`,
              {
                target: `${projectId}/changes/archive/${targetLineId}/${entryName}`,
                fix: `Inspect the entry and move it to the correct target-line partition, or correct the recorded target line. Doctor does not move entries or rewrite identities.`,
              }
            )
          );
        }

        // Check: recorded project disagrees with holding partition.
        if (
          record.projectId !== undefined &&
          record.projectId !== projectId
        ) {
          findings.push(
            makeStoreDiagnostic(
              'warning',
              'project_mismatch',
              `Archive entry '${entryName}' under project '${projectId}' records project '${record.projectId}'.`,
              {
                target: `${projectId}/changes/archive/${targetLineId}/${entryName}`,
                fix: `Inspect the entry and move it to the correct project partition, or correct the recorded project. Doctor does not move entries or rewrite identities.`,
              }
            )
          );
        }
      }
    }
  }

  return findings;
}

/**
 * Walks active Changes under a project partition and checks their recorded
 * identity for project and target-line disagreements.
 *
 * Active Changes carry a `.openspec.yaml` with an optional `identity` object
 * (ChangeMetadataIdentityV2) that records `projectId` and `targetLineId`.
 * The spec explicitly includes active Changes alongside Archive entries.
 */
async function checkActiveChanges(
  changesBase: string,
  holdingProjectId: string,
  declaredTargetLineIds: Set<string>,
  input: ConsistencyDiagnosisInput,
  findings: StoreDiagnostic[]
): Promise<void> {
  let entryNames: string[];
  try {
    entryNames = await listSubdirectories(changesBase);
  } catch {
    return; // No changes directory — nothing to check.
  }

  for (const entryName of entryNames) {
    if (entryName === 'archive') continue;

    const metadataPath = path.join(changesBase, entryName, '.openspec.yaml');
    let raw: string;
    try {
      raw = await fs.readFile(metadataPath, 'utf8');
    } catch {
      continue; // No metadata — not a Rasen Change.
    }

    let parsed: {
      identity?: {
        projectId?: string;
        targetLineId?: string;
      };
    };
    try {
      parsed = parseYaml(raw) as typeof parsed;
    } catch {
      continue; // Corrupt YAML — reported elsewhere.
    }

    const identity = parsed.identity;
    if (identity === undefined) continue; // No v2 identity — pre-v2 Change.

    // Check: recorded project disagrees with holding partition.
    if (
      identity.projectId !== undefined &&
      identity.projectId !== holdingProjectId
    ) {
      findings.push(
        makeStoreDiagnostic(
          'warning',
          'project_mismatch',
          `Active Change '${entryName}' under project '${holdingProjectId}' records project '${identity.projectId}'.`,
          {
            target: `${holdingProjectId}/changes/${entryName}`,
            fix: `Inspect the Change and move it to the correct project partition, or correct the recorded project. Doctor does not move entries or rewrite identities.`,
          }
        )
      );
    }

    // Check: recorded target line has no declared catalog.
    if (
      identity.targetLineId !== undefined &&
      !declaredTargetLineIds.has(identity.targetLineId)
    ) {
      findings.push(
        makeStoreDiagnostic(
          'warning',
          'target_line_not_declared',
          `Active Change '${entryName}' in project '${holdingProjectId}' records target line '${identity.targetLineId}', but the Store has no target-line catalog for it.`,
          {
            target: `${holdingProjectId}/changes/${entryName}`,
            fix: `Add target line '${identity.targetLineId}' with 'rasen store target-line add --store ${input.storeId} --project ${holdingProjectId} --target-line ${identity.targetLineId}', or correct the recorded target line.`,
          }
        )
      );
    }
  }
}

interface TargetLineCatalogRead {
  readonly id: string;
  readonly storeRef?: string;
  readonly path: string;
}

/**
 * Reads target-line catalogs from `.rasen-store/target-lines/*.yaml`.
 * Returns the catalog id (from the filename), the declared `storeRef` (from the
 * YAML content), and the catalog path. An unreadable or unparseable catalog
 * is returned with `storeRef: undefined` — layout-migration diagnostics handle
 * malformed catalogs.
 */
async function readTargetLineCatalogs(
  storeRoot: string
): Promise<readonly TargetLineCatalogRead[]> {
  const catalogDir = path.join(storeRoot, '.rasen-store', 'target-lines');
  let entries: string[];
  try {
    entries = await fs.readdir(catalogDir);
  } catch {
    return [];
  }

  const reads: TargetLineCatalogRead[] = [];
  for (const name of entries) {
    if (!name.endsWith('.yaml')) continue;
    const filePath = path.join(catalogDir, name);
    const id = name.slice(0, -5);
    let storeRef: string | undefined;
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const parsed = parseYaml(content) as Record<string, unknown>;
      if (typeof parsed?.storeRef === 'string') {
        storeRef = parsed.storeRef;
      }
    } catch {
      // Unreadable or unparseable catalog — reported by layout-migration
      // diagnostics, not here.
    }
    reads.push({ id, storeRef, path: filePath });
  }
  return reads;
}

/**
 * Checks whether a Git ref resolves by looking for it in the repository's
 * loose refs (`.git/refs/heads/main`) or packed refs (`.git/packed-refs`).
 *
 * Read-only: touches no network, spawns no process. This is deliberately a
 * filesystem-based check so the consistency module stays free of Git
 * subprocesses and Git adapters.
 */
async function gitRefResolves(storeRoot: string, ref: string): Promise<boolean> {
  const dotGit = path.join(storeRoot, '.git');

  // Resolve `.git` — it may be a directory or a gitfile pointing elsewhere.
  let gitDir = dotGit;
  try {
    const stat = await fs.lstat(dotGit);
    if (stat.isFile()) {
      // gitfile: `gitdir: /path/to/actual`
      const content = await fs.readFile(dotGit, 'utf8');
      const match = content.trim().match(/^gitdir:\s*(.+)$/);
      if (match === null) return false;
      gitDir = path.resolve(storeRoot, match[1] as string);
    }
  } catch {
    return false; // No `.git` — no ref can resolve.
  }

  // Loose ref: `.git/refs/heads/main`
  try {
    const content = await fs.readFile(path.join(gitDir, ref), 'utf8');
    if (content.trim().length > 0) return true;
  } catch {
    // Not a loose ref — check packed-refs.
  }

  // Packed refs: `.git/packed-refs` contains lines like `<sha> <refname>`.
  try {
    const packed = await fs.readFile(path.join(gitDir, 'packed-refs'), 'utf8');
    for (const line of packed.split('\n')) {
      // Lines starting with '#' are header; '^' are peeled tag objects.
      if (line.startsWith('#') || line.startsWith('^')) continue;
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      const parts = trimmed.split(' ');
      if (parts.length >= 2 && parts.slice(1).join(' ').trim() === ref) {
        return true;
      }
    }
  } catch {
    // No packed-refs file.
  }

  return false;
}

/** Lists immediate subdirectory names, skipping files. */
async function listSubdirectories(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}
