<p align="center">
  <picture>
    <source srcset="assets/rasen-logo-dark.svg" media="(prefers-color-scheme: dark)">
    <source srcset="assets/rasen-logo-light.svg" media="(prefers-color-scheme: light)">
    <img src="assets/rasen-logo-light.svg" alt="Rasen logo" height="160">
  </picture>
</p>

<h1 align="center">Rasen — loops that ascend</h1>

<p align="center"><strong>「不是循环，是螺旋」</strong></p>

<p align="center">
  <a href="https://github.com/DumoeDss/rasen/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/DumoeDss/rasen/actions/workflows/ci.yml/badge.svg" /></a>
  <a href="./LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square" /></a>
  <a href="https://rasen.io/docs/"><img alt="Docs" src="https://img.shields.io/badge/docs-rasen.io-4AF626?style=flat-square&labelColor=050505" /></a>
</p>

<p align="center">
  <a href="./README.md"><img alt="English" src="https://img.shields.io/badge/English-4AF626?style=flat-square&labelColor=050505" /></a>
  <a href="./README_zh.md"><img alt="简体中文" src="https://img.shields.io/badge/%E7%AE%80%E4%BD%93%E4%B8%AD%E6%96%87-9A9A98?style=flat-square" /></a>
  <a href="./README_ja.md"><img alt="日本語" src="https://img.shields.io/badge/%E6%97%A5%E6%9C%AC%E8%AA%9E-9A9A98?style=flat-square" /></a>
  <a href="./README_ko.md"><img alt="한국어" src="https://img.shields.io/badge/%ED%95%9C%EA%B5%AD%EC%96%B4-9A9A98?style=flat-square" /></a>
</p>

**Rasen** is an autonomous harness — an engineered **outer loop** wrapped around your coding agent's inner loop. You supply the **intent** — a goal, a bug, a feature — and the harness runs propose → implement → review → fix → ship → archive on its own, iterating until the work is done. Automatic transmission for software development: **control the ideas, not the code.**

## Not a circle — a spiral

A loop that returns to where it started is just a circle. Rasen (螺旋, "spiral") is the shape of a loop that climbs. That is the whole idea, and it maps onto how the tool actually works:

- **Intent is the origin.** Every change begins with what you want, not a document you have to write — a goal, a bug, a feature request. The harness captures it in your `rasen/` workspace and gets to work: `/rasen-propose → apply → archive`. The spec it produces along the way is the pipeline's own working memory — knowledge that accretes with every change — not homework handed back to you.
- **Loops are the form.** Work moves in cycles, not one waterfall pass. The `rasen` pipeline family — `small-feature`, `bug-fix`, `full-feature`, `auto-decompose` — turns a task into a shaped loop of propose, implement, review, ship.
- **Each turn ascends.** The harness doesn't just repeat; it makes progress. `/rasen-auto` runs a LEAD that orchestrates role-isolated subagents, a review-cycle that catches its own mistakes, and handoff/relay that carries context across sessions — so every turn ends higher than it began.
- **Until it breaks through.** `/rasen-goal` closes the spiral on a condition, not a document: drive a metric to a target, make a module rubric-clean, research until a brief is answered — repeat modify → judge until the gate is met.

Intent is where you start. The spiral is how you get there.

## Lineage

