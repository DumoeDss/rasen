/**
 * Change-context capture guidance appended to the prototype expert skill
 * at the getter layer (same mechanism as STORE_SELECTION_GUIDANCE).
 * Keeps the generated SKILL.md source untouched while reconciling the
 * skill's standalone capture locations with the OPSX change-directory flow.
 */
export const CHANGE_CONTEXT_CAPTURE_GUIDANCE = `**OPSX change-context adaptation:** When you are invoked while a Rasen change is active (e.g. consulted from \`/opsx:explore\`), capture your durable output — the verdict and the decisions it settles — in that change's directory: the change's \`design.md\` Decisions section or a change-directory sidecar. Resolve the absolute change directory from \`rasen status --change <name> --json\` (the \`changeRoot\` field). In this mode do NOT capture into repo-root artifacts such as an ADR or a \`NOTES.md\` beside the prototype code — the capture locations described earlier in this skill apply only to standalone (non-Rasen) use.`;
