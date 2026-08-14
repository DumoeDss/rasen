# Post-cap strategy review 1: executable turn-input authority

## Scope and finding

This strategy rework addresses only Round 3 Major M4. It does not implement product code or tests and does not reopen completed route-lifecycle work.

Round 3 correctly requires complete canonical equality between the request's Action receipt and the Action committed in the Record, then dispatches the Record-owned object. That closes caller mutation of Action fields. The shipped Management API nevertheless accepts a sibling `turnInput: string`; `dispatchGrantedAction` forwards that string as the actual turn to routed and unrouted backends. Since the string is neither derived nor checked against committed authority, a byte-identical receipt for work A can execute caller-selected work B.

## Semantic trace

| Value/seam | Real type and meaning | Authority today | Consumer/path |
|---|---|---|---|
| `RunAction.agent.input` | `JsonValue`; structured orchestration metadata such as change, review/goal-cycle phase, bounded-loop recovery/strategy state | Committed Action and receipt digest | Reconciler and lifecycle logic; not a complete general prompt |
| Effective role/model/effort/runtime/sandbox | Closed Action fields resolved from immutable profile policy | Committed Action | Backend and invocation selection |
| `workerContract` | `leaf | evaluate` | Committed Action for new work; routed historical omission fails closed | Claude/Codex structured output schema and deterministic contract framing |
| Capability/Adapter artifacts | IDs, versions, content digests, and host-frozen attestation authority | Frozen profile and Action | Completion trust and capability identity; no prompt-body lookup contract |
| Legacy driver prompt | UTF-8 file containing role, workflow template/skill body, artifact paths, task context, and handoff clause | Driver-owned prompt file | `rasen agent dispatch --prompt-file`; outside canonical frozen-action dispatch |
| Frozen-executor `turnInput` | Driver-rendered base-prompt string | Request only; unauthenticated | Hosted SessionHost, routed Claude/Codex child bridge, and abstract in-tool seam |
| Claude final prompt | Base prompt plus optional template/skill/handoff, leaf/evaluate contract text, and flat-hierarchy guard | Builder-owned deterministic suffixes; caller currently controls base | `buildClaudePrintInvocation` then runner |
| Codex final prompt | Base prompt plus optional template and flat-hierarchy guard; result schema is runner-owned | Builder-owned deterministic suffix; caller currently controls base | Codex invocation/runner |
| Reusable-session message | String or `JSON.stringify(action.agent.input)` | Derived from committed Action | Separate reusable-session API precedent; not sufficient for general workflow execution |

### Path matrix

| Backend | Routed | Actual input source before repair | Side effect boundary |
|---|---:|---|---|
| Hosted SessionHost | no | request `turnInput` | `host.dispatch({ op: 'execute' })` may create/resume a generation |
| Hosted Claude/Codex bridge | yes | request `turnInput` | Route Lease, binary resolution/spawn/stdin |
| In-tool launcher seam | no | request `turnInput` exposed to seam | launcher-owned execution |
| In-tool routed seam | yes | request `turnInput` | Route Lease then route-aware launcher execution |

The defect is therefore independent of OmniCross. Routing changes credential transport; it must not create or remove work authority.

## Alternatives evaluated

### A. Deterministically render from committed `agent.input` inside the executor

**Attraction:** removes request prompt authority and naturally repeats on resume.

**Rejection:** the committed value is structured control input, not a complete prompt language. Current Action examples can be as small as `{ change }` and reconciler inputs carry lifecycle metadata. Existing prompt-owned orchestration separately contributes role instructions, workflow template/skill text, artifact locations, task-specific context, and handoff clauses. `JSON.stringify(agent.input)` would authenticate the wrong, incomplete workload. A correct late renderer would require a new frozen render graph, resolvable content bodies, renderer versioning, and historical artifact-availability rules. The current capability digest identifies content but is not a contract for retrieving and assembling prompt bytes. This is not the smallest safe M4 repair.

### B1. Freeze the exact rendered prompt bytes in every Action

**Correctness:** complete. The executor could ignore request text and execute Record-owned bytes.

**Trade-off:** prompt bodies can approach existing MiB bounds. Embedding them in every Action duplicates them across canonical Record snapshots and request receipts, changes storage/body limits, and persists potentially sensitive task context where only a digest is needed. It is larger than the defect requires.

### B2. Freeze exact length plus digest and validate transported bytes

