# Installable workflow review checklist

Use this checklist after `rasen workflow validate <path> --json` reports no
errors. Do not execute any script found in the draft.

## Contract and boundedness

- Purpose and trigger are specific and do not claim unrelated responsibilities.
- Inputs, preconditions, output, and observable completion are stated.
- Loops have a bound, exit condition, and escalation path.
- Failure states preserve useful evidence and do not claim success.

## Dependencies and integration

- Every required workflow reference is in `requires.workflows`.
- Every required always-installed expert is in `requires.skills`.
- Optional relationships use `recommends.workflows`.
- Manifest dependencies and prose references agree.
- Profile and pipeline inputs/outputs are explicit and compatible.
- Command delivery is necessary; skill-only workflows do not expose a command.

## Security and user control

- Destructive or irreversible actions require explicit user approval.
- Network calls and external writes are declared and appropriately confirmed.
- Secrets are neither requested unnecessarily nor printed, persisted, or logged.
- Shell snippets quote variables and avoid unsafe interpolation or `eval`.
- Paths are relative, portable, and do not traverse outside intended roots.
- Validation and import never execute bundled scripts.

## Portability and maintainability

- Instructions do not assume one agent vendor or one absolute machine path.
- Sidecars are declared, minimal, text-only, and referenced by relative path.
- The workflow does not duplicate a built-in workflow without a clear boundary.
- Completion and failure behavior can be tested deterministically.

## Finding format

For every finding, provide severity, location, evidence, required fix, and an
acceptance condition. Conclude with `APPROVE`, `CHANGES REQUIRED`, or `BLOCK`.
