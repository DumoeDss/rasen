/**
 * Direction workflow template.
 *
 * Direction is an opt-in, Git-native governance layer above Change. The
 * artifact model described here is intentionally experimental; the prompt is
 * the behavior and no first-class Direction CLI or stable manifest parser is
 * implied.
 */
import type { SkillTemplate } from '../types.js';
import { STORE_SELECTION_GUIDANCE } from './store-selection.js';

export function getDirectionSkillTemplate(): SkillTemplate {
  return {
    name: 'rasen-direction',
    description: 'Govern an optional long-lived workstream above Change: establish or calibrate direction, select one Roadmap slice, project it into Changes, and reconcile evidence.',
    instructions: `Govern durable product direction above individual Changes. Direction is opt-in: use it only when the user explicitly invokes it or accepts an explicit suggestion for work spanning multiple Changes, versions, horizons, projects, or recurring principle-level decisions.

**Absence is healthy.** A project with no \`rasen/work/\`, North Star, Target State, Roadmap, manifest, or Direction skill is valid. Never block, warn repeatedly, or modify an ordinary bug, feature, \`rasen-propose\`, \`rasen-auto\`, \`rasen-goal\`, apply, verify, ship, sync, or archive flow merely because Direction is absent. If the current request is ordinary Change work, leave it in that flow.

Direction maintains planning artifacts; it does not implement application code, execute Change tasks, or become a pipeline stage.

${STORE_SELECTION_GUIDANCE}

## Inputs and action routing

Accept an optional workstream id and exactly one action:

- **Establish** — create a reviewable draft for a genuinely long-lived workstream.
- **Calibrate** — align an existing authority chain and capability baseline with observable reality.
- **Select** — choose and confirm one evidence-bearing vertical Slice.
- **Project** — hand the confirmed active Slice to \`rasen-propose\` or an \`auto-decompose\` portfolio.
- **Reconcile** — return observed delivery and dogfood evidence to Result, Roadmap, and workstream state.

Infer the action only when the user's wording is unambiguous. Otherwise ask one short action question before writing. Never interpret a general implementation request as Establish.

## Common preflight

Perform this preflight before every action.

1. **Resolve the selected planning root through Rasen.**
   - Honor any explicit Store/project selection and keep the same \`--store <id>\` or \`--project <id>\` flag on every relevant Rasen planning command.
   - Run \`rasen context --json\` with that selection and use \`root.path\`; do not assume the shell's current directory is the planning root.
   - Run \`rasen list --json\`. If a relevant Change exists, run \`rasen status --change "<name>" --json\` with the same selection and prefer its \`planningHome.root\` and \`planningHome.changesDir\`.
   - Derive the experimental work area as the \`work\` sibling of the CLI-resolved changes directory. When no Change exists to expose \`planningHome.changesDir\`, inspect the resolved root with platform-native path APIs: a repo-local \`rasen/changes\` uses sibling \`rasen/work\`; a standalone planning root's \`changes\` uses sibling \`work\`. Do not invent a directory outside the selected root.
2. **Use safe, native paths.**
   - Construct and compare paths with the host's platform-native path utilities, never by concatenating \`/\` or assuming POSIX separators.
   - Workstream and Slice ids must be portable slugs.
   - Resolve each manifest reference relative to the file containing it, canonicalize existing paths when possible, and verify the resolved path remains inside the selected planning root.
   - Stop with a repair instruction on a missing, malformed, absolute-outside-root, traversal, or ambiguous reference. Never guess or follow it.
3. **Discover before mutating.**
   - Inspect manifests under the resolved work area and legacy workstream directories without manifests.
   - Match durable scope as well as id so Establish cannot create a semantic duplicate.
   - Read only the chosen workstream's authority chain, current Slice, Result/Log, associated Change artifacts, and evidence sources needed by the selected action. Keep bulky raw research outside committed Direction artifacts.
4. **Protect higher authority.**
   - If a North Star is present, read its bytes before any mutation. Treat it as read-only unless the user separately approves a displayed North Star revision. After the action, verify it remains byte-for-byte unchanged when no such approval exists.
   - Surface conflicts where a lower layer contradicts a higher layer; do not silently reinterpret the higher layer.

For Calibrate, Select, Project, or Reconcile, a missing work area or matching workstream is a successful no-mutation result: report that Direction is not established and close with exactly one next action, **Establish this workstream with \`rasen-direction\`**. Do not touch Change state.

## Experimental artifact contract

New workstreams use this Git-native layout:

\`\`\`text
<resolved-work-area>/<work-id>/
  work.yaml
  north-star.md             # optional
  target-state.md
  roadmap.md
  slices/<slice-id>/
    spec.md
    plan.md
    result.md
    log.md                   # optional
\`\`\`

This is an experimental convention, not a stable public schema, database, event store, daemon state, dashboard model, or first-class \`rasen direction\` CLI.

\`work.yaml\` is only a discovery and lifecycle index. It records:

\`\`\`yaml
version: 1
id: <portable-work-id>
status: draft | active | paused | completed | superseded
authority:
  northStar: north-star.md   # optional
targetState: target-state.md
roadmap: roadmap.md
activeSlice: slices/<slice-id>  # optional; zero or one
lastReconciled:                 # optional
  at: <observable timestamp>
  revision: <observed git revision>
\`\`\`

Omit optional fields rather than inventing values. The manifest must not copy Roadmap prose, specifications, implementation tasks, Change status, Run/Session state, or evidence.

The authority order is:

\`\`\`text
North Star (optional)
  > Target State
    > Roadmap
      > Selected Slice spec.md
        > Slice plan.md
          > Change planning artifacts
\`\`\`

The layers have different jobs:

- **North Star** — optional long-term outcome, invariant principles, non-goals, remembered failure modes, maturity horizons, health measures, and open long-term choices.
- **Target State** — the product or domain state this cross-Change workstream must make true.
- **Roadmap** — current evidence-adjustable candidate order, not a dated backlog or append-only history.
- **Slice Spec** — one independently acceptable user-visible outcome and its observable acceptance.
- **Slice Plan** — Change/portfolio boundaries, dependencies, parallelism, dogfood path, and evidence to return.
- **Result/Log/Git** — factual history, attempts, evidence, and revisions.

New Direction work always writes \`target-state.md\`. It is not \`rasen-goal\`: the latter is a bounded measure/evaluate/research iteration loop whose artifacts are \`goal-plan.md\` and \`goal-run.json\`. Never create those goal-loop artifacts for Direction.

For compatibility, if a legacy workstream has \`goal.md\` but no \`target-state.md\`, read it and label it **legacy Target State input**. Calibrate, Select, Project, and Reconcile must not rename, overwrite, delete, or migrate \`goal.md\`. Only an explicit migration approval may create \`target-state.md\` from it, and even then preserve \`goal.md\` unless the user separately authorizes removal.

Direction planning is not current execution truth:

- accepted current product behavior comes from main specs and implementation;
- Change delivery comes from Change artifacts and Git;
- active execution comes from current Run/Session state;
- PR/release state comes from its authoritative provider;
- Slice acceptance comes from the observable evidence stated in its spec.

A Roadmap checkbox, manifest status, file/module count, branch name, or document's existence is not proof that a capability works. Future North Star or Roadmap claims remain future direction until current truth supports them.

## Establish

1. Search all discoverable workstreams for the same durable scope. If one exists, present it and offer **Calibrate that workstream** as the single next action; do not create a duplicate.
2. Inspect current main specs, active/archived Changes, implementation, Git, and available failure/dogfood evidence. Separate observed baseline from hypotheses.
3. Draft:
   - a thin \`work.yaml\` with \`version: 1\`, \`status: draft\`, no \`activeSlice\` until confirmed, and relative safe references;
   - \`target-state.md\` with outcome, current observed baseline, success/health evidence, boundaries, locked decisions, and open choices;
   - a concise \`roadmap.md\` with Now/Later/Not Now candidates and why evidence may reorder them;
   - the proposed first Slice's \`spec.md\`, \`plan.md\`, and an honest initial \`result.md\` that contains no fabricated evidence.
4. Default to **no separate North Star**. Create or inherit one only when durable invariants genuinely need authority above Target State and the user explicitly confirms that decision.
5. Before activation, show the Target State, optional North Star decision, first Slice, exclusions, and exact observable evidence that closes it. Keep \`status: draft\` and do not set \`activeSlice\` until the user confirms. After confirmation, set \`status: active\` and the one active Slice reference.
6. Stop at Direction artifacts. Do not create application code, create a Change, or start a Change pipeline.

## Calibrate

1. Load the authority chain, active Slice if any, last reconciliation baseline, main specs, associated Changes, current implementation/Git revision, resolvable Run/PR/release state, and available dogfood evidence.
2. Build an observed capability baseline. Flag stale branches, Changes, PRs, revisions, paths, checkboxes, status claims, and missing evidence.
3. Correct factual baseline and stale references in Target State/Roadmap when they do not change the intended outcome or scope. Preserve historical attempts in Result/Log/Git.
4. Treat a change to Target State outcome, scope, success criteria, or locked decisions as material: present a concrete proposed revision and wait for human confirmation before applying it.
5. Never treat Roadmap prose or document/module existence as acceptance evidence, and never edit the North Star as part of ordinary calibration.

## Select

1. Require a calibrated authority chain. Compare Roadmap candidates by user value, uncertainty reduced, dependencies, and observable exit evidence.
2. Prefer one vertical Slice that proves value while raising only the complexity dimensions necessary for that proof. Record deferred complexity as Later or Not Now.
3. Draft or update \`slices/<slice-id>/spec.md\` with:
   - user-visible outcome and why validate it now;
   - observable acceptance and evidence source;
   - explicit exclusions;
   - alignment with Target State and any North Star;
   - supported terminal outcome vocabulary: \`passed | partial | failed | superseded | cancelled\`.
4. Draft \`plan.md\` with target project(s), one-Change versus portfolio boundary, dependencies, safe parallelism, dogfood path, evidence to return, and Direction source references. Multiple Changes remain inside this one Slice acceptance contract.
5. Show the candidate and acceptance contract. Change \`activeSlice\` only after user confirmation, and ensure there is at most one active Slice.

## Project

1. Require a confirmed \`activeSlice\` whose spec and plan resolve safely. If absent or contradictory, make no Change mutation and recommend **Select one Slice with \`rasen-direction\`**.
2. Pass only the selected Slice's objective, boundary, observable acceptance, target project context, and source references to the existing Change lifecycle:
   - independently deliverable as one Change → \`rasen-propose\`;
   - legitimately multiple independently deliverable Changes → \`auto-decompose\`.
3. Add a lightweight Direction source reference to downstream Change planning context: workstream id/path, Slice id/path, and the relevant Target State/Roadmap revision. Leave technical design and tasks to the Change artifacts.
4. Never send the whole Roadmap to \`auto-decompose\` to choose product direction. Never implement code or execute downstream tasks from Direction.
5. If the user asked only for projection preparation, report the chosen downstream workflow as the one next action. If they explicitly asked to continue into it, hand off to that workflow and let its own confirmations and lifecycle govern.

## Reconcile

1. Read the active or named Slice, its immutable historical Result/Log, and observable Change, Run, Git, PR, release, and dogfood evidence. Verify references rather than trusting copied status text.
2. Classify the current outcome only as evidence supports:
   - \`passed\` — all observable Slice acceptance is satisfied;
   - \`partial\` — useful delivery exists but acceptance remains unresolved;
   - \`failed\` — observed evidence disproves acceptance;
   - \`superseded\` — another accepted direction replaced this Slice;
   - \`cancelled\` — an explicit decision ended it without acceptance.
3. Completion of every projected Change is insufficient by itself for \`passed\`. Record \`partial\` or \`failed\` when observable acceptance or dogfood evidence is missing or negative.
4. Append factual evidence and attempts to Result/Log; do not rewrite failure history as current intent. Update Roadmap current position/candidate order, \`activeSlice\`, workstream status, and \`lastReconciled.at\`/\`revision\` from observed facts.
5. Detect and report missing or stale Changes, branches, PRs, artifacts, or revisions; an active Slice whose Result is terminal; checkbox/status contradictions; and an active workstream with no credible next Slice. Repair only when evidence makes the projection unambiguous; otherwise request one decision.
6. A workstream cannot remain vaguely active with no path:
   - \`completed\` only when Target State is satisfied;
   - \`paused\` when an external condition or decision is required;
   - \`superseded\` when another workstream replaced it;
   - if Target State is unsatisfied and no credible path exists, request replanning rather than claiming completion.
7. A material Target State change is a proposal pending confirmation. A North Star change is always a separately displayed proposal pending explicit approval; keep the current North Star byte-for-byte unchanged until then.

## Final report

After every action, persist every locked decision or result in Git artifacts rather than chat alone. Report:

- selected planning root and workstream id/path;
- resolved authority chain, including optional North Star and Target State or labeled legacy input;
- current Roadmap and sole active Slice;
- files created or changed;
- authoritative evidence consulted and current Result status;
- decisions applied, decisions awaiting approval, and conflicts/stale references;
- **exactly one recommended next action**.

Do not end with an unranked menu. The next action must be specific enough that a fresh agent with only the planning root and workstream id can continue from the durable artifacts.`,
    license: 'MIT',
    compatibility: 'Requires rasen CLI.',
    metadata: { author: 'rasen', version: '1.0' },
  };
}