**Correctness:** complete under the existing bounded request transport. A collision-resistant, domain-separated digest authenticates the exact UTF-8 bytes while the length makes encoding/measurement explicit. It preserves the already rendered rich prompt without persisting its body. Exact retries can retransmit identical bytes. No blob store is required.

**Selected.**

### C. Commit a content-addressed prompt artifact and reference it from the Action

**Correctness:** complete and permits the executor to load rather than trust caller transport.

**Rejection for this change:** requires a new durable blob lifecycle, atomic admission/ref commitment, availability and corruption behavior, retention/GC, body encryption/privacy policy, and recovery semantics. It may be a later transport optimization, but it is not needed while bounded `turnInput` remains present.

### Routed-only validation

**Rejected.** It would leave the identical second-channel defect on unrouted hosted/in-tool dispatch and make authority disappear when `inference` is removed. Route presence cannot determine whether caller text is trusted.

## Chosen decision

Every newly admitted canonical agent Action binds the exact trusted driver-rendered base prompt:

```ts
type FrozenAgentTurnInput = {
  format: 'agent-turn-input/1';
  mediaType: 'text/plain;charset=utf-8';
  renderingContract: 'rasen.driver-rendered-turn/1';
  utf8ByteLength: number;
  contentDigest: Digest;
};
```

The trusted Adapter/driver performs its existing complete render before admission. The Action builder, not a request caller, computes length and a SHA-256 digest over a domain-separated byte stream containing `agent-turn-input/1` and the exact UTF-8 bytes. The Action schema carries the field as optional solely for historical decoding. Newly admitted Actions always include it.

The profile is not expanded. A prompt is occurrence- and Action-specific, while the profile already binds the capability/Adapter artifacts and policy used by the renderer. `agent.input` stays structured JSON for reconciler semantics. `workerContract` stays the only leaf/evaluate discriminator.

`turnInput` remains in the Management API request as transport compatibility, but becomes an assertion. After strict receipt decode and complete equality, the executor obtains the Record-owned Action and compares exact request length/digest to that Action's binding. Matching bytes proceed; mismatching bytes never reach a backend.

### Stable typed failures

Add a route-independent executor rejection result with non-retryable codes:

- `execution_input_authority_missing` — historical routed Action has no trustworthy binding;
- `execution_input_mismatch` — transported UTF-8 bytes do not equal the Record-owned binding;
- `execution_input_too_large` — matching authenticated bytes exceed the selected effective turn bound.

Do not encode these as OmniCross failures. No lease has been requested and the rule applies without routing.

## Required ordering

1. Bound/decode body and exact UTF-8 transport string; strictly decode receipt and workspace revision.
2. Load and decode the canonical head Record.
3. Validate complete receipt equality and switch to the Record-owned Action.
4. Validate new turn-input authority: exact UTF-8 length and domain-separated digest.
5. Enforce the effective shared `maxInputBytes`; preserve each runner's final assembled-stdin check as defense in depth.
6. Select backend and validate remaining worker/runtime authority.
7. Only then acquire Route Lease, create/resume SessionHost state, invoke a launcher, resolve/spawn a binary, or send stdin.

Admission also uses a canonical hard prompt bound. Dispatch policy may be stricter. Digest mismatch is classified before an effective-limit rejection so unauthenticated work never gets a policy-only path.

## Historical and migration behavior

| Artifact/path | Behavior |
|---|---|
| New canonical agent Action | Binding mandatory at admission and enforced on every backend |
| Historical routed Action without binding | Fail closed with `execution_input_authority_missing` before lease/process |
| Historical unrouted Action without binding | Preserve old request-rendered behavior; no invented authority |
| Legacy/autopilot `rasen agent dispatch --prompt-file` | Unchanged; outside the frozen-action executor |
| Old Action/Record bytes and digests | Unchanged because the new field is optional and absent |
| New Action receipt/digest | Naturally covers the binding through canonical Action authority |
| Re-render/backfill | Forbidden; do not load current Pipeline/skill text or stringify `agent.input` |

The exception for historical unrouted work is deliberate compatibility, not a mode available to new Actions. Re-admission is the migration if an operator needs authoritative execution for old unrouted work.

## Exact code seams expected to change

- `src/core/change-run/contracts.ts`
  - add the closed optional turn-input binding schema/type to agent Actions.
- `src/core/change-run/internal/actions.ts`
  - accept trusted rendered bytes at Action construction; enforce hard bound and compute, never accept, binding authority.
