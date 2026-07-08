# fork-phase1-release-prep — Pack verification notes

## Release evidence: local `npm pack` inventory

- **Command:** `pnpm build` (green, version `0.1.0`) → `npm pack`
- **Produced tarball:** `fission-ai-openspec-0.1.0.tgz` (read from `npm pack` output, not hardcoded)
- **Total files:** 443
- **shasum:** `84907286cce48c82634a61a28f564d19be7d24fd`
- **Tarball deleted after inventory** (not left untracked in repo root).

### Whitelisted-directory assertions (all present)

| dir | files |
| --- | ----- |
| dist | 426 |
| bin | 1 |
| schemas | 5 |
| pipelines | 7 |
| scripts | 1 |

Root files: `LICENSE`, `package.json`, `README.md`.

### Residue check (all CLEAN — zero matches)

- `browse` — none
- `telemetry-backend/` — none (repo-root dir is not in the `files` whitelist → auto-excluded)
- `playwright` — none

Telemetry client IS packed (rewritten B2 client): `dist/telemetry/{index,config}.{js,d.ts}` — points at the maintainer Cloudflare Worker over `node:https`, no posthog.

### dist/ subdirectory breakdown

| subdir | files |
| ------ | ----- |
| (dist root) | 2 |
| cli | 2 |
| commands | 50 |
| core | 342 |
| prompts | 2 |
| telemetry | 4 |
| ui | 4 |
| utils | 20 |

## Delivery boundary (task 6.2)

HARD BOUNDARY honored: NO `git tag`, NO `git push --tags`, NO `gh release create`/publish, NO git commit performed. Working tree is prepared and locally pack-verified only. The `v0.1.0` tag + GitHub Release publish are escalated to the user by the LEAD at run end.

## Full tarball inventory

