# Implementer findings — issue-revision-history-preservation (2026-08-22)

Durable observations for g-003 (and any later consumer), in impact order.

## 1. An accepted record's gate snapshot freezes `waiting-human`, not `healthy`

At accept time every required node is terminal, so the projection reads
`review` + `waiting-human` — the human act awaited IS the acceptance. The
gate's design comment says exactly this, but the intuitive pin (`health:
'healthy'` beside "everything done") is wrong and the tree corrects it: both
the carry test and the CLI parity receipt freeze `gate: 2/2 waiting-human`.
**g-003's Issue #4 dogfood close will mint a record with `waiting-human` in
it** — pin that, and don't "fix" it to healthy in a later review round.

## 2. Prior-revision composition is assembled from the confirm seam, and it composes over TODAY's run-state

`projectIssueStatus` reads `detail.plan` (always the latest revision); there
is no `--revision` on the projection. To project revision N you assemble
`{ ...showIssueDetail, plan: await resolveExecutionPlan({ revisionId }) }` —
the same ordinal read `confirm --revision` resolves. Two consequences:

- The prior revision's node observations use CURRENT run-state — a
  prior-revision progress pair counts today's evidence, so "history" there is
  graph history (the revision's own nodes/edges), not observation history.
  My totality pin's final row initially assumed the pre-completion pair
  (1/2); the honest composition reads 2/2 after Y completed.
- If g-003's Needs-Attention surface ever wants an observation-history read
  ("what did it look like at revision N"), that is a NEW input the projection
  does not take — its own change, exactly the D5 stance on a first-class
  history read.

## 3. `store issue acceptance` is publish-only; the record's read surfaces are `accept` and `show`

The task text said "`store issue acceptance` ... presents the record" — it
cannot: the subcommand requires `--from-file` and never reads `accepted.yaml`.
The surfaces that present an accepted record are `accept`'s write result
(human + `--json`) and `show`'s acceptance block (human + `--json`, via
`status.acceptance.record`); both now render the carried exclusions
(`excluded <node> (<lifecycle>): <reason>`), verified through the real CLI in
`store-issue-acceptance-exclusions-cli.test.ts`. If a first-class acceptance
READ verb is wanted later, it is its own change.

## Machine note (not durable design, but it will bite again)

The CLI test helper builds dist once per process; a dist left stale by an
earlier process can make a passing-src test fail on old rendering. Run
`pnpm run build` manually before trusting a CLI-suite failure as a code
signal (this cost one false-red round on the parity test).
