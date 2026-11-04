Scope legend: `[MACOS-HOST]` marks work that requires a real macOS machine (none is available in the planning/implementation environment; those tasks stay open until one is). `[POSIX-PREFLIGHT]` marks real-process evidence runnable on Linux/WSL that is labelled non-acceptance (wrong OS) and never satisfies the macOS gate.

## 1. Baseline and context

- [x] 1.1 Record the implementation-start HEAD and a verbatim copy of the current `RECURSIVE_PROCESS_SCOPE_SEMANTICS` constant in `evidence/implementation-baseline.md`, noting the two pending contract edits (`workload-non-escape` wording narrow, `replacement-recovery` re-tier) and that this change touches none of `types.ts`/`registry.ts`/`manifest.ts`.
- [x] 1.2 Re-verify the seam facts design.md rests on (registry subset rejection, `closeDurableProcess` release-only-on-closed rule, the three `createNativeProcessScope` construction sites, Tier A never entering ProcessScope) against the current tree with file:line anchors; report any drift to the LEAD before writing code.

## 2. Seam tier declaration and honest terminal vocabulary

- [x] 2.1 Add the additive best-effort tier declaration to the ProcessScope seam: `exactCancel: false` and `scopeEmptyProof: false`, recorded at prepare time before activation; absence of a declaration means the exact tier with unchanged behavior.
- [x] 2.2 Add the declared-unproven terminal vocabulary, distinct from both `closed` (a proven-empty claim) and `uncertain` (a transient unknown): cancel terminal `cancelled / emptiness-unproven` and a completion terminal carrying the same unproven honesty, with diagnostics for `groupObservedEmpty` and whether force was used.
- [x] 2.3 Persist the declaration in the hosted-session record at prepare time; if the declaration cannot be recorded before activation, activation fails typed and no workload code runs.
- [x] 2.4 Deterministic tests: declaration visible in the record before start; undeclared scopes keep the exact-tier contract; the new receipt shapes are closed types (no field for a proven-empty claim on this tier).

## 3. Darwin best-effort scope implementation (Node-only, no native helper)

- [x] 3.1 Implement `prepare()`: refuse a non-absolute command with a typed error before any process is created, apply the explicit env allowlist only, record the tier declaration, mint the opaque ref; no workload process exists after prepare.
- [x] 3.2 Implement `activate()`: detached spawn so the workload is the leader of its own session and process group (group id equals leader pid), wire stdio, capture the exact root exit as code XOR signal.
- [x] 3.3 Implement the cancel protocol per design D5: group SIGTERM; bounded grace polling whole-group emptiness (ESRCH on the group probe, tolerant of transient zombie visibility per the RC-002 lesson); the escalation decision reads group emptiness only - never leader exit; group SIGKILL at grace expiry when the group persists; one bounded final observation; terminal always `cancelled / emptiness-unproven`.
- [x] 3.4 Implement `inspect()` and prepared `abort()`: abort before activate reports honestly that nothing ran; a root-exited scope with the group not observed empty remains controllable and a later cancel runs the full group protocol.
- [x] 3.5 Bound every phase (prepare, activate, cancel steps, inspect, final observation) with a deadline that settles once as a typed timeout; no code path waits unbounded.
- [x] 3.6 Daemon-death posture: refs from a prior daemon lifetime report foreign or uncertain; no signal is ever delivered from a stale record; no reattach and no identity revalidation exist anywhere in the module.

## 4. Host integration and the declaration-gated release rule

- [x] 4.1 Select the darwin best-effort scope in hosted-session ProcessScope construction only when `process.platform === 'darwin'` (router construction site plus the two internal defaults), leaving Linux, Windows, and host-native Tier A dispatch untouched.
- [x] 4.2 Extend the hosted-session close path (`closeDurableProcess` and the live-close route) with the declaration-gated release rule: release from a declared-unproven terminal only when the record carries the pre-start declaration; refuse release for undeclared scopes; the released record keeps the unproven terminal permanently.
- [x] 4.3 Surface the declaration and terminal state on the hosted-session record and its API projection so an operator reading the Record sees `cancelled / emptiness-unproven`, never a clean-cancel claim.
- [x] 4.4 Regression: the existing deterministic-scope suite passes unchanged, plus a dedicated assertion that undeclared scopes see identical release behavior before and after this change.

