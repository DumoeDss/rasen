import type { SkillTemplate } from '../types.js';
import { STORE_SELECTION_GUIDANCE } from '../workflows/store-selection.js';
import { PREAMBLE } from './_shared.js';

const BODY = `
<!-- adapted from mattpocock/skills (MIT, Copyright Matt Pocock) -->

${PREAMBLE}

# Navigator

You don't remember every skill, so ask. This is the map: the OPSX **main flow** that most work travels, two **on-ramps** that merge onto it, a **vocabulary layer** that runs underneath, and **standalone** specialists off to the side. Each entry says *when to reach for it*.

## The main flow: idea → ship

The route most work travels. **\`/opsx:auto\`** drives this whole flow autonomously — classify the task, pick the pipeline, run the stages with gates. Reach for the individual commands below when you want to run one stage by hand.

1. **\`/opsx:explore\`** — think a rough idea through before committing to it. (Not sure it's worth building at all? Start at \`/opsx:office-hours\` — see On-ramps.)
2. **\`/opsx:propose\`** — turn the sharpened idea into a change: proposal, design, specs, and tasks.
3. **\`/opsx:apply\`** — implement the tasks against the change.
4. **\`/opsx:review-cycle\`** — iterate review → triage → fix → re-review the delta until it's clean or escalates. Lighter gate: **\`/opsx:verify\`** checks the implementation matches the artifacts. Heavier: **\`/opsx:verify-enhanced\`** adds code-review, security, and browser passes, auto-scaled to the change size.
5. **\`/opsx:ship\`** — resolve the delivery mode (pr / push / local), test only when evidence demands it, then deliver.
6. **\`/opsx:archive\`** — fold the delta specs into the main specs once the change has merged.
7. **\`/opsx:retro\`** — look back at what shipped and what to learn from it.

## On-ramps

A starting situation that generates work, then merges onto the main flow.

- **Something's broken** → **\`/investigate\`**. Systematic root-cause debugging. It **refuses to hypothesise until it has a red-capable feedback loop** — one command that already goes red on *this* bug — then fixes with a regression test. Reach for it on the hard ones: the bug that resists a first glance, the intermittent flake, the regression that crept in between two known-good states.
- **Is this worth building** → **\`/opsx:office-hours\`**. YC-style demand validation before you write code. Reach for it when the idea's *value*, not its design, is the open question.

## Vocabulary underneath

One reference that runs *beneath* the other skills — the single source of truth for its vocabulary. Reach for it directly when the **words**, not the process, are the problem; the skills above also pull it in.

- **\`/codebase-design\`** — the deep-module vocabulary (module, interface, depth, seam, adapter, leverage, locality) for designing a module's *shape*: a lot of behaviour behind a small interface at a clean seam.

## Standalone

Off the main flow — reach for each by name when its situation comes up.

- **\`/tdd\`** — build one concrete behaviour test-first, red → green, when you want a test worth keeping but not a full spec.
- **\`/prototype\`** — throwaway code that answers one design question (does this state model feel right, what should this UI look like). Keep the answer, delete the code.
- **\`/review\`** — a **two-axis** review of a diff: **Standards** (repo conventions + a code-smell baseline) and **Spec** (faithful to the originating proposal/tasks), reported side by side. Reach for it to review a branch or PR against a fixed point.
- **\`/qa\`** — open a real browser, find bugs, fix them, re-verify.
- **\`/qa-only\`** — the same browser sweep as \`/qa\`, but report-only — no code changes.
- **\`/design-review\`** — design audit of the rendered UI with a fix loop and atomic commits.
- **\`/design-consultation\`** — build a complete design system from scratch.
- **\`/benchmark\`** — measure performance against a baseline.
- **\`/cso\`** — security review from a chief-security-officer lens.
- **\`/codex\`** — hand a task to Codex for an independent second opinion or a parallel implementation.
- **\`/browse\`** — headless browser (real Chromium, real clicks) for scripted page interaction.

**Security family** — guarding edits during risky work.

- **\`/careful\`** — warn before destructive commands (rm -rf, DROP TABLE, force-push).
- **\`/freeze\`** — hard-lock edits to one directory.
- **\`/guard\`** — activate \`careful\` + \`freeze\` together.
- **\`/unfreeze\`** — remove the directory lock.
`;

export function getNavigatorSkillTemplate(): SkillTemplate {
  return {
    name: 'openspec:navigator',
    description: 'A map of this repo\'s skills and OPSX workflows and when to reach for each.',
    instructions: `${BODY.trim()}\n\n${STORE_SELECTION_GUIDANCE}`,
    disableModelInvocation: true,
    metadata: { author: 'openspec', version: '1.0' },
  };
}
