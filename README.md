<h1 align="center">Rasen — loops that ascend</h1>

<p align="center"><strong>「不是循环，是螺旋」</strong></p>

<p align="center">
  <a href="https://github.com/DumoeDss/rasen/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/DumoeDss/rasen/actions/workflows/ci.yml/badge.svg" /></a>
  <a href="./LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square" /></a>
</p>

<p align="center">
  <a href="https://rasen.io/docs/"><img alt="Docs — English" src="https://img.shields.io/badge/docs-English-4AF626?style=flat-square&labelColor=050505" /></a>
  <a href="https://rasen.io/zh/docs/"><img alt="文档 — 简体中文" src="https://img.shields.io/badge/docs-%E7%AE%80%E4%BD%93%E4%B8%AD%E6%96%87-4AF626?style=flat-square&labelColor=050505" /></a>
  <a href="https://rasen.io/ja/docs/"><img alt="ドキュメント — 日本語" src="https://img.shields.io/badge/docs-%E6%97%A5%E6%9C%AC%E8%AA%9E-4AF626?style=flat-square&labelColor=050505" /></a>
  <a href="https://rasen.io/ko/docs/"><img alt="문서 — 한국어" src="https://img.shields.io/badge/docs-%ED%95%9C%EA%B5%AD%EC%96%B4-4AF626?style=flat-square&labelColor=050505" /></a>
</p>

**Rasen** is a spec-driven development workflow with an autonomous orchestration harness on top — you write a spec, and the harness drives the change through propose → apply → archive, iterating on its own until the work is done.

## Not a circle — a spiral

A loop that returns to where it started is just a circle. Rasen (螺旋, "spiral") is the shape of a loop that climbs. That is the whole idea, and it maps onto how the tool actually works:

- **The spec is the origin.** Every change begins as a written intent — a proposal, requirements, a design, a task list — captured in your `rasen/` workspace before any code is written. `/rasen:propose → apply → archive`.
- **Loops are the form.** Work moves in cycles, not one waterfall pass. The `rasen` pipeline family — `small-feature`, `bug-fix`, `full-feature`, `auto-decompose` — turns a task into a shaped loop of propose, implement, review, ship.
- **Each turn ascends.** The harness doesn't just repeat; it makes progress. `/rasen:auto` runs a LEAD that orchestrates role-isolated subagents, a review-cycle that catches its own mistakes, and handoff/relay that carries context across sessions — so every turn ends higher than it began.
- **Until it breaks through.** `/rasen:goal` closes the spiral on a condition, not a document: drive a metric to a target, make a module rubric-clean, research until a brief is answered — repeat modify → judge until the gate is met.

Spec is where you start. The spiral is how you get there.

## Lineage

