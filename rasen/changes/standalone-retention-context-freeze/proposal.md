## Why

The `rasen-retain` workflow documents a standalone invocation whose mode comes from the effective profile, and that mode can be `codify`. But every project-scoped knowledge command in the `codify` branch requires a frozen knowledge identity loaded from a resolved run-state directory, and a completed change that never ran through a classified pipeline has no run-state at all. `rasen pipeline resume` then returns neither a run-state nor a directory, so there is no authorized way to freeze the identity the branch needs.

Two documented states exist — standalone retention resolves its mode from the effective profile, and project knowledge operations use a frozen identity — with no defined transition between them. The gap is latent while every candidate lesson is rejected, and becomes a hard blocker the moment one project lesson passes all acceptance gates. Reported in `local_docs/rasen-retention-standalone-run-state/report.md` against CLI `0.1.6`, observed on the change `implement-child-process-supervision`.

The worker cannot work around it. Creating or classifying a pipeline after the fact would freeze a pipeline that never ran; hand-writing run-state or synthesizing an owner identity is forbidden and would defeat the frozen-identity guarantee that makes the write safe. The transition has to be an operation Rasen owns.

A second, independent defect blocks the same branch at its entry point: the workflow reads the standalone retention mode with `rasen config get retention`, which reports only an explicitly stored value and reports nothing at all when the key is unset, while the authorization gate that decides whether a project lesson may be applied resolves the effective value from the profile. A user on the `full` profile with no stored key gets no answer from the documented command even though the gate would resolve `report`.

## What Changes

- Let a completed change with no pipeline run-state prepare itself for retention through one Rasen operation that reports the effective retention mode, freezes the knowledge owner and planning root, and returns the directory later knowledge commands read.
- Report the resolved retention mode as the effective value the authorization gate itself uses, so the mode a user is told matches the mode that governs whether a lesson may be applied.
- Make repeated preparation reuse the identities already recorded rather than creating a second record, so re-running retention on the same change is safe.
- Refuse preparation before any candidate is created when ownership is ambiguous, missing, renamed, or stale.
- Treat an existing run-state and any knowledge context already recorded in it as authoritative and leave it exactly as written, including records from earlier context versions.
- Record only durable identities in the prepared context, never an absolute planning or owner directory, so the record stays valid across machines and checkouts.
- Report the deterministic run-state location from `rasen pipeline resume` even when no run-state exists yet, so a caller can see where state for that change would live.
- Let a run carry a frozen knowledge identity without claiming a pipeline it never ran.
- Complete a zero-candidate standalone retention run as a successful no-op that writes no learned skill.
- Direct the retention workflow at the new preparation operation, removing its dependency on a command that reports a different value than the gate.

## Capabilities

### New Capabilities

- `retention-context-preparation`: Defines the Rasen-owned operation that resolves the effective retention mode, freezes durable knowledge identity for a change with no pipeline run-state, returns the run-state location for later knowledge commands, and is safe to repeat.

### Modified Capabilities

- `opsx-pipeline-registry`: Allows a run to hold a frozen knowledge identity without a pipeline, reports the deterministic run-state location when no run-state exists, requires crash-safe run-state writing, and preserves existing run-state content and context versions unchanged.

## Impact

- Affects run-state contract, location reporting, and writing in `src/core/pipeline-registry/run-state.ts`; resume payloads and the no-run-state branch in `src/commands/pipeline.ts`; knowledge identity freezing in `src/core/learned-skills/context.ts`; the knowledge command surface in `src/commands/knowledge.ts`; retention mode resolution shared with `src/commands/profile-editor.ts`; a new command surface under `src/commands/`; the `rasen-retain` template in `src/core/templates/workflows/retain.ts` and its `codify` sidecar in `skills/workflows/rasen-retain/codify.md`; and command and option copy in `src/locales/`.
- Connects `freezeKnowledgeContext`, which is already implemented and unit-tested but has no production caller, so no new identity-freezing logic is introduced.
- Relaxes the run-state contract rather than tightening it: every run-state file valid today stays valid and unchanged, and no context version is upgraded in place.
- Makes run-state writing crash-safe and repeatable, which is a requirement of preparation rather than a separate improvement, because preparation updates a file that may already exist.
- Does not make Rasen the only writer of run-state. The LEAD still hand-writes progress and handoff records during a run, as the shipped orchestration guidance instructs, so preparation must tolerate a file another writer has touched.
- Requires tests covering project and store ownership including two stores sharing a display name, zero-candidate and accepted-candidate standalone runs, ambiguous and stale ownership, repeated preparation, and existing pipeline run-states at every context version.
- Shares no source file with `detect-omp-host-runtime`, so the two changes can proceed independently.
