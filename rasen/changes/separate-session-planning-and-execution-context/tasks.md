## 1. Launch-Context Contract

- [x] 1.1 Add the runtime-only `execution?: "planning" | "project:<selector>"` request field and matching documentation to `src/core/management-api/wire-types.ts` and the hand-maintained `packages/ui/src/api/types.ts` mirror.
- [x] 1.2 Create `resolveSessionLaunchContext` with the selector-in / facts-out result defined in design D1, and move session planning-space fallback, canonical root comparison, planning-only policy, and attached-root calculation behind that seam.
- [x] 1.3 Resolve project ids, registered roots, and linked worktree roots through the existing project-addressing utilities; validate Store execution against the owning project-registry entry and the execution checkout's current `store:` pointer without mutating registry, config, metadata, or directories.
- [x] 1.4 Return stable pre-spawn failures for malformed execution, missing explicit Store execution, missing projects, stale/dead/non-member projects, and cross-project execution under a project planning space.
- [x] 1.5 Add focused resolver tests for the full selection matrix: compatible project default, explicit Store member, missing Store execution, planning-only, non-member, stale pointer, dead root, linked worktree, omitted-space pointer-repo fallback, and unattributed fallback.
- [x] 1.6 Add path-focused resolver cases using Node path utilities, including Windows case/separator canonicalization and a selected worktree whose canonical root differs from the registered main checkout.

## 2. Management API and Supervisor

- [x] 2.1 Replace the router's session-only `resolveSessionSpace` composition with `resolveSessionLaunchContext`; keep `sessions.ts` responsible for generic request validation and pass only resolved launch facts to the Supervisor.
- [x] 2.2 Extend `LaunchInput` with resolved `attachedRoots`, preserve `SessionRecord.space` as planning attribution and `SessionRecord.cwd` as execution observation, and avoid adding any persistent execution/ownership field.
- [x] 2.3 Build headless-Claude argv with one server-resolved `--add-dir <planning-root>` pair only when the planning root differs from cwd; never attach sibling Store members and never accept client-provided cwd, argv, executable, or additional directories.
- [x] 2.4 Extend management API tests to prove project compatibility; `execution_required` without spawn; valid member/worktree cwd; planning-only Store cwd; non-member/stale-pointer rejection; Store-space filtering; and run-state joins from the Store while `session.cwd` is the member.
- [x] 2.5 Extend Supervisor argv tests to prove same-root omission, distinct-root attachment, and literal argument ordering on POSIX/native executables.
- [x] 2.6 Extend the Windows `.cmd`/`.bat` injection fixture/tests so an attached planning path containing valid command-interpreter metacharacters reaches the fake Claude CLI as one literal `--add-dir` value, with no injected side effect and all existing task-text protections still passing.

## 3. Store Launch UI

- [x] 3.1 Load the active Store's current `members` for Task Detail and pass presentation-only member choices into `LaunchSessionDialog`; keep project pages on their existing launch path.
- [x] 3.2 Add an explicit execution control: preselect and explicitly submit a sole Store member, require a user choice for multiple members, offer planning-only as a separate non-default choice, and invent no project choice for a zero-member Store.
- [x] 3.3 Keep the dialog open on launch rejection and render the server's message verbatim, including a member that became stale after the list was loaded.
- [x] 3.4 Add localized labels, hints, empty-state text, and validation copy in every shipped UI locale, plus focused styling that preserves the dialog's disabled-while-submitting and primary/secondary action hierarchy.
- [x] 3.5 Update API-client, fixture, and component tests for the mirrored request shape, project omission compatibility, sole-member explicit submission, multi-member gating, planning-only submission, zero-member behavior, and verbatim server errors.

## 4. Regression and Scope Verification

- [x] 4.1 Verify the session registry remains in-memory/process-only and that no launch-context field is written to Session files, Change artifacts, or run-state.
- [x] 4.2 Add or update regressions proving Store member chips still filter by actual `session.cwd` provenance while Store session visibility and pipeline joins continue to follow `session.space`; do not reinterpret chips as Task or Change ownership.
- [x] 4.3 Confirm the implementation does not add Issue/Execution Plan schemas, persistent Change targets, Board redesign, automatic multi-project routing, Workset CLI-agent openers, or Codex browser supervision.

## 5. Automated Verification

- [x] 5.1 Run the focused root Vitest suites for launch-context resolution, sessions API/space behavior, Supervisor behavior, and Windows injection fixtures; resolve every failure without weakening the security assertions.
- [x] 5.2 Run the UI package's Task Detail/API client tests and `pnpm --dir packages/ui typecheck`.
- [ ] 5.3 Run root `pnpm lint`, `pnpm test`, and `pnpm build`, then run or obtain CI evidence on both Windows and a POSIX platform for the path/spawn changes.

## 6. Two-Member Store Dogfood

- [x] 6.1 Provision or select a real registered Store with two live member projects A and B, record their clean starting Git states and current pointers, and open a real Store Task Detail through the management UI.
- [x] 6.2 Launch from the Store UI with member A explicitly selected and drive one real pipeline from launch through completion or an explicit terminal failure; record evidence that the agent cwd and Git/dependency/test commands use A while Store-resident Change/spec/run-state artifacts remain readable and writable.
- [x] 6.3 Verify member B remains unmodified, the Session is visible in the Store space, the member-A activity filter finds it from `session.cwd`, the member-B filter does not, and the pipeline evidence remains joined from the Store planning space.
- [x] 6.4 Save the dogfood commands, observed roots, Session response, pipeline outcome, and before/after Git evidence in the change work directory; do not mark the Store launch repair complete from automated tests alone.

## 7. Review Round 1 Corrections

- [x] 7.1 Submit each Store member's server-listed registered root as the `project:<selector>` value, key member choices by root, and add UI plus resolver/API regressions proving two live same-id clones launch in the selected clone's cwd.
- [x] 7.2 Separate Store member-inventory transport status from authoritative member data, preserve the last successful list across polling failures, render a localized retryable error in all shipped locales, and keep planning-only explicitly available.
- [x] 7.3 Add component regressions for an initial inventory failure and for preservation followed by polling recovery; update the design and delta specs to record both review corrections without introducing durable ownership state.

## 8. Review Round 2 Correction

- [x] 8.1 Distinguish automatic sole-member preselection from explicit user choice so an inventory expansion to multiple members clears only the automatic selection, while valid explicit project or planning-only choices survive refreshes.
- [x] 8.2 Add component regressions for one-to-many inventory expansion, explicit-selection persistence, and safe recovery when an explicitly selected project disappears.

## 9. Review Round 3 Correction

- [x] 9.1 Derive the effective execution choice synchronously from the current member inventory and selection provenance, and use that same safe value for rendered radio state, submit-button gating, and the launch request.
- [x] 9.2 Add pre-effect regressions proving inventory expansion and removal of an explicit project cannot submit a stale choice, plus direct coverage that planning-only survives inventory refreshes.
