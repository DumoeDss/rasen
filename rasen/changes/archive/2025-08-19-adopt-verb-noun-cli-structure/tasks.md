# Implementation Tasks

## 1. CLI Behavior and Help
- [x] 1.1 Un-deprecate top-level `openspec list`; mark `change list` as deprecated with warning that points to `openspec list`
- [x] 1.2 Add support to list specs via `openspec list --specs` and keep `--changes` as default
- [x] 1.3 Update command descriptions and `--help` output to emphasize verb–noun pattern
- [x] 1.4 Keep `openspec spec ...` and `openspec change ...` commands working but print deprecation notices

## 2. Core List Logic
- [x] 2.1 Extend `src/core/list.ts` to accept a mode: `changes` (default) or `specs`
- [x] 2.2 Implement `specs` listing: scan `openspec/specs/*/spec.md`, compute requirement count via parser, format output consistently
- [x] 2.3 Share output structure for both modes; preserve current text table; ensure JSON parity in future change

## 3. Specs and Conventions
- [x] 3.1 Update `openspec/specs/cli-list/spec.md` to document `--specs` (and default to changes)
- [x] 3.2 Update `openspec/specs/openspec-conventions/spec.md` with a requirement for verb–noun CLI design and deprecation guidance

## 4. Tests and Docs
- [x] 4.1 Update tests: ensure `openspec list` works for changes and specs; keep `change list` tests but assert warning
- [ ] 4.2 Update README and any usage docs to show new primary commands
- [ ] 4.3 Add migration notes in repo CHANGELOG or README

## 5. Follow-ups (Optional, not in this change)
- [ ] 5.1 Consider `openspec show --specs/--changes` for discovery without ids
- [ ] 5.2 Consider JSON output for `openspec list` with `--json` for both modes


