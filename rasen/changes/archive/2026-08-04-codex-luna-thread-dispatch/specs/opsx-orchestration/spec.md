## ADDED Requirements

### Requirement: Codex dispatch applies the resolved model and effort to an isolated worker

The orchestration playbook SHALL read each stage's final `model`, `modelSource`, `effort`, and `effortSource` from the execution view and SHALL pass present values to the selected Codex dispatch mechanism without re-deriving configuration. A Codex-native worker that receives a model or effort override SHALL be created without a full-history fork so the requested agent type and reasoning effort can take effect; the worker prompt SHALL seed the concrete change artifacts it needs. A Codex process worker SHALL run through `rasen agent dispatch --runtime codex` and SHALL be recorded with dispatch mode `exec-bridge`.

#### Scenario: Native Luna Max worker uses no-history creation
- **WHEN** a Codex-hosted stage resolves model `gpt-5.6-luna` and effort `max` and uses native dispatch
- **THEN** the LEAD creates the worker with those resolved values and without a full-history fork
- **AND** the prompt names the change artifacts that seed the isolated worker

#### Scenario: Native Terra worker uses the same configurable path
- **WHEN** a Codex-hosted stage resolves model `gpt-5.6-terra` and a supported effort and uses native dispatch
- **THEN** the LEAD forwards that exact model/effort pair with no model-family special case and without a full-history fork

#### Scenario: Arbitrary model override is forwarded unchanged
- **WHEN** a Codex-native or Codex process stage resolves an unknown non-empty model id
- **THEN** the LEAD forwards that id unchanged through the selected route
- **AND** it does not attempt model discovery or substitute a known Luna or Terra model

#### Scenario: Native override is not claimed on an inheriting fork
- **WHEN** a Codex-native worker requires a model or effort different from the parent
- **THEN** the playbook SHALL not use a full-history fork that inherits the parent's agent type, model, and effort

#### Scenario: Codex process route uses the shipped bridge
- **WHEN** the route matrix selects a Codex exec-bridge stage, or a caller explicitly requests a process-durable Codex thread
- **THEN** the LEAD invokes `rasen agent dispatch --runtime codex` with the resolved model and effort when present
- **AND** it accepts completion only from an `ok: true` structured receipt

#### Scenario: Existing same-host default remains native
- **WHEN** a Codex-hosted stage has no explicit process-thread request and the route matrix selects the ordinary same-host route
- **THEN** it remains a Codex-native dispatch and no new pipeline dispatch-mode field is required

### Requirement: Codex thread continuation is exact, structured, and batched

The orchestration playbook SHALL record a Codex bridge receipt's exact thread id, transcript when available, sandbox, model, and effort in the worker record. Every warm continuation SHALL call the same bridge with that exact thread id and the appropriate `leaf` or `evaluate` contract. When multiple consecutive instructions are ready and no intermediate result is needed, the LEAD SHALL combine them into one meaningful continuation so process startup and model context cost are not paid for microtasks. Separate independent threads SHALL remain dispatchable concurrently; one thread SHALL have one active writer.

#### Scenario: Later process resumes the exact worker thread
- **WHEN** a LEAD session restarts after recording a Codex bridge worker
- **THEN** the successor resumes the recorded thread id through `rasen agent dispatch --runtime codex --resume <threadId>`
- **AND** it does not use a native agent id, spawn label, or latest-thread lookup

#### Scenario: Completion-shaped continuation keeps its contract
- **WHEN** the LEAD asks a warm Codex thread to finish remaining tasks or evaluate a gate
- **THEN** it selects the corresponding shared structured contract and accepts only the validated receipt result

#### Scenario: Consecutive instructions are batched
- **WHEN** several instructions target the same warm thread and none depends on an intermediate answer
- **THEN** the LEAD combines them into one continuation rather than starting one process turn per microtask

#### Scenario: Parallel workers use independent thread ids
- **WHEN** independent Codex process stages run concurrently
- **THEN** each receipt records a distinct thread id and no thread receives concurrent continuations
