# Rasen Expert Skills — AI Engineering Workflow

Rasen's standalone experts give AI agents structured specialist roles for
software development. The public roster is intentionally limited to experts
that justify direct invocation or independent pipeline dispatch.

## Available skills

The 12 standalone experts install as `rasen-<name>/` under the host's skills
directory and are invoked by their canonical skill name.

| Skill | What it does |
|-------|-------------|
| `rasen-benchmark` | Repeatable performance and size regression checks against budgets. |
| `rasen-careful` | Warn before destructive commands (`rm -rf`, `DROP TABLE`, force-push). |
| `rasen-chrome-use` | Drive the user's real Chrome browser through the local CDP proxy. |
| `rasen-codex` | Independent second opinion or bounded parallel implementation. |
| `rasen-cso` | Adversarial security audit. |
| `rasen-design-consultation` | Build a complete design system collaboratively. |
| `rasen-design-review` | Browser-rendered design audit and standalone fix loop. |
| `rasen-investigate` | Systematic root-cause debugging; reproduce before hypothesizing. |
| `rasen-office-hours` | Start here. Reframes your product idea before you write code. |
| `rasen-qa` | Browser QA: standalone test/fix/verify or explicit report-only/non-UI mode. |
| `rasen-review` | Pre-landing code review with Standards + Spec axes. |
| `rasen-workflow-author` | Stage and validate workflow/pipeline packages, then run its bundled independent review. |

Single-host methods are bundled references, not standalone skills:

| Host | Bundled reference |
|---|---|
| `rasen-propose` | `references/codebase-design/README.md` |
| `rasen-apply-change` | `references/tdd/README.md` |
| `rasen-explore` | `references/prototype/README.md` |
| `rasen-workflow-author` | `references/workflow-review/README.md` |
| `rasen-help` | `references/navigator.md` |

## Build commands

```bash
pnpm install             # install dependencies
pnpm test                # run tests
pnpm build               # compile TypeScript (also builds the skill payloads)
```

## Key conventions

- Expert skill prose lives inline in `src/core/templates/experts/<name>.ts`; shared blocks are TypeScript constants in `src/core/templates/experts/_shared.ts`. Host-owned references live under `skills/workflows/<dirName>/`, while an expert's own references live under `skills/experts/<id>/`.
- Freshness is pinned by the parity golden-master in `test/core/templates/skill-templates-parity.test.ts`; catalog digests and the workflow-artifact ledger also cover packaged sidecars.
- `chrome-use` provides real-browser access through the local CDP proxy.
- `careful` uses inline advisory prose — always confirm before destructive operations. Scope-sensitive work declares its affected area and audits the actual changed-file set; managed sandbox/workspace policy is separate execution containment.
