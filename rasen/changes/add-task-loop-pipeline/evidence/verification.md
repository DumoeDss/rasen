# Task Loop verification

Date: 2026-08-02

## Required gates

- `pnpm run build`
  - Result: PASS (exit 0). TypeScript 5.9.3 compilation and distribution build completed.
- `pnpm run lint`
  - Result: PASS (exit 0). Zero errors. One pre-existing warning remains at `test/core/change-run/facade-settle-completeness.test.ts:139` for an unused eslint-disable directive.
- `pnpm exec vitest run test/core/change-run/task-loop.test.ts test/core/templates/skill-templates-parity.test.ts test/commands/auto.test.ts test/commands/pipeline-start-input.test.ts test/commands/pipeline-messages.test.ts test/core/templates/task-loop.test.ts test/locales/catalog.test.ts --reporter=dot`
  - Result: PASS, 7 files / 97 tests.
- `pnpm exec vitest run test/commands/pipeline-bugfix-e2e.test.ts -t "drives a spec-free Task Loop through builder, fresh critic, ship, and archive"`
  - Result: PASS, 1 file / 1 test (115.458 s). This fresh-process Windows-safe CLI test uses a spaced, non-ASCII input-file path and verifies builder, fresh critic, report, ship, archive, completed status, and absence of proposal/design/specs/tasks/goal-plan artifacts.
- `pnpm exec vitest run test/core/archive-consumer-integration.test.ts --reporter=dot`
  - Result: PASS, 1 file / 7 tests (71.36 s). This isolated the archive failures seen only in the loaded shard run.
- `pnpm exec vitest run test/core/init.test.ts test/core/update.test.ts -t "never removes skill dirs|deduplicates auto" --reporter=dot`
  - Result: PASS, 2 files / 2 selected tests (127 skipped). Generated installations contain `rasen-task-loop` while it remains internal and non-user-invokable.
- `pnpm exec vitest run test/commands/pipeline.test.ts test/commands/pipeline-store-root-selection.test.ts -t "returns the built-in pipelines|list and validate --pipelines|lists task-loop as explicit-only" --reporter=dot`
  - Result: PASS, 2 files / 3 selected tests (108 skipped). Registry list and store validation expose TaskLoop, while classification does not select it.
- Earlier complete focused regression covering 22 TaskLoop-adjacent CLI, Registry, workflow-template, change-run, init/update, locale, and parity files.
  - Result: PASS, 22 files / 316 tests.
- `git diff --check`
  - Result: PASS. Git emitted only existing LF-to-CRLF checkout warnings.

## Full-suite attempts

- `pnpm test`
  - Result: INCONCLUSIVE due to environment timeout after approximately 15 minutes; Vitest produced no final summary and no fail-fast assertion before the timeout.
- `pnpm exec vitest run --shard=1/2`
  - Result: INCONCLUSIVE due to environment timeout after approximately 15 minutes while still progressing, with no observed assertion failure before timeout.
- `pnpm exec vitest run --shard=1/4`
  - Result: completed with 31 failures. Failures were dominated by existing process/interactive-mock timing symptoms under load (including uncalled config/profile mocks and a supervisor child reported as still running). The archive consumer failure from this run was re-run alone and passed 7/7.
- Two larger combined targeted invocations also hit the 300-second process timeout. The stable smaller focused group above passes 97/97, and the previously completed 22-file focused group passes 316/316.

The full repository suite is therefore not represented as green. The deterministic feature-focused gates, TypeScript build, lint, real CLI TaskLoop E2E, and isolated delivery consumer are green; the remaining full-suite signal is a repository/environment load and timeout limitation rather than a reproducible TaskLoop assertion failure.

## Durable findings

1. Launch identity must include normalized canonical inputs. Comparing the requested digest before returning `reused` prevents a changed task or Pipeline from silently attaching to an existing Run.
2. TaskLoop should remain an additive projection over Canonical Run + GoalCycle. A separate cycle model would duplicate replay, admission, settlement, and delivery semantics.
3. A critic result is trustworthy only when actor freshness, exact frozen-criterion coverage, and raw target-bound evidence are revalidated at both completion and delivery boundaries.
4. Projection files are disposable views. `task-loop-report.md` can be regenerated from canonical events and cannot grant satisfaction or delivery authority.
5. Explicit-only routing is a product boundary: default auto classification must neither select nor suggest TaskLoop, and terminal TaskLoop states must never convert into a spec-driven Pipeline.
6. `--no-gate` controls ordinary Pipeline gates only. It must remain unable to bypass TaskLoop input, evidence, terminal, safety, ship, or archive guards.
7. Process-heavy Vitest combinations on this Windows environment can create misleading timeout cascades. Re-run suspected consumers in isolation before attributing them to a feature regression.

## Workspace hygiene

- `rasen/config.yaml` was already modified before this implementation and was not edited as part of TaskLoop work.
- Existing untracked `.rasen/`, `rasen/changes/add-thing/`, `rasen/changes/ecp-v2-default-authoring-and-builtins/`, and `rasen/specs/billing/` were not modified.
- Timed-out tests created `test-pipeline-command-tmp/`; its resolved path was verified under the repository root and the test-only directory was removed with an exact-path `git clean` command.
