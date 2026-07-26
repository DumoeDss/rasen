/**
 * `rasen bootstrap` — reports what this machine still needs before a project
 * works, and does nothing else.
 *
 * Two modes, requested separately because they are two promises: `--check`
 * reads local information and contacts no network at all; `--dry-run`
 * additionally resolves remotes and the exact location each repository would be
 * placed at. Neither creates a directory, runs a version-control operation, or
 * writes a registration or a declaration.
 *
 * The bare invocation is deliberately left UNDEFINED: it reports which modes
 * exist and exits. Giving it any other meaning here — even "the same as
 * `--check`" — would have to be redefined by the acting half, breaking anyone
 * who scripted it. For the same reason no flag that would obtain, register, or
 * write is defined, not even one that errors: a "not available yet" message is
 * itself a promise.
 */
import type { Command } from 'commander';

import {
  buildBootstrapReport,
  type BootstrapMode,
  type BootstrapProblem,
  type BootstrapProjectEntry,
  type BootstrapReport,
  type BootstrapRepair,
  type BootstrapStoreEntry,
} from '../core/store/bootstrap.js';
import type { StoreDiagnostic } from '../core/store/errors.js';
import {
  BOOTSTRAP_DESCRIPTIONS,
  getBootstrapMessages,
  type BootstrapMessages,
} from './bootstrap-messages.js';
import { printJson } from './shared-output.js';

export interface BootstrapCommandOptions {
  check?: boolean;
  dryRun?: boolean;
  json?: boolean;
  path?: string[];
  into?: string;
}

/** The modes this command offers, named once for the bare invocation. */
export const BOOTSTRAP_MODES: readonly BootstrapMode[] = ['check', 'preview'];

class BootstrapUsageError extends Error {
  constructor(
    message: string,
    readonly code: string
  ) {
    super(message);
    this.name = 'BootstrapUsageError';
  }
}

/**
 * `<selector>=<directory>`, repeatable. The selector is required because a
 * location belongs to ONE store or project: applying a single bare path to
 * every expected store would name a location for repositories it was never
 * meant for, which is the opposite of a preview a user can trust.
 */
export function parseSuppliedPaths(
  values: readonly string[] | undefined,
  messages: BootstrapMessages
): Map<string, string> {
  const parsed = new Map<string, string>();
  for (const value of values ?? []) {
    const separator = value.indexOf('=');
    const selector = separator > 0 ? value.slice(0, separator).trim() : '';
    const target = separator > 0 ? value.slice(separator + 1).trim() : '';
    if (selector.length === 0 || target.length === 0) {
      throw new BootstrapUsageError(messages.pathFormat(value), 'bootstrap_path_format');
    }
    parsed.set(selector, target);
    parsed.set(selector.toLowerCase(), target);
  }
  return parsed;
}

/**
 * The mode, or null for the bare invocation. Both flags together is rejected
 * here — before any work — because they are two different promises and a run
 * that made both would keep neither.
 */
export function resolveMode(
  options: BootstrapCommandOptions,
  messages: BootstrapMessages
): BootstrapMode | null {
  if (options.check && options.dryRun) {
    throw new BootstrapUsageError(messages.modeConflict, 'bootstrap_mode_conflict');
  }
  if (options.check) return 'check';
  if (options.dryRun) return 'preview';
  return null;
}

function repairText(repair: BootstrapRepair, selector: string, messages: BootstrapMessages): string {
  switch (repair.kind) {
    case 'command':
      return repair.command;
    case 'manual':
      return repair.instruction;
    case 'supply-path':
      return messages.repairSupplyPath(selector);
  }
}

/**
 * Renders each repair once. An unavailable Store's membership repair IS its
 * Store repair (there is one thing to do), so printing the list twice would
 * read as two separate steps.
 */
function renderRepairs(
  lines: string[],
  repairs: readonly BootstrapRepair[],
  selector: string,
  messages: BootstrapMessages
): void {
  const rendered: string[] = [];
  for (const repair of repairs) {
    const text = repairText(repair, selector, messages);
    if (!rendered.includes(text)) rendered.push(text);
  }
  if (rendered.length === 0) return;
  lines.push(messages.repairHeading);
  for (const text of rendered) lines.push(messages.repairLine(text));
}

