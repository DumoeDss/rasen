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

## 1. Freeze or reuse knowledge identity

- Read the resolved run-state location from \`rasen pipeline resume <change> --json\` (thread the same planning \`--store\`/\`--project\` selector used for the change).
- If run-state already carries a \`knowledgeContext\` of ANY version, treat its recorded \`planningRoot\` and \`owner\` as authoritative and leave the record exactly as written — it is the authority for a run already in flight, so never rewrite or upgrade it in place. Pass the absolute \`runStateDir\` returned by pipeline resume as \`--run-state-dir "<runStateDir>"\` on every project/store knowledge command so the CLI loads and revalidates BOTH frozen identities. A newly supplied \`--project\`/\`--store\` remains only a consistency check; a conflicting selector is an error and the CLI never falls back to the new cwd.
- If the field is absent, resolve once before creating any candidate with \`rasen knowledge list --scope project --run-state-dir "<runStateDir>" --json\` (plus an explicit knowledge-owner selector only when zero-selector resolution requests one). Copy ONLY the returned identities into run-state as \`knowledgeContext: { version: 3, planningRoot: <durable ref>, owner: <durable ref> }\`, where a durable ref is \`{type:'store', uid, id?}\` or \`{type:'project', projectId, id?}\` — the permanent identity is the authority and the display name is carried for readability only, so a rename cannot retarget the run and two stores sharing a name stay distinct. Record \`execution\` alongside them when the session has an execution binding, and omit it when it does not. Never persist absolute roots. If a store has no permanent identity yet, the CLI records the older name-keyed shape instead; that record resolves fail-closed on resume (an ambiguous or unknown name stops the run), so run \`rasen store upgrade-identity <store>\` to move it onto a durable identity. Preserve the independently frozen \`retention\` field byte-for-byte. After persisting it, every later project/store knowledge command uses the same \`--run-state-dir\`.
- If identity is ambiguous or stale, pause before candidate creation. Direct store planning does not imply a member project.

## 2. Use the frozen mode or resolve a standalone mode

- When dispatched for any pipeline stage whose canonical ID is \`retain\`, use the retention mode the LEAD froze in run-state before dispatch (\`rasen pipeline resume <change> --json\`). The LEAD is the sole writer of the \`retention\` field; this worker never records or changes it.
- On resume, always reuse that recorded mode. Never re-read the current profile for a canonical \`retain\` stage; a profile edit mid-run SHALL NOT switch the branch.
- Only for a standalone invocation outside a canonical \`retain\` stage, read the effective profile retention (\`rasen config get retention\`, or the effective config). It is exactly one of \`off\`, \`report\`, or \`codify\`.

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
    metadata: { author: 'rasen', version: '1.0' },
  };
}
