/**
 * Retain — the internal retention runner (`retain-command`, skill dir
 * `rasen-retain`). A shallow lazy-loading router: its body resolves the single
 * active retention mode and then loads ONLY the matching sidecar (`report.md`
 * or `codify.md`); `off` loads neither. The substantive contracts live in the
 * sidecars so progressive disclosure never pulls both long branches into
 * context (design D1). Installed through workflow dependency closure wherever
 * shipping or another workflow needs the canonical runner, even when retention
 * is `off`.
 */
import type { SkillTemplate } from '../types.js';
import { STORE_SELECTION_GUIDANCE } from './store-selection.js';

const RETAIN_INSTRUCTIONS = `Policy-driven retention runner. Resolve exactly one retention mode, then load ONLY the matching branch. report and codify are mutually exclusive — never run both.

${STORE_SELECTION_GUIDANCE}

## 1. Prepare the run: resolve the mode, freeze identity for codify

- Run \`rasen retain prepare <change> --json\` before creating any candidate (thread the same \`--store\`/\`--project\` selector used for the change). This is the ONE Rasen-owned operation that reports the effective retention mode, freezes or reuses this change's durable knowledge identity, and returns the absolute \`runStateDir\`. It works for a change that never ran through a classified pipeline and therefore has no run-state at all.
- Pass the returned \`runStateDir\` as \`--run-state-dir "<runStateDir>"\` on every project/store knowledge command so the CLI loads and revalidates BOTH frozen identities. A \`--project\`/\`--store\` supplied there remains only a consistency check; a conflicting selector is an error and the CLI never falls back to the new cwd.
- \`prepare\` keeps its two selectors separate: \`--store\`/\`--project\` pick the PLANNING ROOT (the same selector the change itself uses), and \`--owner-store\`/\`--owner-project\` pick the KNOWLEDGE OWNER independently. Pass an owner selector only when zero-selector resolution requests one; an owner selector that disagrees with an already-recorded identity is refused, never applied.
- \`contextSource: "recorded"\` means the change already carried a \`knowledgeContext\`: it is authoritative at ANY version, was left exactly as written, and was NOT upgraded in place. \`contextSource: "prepared"\` means preparation froze it now. Either way the reported identity is the one to use — never hand-write run-state, never synthesize an owner, and never derive one from the cwd, a directory basename, candidate evidence, or model output.
- \`contextSource: "skipped"\` means neither the effective mode nor a mode frozen in run-state is \`codify\`, so preparation resolved and wrote NOTHING — no \`knowledgeContext\`, no run-state file, no change to any learning state. That is the expected outcome under \`off\` and \`report\`, which never read a frozen identity; it is not a failure and there is nothing to repair. The reported \`runStateDir\` is where durable state WOULD live, not a claim that it exists. Preparing again once the effective mode is \`codify\` freezes the identity then.
- If preparation fails, pause before candidate creation and report the condition it named (ambiguous, missing, renamed, or stale ownership; an owner selector conflicting with a recorded identity; an unreadable run-state). Direct store planning does not imply a member project.

## 2. Use the frozen mode or the reported standalone mode

- When dispatched for any pipeline stage whose canonical ID is \`retain\`, use the retention mode the LEAD froze in run-state before dispatch (\`rasen pipeline resume <change> --json\`, or the \`frozenRetention\` field \`rasen retain prepare\` reports). The LEAD is the sole writer of the \`retention\` field; this worker never records or changes it.
- On resume, always reuse that recorded mode. Never re-read the current profile for a canonical \`retain\` stage; a profile edit mid-run SHALL NOT switch the branch.
- Only for a standalone invocation outside a canonical \`retain\` stage, use the \`retention\` value \`rasen retain prepare\` reported. That is the EFFECTIVE mode — the same resolution that decides whether a project-scoped lesson may be applied — so it answers even when no \`retention\` key was ever stored. It is exactly one of \`off\`, \`report\`, or \`codify\`.

## 3. Dispatch

- **off** → Complete immediately as a successful no-op. Do NOT load \`report.md\` or \`codify.md\`, write a retrospective report, or change any learned-skill state.
- **report** → Read and follow this skill's \`report.md\` sidecar. Do NOT read \`codify.md\`, and do NOT create, update, promote, or retire a learned skill.
- **codify** → Read and follow this skill's \`codify.md\` sidecar. Do NOT read \`report.md\`. codify v1 requires a specific change; if none can be resolved, fail with an actionable error.

Archive runs after retention completes; archive itself never reports or codifies.`;

export function getRetainCommandSkillTemplate(): SkillTemplate {
  return {
    name: 'rasen-retain',
    description:
      'Policy-driven retention runner: routes to report (retrospective) or codify (managed learned skills), or no-ops when retention is off.',
    instructions: RETAIN_INSTRUCTIONS,
    license: 'MIT',
    compatibility: 'Requires rasen CLI.',
    metadata: { author: 'rasen', version: '1.2' },
  };
}
