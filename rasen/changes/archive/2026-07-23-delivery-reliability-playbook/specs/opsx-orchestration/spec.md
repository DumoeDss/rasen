## ADDED Requirements

### Requirement: Message batching to a live worker
When the LEAD has several consecutive instructions for the same live (not parked) worker and does not need an intermediate result between them, the playbook SHALL direct the LEAD to combine them into a single `SendMessage` rather than sending them as separate messages — each `SendMessage` delivery rebases the worker's conversation and re-taxes its cache, so sending N instructions separately pays that cost N times for no benefit over paying it once.

#### Scenario: Two instructions with no intermediate result needed are batched
- **WHEN** the LEAD has two follow-up instructions ready for the same worker at the same time, and does not need the worker's response to the first before issuing the second
- **THEN** the LEAD SHALL send them as a single `SendMessage`, not two separate messages

#### Scenario: An instruction that depends on an intermediate result is not batched
- **WHEN** the LEAD's second instruction depends on the worker's response to the first
- **THEN** the LEAD SHALL send them as separate messages in sequence, since batching does not apply when an intermediate result is actually needed
