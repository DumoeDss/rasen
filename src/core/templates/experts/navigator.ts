import type { SkillTemplate } from '../types.js';
import { STORE_SELECTION_GUIDANCE } from '../workflows/store-selection.js';
import { PREAMBLE_LITE } from './_shared.js';

const BODY = `
<!-- adapted from mattpocock/skills (MIT, Copyright Matt Pocock) -->

${PREAMBLE_LITE}

# Navigator

You don't remember every skill, so ask. This is the map: the Rasen **main flow** that most work travels, two **on-ramps** that merge onto it, a **vocabulary layer** that runs underneath, and **standalone** specialists off to the side. Each entry says *when to reach for it*.

## The main flow: idea → ship

The route most work travels. **\`rasen-auto\`** drives this whole flow autonomously — classify the task, pick the pipeline, run the stages with gates. Reach for the individual commands below when you want to run one stage by hand.

1. **\`rasen-explore\`** — think a rough idea through before committing to it. (Not sure it's worth building at all? Start at \`rasen-office-hours-command\` — see On-ramps.)
2. **\`rasen-propose\`** — turn the sharpened idea into a change: proposal, design, specs, and tasks.
3. **\`rasen-apply-change\`** — implement the tasks against the change.
4. **\`rasen-review-cycle\`** — iterate review → triage → fix → re-review the delta until it's clean or escalates. Lighter gate: **\`rasen-verify-change\`** checks the implementation matches the artifacts. Heavier: **\`rasen-verify-enhanced\`** adds code-review, security, and browser passes, auto-scaled to the change size.
5. **\`rasen-ship\`** — resolve the delivery mode (pr / push / local), test only when evidence demands it, then deliver.
6. **\`rasen-archive-change\`** — fold the delta specs into the main specs once the change has merged.
7. **\`rasen-retro\`** — look back at what shipped and what to learn from it.

## On-ramps

A starting situation that generates work, then merges onto the main flow.

- **Something's broken** → **\`rasen-investigate\`**. Systematic root-cause debugging. It **refuses to hypothesise until it has a red-capable feedback loop** — one command that already goes red on *this* bug — then fixes with a regression test. Reach for it on the hard ones: the bug that resists a first glance, the intermittent flake, the regression that crept in between two known-good states.
- **Is this worth building** → **\`rasen-office-hours-command\`**. YC-style demand validation before you write code. Reach for it when the idea's *value*, not its design, is the open question.

## Vocabulary underneath

One reference that runs *beneath* the other skills — the single source of truth for its vocabulary. Reach for it directly when the **words**, not the process, are the problem; the skills above also pull it in.

- **\`rasen-codebase-design\`** — the deep-module vocabulary (module, interface, depth, seam, adapter, leverage, locality) for designing a module's *shape*: a lot of behaviour behind a small interface at a clean seam.

## Standalone

Off the main flow — reach for each by name when its situation comes up.

- **\`rasen-tdd\`** — build one concrete behaviour test-first, red → green, when you want a test worth keeping but not a full spec.
- **\`rasen-prototype\`** — throwaway code that answers one design question (does this state model feel right, what should this UI look like). Keep the answer, delete the code.
- **\`rasen-review\`** — a **two-axis** review of a diff: **Standards** (repo conventions + a code-smell baseline) and **Spec** (faithful to the originating proposal/tasks), reported side by side. Reach for it to review a branch or PR against a fixed point.
- **\`rasen-qa\`** — open a real browser, find bugs, fix them, re-verify.
- **\`rasen-qa-only\`** — the same browser sweep as \`rasen-qa\`, but report-only — no code changes.
- **\`rasen-design-review\`** — design audit of the rendered UI with a fix loop and atomic commits.
- **\`rasen-design-consultation\`** — build a complete design system from scratch.
- **\`rasen-benchmark\`** — measure performance against a baseline.
- **\`rasen-cso\`** — security review from a chief-security-officer lens.
- **\`rasen-codex\`** — hand a task to Codex for an independent second opinion or a parallel implementation.
- **\`rasen-chrome-use\`** — drives your real Chrome over the DevTools Protocol (real login state, real clicks) for scripted page interaction, DOM snapshots, and network capture.

**Security family** — guarding edits during risky work.

- **\`rasen-careful\`** — warn before destructive commands (rm -rf, DROP TABLE, force-push).
- **\`rasen-freeze\`** — hard-lock edits to one directory.
- **\`rasen-guard\`** — activate \`rasen-careful\` + \`rasen-freeze\` together.
- **\`rasen-unfreeze\`** — remove the directory lock.
`;

export function getNavigatorSkillTemplate(): SkillTemplate {
  return {
    name: 'rasen:navigator',
    description: 'A map of this repo\'s skills and Rasen workflows and when to reach for each.',
    instructions: `${BODY.trim()}\n\n${STORE_SELECTION_GUIDANCE}`,
    disableModelInvocation: true,
    metadata: { author: 'rasen', version: '1.0' },
  };
}
