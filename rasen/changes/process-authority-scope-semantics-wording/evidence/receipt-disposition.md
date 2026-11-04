# Receipt disposition for the three retired semantics

Receipts stand as taken. Nothing in this record edits an evidence file, a ledger row, or a
gate row. Each row below states whether the receipt's *claim* survives the narrowed wording,
and if not, whether it must be re-taken or only annotated.

Every grading quoted here was read from the source evidence during implementation rather than
copied from `design.md`. Where the source disagreed with the design, the source wins and the
disagreement is called out.

## 6.1 Receipts phrased against `workload-non-escape`

The token is renamed to `forked-descendant-non-escape`. The measurement did not change, so a
receipt survives exactly when what it exercised was a descendant the workload itself forked.

| Receipt | Source grading | Disposition |
| --- | --- | --- |
| Linux task 7.4 detached double-fork recursive-kill oracle | `STAYS-0.2.0`, no caveat | **Valid unchanged.** Row 137 reads "actual `setsid()` plus detached double-fork survival/recursive-kill proves containment of our own leaked workers - the exact case Step 1 exists to keep catching". A `setsid` double-fork is a forked descendant, so the receipt attests the narrowed claim precisely. Annotation only. |
| Linux task 7.5 `setpgid` orphan oracle | `STAYS-0.2.0`, no caveat | **Valid unchanged.** Row 138 records that membership must not depend on process groups. Still a forked descendant. Annotation only. |
| `evidence/f-l2-17-linux-escape-demonstration.md` | not a ledger row | **Reclassified, not retired.** It demonstrated that a workload can reach `systemd --user` and produce a process outside the authority. Under the old wording that was a standing counterexample to an advertised semantic. Under the new wording it is the *justification* for the narrowing and is no longer an open defect. Its six falsifiers stand as taken; no re-take. |
| `native/windows-process-authority/tests/windows_section8_gate.rs:1091` | crate comment | **Untouched.** Prose comment naming F-L2-17 as "a property of `workload-non-escape`, not a defect in this receipt". Left byte-identical so neither crate freeze is disturbed. Its reasoning survives the rename verbatim. |

## 6.2 Receipts phrased against `replacement-recovery`

The ledger's own counts line reads `MOVES-UPGRADE-PATH 5`, and the five rows are exactly the
ones the design names.

| Receipt | Source grading | Disposition |
| --- | --- | --- |
| Linux 2.7 | `MOVES-UPGRADE-PATH` | **Retired with criterion 4.** Row 99: "entirely durable-publication machinery". No intra-lifetime half. |
| Linux 6.9 | `MOVES-UPGRADE-PATH` | **Retired with criterion 4.** The durable half of prepare/publish/activate. |
| Linux 6.10 | `MOVES-UPGRADE-PATH` | **Retired with criterion 4**, with one carve-out the row states itself: "(Exactly-once activation itself stays via 5.1.)" That carve-out is what the new ADDED activation requirement makes normative. |
| Linux 6.11 | `MOVES-UPGRADE-PATH` | **Retired with criterion 4.** Recovered-published-state reconciliation. |
| Linux 7.10 | `MOVES-UPGRADE-PATH` | **Retired with criterion 4.** Publication-window machinery, "moves whole (WSL-R4-M06)". |
| Linux 2.3 | `NARROWS` | **Split; retained half is load-bearing.** The private-reference codec stays because "every control verb is a fresh helper process consuming this reference ... the live destructive-target-safety path". Only the daemon-restart reattach purpose leaves. |
| Linux 6.2 | `NARROWS` | **Split.** Native-owned one-use capabilities stay as live control-path integrity; the durable-reattach purpose leaves. |
| Linux 6.3 | `NARROWS` | **Split.** The required order (verify envelope, open handle, reread and compare the tuple) stays as the per-operation open path; only "resume after daemon death" leaves. This is the row the new revalidation requirement exists to protect. |
| Linux 6.4 | `NARROWS` | **Split.** "Without signalling on ambiguous or drifted identity" is retained destructive-target safety. |
| Linux 7.7 | `NARROWS` | **Split, explicitly, in the row's own words.** Guardian forced-death and unrelated-process survival stay; "controller replacement ... resumes live authority" moves; the refusal half (reject boot/PID/start/namespace replacements, no destructive control on drift) stays. The row ends "Receipts stand as taken." |
| WSL primary gate round-4 row for 7.7 | see 7.7 | **Follows 7.7's split.** No separate re-take. |
| Windows task 9.8 | task is `- [ ]`, unchecked | **No receipt exists to dispose of.** Its text ("prepare, activate, inspect, terminate, abort, and recovery end to end") is an *unrun* task, not a taken receipt. The disposition is therefore a re-scope of the task wording before it is ever run, not a re-take. Recorded as a finding for the Windows Change's owner; this Change does not edit that task file. |

## 6.3 Receipts phrased against `publish-before-activate`

| Receipt | Source grading | Disposition |
| --- | --- | --- |
| Linux 2.5 | `NARROWS` | **Split.** "The published phase belongs to the three-phase protocol and moves to the upgrade path"; the live / root-exit / exact-empty / unavailable / uncertain / drift / gap / timeout / control-loss mapping stays. |
| Linux 6.6 | `NARROWS` | **Split.** Prepared abort stays ("keeping activation closed, signalling only the revalidated guardian pidfd"); published abort accompanies the publication machinery, tracked as `WSL-R4-M04`. |
| Linux 7.8 | `NARROWS` | **Split, six of seven oracles stay.** Natural empty, exact code exit, exact signal exit, root-exit-with-live-descendant, recursive force, and prepared abort stay; the published-abort oracle moves with `WSL-R4-M04`. The row also records a self-correction made 2026-08-07 with no verdict change. |
| Linux 8.6 | `MOVES-0.3.0-BROKER` | **Moves with the broker, not with this narrowing.** The design described this row as moving "with the broker"; the ledger grades it `MOVES-0.3.0-BROKER`, which is a different destination from `MOVES-UPGRADE-PATH`. Recorded precisely so a later reader does not merge the two buckets. |
| Publication rows already listed in 6.2 (2.7, 6.9, 6.10, 6.11, 7.10) | `MOVES-UPGRADE-PATH` | **Carry both phrasings and retire once.** Not double-counted. |
| Coordinator-level publication receipts from the archived foundation | archived | **Remain valid.** The mechanics they attest still run unchanged: the delta retains `Bounded prepare, publish, and activate ordering` with all seven scenarios, reframed as coordinator mechanics rather than an advertised semantic. |

## 6.4 Re-take versus annotate

**Must be re-taken because the claim named a semantic that no longer exists:** none.

Every `MOVES-UPGRADE-PATH` receipt is retired along with the acceptance it served, so there is
nothing to re-take. Every `NARROWS` receipt keeps its retained half, and each of those rows
already states the split in its own text, so the assertion is unchanged and only the vocabulary
around it moved.

**Need only a disposition note:** all rows above. The two Linux non-escape oracles (7.4, 7.5)
attest the narrowed claim verbatim. F-L2-17 changes role from open counterexample to
justification. The `NARROWS` rows keep their retained halves.

**One item is neither:** Windows task 9.8 is unrun, so its wording should be re-scoped before
execution rather than re-taken after it. Flagged for that Change's owner.
