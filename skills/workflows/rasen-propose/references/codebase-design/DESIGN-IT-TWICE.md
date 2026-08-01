<!-- adapted from mattpocock/skills (MIT, Copyright Matt Pocock) -->

# Design It Twice

When the user wants to explore alternative interfaces for a chosen deepening candidate, use this orchestration-aware comparison pattern. Based on "Design It Twice" (Ousterhout) — your first idea is unlikely to be the best.

Uses the vocabulary in [README.md](README.md) — **module**, **interface**, **seam**, **adapter**, **leverage**.

## Process

### 1. Frame the problem space

Before producing alternatives, write a user-facing explanation of the problem space for the chosen candidate:

- The constraints any new interface would need to satisfy
- The dependencies it would rely on, and which category they fall into (see [DEEPENING.md](DEEPENING.md))
- A rough illustrative code sketch to ground the constraints — not a proposal, just a way to make the constraints concrete

Show this to the user, then immediately proceed to Step 2.

### 2. Produce independent alternatives without nesting

First detect the execution context:

- **Standalone `rasen-propose`, with delegation explicitly available:** the workflow owner may fan out 3+ independent design workers in parallel through the runtime.
- **A dispatched planner leaf under `rasen-auto`, or any runtime whose prompt forbids subagents:** do **not** spawn or delegate. Draft 3+ radically different interfaces sequentially in the same planner pass, resetting assumptions between drafts and applying a different constraint to each. This is the required flat-hierarchy fallback and must not be skipped.
- **When genuinely independent parallel review is important but the current leaf cannot own it:** record a bounded LEAD-owned fan-out request in the change directory (`design.md` Decisions or a sidecar), including the briefs below. Continue with the sequential comparison now; the request must never block artifact completion.

Give each worker or sequential draft a separate technical brief (file paths, coupling details, dependency category from [DEEPENING.md](DEEPENING.md), what sits behind the seam). The brief is independent of the user-facing problem-space explanation in Step 1. Give each alternative a different design constraint:

- Agent 1: "Minimize the interface — aim for 1–3 entry points max. Maximise leverage per entry point."
- Agent 2: "Maximise flexibility — support many use cases and extension."
- Agent 3: "Optimise for the most common caller — make the default case trivial."
- Agent 4 (if applicable): "Design around ports & adapters for cross-seam dependencies."

Include both [README.md](README.md) vocabulary and CONTEXT.md vocabulary in the brief so each sub-agent names things consistently with the architecture language and the project's domain language.

Each worker or sequential draft outputs:

1. Interface (types, methods, params — plus invariants, ordering, error modes)
2. Usage example showing how callers use it
3. What the implementation hides behind the seam
4. Dependency strategy and adapters (see [DEEPENING.md](DEEPENING.md))
5. Trade-offs — where leverage is high, where it's thin

### 3. Present and compare

Present designs sequentially so the user can absorb each one, then compare them in prose. Contrast by **depth** (leverage at the interface), **locality** (where change concentrates), and **seam placement**.

After comparing, give your own recommendation: which design you think is strongest and why. If elements from different designs would combine well, propose a hybrid. Be opinionated — the user wants a strong read, not a menu.
