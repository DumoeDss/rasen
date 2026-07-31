# Runtime edit-boundary retirement

Rasen no longer installs project write hooks or exposes a runtime
freeze/unfreeze-style lifecycle. Scope-sensitive workflows now declare the
evidence-backed affected area, record justified expansions before editing, and
audit the actual changed-file set and diff before completion. This discipline
is review evidence, not mechanical write enforcement.

Generic managed-execution controls remain independent: ECP workspace access,
runtime sandbox selection, cross-run workspace reservations, and isolated
worktrees continue under their existing contracts.

## Upgrade matrix

The matrix is organized by artifact type rather than assigning each generation
to one release line:

| Artifact generation | Where it may be present | Migration |
|---|---|---|
| Predecessor skill/state generation | Installations retaining exact `freeze`, `guard`, or `unfreeze` ids/directories and `freeze-dir.txt`; this cleanup is additive and is not classified as 0.1.6-only. | Normalize saved selections and remove only the exact retired artifacts; preserve similarly named skills and sibling files. |
| Runtime hook/version-1-state generation | Both released lines may carry the same artifacts: the feature landed independently on `dev/0.1.6` in `8e0be936c97d58fe7a24508ffaba8e55c839da35` and on the 0.2.0 line in `897fa6c1b8adf0582cd0044781b3ad51a84819e6`; the frozen hook source was byte-identical. | Subtract only complete generated Claude/Codex handler matches, preserve unrelated hook structure, and remove only validated direct-child version-1 state/temp entries. |
| Current retirement release | No live command, hook reconciliation, or boundary state writer. | Fresh init creates no Rasen write hook; repeated update is idempotent. |

Invalid or unexpected hook configuration is left byte-for-byte unchanged with
its exact path reported for manual review. Future-version, malformed,
unexpected, nested, and unreadable state entries are preserved; cleanup never
recursively removes the machine-data directory.

Any approved 0.1.6 maintenance backport must reuse these same frozen artifact
identities. It does not import daemon code or rename daemon/ECP workspace and
sandbox controls as a compatibility feature.
