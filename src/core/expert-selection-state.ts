/**
 * Per-project machine-local acknowledgment for the expert install-semantics
 * flip (concept-coherence 6b, review-round fix for the cross-project data-
 * loss Blocker).
 *
 * `GlobalConfig.expertSelectionExplicit` (global-config.ts) is machine-wide:
 * it can flip to `true` from an action taken against a completely different
 * project (a fresh `rasen init` elsewhere, `profile use`/`new`/`import`, the
 * interactive picker — none of these commands know or care which project the
 * caller is standing in). Gating expert-dir PRUNING on the marker alone means
 * project A can lose previously-installed experts on its next `rasen update`
 * purely because project B did something unrelated — the reproduced Blocker
 * sequence.
 *
 * This module adds a second, per-project gate stored in that project's own
 * machine-local home directory (`resolveProjectHome`'s `homeDir` - already
 * documented as "the single entry point later children use to place
 * machine-local project state"). `update` only prunes an expert for a
 * project once THAT project has this acknowledgment file. The first `update`
 * run that observes the global marker flipped to `true` for a project that
 * lacks it stays on the legacy (keep-everything) branch for that one run,
 * prints the existing migration notice, and writes the acknowledgment so the
 * *next* `update` on that same project is the one that applies profile-
 * default narrowing. A brand-new project created via fresh `init` writes its
 * own acknowledgment immediately (there is nothing pre-existing to lose), so
 * it narrows from its very first install rather than taking the one-run
 * detour.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { getGlobalConfig } from './global-config.js';
import { resolveProjectHome } from './project-home.js';

/** Exported for tests that need to simulate a project predating this mechanism entirely. */
export const EXPERT_SELECTION_ACK_FILE_NAME = 'expert-selection-explicit.json';

/** True when `homeDir` has already been through its own expert-selection transition. */
export function hasExpertSelectionAck(homeDir: string): boolean {
  try {
    return fs.existsSync(path.join(homeDir, EXPERT_SELECTION_ACK_FILE_NAME));
  } catch {
    return false;
  }
}

/**
 * Read-only variant of the `expertSelectionExplicit` gate `update.ts`
 * computes (global marker AND this project's own acknowledgment) — never
 * writes the acknowledgment file itself; a project that has not yet
 * acknowledged simply reads as legacy (all-experts), same as its next
 * `update` would before that project acknowledges. Shared by the management
 * API's enablement read and the profile editor's drift warning.
 */
export async function resolveExpertSelectionExplicitReadOnly(projectRoot: string): Promise<boolean> {
  const globalConfig = getGlobalConfig();
  if (globalConfig.expertSelectionExplicit !== true) return false;
  try {
    const projectHome = await resolveProjectHome(projectRoot, { ensure: false });
    return projectHome !== null && hasExpertSelectionAck(projectHome.homeDir);
  } catch {
    return false;
  }
}

/**
 * Records that `homeDir`'s project has been through the transition. Best-
 * effort and silent on failure: a write failure just means this project's
 * next `update` re-evaluates from the same (safe, legacy) starting point
 * rather than corrupting state or throwing mid-command.
 */
export function writeExpertSelectionAck(homeDir: string): void {
  try {
    fs.mkdirSync(homeDir, { recursive: true });
    fs.writeFileSync(
      path.join(homeDir, EXPERT_SELECTION_ACK_FILE_NAME),
      JSON.stringify({ acknowledgedAt: new Date().toISOString() }, null, 2) + '\n',
      'utf-8'
    );
  } catch {
    // Best-effort; see docstring above.
  }
}