## 5. Deterministic guard tests and mutation receipts (any OS; non-acceptance)

- [x] 5.1 State-machine guard with an injected process-control shim: leader exits instantly while a shim descendant survives; the protocol must keep grace running and force at expiry - proving the escalation input is group emptiness, never leader exit.
- [x] 5.2 Never-cleanly-cancelled guard: no code path on this tier produces `closed` or any proven-empty claim, including the group-observed-empty case.
- [x] 5.3 Declaration-gated release guard: an unproven terminal presented without the pre-start declaration is refused release.
- [x] 5.4 Mutation receipts for 5.1-5.3 by deliberate defect injection, each receipt showing the guard RED against the defect it names: (a) escalation keyed to leader exit; (b) leader-only kill instead of group kill; (c) forged cleanly-cancelled receipt; (d) release without declaration. Deterministic mutations are necessary but not sufficient; real-kernel receipts live in Sections 6 and 7.

## 6. POSIX pre-flight oracles [POSIX-PREFLIGHT]

- [x] 6.1 Real-process oracle: leader exits instantly on SIGTERM, real descendant survives; correct build delivers group SIGKILL at grace expiry (descendant gone); leader-exit-keyed mutant leaves the descendant alive - capture both receipts.
- [x] 6.2 Real-process oracle: descendant traps/ignores SIGTERM and forces escalation; capture the group-kill-vs-leader-kill mutation receipt (leader-only mutant leaves the descendant alive).
- [x] 6.3 Escape demonstration (the flagship honesty receipt): a descendant leaves the group via `setsid()` and survives a completed cancel while the group observes empty; the record shows `cancelled / emptiness-unproven` and never claimed proven-empty.
- [x] 6.4 Natural-empty observation: all members exit naturally; exact root exit code and, separately, exact terminating signal are captured; completion terminal still records emptiness as unproven.
- [x] 6.5 Label every Section 6 evidence file non-acceptance (wrong OS) inside the file itself.

## 7. Real macOS acceptance gate [MACOS-HOST]

Every task in this section requires a real macOS machine; none exists in this environment, so these remain open until one is available and the change stays non-terminal without them.

- [ ] 7.1 Run the full unit and guard suite on the macOS host; record host, OS version, and Node version provenance in the evidence.
- [ ] 7.2 Re-run oracles 6.1-6.4 on macOS, including the mutation receipts, under Darwin signal semantics and launchd reaping.
- [ ] 7.3 Production-path cancel receipt: start a real hosted session through the production entry path (`createSessionHost` via the management router - not a fixture, not a `...ForTesting` twin), cancel it, and capture the Record showing the pre-start declaration and the `cancelled / emptiness-unproven` terminal.
- [ ] 7.4 Production-path natural completion receipt: exact root exit recorded and the completion terminal carries the unproven-emptiness honesty.
- [ ] 7.5 Daemon-death receipt: kill the daemon with a live workload group; confirm the group persists (the declared leak), restart, and confirm the stale record reports loss honestly with no destructive action and no reattach.
- [ ] 7.6 Production-exercise sweep: confirm every production entry point this change added is covered by at least one macOS receipt not mediated by a fixture; record the sweep in the evidence.

## 8. Verification and ship

- [x] 8.1 `rasen validate --strict` green for this change; whitespace gate verified on bytes (LF-only, no trailing whitespace, no trailing blank line at EOF) for every file this change adds or edits.
- [x] 8.2 Confirm the DAG: no edge from this change into `ecp-native-process-capsule-closure` anywhere; closure `dependsOn` remains `[ecp-linux-process-authority-provider, ecp-windows-process-authority-provider]`.
- [x] 8.3 Re-read design.md D2 against the then-current `RECURSIVE_PROCESS_SCOPE_SEMANTICS`; record that the declaration survived the landed contract edits, or the exact discrepancy if it did not.
- [ ] 8.4 Windows and Linux CI green: this change must not alter non-darwin behavior; all paths built with `node:path`.
- [x] 8.5 Evidence completeness review: every green guard has its mutation receipt; macOS receipts present, or the change is explicitly reported non-terminal awaiting a macOS host - never a green assertion without its demonstrated failing counterpart.
