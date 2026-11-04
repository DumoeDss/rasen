# Deterministic RED regression

## Seam

The regression exercises the public no-argument interactive config editor from a child working directory whose ancestor contains an unrelated `rasen/` directory but no project configuration file.

It observes three user-facing behaviors through that seam:

- outside-project guidance is printed;
- `archive.timing` is disabled because it is project-only;
- editing a both-scope key does not add a project-scope prompt.

## Command

```text
pnpm exec vitest run test/commands/config-editor.test.ts -t 'treats an unrelated ancestor rasen directory without project config as outside-project' --maxWorkers=1 --minWorkers=1 --reporter=verbose
```

## RED receipt

- Exit code: `1`
- Test files: `1 failed (1)`
- Tests: `1 failed | 19 skipped (20)`
- Duration: `11.21s`
- Failure: `archive.timing.disabled` was `undefined`, but the outside-project contract requires a truthy disabled value.

The failure occurred before any production-code change for this Change.
