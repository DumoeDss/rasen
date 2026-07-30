# file-placement-collapse-archive

## Why

Child A (`file-placement-collapse-landing`) collapsed the file-placement
configuration surface to zero and re-wired every write-side landing point to the
terminal seven-class model. But it left the **archive side** untouched: archive
still moves the change directory wholesale, writes no disposition accounting,
runs no ephemera cleaner, and records no structured metadata. This change closes
that gap.

It implements the four archive dispositions (归档 / 清理 / 静置 / out-of-scope)
from `docs/zh/file-placement-and-planning-roots.md`, introduces `archive.json`
as the structured disposition-accounting file, adds a whitelist-by-filename
ephemera cleaner (the portfolio's only destructive operation), and inverts the
`rasen work migrate` command to consolidate legacy machine-home state into the
terminal locations child A established.

Without this change, ephemera accumulates indefinitely in the execution root with
no cleanup path, archive carries no record of what was cleaned or what handoff
was absorbed, and users have no migration from the old machine-home layout.

## What

### 1. Four dispositions at archive time (MODIFY `file-placement`)

The archive path gains four disposition classes, matching the design doc's
"Archive 的三档处置" table plus an explicit out-of-scope:

| Disposition | Members | Action |
|---|---|---|
| **归档 (archive)** | Planning files, evidence, unabsorbed handoff | Travel with the change directory into the archive |
| **清理 (clean)** | Ephemera (execution root) | Whitelist-by-filename delete; list recorded in `archive.json` |
| **静置 (leave)** | Probes (execution root) | Not moved, not deleted; path + code commit recorded in `archive.json` |
| **out-of-scope** | design-docs (root-level), coordination (machine root) | Not scanned by the disposition logic |

### 2. Ephemera cleaner (MODIFY `file-placement`, `cli-archive`, `opsx-archive-skill`)

A whitelist-by-filename delete, never discretionary and never recursive:

- **Deletes only known filenames**: `auto-run.json`, `portfolio-run.json`,
  `goal-run.json`, change-level signal/lock/heartbeat files, worker/expert
  selection state, and the regenerable intermediates the design lists. The exact
  whitelist is enumerated in the spec.
- **Preserves everything else byte-for-byte**: unknown files, future-version
  state files, malformed entries, and nested entries are left in place and their
  exact paths are reported for human judgment.
- **Source-tree detection**: if a source manifest (`package.json`, `Cargo.toml`,
  `pyproject.toml`) or source tree is discovered in the ephemera directory,
  cleaning is aborted for that change — that is the signal probes were
  misclassified, and the matter is handed to the user.
- **`--keep-ephemera` exit**: a flag on `rasen archive` that skips the cleaner
  entirely and preserves all ephemera.
- **Dry-run**: `rasen archive --dry-run` reports the full pending-delete list
  (and all other planned actions) without executing anything — this is also the
  validate-blind-spot mitigation (you can dry-run the spec merge and disposition
  logic without committing).
- **Accounting**: deleted files are listed in `archive.json`'s `ephemeraDiscarded`
  array.

### 3. Handoff absorption judgment (MODIFY `file-placement`, `opsx-archive-skill`)

The model's one discretionary point at archive time:

- Dead-ends and eliminated hypotheses **already absorbed** by `design.md` or
  evidence → delete the original handoff file.
- **Unabsorbed** handoff → move to `<Archive>/evidence/handoff/`.
- Default is to preserve (never default-delete). "Eliminated hypotheses" are a
  change's most expensive information; their value begins after archive.
- Outcome recorded in `archive.json`'s `handoffAbsorbed` array.
- This is agent judgment (the archive skill guides it), not a deterministic CLI
  operation.

### 4. `archive.json` accounting (MODIFY `file-placement`)

A new structured metadata file written to the archived change directory. Fields:

```json
{
  "change": "<semantic-change>",
  "archivedAt": "<ISO-8601>",
  "codeCommit": "<execution root commit SHA>",
  "planningBranch": "<planning root branch>",
  "planningTreeState": "clean | dirty",
  "evidence": [{ "path": "evidence/review-report.md", "sha256": "..." }],
  "probes": [{ "path": "<execution-root-relative>", "codeCommit": "..." }],
  "handoffAbsorbed": ["handoff/implementer-1.md"],
  "ephemeraDiscarded": ["ephemera/auto-run.json"],
  "missing": ["<not-run-or-absent items>"]
}
```

**Does not record the planning-root commit hash.** `archive.json` lives inside
that commit, so the hash is an unclosable self-reference: amending the commit
orphanes the recorded hash. The binding identifiers are `codeCommit`
(cross-repo, closable) and evidence content hashes (content-addressed, closable);
the planning side records branch + clean/dirty state only.

Coexists with `.openspec.yaml` (quality capture — a separate concern, unchanged
by this change).

### 5. Inverted migrator (MODIFY `work-migration`, `change-work-dir`)

`rasen work migrate` inverts direction — from "in-repo ephemera → machine home"
(the old model) to "machine-home legacy state → terminal locations" (the model
child A established):

| Legacy source | Terminal destination |
|---|---|
| Old `workDir` reports (review, QA, CSO, benchmark, verification, ship-log) | `<changeRoot>/evidence/` (archived changes: that Archive's `evidence/`) |
| Old `workDir` handoff | `<changeRoot>/handoff/` |
| Old `workDir` run-state | `<executionRoot>/.rasen/changes/<c>/ephemera/` (archived changes: discard + list) |
| Machine-root historical probe dirs | Reclassify one-by-one per classification order: driver/harness → probes, sampling output → ephemera, absorbed conclusions → droppable |
| `machineHome/design-docs/` | `<planningRoot>/rasen/design-docs/` |

**Never overwrite on conflict** — keep both copies and hand the authority call
to the user. The migrator is the LAST implementation task (it migrates to child
A's terminal state, which must be stable first).

The preview-first / idempotent / git-boundary-safe / `--dry-run` / `--json` /
`--yes` contract carries over from the existing command.

## Spec deltas

- **MODIFY `file-placement`** — add: four dispositions, ephemera cleaner
  discipline, handoff absorption judgment, `archive.json` structure
- **MODIFY `cli-archive`** — add: ephemera cleaning at archive time,
  `--keep-ephemera`, `--dry-run`, `archive.json` generation
- **MODIFY `opsx-archive-skill`** — add: ephemera cleaner step, handoff
  absorption step, `archive.json` in the skill's archive flow
- **MODIFY `work-migration`** — rewrite for inverted migrator direction
- **MODIFY `change-work-dir`** — update migration-lifecycle requirement to
  reflect the inverted direction (terminal location is now authoritative after
  migration, not the machine-home work directory)
- **MODIFY `project-registry`** — update doctor's migration hint to scan
  machine-home work directories (the inverted migrator's scan surface) instead
  of in-repo change directories, and count by file type rather than git
  tracked/untracked split