/**
 * A diagnostic's MESSAGE, and deliberately not its `fix`.
 *
 * `fix` is a second command channel that no safety filter in this repo covers
 * (design D6): several landed diagnostics embed a state-changing command
 * mid-sentence there — `rasen store unregister --project …`, `rasen store
 * migrate-membership … --apply` — where `isMutatingRepair`'s prefix match
 * cannot see it. Rendering it once put those commands in the repair position
 * under an answer the report had just called undetermined, and the
 * `BootstrapRepair`-versus-`fix` distinction that keeps the letter of the rule
 * is invisible to a human: both render as indented lines under the item.
 *
 * The message alone is sufficient for what the human output owes: it names the
 * file and says why it could not be read. Where a fix is genuinely needed it
 * goes through `repair`, which IS filtered.
 */
function renderDiagnostics(
  lines: string[],
  diagnostics: readonly StoreDiagnostic[],
  messages: BootstrapMessages
): void {
  for (const diagnostic of diagnostics) {
    lines.push(messages.detailLine(diagnostic.message));
  }
}

function renderLocation(
  lines: string[],
  entry: Pick<BootstrapStoreEntry, 'location'>,
  messages: BootstrapMessages
): void {
  const location = entry.location;
  if (!location) return;
  if (location.kind === 'usable') {
    lines.push(messages.locationUsable(location.path));
    return;
  }
  if (location.kind === 'refused') {
    lines.push(
      messages.locationRefused(location.path, messages.locationRefusal(location.because))
    );
    return;
  }
  lines.push(messages.locationRequired(messages.locationDemand(location.because)));
}

function renderStore(
  lines: string[],
  entry: BootstrapStoreEntry,
  messages: BootstrapMessages
): void {
  lines.push(messages.storeRow(entry.selector, messages.storeClass(entry.class)));
  if (entry.reason !== undefined) {
    lines.push(messages.reasonLine(messages.reason(entry.reason)));
  }
  if (entry.remote !== undefined) lines.push(messages.remoteLine(entry.remote));
  lines.push(messages.membershipLine(messages.membership(entry.membership.state)));
  renderLocation(lines, entry, messages);
  // Entry-level diagnostics are the only place the REASON lives for several
  // answers; JSON has always carried them, so human output must too or the
  // two do not report the same facts.
  renderDiagnostics(lines, entry.diagnostics, messages);
  renderRepairs(lines, [...entry.repair, ...entry.membership.repair], entry.selector, messages);
}

function renderProject(
  lines: string[],
  entry: BootstrapProjectEntry,
  messages: BootstrapMessages
): void {
  lines.push(messages.projectRow(entry.id ?? entry.projectId, messages.presence(entry.presence)));
  if (entry.remote !== undefined) lines.push(messages.remoteLine(entry.remote));
  renderLocation(lines, entry, messages);
  // `presence: 'unknown'` carries no repair, so without these the human reader
  // is told only that something could not be determined — no reason, no path,
  // no fix — while JSON carries all three.
  renderDiagnostics(lines, entry.diagnostics, messages);
}

function renderProblem(
  lines: string[],
  problem: BootstrapProblem,
  messages: BootstrapMessages
): void {
  lines.push(messages.problem(problem.kind, problem.path ?? ''));
  renderDiagnostics(lines, problem.diagnostics, messages);
  renderRepairs(lines, problem.repair, '', messages);
}

