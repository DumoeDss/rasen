/**
 * Client-side pipeline-name grammar check (pipeline-canvas-edit design D6):
 * a lightweight, non-authoritative convenience so the name-first dialogs
 * ("Assemble in canvas", "Duplicate to edit") catch an obviously malformed
 * name before a round-trip — the server (`pipeline save`'s own identifier
 * check) remains the authority.
 */
const PIPELINE_NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

/** Returns an error message for an invalid name, or `null` when it passes. */
export function validatePipelineName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return 'Name is required.';
  if (!PIPELINE_NAME_PATTERN.test(trimmed)) {
    return 'Use lowercase letters, digits, and hyphens, starting with a letter.';
  }
  return null;
}
