/**
 * Retain — the internal retention runner (`retain-command`, skill dir
 * `rasen-retain`). A shallow lazy-loading router: its body resolves the single
 * active retention mode and then loads ONLY the matching sidecar (`report.md`
 * or `codify.md`); `off` loads neither. The substantive contracts live in the
 * sidecars so progressive disclosure never pulls both long branches into
 * context (design D1). Installed by `auto-command`'s workflow dependency
 * closure, so it is available whenever the full-feature pipeline is, even when
 * retention is `off`.
 */
import type { SkillTemplate } from '../types.js';
import { STORE_SELECTION_GUIDANCE } from './store-selection.js';

const RETAIN_INSTRUCTIONS = `Policy-driven retention runner. Resolve exactly one retention mode, then load ONLY the matching branch. report and codify are mutually exclusive — never run both.

${STORE_SELECTION_GUIDANCE}

## 1. Resolve the mode

- If the full-feature pipeline recorded a retention mode in run-state on first entry to this stage, use that recorded mode (\`rasen pipeline resume <change> --json\`). A profile edit mid-run SHALL NOT switch the branch.
- Otherwise read the effective profile retention (\`rasen config get retention\`, or the effective config). It is exactly one of \`off\`, \`report\`, or \`codify\`.

## 2. Dispatch

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