```
bin/openspec.js
dist/cli/index.d.ts
dist/cli/index.js
dist/commands/agent.d.ts
dist/commands/agent.js
dist/commands/change.d.ts
dist/commands/change.js
dist/commands/completion.d.ts
dist/commands/completion.js
dist/commands/config.d.ts
dist/commands/config.js
dist/commands/context.d.ts
dist/commands/context.js
dist/commands/doctor.d.ts
dist/commands/doctor.js
dist/commands/feedback.d.ts
dist/commands/feedback.js
dist/commands/pipeline.d.ts
dist/commands/pipeline.js
dist/commands/schema.d.ts
dist/commands/schema.js
dist/commands/shared-gather.d.ts
dist/commands/shared-gather.js
dist/commands/shared-output.d.ts
dist/commands/shared-output.js
dist/commands/show.d.ts
dist/commands/show.js
dist/commands/spec.d.ts
dist/commands/spec.js
dist/commands/store.d.ts
dist/commands/store.js
dist/commands/validate.d.ts
dist/commands/validate.js
dist/commands/workflow/index.d.ts
dist/commands/workflow/index.js
dist/commands/workflow/instructions.d.ts
dist/commands/workflow/instructions.js
dist/commands/workflow/new-change.d.ts
dist/commands/workflow/new-change.js
dist/commands/workflow/schemas.d.ts
dist/commands/workflow/schemas.js
dist/commands/workflow/shared.d.ts
dist/commands/workflow/shared.js
dist/commands/workflow/status.d.ts
dist/commands/workflow/status.js
dist/commands/workflow/templates.d.ts
dist/commands/workflow/templates.js
dist/commands/workset.d.ts
dist/commands/workset.js
dist/commands/workset-input.d.ts
dist/commands/workset-input.js
dist/commands/workset-prompts.d.ts
dist/commands/workset-prompts.js
dist/core/agent-context.d.ts
dist/core/agent-context.js
dist/core/archive.d.ts
dist/core/archive.js
dist/core/artifact-graph/graph.d.ts
dist/core/artifact-graph/graph.js
dist/core/artifact-graph/index.d.ts
dist/core/artifact-graph/index.js
dist/core/artifact-graph/instruction-loader.d.ts
dist/core/artifact-graph/instruction-loader.js
dist/core/artifact-graph/outputs.d.ts
dist/core/artifact-graph/outputs.js
dist/core/artifact-graph/resolver.d.ts
dist/core/artifact-graph/resolver.js
dist/core/artifact-graph/schema.d.ts
dist/core/artifact-graph/schema.js
dist/core/artifact-graph/state.d.ts
dist/core/artifact-graph/state.js
dist/core/artifact-graph/types.d.ts
dist/core/artifact-graph/types.js
dist/core/available-tools.d.ts
dist/core/available-tools.js
dist/core/change-metadata/index.d.ts
dist/core/change-metadata/index.js
dist/core/change-metadata/schema.d.ts
dist/core/change-metadata/schema.js
dist/core/change-status-policy.d.ts
dist/core/change-status-policy.js
dist/core/claude-settings.d.ts
dist/core/claude-settings.js
dist/core/command-generation/adapters/amazon-q.d.ts
dist/core/command-generation/adapters/amazon-q.js
dist/core/command-generation/adapters/antigravity.d.ts
dist/core/command-generation/adapters/antigravity.js
dist/core/command-generation/adapters/auggie.d.ts
dist/core/command-generation/adapters/auggie.js
dist/core/command-generation/adapters/bob.d.ts
dist/core/command-generation/adapters/bob.js
dist/core/command-generation/adapters/claude.d.ts
dist/core/command-generation/adapters/claude.js
dist/core/command-generation/adapters/cline.d.ts
dist/core/command-generation/adapters/cline.js
dist/core/command-generation/adapters/codebuddy.d.ts
dist/core/command-generation/adapters/codebuddy.js
dist/core/command-generation/adapters/codex.d.ts
dist/core/command-generation/adapters/codex.js
dist/core/command-generation/adapters/continue.d.ts
dist/core/command-generation/adapters/continue.js
dist/core/command-generation/adapters/costrict.d.ts
dist/core/command-generation/adapters/costrict.js
dist/core/command-generation/adapters/crush.d.ts
dist/core/command-generation/adapters/crush.js
dist/core/command-generation/adapters/cursor.d.ts
dist/core/command-generation/adapters/cursor.js
dist/core/command-generation/adapters/factory.d.ts
dist/core/command-generation/adapters/factory.js
dist/core/command-generation/adapters/gemini.d.ts
dist/core/command-generation/adapters/gemini.js
dist/core/command-generation/adapters/github-copilot.d.ts
dist/core/command-generation/adapters/github-copilot.js
dist/core/command-generation/adapters/iflow.d.ts
dist/core/command-generation/adapters/iflow.js
dist/core/command-generation/adapters/index.d.ts
dist/core/command-generation/adapters/index.js
dist/core/command-generation/adapters/junie.d.ts
dist/core/command-generation/adapters/junie.js
dist/core/command-generation/adapters/kilocode.d.ts
dist/core/command-generation/adapters/kilocode.js
dist/core/command-generation/adapters/kiro.d.ts
dist/core/command-generation/adapters/kiro.js
dist/core/command-generation/adapters/lingma.d.ts
dist/core/command-generation/adapters/lingma.js
dist/core/command-generation/adapters/opencode.d.ts
dist/core/command-generation/adapters/opencode.js
dist/core/command-generation/adapters/pi.d.ts
dist/core/command-generation/adapters/pi.js
dist/core/command-generation/adapters/qoder.d.ts
dist/core/command-generation/adapters/qoder.js
dist/core/command-generation/adapters/qwen.d.ts
dist/core/command-generation/adapters/qwen.js
dist/core/command-generation/adapters/roocode.d.ts
dist/core/command-generation/adapters/roocode.js
dist/core/command-generation/adapters/windsurf.d.ts
dist/core/command-generation/adapters/windsurf.js
dist/core/command-generation/command-file-id.d.ts
dist/core/command-generation/command-file-id.js
dist/core/command-generation/generator.d.ts
dist/core/command-generation/generator.js
dist/core/command-generation/index.d.ts
dist/core/command-generation/index.js
dist/core/command-generation/registry.d.ts
dist/core/command-generation/registry.js
dist/core/command-generation/types.d.ts
dist/core/command-generation/types.js
dist/core/command-generation/yaml.d.ts
dist/core/command-generation/yaml.js
dist/core/completions/command-registry.d.ts
dist/core/completions/command-registry.js
dist/core/completions/completion-provider.d.ts
dist/core/completions/completion-provider.js
dist/core/completions/factory.d.ts
dist/core/completions/factory.js
dist/core/completions/generators/bash-generator.d.ts
dist/core/completions/generators/bash-generator.js
dist/core/completions/generators/fish-generator.d.ts
dist/core/completions/generators/fish-generator.js
dist/core/completions/generators/powershell-generator.d.ts
dist/core/completions/generators/powershell-generator.js
dist/core/completions/generators/zsh-generator.d.ts
dist/core/completions/generators/zsh-generator.js
dist/core/completions/installers/bash-installer.d.ts
dist/core/completions/installers/bash-installer.js
dist/core/completions/installers/fish-installer.d.ts
dist/core/completions/installers/fish-installer.js
dist/core/completions/installers/powershell-installer.d.ts
dist/core/completions/installers/powershell-installer.js
dist/core/completions/installers/zsh-installer.d.ts
dist/core/completions/installers/zsh-installer.js
dist/core/completions/shared-flags.d.ts
dist/core/completions/shared-flags.js
dist/core/completions/templates/bash-templates.d.ts
dist/core/completions/templates/bash-templates.js
dist/core/completions/templates/fish-templates.d.ts
dist/core/completions/templates/fish-templates.js
dist/core/completions/templates/powershell-templates.d.ts
dist/core/completions/templates/powershell-templates.js
dist/core/completions/templates/zsh-templates.d.ts
dist/core/completions/templates/zsh-templates.js
dist/core/completions/types.d.ts
dist/core/completions/types.js
dist/core/config.d.ts
dist/core/config.js
dist/core/config-prompts.d.ts
dist/core/config-prompts.js
dist/core/config-schema.d.ts
dist/core/config-schema.js
dist/core/converters/json-converter.d.ts
dist/core/converters/json-converter.js
dist/core/file-state.d.ts
dist/core/file-state.js
dist/core/global-config.d.ts
dist/core/global-config.js
dist/core/id.d.ts
dist/core/id.js
dist/core/index.d.ts
dist/core/index.js
dist/core/init.d.ts
dist/core/init.js
dist/core/legacy-cleanup.d.ts
dist/core/legacy-cleanup.js
dist/core/list.d.ts
dist/core/list.js
dist/core/migration.d.ts
dist/core/migration.js
dist/core/openers.d.ts
dist/core/openers.js
dist/core/openspec-root.d.ts
dist/core/openspec-root.js
dist/core/parsers/change-parser.d.ts
dist/core/parsers/change-parser.js
dist/core/parsers/markdown-parser.d.ts
dist/core/parsers/markdown-parser.js
dist/core/parsers/requirement-blocks.d.ts
dist/core/parsers/requirement-blocks.js
dist/core/parsers/spec-structure.d.ts
dist/core/parsers/spec-structure.js
dist/core/pipeline-registry/graph.d.ts
dist/core/pipeline-registry/graph.js
dist/core/pipeline-registry/index.d.ts
dist/core/pipeline-registry/index.js
dist/core/pipeline-registry/pipeline.d.ts
dist/core/pipeline-registry/pipeline.js
dist/core/pipeline-registry/portfolio-state.d.ts
dist/core/pipeline-registry/portfolio-state.js
dist/core/pipeline-registry/resolver.d.ts
dist/core/pipeline-registry/resolver.js
dist/core/pipeline-registry/run-state.d.ts
dist/core/pipeline-registry/run-state.js
dist/core/pipeline-registry/state.d.ts
dist/core/pipeline-registry/state.js
dist/core/pipeline-registry/types.d.ts
dist/core/pipeline-registry/types.js
dist/core/planning-home.d.ts
dist/core/planning-home.js
dist/core/profiles.d.ts
dist/core/profiles.js
dist/core/profile-sync-drift.d.ts
dist/core/profile-sync-drift.js
dist/core/project-config.d.ts
dist/core/project-config.js
dist/core/references.d.ts
dist/core/references.js
dist/core/relationship-health.d.ts
dist/core/relationship-health.js
dist/core/root-selection.d.ts
dist/core/root-selection.js
dist/core/schemas/base.schema.d.ts
dist/core/schemas/base.schema.js
dist/core/schemas/change.schema.d.ts
dist/core/schemas/change.schema.js
dist/core/schemas/index.d.ts
dist/core/schemas/index.js
dist/core/schemas/spec.schema.d.ts
dist/core/schemas/spec.schema.js
dist/core/shared/index.d.ts
dist/core/shared/index.js
dist/core/shared/skill-generation.d.ts
dist/core/shared/skill-generation.js
dist/core/shared/tool-detection.d.ts
dist/core/shared/tool-detection.js
dist/core/specs-apply.d.ts
dist/core/specs-apply.js
dist/core/store/errors.d.ts
dist/core/store/errors.js
dist/core/store/foundation.d.ts
dist/core/store/foundation.js
dist/core/store/git.d.ts
dist/core/store/git.js
dist/core/store/index.d.ts
dist/core/store/index.js
dist/core/store/operations.d.ts
dist/core/store/operations.js
dist/core/store/registry.d.ts
dist/core/store/registry.js
dist/core/styles/palette.d.ts
dist/core/styles/palette.js
dist/core/templates/experts/_shared.d.ts
dist/core/templates/experts/_shared.js
dist/core/templates/experts/benchmark.d.ts
dist/core/templates/experts/benchmark.js
dist/core/templates/experts/careful.d.ts
dist/core/templates/experts/careful.js
dist/core/templates/experts/chrome-use.d.ts
dist/core/templates/experts/chrome-use.js
dist/core/templates/experts/codebase-design.d.ts
dist/core/templates/experts/codebase-design.js
dist/core/templates/experts/codex.d.ts
dist/core/templates/experts/codex.js
dist/core/templates/experts/cso.d.ts
dist/core/templates/experts/cso.js
dist/core/templates/experts/design-consultation.d.ts
dist/core/templates/experts/design-consultation.js
dist/core/templates/experts/design-review.d.ts
dist/core/templates/experts/design-review.js
dist/core/templates/experts/freeze.d.ts
dist/core/templates/experts/freeze.js
dist/core/templates/experts/guard.d.ts
dist/core/templates/experts/guard.js
dist/core/templates/experts/index.d.ts
dist/core/templates/experts/index.js
dist/core/templates/experts/investigate.d.ts
dist/core/templates/experts/investigate.js
dist/core/templates/experts/navigator.d.ts
dist/core/templates/experts/navigator.js
dist/core/templates/experts/office-hours.d.ts
dist/core/templates/experts/office-hours.js
dist/core/templates/experts/prototype.d.ts
dist/core/templates/experts/prototype.js
dist/core/templates/experts/qa.d.ts
dist/core/templates/experts/qa.js
dist/core/templates/experts/qa-only.d.ts
dist/core/templates/experts/qa-only.js
dist/core/templates/experts/review.d.ts
dist/core/templates/experts/review.js
dist/core/templates/experts/tdd.d.ts
dist/core/templates/experts/tdd.js
dist/core/templates/experts/unfreeze.d.ts
dist/core/templates/experts/unfreeze.js
dist/core/templates/index.d.ts
dist/core/templates/index.js
dist/core/templates/skill-templates.d.ts
dist/core/templates/skill-templates.js
dist/core/templates/types.d.ts
dist/core/templates/types.js
dist/core/templates/workflows/_orchestration.d.ts
dist/core/templates/workflows/_orchestration.js
dist/core/templates/workflows/apply-change.d.ts
dist/core/templates/workflows/apply-change.js
dist/core/templates/workflows/archive-change.d.ts
dist/core/templates/workflows/archive-change.js
dist/core/templates/workflows/auto.d.ts
dist/core/templates/workflows/auto.js
dist/core/templates/workflows/bulk-archive-change.d.ts
dist/core/templates/workflows/bulk-archive-change.js
dist/core/templates/workflows/change-context.d.ts
dist/core/templates/workflows/change-context.js
dist/core/templates/workflows/continue-change.d.ts
dist/core/templates/workflows/continue-change.js
dist/core/templates/workflows/explore.d.ts
dist/core/templates/workflows/explore.js
dist/core/templates/workflows/feedback.d.ts
dist/core/templates/workflows/feedback.js
dist/core/templates/workflows/ff-change.d.ts
dist/core/templates/workflows/ff-change.js
dist/core/templates/workflows/goal-command.d.ts
dist/core/templates/workflows/goal-command.js
dist/core/templates/workflows/goal-iterate.d.ts
dist/core/templates/workflows/goal-iterate.js
dist/core/templates/workflows/goal-plan.d.ts
dist/core/templates/workflows/goal-plan.js
dist/core/templates/workflows/goal-report.d.ts
dist/core/templates/workflows/goal-report.js
dist/core/templates/workflows/handoff.d.ts
dist/core/templates/workflows/handoff.js
dist/core/templates/workflows/new-change.d.ts
dist/core/templates/workflows/new-change.js
dist/core/templates/workflows/office-hours.d.ts
dist/core/templates/workflows/office-hours.js
dist/core/templates/workflows/onboard.d.ts
dist/core/templates/workflows/onboard.js
dist/core/templates/workflows/propose.d.ts
dist/core/templates/workflows/propose.js
dist/core/templates/workflows/retro.d.ts
dist/core/templates/workflows/retro.js
dist/core/templates/workflows/review-cycle.d.ts
dist/core/templates/workflows/review-cycle.js
dist/core/templates/workflows/ship.d.ts
dist/core/templates/workflows/ship.js
dist/core/templates/workflows/store-selection.d.ts
dist/core/templates/workflows/store-selection.js
dist/core/templates/workflows/sync-specs.d.ts
dist/core/templates/workflows/sync-specs.js
dist/core/templates/workflows/verify-change.d.ts
dist/core/templates/workflows/verify-change.js
dist/core/templates/workflows/verify-enhanced.d.ts
dist/core/templates/workflows/verify-enhanced.js
dist/core/update.d.ts
dist/core/update.js
dist/core/validation/constants.d.ts
dist/core/validation/constants.js
dist/core/validation/types.d.ts
dist/core/validation/types.js
dist/core/validation/validator.d.ts
dist/core/validation/validator.js
dist/core/view.d.ts
dist/core/view.js
dist/core/working-set.d.ts
dist/core/working-set.js
dist/core/worksets.d.ts
dist/core/worksets.js
dist/core/zod-issues.d.ts
dist/core/zod-issues.js
dist/index.d.ts
dist/index.js
dist/prompts/searchable-multi-select.d.ts
dist/prompts/searchable-multi-select.js
dist/telemetry/config.d.ts
dist/telemetry/config.js
dist/telemetry/index.d.ts
dist/telemetry/index.js
dist/ui/ascii-patterns.d.ts
dist/ui/ascii-patterns.js
dist/ui/welcome-screen.d.ts
dist/ui/welcome-screen.js
dist/utils/change-metadata.d.ts
dist/utils/change-metadata.js
dist/utils/change-utils.d.ts
dist/utils/change-utils.js
dist/utils/command-references.d.ts
dist/utils/command-references.js
dist/utils/file-system.d.ts
dist/utils/file-system.js
dist/utils/index.d.ts
dist/utils/index.js
dist/utils/interactive.d.ts
dist/utils/interactive.js
dist/utils/item-discovery.d.ts
dist/utils/item-discovery.js
dist/utils/match.d.ts
dist/utils/match.js
dist/utils/shell-detection.d.ts
dist/utils/shell-detection.js
dist/utils/task-progress.d.ts
dist/utils/task-progress.js
LICENSE
package.json
pipelines/auto-decompose/pipeline.yaml
pipelines/bug-fix/pipeline.yaml
pipelines/full-feature/pipeline.yaml
pipelines/goal-loop-evaluate/pipeline.yaml
pipelines/goal-loop-measure/pipeline.yaml
pipelines/goal-loop-research/pipeline.yaml
pipelines/small-feature/pipeline.yaml
README.md
schemas/spec-driven/schema.yaml
schemas/spec-driven/templates/design.md
schemas/spec-driven/templates/proposal.md
schemas/spec-driven/templates/spec.md
schemas/spec-driven/templates/tasks.md
scripts/postinstall.js
```
