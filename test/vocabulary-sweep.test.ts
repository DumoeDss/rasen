import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

// The store rename (slice 1.4) retired the pre-rename vocabulary. This
// sweep keeps it retired: no live surface may reintroduce the old tokens.
// The openspec/ planning-history tree is outside the sweep roots by
// design; the committed format literals (.openspec-store, store.yaml) do
// not match these patterns at all. The forbidden tokens are built by
// concatenation so this file stays clean under its own sweep.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// .codex/ is git-ignored local skill guidance (roadmap L8); swept when
// present, skipped when a checkout does not carry it.
const SWEEP_ROOTS = ['src', 'test', 'docs', 'scripts', '.codex'];

// Built by concatenation so this file never matches itself; the optional
// separator class covers the hyphen, underscore, fused, and spaced forms.
const FORBIDDEN_PATTERN = new RegExp('context' + '[-_ ]?store', 'i');

// Exact identifiers that legitimately contain the swept substring but are NOT
// the retired store noun-command vocabulary. W1 (store-as-config-scope,
// ratified) reintroduces the store as a CONFIG SCOPE on live surfaces:
// `contextStoreRef` is the config API's response field naming the store that
// supplies a config layer (config-api/router.ts). Allow exactly this token;
// every other reintroduction of the retired vocabulary is still caught,
// because stripping only this literal leaves any real offender matching. (The
// forbidden forms are never written out here so this file stays clean under
// its own sweep — same discipline as the concatenated pattern above.)
const ALLOWED_IDENTIFIERS = ['contextStoreRef'];

/**
 * A line carries the retired vocabulary only if it still matches after every
 * allowlisted identifier is removed — so `contextStoreRef` passes while a real
 * reintroduction on the same or any other line is still flagged.
 */
function carriesRetiredVocabulary(line: string): boolean {
  if (!FORBIDDEN_PATTERN.test(line)) {
    return false;
  }
  let residual = line;
  for (const allowed of ALLOWED_IDENTIFIERS) {
    residual = residual.split(allowed).join('');
  }
  return FORBIDDEN_PATTERN.test(residual);
}

// Fork note: historical analysis docs may cite the retired vocabulary when
// documenting the upstream transition itself (names and upstream paths are
// quoted verbatim there). Exempt them explicitly instead of rewording history.
const SWEEP_EXEMPT_FILES = new Set([
  'docs/upstream-v1.5-stores-and-resolution.md',
  'docs/zh/upstream-v1.5-stores-and-resolution.md',
]);

const TEXT_EXTENSIONS = new Set([
  '.ts',
  '.js',
  '.mjs',
  '.cjs',
  '.json',
  '.md',
  '.yaml',
  '.yml',
  '.sh',
  '.txt',
]);

function* walkFiles(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') {
        continue;
      }
      yield* walkFiles(fullPath);
    } else if (entry.isFile() && TEXT_EXTENSIONS.has(path.extname(entry.name))) {
      yield fullPath;
    }
  }
}

describe('vocabulary sweep', () => {
  it('keeps the retired store vocabulary out of live surfaces', () => {
    const offenders: string[] = [];

    for (const root of SWEEP_ROOTS) {
      const rootPath = path.join(REPO_ROOT, root);
      if (!fs.existsSync(rootPath)) {
        continue;
      }

      for (const filePath of walkFiles(rootPath)) {
        const relPath = path.relative(REPO_ROOT, filePath).split(path.sep).join('/');
        if (SWEEP_EXEMPT_FILES.has(relPath)) {
          continue;
        }
        const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
        lines.forEach((line, index) => {
          if (carriesRetiredVocabulary(line)) {
            offenders.push(
              `${path.relative(REPO_ROOT, filePath)}:${index + 1}: ${line.trim()}`
            );
          }
        });
      }
    }

    expect(offenders, `retired vocabulary found:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('keeps the deleted workspace/initiative token surface from regrowing', () => {
    // The command-group deletion slice's ledger records exactly these
    // survivors; a new (workspace|initiative)_ token in src/ must be a
    // deliberate decision recorded in the ledger, not drift.
    // workspace_detected: the token surfaced (via the pattern below) from the
    // RootSelectionError code `legacy_workspace_detected`, emitted when root
    // resolution finds a legacy openspec/ workspace but no rasen/ one and points
    // the user at `rasen migrate` (rasen-full-rebrand slice 1.4). Deliberate.
    // workspace_identity_unavailable: Management fails closed when it cannot
    // prove that a Run belongs to the selected physical workspace. This is an
    // intentional authority error, not a revived workspace command surface.
    // workspace_revision: the frozen-Action executor's strict request decoder
    // identifies an invalid workspace-revision authority value. It is not a
    // workspace noun-command or a revived workspace management surface.
    // The thirty `workspace_*` entries below are `store-worktree-bindings-v2`'s
    // refusal codes for the bound planning/execution worktree pair. They are a
    // deliberate ledger entry, not drift, and the distinction the guard turns on
    // is worth stating: this sweep exists to keep the RETIRED `rasen workspace`
    // noun-command surface from regrowing, not to ban the word from a domain
    // that legitimately has workspaces. Store v2 binds a planning worktree to an
    // execution worktree as a first-class Store concept; its failures have to be
    // named, and `workspace_` is what they are named after. Nothing here
    // registers a command, an option, or a top-level group — every one is an
    // error code reached through `store workspace`, which lives under `store`
    // precisely because the top-level name stays retired.
    const allowed = new Set([
      'initiative_option_removed',
      'workspace_detected',
      'workspace_identity_unavailable',
      'workspace_revision',
      'workspace_already_bound',
      'workspace_apply_failed',
      'workspace_atomic_write_conflict',
      'workspace_binding_ambiguous',
      'workspace_cleanup_failed',
      'workspace_cleanup_unsafe',
      'workspace_destination_exists',
      'workspace_dirty_tree',
      'workspace_execution_side_unknown',
      'workspace_git_failed',
      'workspace_layout_version_unsupported',
      'workspace_lock_unavailable',
      'workspace_marker_conflict',
      'workspace_not_prepared',
      'workspace_plan_failed',
      'workspace_plan_missing',
      'workspace_plan_not_applicable',
      'workspace_plan_stale',
      'workspace_planning_identity_unavailable',
      'workspace_project_unresolved',
      'workspace_ref_drift',
      'workspace_ref_mismatch',
      'workspace_repository_identity_drift',
      'workspace_repository_unavailable',
      'workspace_show_failed',
      'workspace_store_unresolved',
      'workspace_target_line_unknown',
      // L6 port: context.ts's own resolution failure for a declared workspace
      // whose pair cannot be read back (0.1.7's code, ported with the command).
      'workspace_unresolved',
      // L3+L5 port: the finalization record's workspace-pair states.
      'workspace_pair_unavailable',
      'workspace_worktree_absent',
      'workspace_worktree_identity_drift',
      'workspace_worktree_not_a_repository',
    ]);
    const found = new Set<string>();
    const pattern = /(workspace|initiative)_[a-z_]+/g;

    for (const filePath of walkFiles(path.join(REPO_ROOT, 'src'))) {
      const content = fs.readFileSync(filePath, 'utf-8');
      for (const match of content.matchAll(pattern)) {
        found.add(match[0]);
      }
    }

    expect([...found].filter((token) => !allowed.has(token)).sort()).toEqual([]);
  });
});
