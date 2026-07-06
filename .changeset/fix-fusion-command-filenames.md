---
"@fission-ai/openspec": patch
---

fix: fusion workflow slash commands now generate under their documented short names (`/opsx:ship`, `/opsx:auto`, `/opsx:retro`, `/opsx:office-hours`, `/opsx:verify-enhanced`) instead of leaking the internal `-command` workflow-id suffix into filenames (`/opsx:ship-command`). Workflow ids in profiles and the global config are unchanged. `openspec update` (and re-`init`) removes the legacy suffixed files, drift detection flags lingering legacy files so a sync cleans them up, and install detection/migration still recognizes projects that only have the old filenames.
