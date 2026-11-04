# 2.1 — The persistent store `issue-registry`

Created 2026-08-20 with the change's own product delta (`rasen store setup
--layout 2`), from the worktree cwd, build = worktree `feat/issue-phase2`
(after tasks 1.1–1.3, `pnpm run build`).

- Command: `node bin/rasen.js store setup issue-registry --path E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\rasen-issue-store --layout 2 --json`
- Full JSON payload: `2-1-store-setup.json` (exit 0, `status: []`)

## Durable facts

| fact | value |
| --- | --- |
| Store id | `issue-registry` |
| Permanent uid | `f76edc31-229a-42bc-a5c7-848021eeb2da` |
| Root (durable path) | `E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\rasen-issue-store` |
| Machine registry | `C:\Users\Sayo\.rasen\stores\registry.yaml` (entry type `store`) |
| Layout | declared `layoutVersion: 2` at creation (store.yaml beside `version: 2`) |
| Git | initialized by setup on `master`, renamed to `main` (Phase-1 lesson 3); initial commit `39847ce` "Initialize Rasen store issue-registry" |
| Tracked files at birth | `.rasen-store/store.yaml`, `rasen/config.yaml` — no flat planning tree ever existed |

## store.yaml at creation (verbatim)

```yaml
version: 2
uid: f76edc31-229a-42bc-a5c7-848021eeb2da
id: issue-registry
layoutVersion: 2
```

The born-clean claim, verified on the real store: `readStoreLayoutState`
semantics — declared 2, `flatContentPresent: false` — because setup with
`--layout 2` never created `rasen/specs` or `rasen/changes`. The
`store_layout_mixed_residue` retirement dance every temp-store dogfood had to
run by hand never existed for this store (task 1.3's test pins the same shape
in CI).
