# Tasks — issue-needs-attention

## 1. The attention derivation (design D1/D2/D4)

- [x] 1.1 `deriveIssueAttention(status: IssueStatus)` in `src/core/issue-status/attention.ts`
      (+ types): the five kinds — failure / blocked-behind (one hop, direct blockers named
      with node id, project, observed state via the shared refinement vocabulary) /
      waiting-human / acceptance-awaiting (phase review, gate evaluation carried) / problem
      (every standing problem with kind, node, ref, reason); every item carries issueId,
      nodeId where one is named, and the Issue's phase+health; kind order and stable
      (issueId, nodeId) ordering.
- [x] 1.2 Unit tests per spec scenario: each kind's derivation, the exclusions (in-flight/
      advanced/terminal/ready/serial-wait contribute nothing), the exclusions' visibility
      contract inputs (scan roll facts), determinism over unchanged input.
- [x] 1.3 Blocked-behind boundary tests: direct blocker failed/waiting-human/unknown ⇒ item;
      direct blocker not-started or healthy in-flight ⇒ no item even when a grandparent is
      failed (the one-hop rule, each hop listed on its own).

## 2. The read verb (design D3)

- [x] 2.1 `rasen store attention [--store <id>] [--issue <issue-id>] [--json]` in
      `src/commands/store.ts`: per-Issue composition EXACTLY the CLI status composition
      `show` uses (same inputs, same projection — attention and show cannot disagree); scan
      summary (every Issue scanned: id, phase, health, item count) + grouped items; honest
      empty state ("N Issues scanned, none need attention"); `--issue` unknown id refuses.
- [x] 2.2 Human/`--json` parity test; counts-summarize-without-replacing test (every item
      listed in full in both forms).
- [x] 2.3 Write-nothing test (records/revisions/run-state/workspace index byte-identical);
      extend the issue-status read-only guard to the attention module and CLI path.
- [x] 2.4 Locale strings (en/ja/zh-cn) + completions sync (the discipline the `ready` verb
      established); localized-command structure check passes.

## 3. The unmasking receipt (design D2)

- [x] 3.1 Integration test: one Issue with two running siblings and one failed node beside
      another Issue parked waiting-human — assert the failure item leads, carries
      `active`+`failed`, and no summary presents the Issue as merely busy.
- [x] 3.2 Cross-issue ordering test: kinds in fail-first order, stable within group.

## 4. Issue #4 dogfood on the persistent store (design D5 — staged, receipted)

- [x] 4.1 Seed the shipped children's archived evidence into `issue-registry` store-side
      with properly derived v2 identities (the Issue #3 close pattern; g-001 ship `3f065496`,
      g-002 ship `c0ace35e`); store-side commits only.
- [x] 4.2 Author the decomposition document (three children, `line-0.2` targets, suggested
      pipeline, rationale) and publish Issue #4's plan via `--from-decomposition`; bind the
      seeded instances; run `confirm`; capture receipts (planning→ready scan).
- [x] 4.3 Receipt: children-terminal + finale-in-flight — `store attention` shows Issue #4
      scanned `active`/`healthy` with the shipped children finalized and the finale node
      honest (zero items unless a real signal stands — record which and why).
- [x] 4.4 Receipt: staged failure shape on a TEMP-store fixture twin (not the persistent
      store) — failed-among-running surfacing unmasked through the new verb.
- [x] 4.5 STAGE the close: author acceptance conditions against the real criteria
      (aggregation receipts captured, exit criteria evidenced, suites green), document the
      accept step; execute `accept` ONLY if genuinely terminal at the implementer's hands;
      capture the outcome either way. Close acts live in evidence, never in this list's
      checkboxes beyond "staged".

## 5. P5 exit-criteria receipts + close-out (design D6)

- [x] 5.1 Evidence set: replanning-preserves-history (cite g-002's shipped pins — do not
      recreate), failure-not-masked (task 3.1 + receipt 4.4), aggregation entry (receipts
      4.2–4.3) — one directory the portfolio close summary can read §8 from.
- [x] 5.2 Focused suites green (issue-status, store commands, completions, locale structure);
      full failure list from a captured log; binned full-suite run per the ≤25 files/box
      recipe.
- [x] 5.3 Architecture-index sync: new module `issue-status/attention.ts`, new store
      subcommand `attention` — quick-locate rows + `detail/modules/spec-store-engine.md` and
      `cli-commands.md` notes.
