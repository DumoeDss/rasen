# Rehearsal evidence index

Captured by `harness.sh` in this directory. Every step file is the verbatim
stdout+stderr of one command plus its exit code; nothing is edited except
machine-specific absolute paths, which are replaced by `<temp>`, `<repo>`, and
`<real-store>` so the record is readable and diffable.

## How to replay

```sh
source rasen/changes/rehearse-legacy-store-layout-migration/evidence/rehearsal/harness.sh
h_build_pinned    # git archive HEAD -> <temp>/pinned, junction node_modules, node build.js
h_bootstrap       # robocopy the real store -> <temp>/copy-pristine; git clone -> <temp>/copy-clone
h_preflight       # MUST print PREFLIGHT-OK before any stage runs
```

## Safety invariants held by every step

- `RASEN_HOME` and `GIT_CONFIG_GLOBAL` are redirected into the temp root, so the
  machine store registry the CLI reads is the disposable one. The copies carry
  the real store's uid (`f35acc7d-...`), which is exactly why this is a
  correctness requirement and not hygiene: under the real registry that uid
  resolves to the user's live store.
- `h_preflight` runs at the head of every stage and refuses unless **every**
  registered entry resolves inside the temp root. A pre-flight failure is a stop,
  never something to repair by unregistering.
- The real store is read with `git log/show/status --porcelain`, `cat`, and
  `sha256sum` only. `robocopy /E` and `git clone` read it; neither writes.
- The clone's `origin` points at the real store, so its **push** URL is disabled
  (`00-harness/04-clone-push-disarmed.txt`).

## CLI pinning (why the evidence is not contaminated)

The repo working tree is shared with an in-flight sibling change whose
uncommitted edits touch `src/core/store/identity.ts` and
`src/core/store-planning/internal/*`, and `pnpm build` deletes `dist/` before
compiling. The rehearsal therefore runs a CLI built from a pinned
`git archive HEAD` tree, recorded in `00-harness/01-build-and-redirection-proof.txt`
together with the sibling's dirty-file list. Post-fix re-runs rebuild that same
pinned tree with only this change's patch applied.

## Stages

| Dir | Stage | Claim it speaks for |
|---|---|---|
| `00-harness/` | Isolation + disposable material | Redirection works; the copies are faithful; the real store is untouched |
| `01-pristine/` | The real store's ACTUAL shape (working-tree copy: v2 metadata + uid, dirty tracked files) | What happens to the real store today |
| `02-enriched/` | Authored flat content layered onto a copy | Attribution, provenance, publication, recovery, retirement, multi-ref, Windows/UTF-8 |
| `03-clone/` | Committed-truth clone (v1 metadata, no uid) | The `store-identity-missing` -> `upgrade-identity` repair chain |

Honesty note for `02-enriched/`: the content is authored, so those rows claim
**real CLI + real machine registry + real Windows host + real store lineage**,
not real content. That is still strictly more than any existing suite, none of
which crosses the registry or runs the shipped binary.

## Step index

Every file below is a verbatim capture. Each stage's `00-provenance.txt`
names the exact CLI build that produced it; `04-postfix/00-summary.txt` narrates
the before/after chain; `00-harness/06-teardown.txt` closes the safety record.
The guard runs live beside this directory in `../guards/`.

### 00-harness

- `00-provenance.txt`
- `01-build-and-redirection-proof.txt`
- `02-pristine-copy.txt`
- `03-clone-copy.txt`
- `04-clone-push-disarmed.txt`
- `05-teardown-and-real-store-untouched.txt`
- `06-teardown.txt`

### 01-pristine

- `00-provenance.txt`
- `00a-register.txt`
- `00b-preflight.txt`
- `01-preview-human.txt`
- `02-preview-json.txt`
- `03-status.txt`
- `04-status-json.txt`
- `05-apply-attempt.txt`
- `06-retire-flat-attempt.txt`
- `07-rollback-attempt.txt`
- `08-partition-write-probe.txt`
- `09-partition-write-probe-json.txt`
- `10-write-surface.txt`

### 02-enriched

- `00-provenance.txt`
- `00a-register.txt`
- `00b-preflight.txt`
- `01-add-project-beta.txt`
- `02-preview-human.txt`
- `03-preview-json.txt`
- `04-mapping-contradicts-recorded-identity.txt`
- `05-mapping-outside-worktree.txt`
- `06-mapping-names-absent-item.txt`
- `07-mapping-repairs-non-member.txt`
- `08-add-project-gamma-the-real-repair.txt`
- `09-replan-with-mapping.txt`
- `10-rename-unrecordable-item.txt`
- `11-replan-applicable.txt`
- `12-apply.txt`
- `13-status-after-apply.txt`
- `14-status-after-apply-json.txt`
- `15-publication-verification.txt`
- `16-retire-before-commit.txt`
- `17-retire-again-idempotence.txt`
- `18-rollback-after-retirement.txt`
- `19-status-after-retirement.txt`
- `20-partition-write-accepted-after-migration.txt`
- `21-post-retirement-tree-and-receipt.txt`
- `22a-stale-register.txt`
- `22b-stale-plan.txt`
- `23-stale-uncommitted-edit.txt`
- `24-stale-apply.txt`
- `25-rollback-before-retirement.txt`
- `26-post-rollback-state.txt`
- `27-plan-stale-on-resume.txt`
- `28-recovery-after-wedged-resume.txt`

### 03-clone

- `00-provenance.txt`
- `00a-register-no-yes.txt`
- `00b-register-human.txt`
- `00c-preflight.txt`
- `01-preview.txt`
- `02-upgrade-identity-preview.txt`
- `03-upgrade-identity-apply.txt`
- `04-replan-after-identity.txt`
- `05-register-content-clone.txt`
- `06-preview-store-identity-missing.txt`
- `07-upgrade-identity-apply.txt`
- `08-replan-after-identity.txt`
- `09a-register-noactive.txt`
- `09b-preview-silent-identity-hole.txt`
- `09c-apply-attempt-silent-identity-hole.txt`
- `09d-preview-json-silent-identity-hole.txt`
- `10-identity-hole-analysis.txt`
- `11-remote-tracking-ref-reporting.txt`

### 04-postfix

- `00-provenance.txt`
- `00-summary.txt`
- `00a-register.txt`
- `01-partition-write-before.txt`
- `02-preview-human.txt`
- `03-preview-json.txt`
- `04-apply.txt`
- `05-status.txt`
- `06-retire-flat.txt`
- `07-partition-write-after.txt`
- `08-target-line-add.txt`
- `09-partition-write-accepted.txt`
- `10-identity-hole-preview.txt`
- `11-identity-hole-apply.txt`
- `12-identity-hole-json.txt`
- `13-operator-worktree-after.txt`

## Triage

`triage.md` classifies every observation per design D4 and carries the closing
SS15 acceptance statement.