export function renderBootstrapReport(
  report: BootstrapReport,
  messages: BootstrapMessages
): string[] {
  const lines: string[] = [];
  const mode = messages.mode(report.mode);

  if (report.origin === 'store' && report.store) {
    lines.push(messages.headingStore(report.store.id, report.store.root, mode));
  } else {
    lines.push(messages.headingProject(report.project?.root ?? '', mode));
  }
  lines.push(messages.stateLine(messages.state(report.state)));

  if (report.problems.length > 0) {
    lines.push(messages.problemsHeading);
    for (const problem of report.problems) renderProblem(lines, problem, messages);
  }

  if (report.stores.length > 0) {
    lines.push(messages.storesHeading);
    for (const entry of report.stores) renderStore(lines, entry, messages);
  }

  if (report.projects.length > 0) {
    lines.push(messages.projectsHeading);
    for (const entry of report.projects) renderProject(lines, entry, messages);
  }

  renderDiagnostics(lines, report.diagnostics, messages);

  if (report.state === 'complete') {
    lines.push(messages.nothingMissing);
  } else {
    lines.push(messages.reportsOnly);
  }

  return lines;
}

/** The bare invocation: which modes exist, and nothing else. */
function reportModes(options: BootstrapCommandOptions, messages: BootstrapMessages): void {
  if (options.json) {
    printJson({ ok: true, modeRequired: true, modes: [...BOOTSTRAP_MODES] });
    return;
  }
  console.log(messages.modeRequired);
  console.log(messages.modeRequiredCheck);
  console.log(messages.modeRequiredPreview);
}

export async function runBootstrapCommand(
  options: BootstrapCommandOptions,
  cwd: string = process.cwd()
): Promise<void> {
  const messages = getBootstrapMessages();

  let mode: BootstrapMode | null;
  let paths: Map<string, string>;
  try {
    mode = resolveMode(options, messages);
    paths = parseSuppliedPaths(options.path, messages);
  } catch (error) {
    const usage = error as BootstrapUsageError;
    if (options.json) {
      printJson({ ok: false, error: { code: usage.code, message: usage.message } });
    } else {
      console.error(usage.message);
    }
    process.exitCode = 1;
    return;
  }

  if (mode === null) {
    reportModes(options, messages);
    return;
  }

  // The report itself already turns unreadable machine state into a `blocked`
  // result, so reaching this catch means something genuinely unforeseen. It
  // still must not surface as a raw rejection: Commander does not await an
  // async `.action`, so an escaping rejection is a process-level crash with a
  // stack trace and, in `--json` mode, no JSON at all — from the one command
  // whose entire job is to describe a machine that is not working.
  let report: BootstrapReport;
  try {
    report = await buildBootstrapReport({
      cwd,
      mode,
      ...(paths.size > 0 ? { paths } : {}),
      ...(options.into !== undefined ? { into: options.into } : {}),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (options.json) {
      printJson({
        ok: false,
        error: { code: 'bootstrap_report_failed', message: messages.reportFailed(detail) },
      });
    } else {
      console.error(messages.reportFailed(detail));
    }
    process.exitCode = 1;
    return;
  }

  if (options.json) {
    printJson({ ok: true, report });
    return;
  }
  for (const line of renderBootstrapReport(report, messages)) console.log(line);
}

export function registerBootstrapCommand(program: Command): void {
  program
    .command('bootstrap')
    .description(BOOTSTRAP_DESCRIPTIONS.command)
    .option('--check', BOOTSTRAP_DESCRIPTIONS.check)
    .option('--dry-run', BOOTSTRAP_DESCRIPTIONS.dryRun)
    .option('--json', BOOTSTRAP_DESCRIPTIONS.json)
    .option(
      '--path <selector=dir>',
      BOOTSTRAP_DESCRIPTIONS.path,
      (value: string, previous: string[] = []) => [...previous, value]
    )
    .option('--into <dir>', BOOTSTRAP_DESCRIPTIONS.into)
    .action(async (options: BootstrapCommandOptions) => {
      // Every mature command in this repo guards its own body (see
      // `registerDoctorCommand`, `StoreCommand.register`) because Commander
      // does not await this callback — an uncaught rejection here is a raw
      // process crash, not a reported failure.
      try {
        await runBootstrapCommand(options);
      } catch (error) {
        const messages = getBootstrapMessages();
        const detail = error instanceof Error ? error.message : String(error);
        if (options.json) {
          printJson({
            ok: false,
            error: { code: 'bootstrap_failed', message: messages.reportFailed(detail) },
          });
        } else {
          console.error(messages.reportFailed(detail));
        }
        process.exitCode = 1;
      }
    });
}