Rasen is forked from [OpenSpec](https://github.com/Fission-AI/OpenSpec) (MIT) by Fission-AI, and is independently maintained by [Sayo](https://github.com/DumoeDss). It is **not affiliated with Fission-AI**. Its workflow semantics are aligned with upstream **OpenSpec v1.5.0** — the `propose → apply → archive` spec/change model is the same — but rasen runs in **independent namespaces**: the `rasen` binary, `/rasen-*` slash commands, `rasen-*` skills, and a `rasen/` workspace. rasen layers autonomous orchestration on top and never touches an upstream `openspec/` install.

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

`rasen init` creates a `rasen/` workspace (specs and changes) and installs the `/rasen-*` slash commands for your AI coding tool.

To refresh AI guidance and pick up the latest slash commands after upgrading:

```bash
rasen update
```

## Web UI

The CLI has a browser-based management platform beside it. Install the UI package next to the CLI, then launch:

```bash
npm i -g @atelierai/rasen-ui
rasen ui
```

`rasen ui` starts (or adopts) a resident background daemon — bound to 127.0.0.1 with a per-session token — and opens the app:

- **Board** — your active changes as Tasks in lifecycle columns, across every project and store via the space switcher.
- **Sessions** — launch headless `/rasen-auto` / `/rasen-goal` runs from the browser, watch their output, kill them with a click; they survive closing the terminal.
- **Pipeline canvas** — view any pipeline as a DAG, and assemble new ones by dragging skills onto the canvas, with server-side validation before save.
- **Config / Workflows / Profiles** — layered configuration with visible inheritance, the installable-workflow library with per-space toggles, and named workflow profiles.

## Coexistence with OpenSpec

Rasen is designed to live **alongside** upstream OpenSpec without collision. Every surface is a distinct namespace, so both can be installed in the same project at the same time:

| Surface | OpenSpec | Rasen |
| --- | --- | --- |
| Binary | `openspec` | `rasen` |
| Slash commands | `/opsx:*` | `/rasen-*` |
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

- **Intent-driven workflow** — tell it what to build. The harness turns that into a folder — proposal, spec, design, task list — generating and maintaining it as it works, so you never have to write it yourself: `/rasen-propose → /rasen-apply-change → /rasen-archive-change`.
- **`rasen` pipeline family** — `small-feature` / `bug-fix` / `full-feature` / `auto-decompose` ship as data (YAML); inspect them with `rasen pipeline show|list|classify|resume`, share them as installable packages (`rasen pipeline import|export`), or assemble your own by drag-and-drop in the web UI's pipeline canvas. Adding a task type is adding one file, zero code.
- **`rasen ui` management platform** — a local web UI: task board, supervised headless agent sessions that outlive your terminal, the pipeline canvas, and config/workflow/profile management. See [Web UI](#web-ui).
- **`/rasen-auto` autopilot** — one command turns the agent into a **LEAD** that orchestrates role-isolated subagents (planner / implementer / reviewer / fixer / shipper) through the pipeline, pausing only at gates.
- **`/rasen-goal` goal-driven iteration** — a sibling to `/rasen-auto` for tasks whose "done" is a condition, not a document (drive Lighthouse to 90, make a module rubric-clean, research and write a brief). The LEAD classifies the task into a measure / evaluate / research backend and repeats modify → judge until the gate is satisfied or the round cap is hit.
- **Auto-decompose** — a task too large for one reviewable diff is split into independently-deliverable child changes with a dependency DAG and a conservative serial/parallel policy.
- **chrome-use** — an expert that drives your real Chrome via CDP: navigate, click, capture network traffic, inject JS, read cookies and `localStorage`, wait on requests — for logged-in pages, SPAs, and anything a plain fetch can't reach.
- **Context sensing & handoff** — `rasen agent context` measures real occupancy; `/rasen-handoff` writes a distillate checkpoint; workers self-hand-off at soft budgets, and a compact-recovery hook re-anchors on the distillate after an auto-compact, so long runs survive context limits.
- **Prompt-cache keepalive** — `rasen agent wait` parks an idle worker on a keepalive beat instead of letting its 5-minute prompt cache expire, so a reviewer waiting on an implementer doesn't pay a full-context rewrite on its next turn. Beat length is tunable via `keepalive.beatSeconds`.
- **Token audit** — `rasen agent audit` shows where a session's tokens actually went: per-agent spend, cache churn and its causes, with a bundled HTML viewer. Works on Claude Code transcripts and Codex rollouts, fully local — nothing is uploaded.

## See it in action

```text
You: /rasen-explore
AI:  What would you like to explore?
You: I want dark mode but I'm not sure how to do it cleanly.
AI:  Let me look at your styling setup...
     Cleanest path here: CSS variables + a small theme context,
     with system-preference detection. No new dependencies. Scope it?
You: Yes, let's do it.

You: /rasen-propose add-dark-mode
AI:  Created rasen/changes/add-dark-mode/
     ✓ proposal.md — why we're doing this, what's changing
     ✓ specs/       — requirements and scenarios
     ✓ design.md    — technical approach
     ✓ tasks.md     — implementation checklist
     Ready for implementation!

You: /rasen-apply-change
AI:  Implementing tasks...
     ✓ 1.1 Add theme context provider
     ✓ 1.2 Create toggle component
     ✓ 2.1 Add CSS variables
     ✓ 2.2 Wire up localStorage
     All tasks complete!

You: /rasen-archive-change
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

## Community

Rasen is shared and discussed on [LINUX DO](https://linux.do) — a community we're glad to be part of.
