# Planning seed (from LEAD post-relocate investigation, 2026-07-10)

Four defects found live after relocate-machine-home shipped (cba4073/bd2f814):

1. ADOPTION GRANULARITY (data left behind): adoptLegacyMachineData's per-child unit is
   the data root's TOP-LEVEL child (projects/ as one atom). If target projects/ already
   exists (e.g. another session created it first), the ENTIRE legacy projects tree is
   skipped — this machine's full day of work dirs stayed in the old root. Fix: recurse
   per project-home (or deeper), keeping never-overwrite at the finer grain.
2. HOME-NAME MAPPING (GC bait): old home openspec-code-1e42477e vs new registry home
   autonomy-ladder-1e42477e (same projectId). Name-based copy would create an
   UNREFERENCED dir under projects/ = deleted by doctor --gc. Adoption must map old
   home names to current registry homes via the OLD registry.json's projectId, merging
   content into the referenced home.
3. WORKTREE NAME DERIVATION: the shared home's display name derives from whichever
   path registers first/last — a .claude/worktrees/autonomy-ladder worktree named the
   MAIN repo's home. Should derive from git-common-dir's parent (main repo), and
   self-heal should never rename an existing home.
4. TEST-ISOLATION LEAK (pre-existing, ongoing): hundreds of fixture project
   registrations + home dirs leak into the REAL machine root on every full-suite run
   (evidence: ~200 openspec-test-*/init-profile-test-*/handoff-test-* entries in the
   real registry, timestamps matching test runs; existed against the old root too).
   Some suites never redirect the data root. Fix: vitest global setup forces
   RASEN_HOME to a per-run temp dir as a safety net + audit the leaky suites.
   Cleanup: doctor --gc can sweep the dangling Temp entries afterwards.

MACHINE STATE (already remediated by LEAD, copy-only): old openspec-code-1e42477e
content merged into ~/.rasen/projects/autonomy-ladder-1e42477e (24 items copied, 2
already present); old roots intact as cold backup. Old %LOCALAPPDATA%\rasen +
%APPDATA%\rasen can be deleted once adoption granularity is fixed and doctor reports
clean.
