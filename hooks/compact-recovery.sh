#!/usr/bin/env bash
# OpenSpec Compact Recovery Hook — post-compaction recovery guidance
# Configure in .claude/settings.json as a SessionStart hook with the
# "compact" matcher. Whatever this script prints to stdout is injected
# into the session's context right after a compaction, pointing the
# agent back to the handoff distillate instead of the machine summary.
#
# Exit codes:
#   0 = always (this hook only informs; it never blocks)

set -euo pipefail

cat <<'EOF'
A compaction just occurred: your earlier conversation was replaced by a machine-generated summary.
If you are driving an OpenSpec change, re-anchor on durable state before continuing:
1. Run: openspec pipeline resume <change> --json  (add --store <id> for store-scoped changes)
   It reports the sessionHandoff pointer and each stage's latest handoff document.
2. Read the handoff documents (openspec/changes/<change>/handoff/) FIRST — they are curated
   distillates written at decision points and outrank the compaction summary.
3. Cross-check tasks.md and the change directory for ground truth.
Do not trust fine-grained details (paths, decisions, task status) from the compaction summary
when a handoff document or the blackboard contradicts them.
EOF

exit 0
