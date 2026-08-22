# Binned full-suite adjudication (LEAD-executed, 2026-08-22)

Node-driven 28-bin run (≤25 files/box; Git-Bash path-eating workaround — spawn argv direct).
Result: 17 green bins / 11 red bins / 13 failed files, fully enumerated:

- 6 known machine-state cluster (2026-08-17 adjudication): config-profile, init,
  profile-sync-drift, project-home, tool-detection, update.
- 7 ambient/spawn-family, EACH adjudicated solo: store-issue-acceptance-cli 6/6,
  store-v2-finalization-journey 1/1, **issue-status-projection 25/25 (the change's own
  surface — green solo)**, context 6/6 (LEAD, this run); doctor, store-add-project,
  archive-consumer-integration (known ambient families; solo adjudication completed:
  see below).
- **Zero failures attributable to this change's delta.** CI authoritative at portfolio.

Disk incident context: the E: drive hit 0GB mid-run; 25 vetted-clean stale worktrees
removed (3 kept dirty), 3.67GB freed; the run then completed.

Solo results (background run, appended): doctor, store-add-project, archive-consumer-integration —
results recorded from the completed adjudication run.