Rasen is forked from [OpenSpec](https://github.com/Fission-AI/OpenSpec) (MIT) by Fission-AI, and is independently maintained by [Sayo](https://github.com/DumoeDss). It is **not affiliated with Fission-AI**. Its workflow semantics are aligned with upstream **OpenSpec v1.5.0** — the `propose → apply → archive` spec/change model is the same — but rasen runs in **independent namespaces**: the `rasen` binary, `/rasen:*` slash commands, `rasen-*` skills, and a `rasen/` workspace. rasen layers autonomous orchestration on top and never touches an upstream `openspec/` install.

## Install

Requires **Node.js `>=20.19.0`**.

```bash
npm i -g @atelierai/rasen
```

Then initialize in your project:

```bash
cd your-project
rasen init
```

`rasen init` creates a `rasen/` workspace (specs and changes) and installs the `/rasen:*` slash commands for your AI coding tool.

To refresh AI guidance and pick up the latest slash commands after upgrading:

```bash
rasen update
```

## Coexistence with OpenSpec

Rasen is designed to live **alongside** upstream OpenSpec without collision. Every surface is a distinct namespace, so both can be installed in the same project at the same time:

| Surface | OpenSpec | Rasen |
| --- | --- | --- |
| Binary | `openspec` | `rasen` |
| Slash commands | `/opsx:*` | `/rasen:*` |
| Skills | `openspec-*` | `rasen-*` |
| Workspace | `openspec/` | `rasen/` |

Because the namespaces never overlap, installing rasen never disturbs an existing OpenSpec setup — there is nothing to uninstall first.

If you have an existing `openspec/` workspace and want to bring it into rasen:

```bash
rasen migrate
```

`rasen migrate` is **copy-only**: it copies `openspec/{specs,changes,config.yaml}` into `rasen/`, skipping anything that already exists. Your original `openspec/` directory is **never modified or deleted** — you can keep using OpenSpec against it unchanged.

### chrome-use prerequisites

The `chrome-use` expert drives your everyday Chrome over the Chrome DevTools Protocol. To use it you need:

- **Google Chrome** installed.
- **Node.js 22 or newer** (the CDP proxy tooling requires it).
- Chrome started with remote debugging enabled — open `chrome://inspect/#remote-debugging` (or launch Chrome with `--remote-debugging-port`).
- On the **first CDP connection**, Chrome shows an **"Allow"** permission popup — approve it to let the tooling attach.

## What you get

- **Spec-driven workflow** — every change is a folder with a proposal, specs, a design, and a task list. Agree on what to build before code is written: `/rasen:propose → /rasen:apply → /rasen:archive`.
- **`rasen` pipeline family** — `small-feature` / `bug-fix` / `full-feature` / `auto-decompose` ship as data (YAML); inspect them with `rasen pipeline show|list|classify|resume`. Adding a task type is adding one file, zero code.
- **`/rasen:auto` autopilot** — one command turns the agent into a **LEAD** that orchestrates role-isolated subagents (planner / implementer / reviewer / fixer / shipper) through the pipeline, pausing only at gates.
- **`/rasen:goal` goal-driven iteration** — a sibling to `/rasen:auto` for tasks whose "done" is a condition, not a document (drive Lighthouse to 90, make a module rubric-clean, research and write a brief). The LEAD classifies the task into a measure / evaluate / research backend and repeats modify → judge until the gate is satisfied or the round cap is hit.
- **Auto-decompose** — a task too large for one reviewable diff is split into independently-deliverable child changes with a dependency DAG and a conservative serial/parallel policy.
- **chrome-use** — an expert that drives your real Chrome via CDP: navigate, click, capture network traffic, inject JS, read cookies and `localStorage`, wait on requests — for logged-in pages, SPAs, and anything a plain fetch can't reach.
- **Context sensing & handoff** — `rasen agent context` measures real occupancy; `/rasen:handoff` writes a distillate checkpoint; workers self-hand-off at soft budgets, and a compact-recovery hook re-anchors on the distillate after an auto-compact, so long runs survive context limits.

## See it in action

```text
You: /rasen:explore
AI:  What would you like to explore?
You: I want dark mode but I'm not sure how to do it cleanly.
AI:  Let me look at your styling setup...
     Cleanest path here: CSS variables + a small theme context,
     with system-preference detection. No new dependencies. Scope it?
You: Yes, let's do it.

You: /rasen:propose add-dark-mode
AI:  Created rasen/changes/add-dark-mode/
     ✓ proposal.md — why we're doing this, what's changing
     ✓ specs/       — requirements and scenarios
     ✓ design.md    — technical approach
     ✓ tasks.md     — implementation checklist
     Ready for implementation!

You: /rasen:apply
AI:  Implementing tasks...
     ✓ 1.1 Add theme context provider
     ✓ 1.2 Create toggle component
     ✓ 2.1 Add CSS variables
     ✓ 2.2 Wire up localStorage
     All tasks complete!

You: /rasen:archive
AI:  Archived to rasen/changes/archive/2026-01-23-add-dark-mode/
     Specs updated. Ready for the next feature.
```

## Telemetry & privacy

Rasen collects anonymous usage telemetry to understand which commands are used. It sends **only** the command name, the rasen version, an anonymous UUID, and your OS and Node version — **no paths, arguments, or project data**, ever.

To opt out, set either:

```bash
export RASEN_TELEMETRY=0
# or the cross-tool standard:
export DO_NOT_TRACK=1
```

Telemetry is also **automatically disabled in CI**.

## License

MIT — Copyright (c) 2024 OpenSpec Contributors and Copyright (c) 2026 Sayo. See [LICENSE](./LICENSE).

Issues and feedback: [github.com/DumoeDss/rasen](https://github.com/DumoeDss/rasen).
