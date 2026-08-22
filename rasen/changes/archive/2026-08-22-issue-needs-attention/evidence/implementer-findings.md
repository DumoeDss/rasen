# Implementer findings — issue-needs-attention (2026-08-22)

Durable findings for the reviewer, the shipper, and Phase 6.

## 1. The seeded children read finalized on the LEGACY basis, not v2 outcome records — an honest divergence from a planning-context aside

The g-003 planner's parenthetical ("与 Issue #3 不同：它们的 v2 outcome 记录
存在，天然读 finalized，不走 legacy 裁决路径") does not match the shipped
bytes: BOTH g-001's and g-002's repo-side `archive.json` are v1-shaped (no
`schemaVersion`, no `outcome`) — verified by reading both files before
seeding. Seeding therefore follows the design's operative instruction (the
Issue #3 close pattern: archived directory + derived v2 IDENTITY block), and
the nodes read `finalized` through g-001's archived-legacy =
complete-for-scheduling ruling, with the legacy-basis diagnostic named on the
node line (receipt-4). No v2 outcome record was forged — the four-outcome
model's no-inference stance and the content-addressed archive discipline both
forbid it. The design's outcome ("nodes read finalized under the g-001 basis
threading") holds exactly as written; only the aside's premise was off.

## 2. A `#` inside a plain YAML scalar starts a comment — twice in one dogfood

"Issue #4" inside an unquoted YAML scalar truncates the scalar at ` #4` and
the NEXT line fails with a misleading "All mapping items must start at the
same column". Hit once in the decomposition document, once in the acceptance
conditions. Both fixed by rewording (no ` #` inside plain scalars); quoted
scalars would also work. Future dogfood/plan/acceptance YAML authoring should
avoid `#` in unquoted values entirely.

## 3. `showIssue` does NOT throw for an unknown id — membership is the only honest unknown-id test

`StoreAggregateQuery.showIssue` fabricates an empty detail (record null,
diagnostic null, no revisions) for a missing Issue, so an unknown-`--issue`
refusal cannot hang off showIssue's error path. The attention verb detects
unknown ids by membership in the `listIssues` page (which includes
uncommitted local Issues — `collectIssues` reads local copies too), refusing
with `issue_attention_unknown_issue`. Any future per-Issue verb that must
"distinguish unknown from empty" needs the same membership test.

## 4. The per-change run-state vocabulary has no `failed` observation — only portfolio records do

`observeAutoRun` maps escalated stages to `waiting-human`, never `failed`;
the ONLY projection path to a `failed` observation is a portfolio record
(`portfolio-run.json`) with an escalated child or delivery. Consequence:
every future test (or operator expectation) that wants a FAILED node must
seed a portfolio record for the node's alias — a per-change `auto-run.json`
cannot produce one. The unmasking fixture in
`test/commands/store-attention-cli.test.ts` is the template.

## 5. Design D1's one-arg sketch vs the item contract

The design sketched `deriveIssueAttention(status: IssueStatus)` while the
item contract requires every item to carry its Issue's identifier; the
shipped signature is `deriveIssueAttention(issueId: string, status:
IssueStatus)` — the derivation stays pure and consumes the projection output
alone for every fact; the id is an argument, not a second basis. Cosmetic
deviation, argued here so the reviewer sees it was deliberate.

## 6. Phase 6 ledger (inherited, none blocking, none touched here)

- claimant-alias keying attribution (P4 handoff #3): still open; the
  attention scan did not touch the locator. The dogfood's finale visibility
  relies on the execution-root chain from the worktree cwd, which is the
  documented basis.
- pinned-confirmation anchor (P4 handoff #2): still parked, no consumer.
- foreign-repo workspace follow-ups (P4 handoff #4): unchanged.
- No caching in the scan (deliberate; a cached attention answer would be a
  second mutable truth). If fleet scale ever demands it, that is a new
  capability with its own invalidation truth.
