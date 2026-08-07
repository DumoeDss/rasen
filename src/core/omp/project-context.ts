/**
 * What a project-local Oh My Pi directory does to the enclosing tree's own
 * Oh My Pi project context.
 *
 * Oh My Pi resolves its project instruction file (`.omp/AGENTS.md`) and its
 * sticky project rules (`.omp/RULES.md`) from the NEAREST NON-EMPTY `.omp/`
 * directory found while walking from the working directory upward, and does not
 * continue past it (`omp://config-usage.md:240-242,261`, pinned to
 * `OMP_CLI_VERSION_PREMISE`). Populating `<pkg>/.omp/skills` in a monorepo
 * package therefore silently stops `<repo>/.omp/AGENTS.md` and
 * `<repo>/.omp/RULES.md` from loading.
 *
 * Skills are the documented exception: they scan every ancestor's `.omp/skills`
 * and do not require the `.omp/` root to be non-empty, so the skills Rasen
 * installs keep working either way. The capture is real for the two context
 * files, and nothing else Rasen writes is affected.
 *
 * Rasen does not author context files for any tool, so it neither writes a
 * placeholder `.omp/AGENTS.md` (which would shadow the enclosing file just as
 * effectively) nor refuses the install (which is legitimate). It names the files
 * that stop loading and proceeds — design D5.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * The Oh My Pi project files that resolve from the nearest non-empty `.omp/`
 * and therefore stop loading when a nearer one appears. `SYSTEM.md` is
 * deliberately absent: Oh My Pi's own docs disagree about whether it walks
 * ancestors at all (`omp://system-prompt-customization.md:30` says it does
 * not), so warning about it could name a file that was never reachable.
 */
const CAPTURED_PROJECT_FILES = ['AGENTS.md', 'RULES.md'] as const;

/** Oh My Pi's project configuration directory name. */
const OMP_PROJECT_DIR = '.omp';

export interface OmpNestedInstallCapture {
  /** The directory whose `.omp/` the install populates. */
  installRoot: string;
  /** The enclosing directory whose `.omp/` stops being consulted. */
  capturedRoot: string;
  /**
   * Absolute paths of the enclosing Oh My Pi context files that stop loading.
   * Never empty — no capture is reported as `undefined` rather than an empty
   * list, so a caller cannot render a warning that names nothing.
   */
  capturedFiles: string[];
}

/**
 * Whether `dir` holds a non-empty `.omp/`. Oh My Pi's admission helper treats
 * an existing-but-empty `.omp/` as absent for these files, so this check has to
 * match it: an empty ancestor directory captures nothing, and neither does the
 * install target until init writes the skills into it.
 */
function hasPopulatedOmpDir(dir: string): boolean {
  try {
    return fs.readdirSync(path.join(dir, OMP_PROJECT_DIR)).length > 0;
  } catch {
    return false;
  }
}

/**
 * The enclosing Oh My Pi context files a newly populated `<installRoot>/.omp/`
 * takes over, or `undefined` when nothing is captured.
 *
 * MUST be called BEFORE init writes into `<installRoot>/.omp/`. An already
 * populated one means the enclosing files were shadowed before Rasen ran, and
 * warning then would blame Rasen for a pre-existing state — that is the
 * "newly populate" half of the requirement, not an optimization.
 *
 * The walk starts at `installRoot`'s PARENT (a file inside the directory being
 * installed into is not "enclosing") and stops at Oh My Pi's own discovery
 * boundary: the enclosing Git checkout root, else the home directory, else the
 * filesystem root (`omp://config-usage.md:241`). It also stops at the first
 * ancestor with a populated `.omp/`, because Oh My Pi stops there too: a second,
 * higher `.omp/AGENTS.md` was already shadowed before this install.
 *
 * `homeDir` is injectable for testing; the walk never reads outside the
 * ancestry it is given.
 */
export function detectOmpNestedInstallCapture(
  installRoot: string,
  homeDir: string = os.homedir()
): OmpNestedInstallCapture | undefined {
  const start = path.resolve(installRoot);
  if (hasPopulatedOmpDir(start)) return undefined;

  const home = path.resolve(homeDir);
  let current = path.dirname(start);
  let previous = start;
  while (current !== previous) {
    if (hasPopulatedOmpDir(current)) {
      const capturedFiles = CAPTURED_PROJECT_FILES.map((name) =>
        path.join(current, OMP_PROJECT_DIR, name)
      ).filter((candidate) => fs.existsSync(candidate));
      return capturedFiles.length > 0
        ? { installRoot: start, capturedRoot: current, capturedFiles }
        : undefined;
    }
    // Boundary checked AFTER the capture test so a repository root that itself
    // carries the context files is still reported — that is the common
    // monorepo shape, not an edge case.
    if (current === home || fs.existsSync(path.join(current, '.git'))) return undefined;
    previous = current;
    current = path.dirname(current);
  }
  return undefined;
}
