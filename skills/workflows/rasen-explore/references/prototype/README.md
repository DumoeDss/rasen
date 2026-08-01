<!-- adapted from mattpocock/skills (MIT, Copyright Matt Pocock) -->

# Prototype reference

A prototype is **throwaway code that answers one bounded design question**. Use this exception to explore's no-implementation stance only when running code is the fastest credible way to settle a stuck question.

## Pick one branch

- **Does this logic or state model feel right?** Read [LOGIC.md](LOGIC.md) and build a tiny interactive terminal probe.
- **What should this look like?** Read [UI.md](UI.md) and build several structurally different, switchable UI variants.

If the question is ambiguous, ask. If no user is available, select the branch that matches the surrounding code and state the assumption.

## Rules for both branches

1. State the one question before writing code.
2. Mark the code clearly as a prototype and keep it near the context it tests.
3. Make it runnable with one project-native command.
4. Keep state in memory unless persistence is the question.
5. Skip production polish, broad abstractions, and speculative scope.
6. Surface the complete relevant state after each action or variant switch.
7. Capture the answer, then delete all throwaway code. Do not leave a prototype shell in production.

## Rasen capture path

When an active change exists, resolve it with `rasen status --change <name> --json` and write the verdict and settled decisions into that `changeRoot`, preferably the Decisions section of `design.md` or a concise change-directory sidecar. A standalone `NOTES.md`, ADR, issue, or commit-message capture is only for non-Rasen use and never overrides the active change path.

The durable artifact is the answer, not the probe. Once the answer is captured, delete the prototype code and verify the working tree contains no leftover route, switcher, script, or task-runner entry.
