# OpenSpec Expert Skills — AI Engineering Workflow

The OpenSpec expert skills give AI agents structured roles for
software development. Each skill is a specialist: CEO reviewer, eng manager,
designer, QA lead, release engineer, debugger, and more.

## Available skills

Skills install as `openspec-<name>/` under the host's skills directory and are
invoked by name (e.g., `/office-hours`).

| Skill | What it does |
|-------|-------------|
| `/office-hours` | Start here. Reframes your product idea before you write code. |
| `/design-consultation` | Build a complete design system from scratch. |
| `/review` | Pre-landing PR review. Finds bugs that pass CI but break in prod. |
| `/debug` | Systematic root-cause debugging. No fixes without investigation. |
| `/design-review` | Design audit + fix loop with atomic commits. |
| `/qa` | Open a real browser, find bugs, fix them, re-verify. |
| `/qa-only` | Same as /qa but report only — no code changes. |
| `/browse` | Headless browser — real Chromium, real clicks, ~100ms/command. |
| `/careful` | Warn before destructive commands (rm -rf, DROP TABLE, force-push). |
| `/freeze` | Lock edits to one directory. Hard block, not just a warning. |
| `/guard` | Activate both careful + freeze at once. |
| `/unfreeze` | Remove directory edit restrictions. |
| `/codebase-design` | Deep-module vocabulary (seam / depth / adapter / leverage) and the deletion test. |
| `/tdd` | Test-driven development that produces tests worth keeping: seams, red→green, anti-patterns. |
| `/prototype` | Throwaway code that answers one design question — a LOGIC or UI branch. |
| `/navigator` | A map of the skills and OPSX workflows and when to reach for each. User-invoked. |

## Build commands

```bash
pnpm install             # install dependencies
pnpm test                # run tests
pnpm build               # compile TypeScript (also builds the skill payloads)
```

## Key conventions

- Expert skill prose lives inline in `src/core/templates/experts/<name>.ts`; shared blocks are TypeScript constants in `src/core/templates/experts/_shared.ts`. Edit those directly — there is no `.tmpl` step.
- Freshness is pinned by the parity golden-master in `test/core/templates/skill-templates-parity.test.ts`.
- The browse binary provides headless browser access. Use `$B <command>` in skills.
- Safety skills (careful, freeze, guard) use inline advisory prose — always confirm before destructive operations.
