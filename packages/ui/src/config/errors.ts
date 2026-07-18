/**
 * Error-code → surface mapping (design.md D6): field-level for value/scope
 * errors, page-level for project-resolution errors, full-screen for auth.
 * Unknown codes fall back to a field-level surface showing the raw message.
 */
export type ErrorSurface = 'field' | 'page' | 'full-screen';

const PAGE_LEVEL_CODES = new Set(['project_required', 'project_not_found']);
const FULL_SCREEN_CODES = new Set(['unauthorized']);

export function errorSurface(code: string): ErrorSurface {
  if (FULL_SCREEN_CODES.has(code)) return 'full-screen';
  if (PAGE_LEVEL_CODES.has(code)) return 'page';
  return 'field';
}