- `src/core/change-run/internal/runtime-context.ts`, reconciler/facade Action-admission callers, and the real trusted driver/Adapter rendering seam
  - ensure every new canonical agent Action is admitted only after the complete base prompt exists; retain structured `agent.input` independently.
- `src/core/frozen-action-executor/executor.ts`
  - validate Record-owned input authority before backend selection/lifecycle and add route-independent typed rejection results.
- `src/core/frozen-action-executor/production-executor.ts`
  - consume only authenticated input; ensure SessionHost and routed/in-tool bridges cannot bypass the check; retain final runner checks.
- `src/core/management-api/frozen-action-executor.ts`
  - retain request transport, surface stable executor rejection, and perform no independent prompt-authority policy.
- `src/core/frozen-action-executor/index.ts` plus Management API/wire mirrors if required
  - export/mirror the new result type without weakening closed contracts.
- `test/core/frozen-action-executor/`
  - authority, ordering, routed/unrouted, in-tool/hosted, historical, exact-resume, and byte-limit unit/integration coverage.
- `test/core/management-api/frozen-action-executor.test.ts`
  - real handler with byte-equal receipt and changed-only request.
- existing fake OmniCross/Claude/Codex integration fixtures used by this change
  - process/lease discrimination and exact delivered-prompt captures.
- architecture index detail files only if implementation introduces or renames a module/seam; ordinary field/result changes should update existing descriptions without expanding the top-level map.

No Claude/Codex result schema change is expected. No OmniCross wire-contract change is expected.

## Acceptance test matrix

| ID | Setup and sole mutation | Expected proof |
|---|---|---|
| AT-1 | New routed Claude leaf Action; matching request | Real Management API reaches fake daemon/Claude; fake receives authenticated base prompt; leaf result validates |
| AT-2 | AT-1 receipt and Record byte/canonically equal; mutate only request text | `execution_input_mismatch`; lease-create count 0; Claude spawn count 0 |
| AT-3 | New routed Codex evaluate Action; matching request | Real Management API reaches fake Codex; evaluate schema and full structured result preserved |
| AT-4 | AT-3 receipt/Record unchanged; mutate only newline normalization | mismatch before lease/process |
| AT-5 | Same but mutate one multibyte code point with equal JS string length | mismatch proves UTF-8 digest, not character count |
| AT-6 | New unrouted hosted Action; matching request | SessionHost gets exact authenticated input |
| AT-7 | AT-6 changed-only request | mismatch; SessionHost dispatch/create/resume count 0 |
| AT-8 | New in-tool Action; changed-only request | mismatch; launcher settle/execute count 0 |
| AT-9 | Historical routed Action lacks binding | authority-missing; lease/process count 0 |
| AT-10 | Historical unrouted Action lacks binding | prior caller-rendered behavior remains |
| AT-11 | Retry/resume exact same base bytes with replacement lease | accepted; session/thread identity preserved; new route token allowed |
| AT-12 | Binding matches but multibyte bytes exceed effective limit | too-large; no lease/session/process |
| AT-13 | Leaf and evaluate differ only in frozen worker contract | same input authority algorithm; each existing result schema remains discriminating |
| AT-14 | Mutate/remove each authority guard or relabel typed code | focused receipt turns RED, proving guards are not theater |

## Risks and mitigations

- **Prompt renderer ownership is currently split from Action admission.** Move only the admission boundary needed to supply already rendered bytes; do not invent a late renderer. Tests must prove the exact bytes seen by the fake runtime are those hashed at admission.
- **Digest-only authority depends on transport availability.** The request already transports bounded bytes. If that becomes undesirable, migrate deliberately to a content-addressed artifact; do not silently use current skill files.
- **Historical unrouted compatibility remains unauthenticated.** Scope it strictly to committed Actions lacking the optional field. Newly admitted omission is a construction error.
- **Different runtime builders append framing.** Authenticate the driver-rendered base prompt; bind framing semantics through committed runtime/worker contract and shipped builder code. Final assembled-stdin limits remain in the runners.
- **Request JSON size and UTF-8 turn size are separate bounds.** Preserve both and test multibyte cases. Body rejection may happen earlier, but executor tests must independently prove the turn bound.
- **Persisted digest may reveal equality, not content.** This is already normal content-addressed authority. Do not persist the rendered prompt body or secrets as part of this repair.

## Rejected hypotheses

