/**
 * The localized surface for the Oh My Pi nested-install disclosure.
 *
 * Kept apart from the detection in `project-context.ts` so the detection stays
 * pure (filesystem in, paths out) and testable without a locale, mirroring how
 * `learned-materialization-locale.ts` sits beside its reconciler.
 *
 * `init` is the only caller, and deliberately: it is the only command that can
 * NEWLY populate a `.omp/` directory, and a capture that already happened is not
 * news. The rendering is factored out here anyway so a future update-side caller
 * cannot word the same disclosure differently.
 */
import { formatLocaleMessage, getLocaleCatalog } from '../../locales/index.js';
import { resolveCliLocale } from '../../utils/locale.js';
import type { OmpNestedInstallCapture } from './project-context.js';

/** One reportable line, with the tone the caller should render it in. */
export interface OmpProjectContextReportLine {
  tone: 'info' | 'warn';
  text: string;
}

/**
 * The disclosure for one detected capture: what stopped loading, then how to
 * keep it. Both lines are built from the capture itself, so the "install here
 * instead" advice always names the directory that actually holds the shadowed
 * files rather than a separately-derived root that might not.
 */
export function ompNestedInstallCaptureReport(
  capture: OmpNestedInstallCapture
): OmpProjectContextReportLine[] {
  const catalog = getLocaleCatalog(resolveCliLocale()).ompProjectContext;
  const values = {
    installDir: capture.installRoot,
    boundary: capture.capturedRoot,
    files: capture.capturedFiles.join(', '),
  };
  return [
    { tone: 'warn', text: formatLocaleMessage(catalog.nestedInstallCaptureWarning, values) },
    { tone: 'info', text: formatLocaleMessage(catalog.nestedInstallCaptureFix, values) },
  ];
}
