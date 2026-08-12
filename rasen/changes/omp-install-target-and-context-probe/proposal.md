## Why

Rasen is unusable-as-designed inside the Oh My Pi (`omp`) harness in two ways that share one cause: `omp` is a recognized host that Rasen has no install entry and no context reader for.

1. **`rasen init` never offers it.** The install surface is the adapted-tool filter, and `omp` has no registry entry, so the interactive picker offers only `claude, codex, hermes`, `--tools all` skips it, and `--tools omp` fails as an unknown token. Today an `omp` user gets Rasen skills only as a side effect of installing Claude Code — a project that wants `omp` alone gets nothing, and the skills land in the lower-precedence location.

2. **`rasen agent context --latest` refuses.** `detect-omp-host-runtime` correctly replaced a silent wrong answer (a week-old Claude transcript reported as the live session) with an honest `unsupported-host` refusal. But that refusal turns off the entire context-sensing half of the orchestration inside `omp`: the handoff protocol has no reading to act on, threshold bindings fall through to `default`, and keepalive beats are withheld. Correct, and unusable.

Both were deliberately deferred by `detect-omp-host-runtime`, whose stated reason for skipping the install entry was that `omp` already reads `.claude/skills` through its Claude discovery provider. That is true and remains true — it is why this is a capability gap rather than a defect. What has changed is that the deferral's cost is now known: `omp` is the harness this project's own maintenance runs in, and the two gaps make it a second-class host in its own repository.

Oh My Pi publishes both halves as first-class, verifiable surfaces: a project-local skills root that its highest-priority discovery provider owns, and a session journal that records per-message token usage. This change consumes exactly those two and nothing else. Token auditing and worker dispatch for `omp` stay out of scope and are proposed separately.

## What Changes

- Offer Oh My Pi as an adapted install target, so it appears in the interactive picker, is included by `--tools all`, and is accepted as `--tools omp`.
- Install Rasen's workflow skills for Oh My Pi into the project-local skills root its own highest-priority discovery provider reads, so an installed skill is discovered at the highest available precedence and is invocable as a skill command without any configuration step.
- Recognize an existing Oh My Pi setup only from real configuration content, so an empty tool directory left behind by an unrelated action does not report the tool as configured or nudge the user to add it.
- Disclose that adding a project-local Oh My Pi directory in a nested package takes over that harness's project-context and sticky-rule discovery for the enclosing tree, so a monorepo user learns this from Rasen rather than from missing instructions.
- Report the current session's context occupancy inside an Oh My Pi session, replacing the present unavailable-with-reason result, so handoff timing, threshold resolution, and every other occupancy consumer act on this session's own numbers.
- Locate the live Oh My Pi session for the current working directory across every session-bucket layout the harness has written, so the reading always describes the newest session for this directory rather than the newest one in a single guessed location.
- Accept Oh My Pi as an explicit `--runtime` selection and as an explicit `--transcript` target, and read an Oh My Pi session file by name instead of refusing it.
- Report an honest unknown context window, rather than a substituted default, when a session's model has no known window size — so a percentage is never computed against a number Rasen guessed.
- Keep the unsupported-host refusal itself intact for any harness Rasen still ships no context reader for.

## Capabilities

### New Capabilities

- `omp-integration`: Oh My Pi as an adapted install target — where its Rasen skills are written, how an existing setup is recognized, and what a project-local install implies for the harness's own context discovery.
- `omp-session-probe`: Reading an Oh My Pi session's context-window occupancy — locating the live session for a working directory, which recorded figures constitute occupancy, and how an unknown context window is reported.

### Modified Capabilities

- `adapted-agent-visibility`: The adapted-agent set gains Oh My Pi, so it is offered for installation and accepted when named explicitly instead of being refused as unadapted.
- `ai-tool-paths`: Oh My Pi paths are defined on the tool registry, and the adapted-designation requirement stops enumerating a set that no longer matches the shipped registry.
- `cli-init`: Non-interactive selection describes the adapted set as it actually ships, so `--tools all` and the refusal message name every adapted tool.
- `cli-agent-context`: The implicit-latest refusal narrows to harnesses that still have no context reader, and probing an Oh My Pi session — implicitly, by explicit runtime, or by explicit transcript — becomes a supported reading.
- `runtime-adapter-registry`: The shipped capability matrix reports Oh My Pi as context-probe capable, and the registry's session-locating contract is stated for a harness whose sessions live in more than one directory layout.

## Impact

- **Install surface.** Adds one registry entry and its detection metadata; every other install-path consumer derives from the registry and is unchanged. No skills-root generalization is required, because Oh My Pi keeps project-local skills like Claude Code and Codex rather than a global home like Hermes.
- **Context probe.** Adds a session locator and an occupancy reader for Oh My Pi, plus resolution of the harness's relocatable agent directory and named profiles. Claude and Codex probing, discovery, and reported fields are unchanged.
- **Derived consumers.** Threshold binding rows, the threshold-policy catalog, and the probe-runtime value lists gain `omp` from the registry with no new allow-list. The hand-maintained UI wire mirror must be widened before the server does, per this project's mirror-relaxation rule.
- **Documented behavior.** The published tool tables and CLI tool-id lists in both languages must gain Oh My Pi; all four are already stale against the shipped registry and are corrected in the same pass. Orchestration playbook copy that names Oh My Pi as un-probeable becomes wrong and moves the generated-skill parity hashes.
- **Preserved contracts.** No configuration key changes, no pipeline runtime value is added, no dispatch route changes, and keepalive gating is untouched — Oh My Pi remains withheld from beats by the existing fail-safe, because no dispatch capability becomes true.
- **Deliberately out of scope, proposed separately.** Token auditing for Oh My Pi, including the report shape, the audit-management registry, and the report viewer's runtime handling. Worker dispatch to Oh My Pi, including its bridge, the pipeline runtime enum, keepalive gating, and the orchestration playbook's third harness arm. Two follow-ups recorded by `runtime-adapter-interface-extraction` name those two changes as their owners and stay open here.