- Complete Action equality implicitly covers `turnInput`: false; the sibling string is not an Action field.
- `agent.input` is the prompt: false in the canonical reconciler; it is arbitrary structured JSON and is read by lifecycle code.
- The capability content digest is enough to reconstruct a prompt: false; it identifies an artifact but does not freeze Action-specific task context or define retrieval/rendering.
- The reusable-session serializer is a general renderer: false; it sends committed structured input but omits the legacy driver's richer workflow instructions.
- M4 is an OmniCross-only vulnerability: false; unrouted hosted and in-tool seams consume the same request string.

## Implementation brief

Implement tasks 7.1–7.8 in order. Freeze a domain-separated length/digest binding from the trusted, complete driver-rendered base prompt at Action admission; make request `turnInput` a checked transport assertion; enforce the check and shared byte policy route-independently before any execution side effect; retain a narrow old-unrouted compatibility branch; prove the result through the real Management API and fake Claude/Codex/SessionHost/launcher seams while holding the Action receipt constant.

## Strategy attempt 2 protocol

Attempt 1 correctly implemented the low-level binding and execution assertion but assumed the complete prompt existed before the existing mutating calls. It did not: the shipped LEAD first received an admitted Action and only then rendered the worker brief. Attempt 2 therefore adds one quiescent boundary rather than a late renderer or a second Action authority.

### State machine and exact commands

`start`, `resume-run`, `complete`, and `control` continue reconciling non-agent candidates, durable waits, and terminal transitions, but stop before every ready agent candidate. Their receipt carries `candidates`, a prompt-free array of frozen candidate descriptors, and carries no Action for those candidates. The Run Record contains no candidate and no prompt body; quiescence is reproduced by reconciling the immutable RuntimePlan against the current canonical Record.

The trusted source LEAD renders the same complete base prompt it historically rendered after grant, using the candidate descriptor plus its existing workflow-owned instructions and context. It writes a bounded private ephemera manifest with closed format `agent-turn-input-manifest/1`:

```json
{
  "format": "agent-turn-input-manifest/1",
  "candidates": [
    { "candidateId": "candidate:…", "prompt": "<exact base-prompt bytes as UTF-8 JSON text>" }
  ]
}
```

The explicit command `rasen pipeline admit <change> --run <runId> --turn-input-file <private-ephemera-path> --json` opens the current Record, reconciles the current frontier, requires the manifest to cover that complete agent preview exactly once with no extras, verifies every candidate identity, reads the bounded prompt strings, and atomically admits/grants that batch. Action construction alone computes `agent-turn-input/1`; the manifest cannot nominate a digest or byte length. The admission receipt returns canonical Actions and no prompt body. A fan-out frontier is one atomic manifest/admission batch so sibling identities do not invalidate one another.

### Candidate identity and descriptor

A preview descriptor is closed and contains only `format: change-run-agent-candidate/1`, `candidateId`, `runId`, `recordVersion`, `nodeId`, `occurrence`, optional `profilePath`, and optional structured `input`. `candidateId` is derived by the runtime from domain `change-run-agent-candidate/1` over the Run id, canonical head Record digest/version, and the complete prompt-free reconciler candidate descriptor. It is not a canonical Action, Record, receipt digest, or caller-authored identifier.

Because the current Record and frozen RuntimePlan are the only inputs, a crash followed by `resume-run` reproduces byte-identical candidate identities without reading current Pipeline, skill, model, or configuration text. Any completion, control transition, competing admission, or Record-version change makes an older manifest stale. Admission rejects missing, extra, duplicate, wrong-Run, wrong-version, or wrong-candidate entries before Action construction or Record mutation.

### Idempotency and stale behavior

Re-running preview against an unchanged head is read-equivalent and returns the same candidates. Re-running `admit` after its successful commit does not reinterpret the old manifest: the current frontier no longer equals it, so the call returns a typed `candidate_stale` refusal and does not mint another Action. If the admission commit loses a Record-version race, normal RunStore conflict handling leaves the winning head authoritative; the caller previews again. Exact Action retry/resume uses the already committed turn-input binding and requires identical transported bytes while permitting replacement route leases.

### Compatibility and migration

Non-agent `command` and `host` candidates retain their existing builder/admission/grant path and never require a prompt manifest. The accidental runtime-context rejection of those kinds is removed. Historical unrouted frozen Actions and legacy `rasen agent dispatch --prompt-file` remain unchanged; historical routed missing-authority behavior remains fail-closed. Existing callers of lifecycle mutation commands must now treat `candidates` as a render boundary and invoke `pipeline admit`; there is no post-admission binding, prompt-body persistence, `agent.input` serialization, caller-authored digest, mutable-template re-render, or route-only enforcement.
