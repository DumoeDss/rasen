import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RASEN_HISTORY_START = '<!-- rasen-history:start -->';
export const RASEN_HISTORY_END = '<!-- rasen-history:end -->';
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const TAG_PATTERN = /^rasen-v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function parseCanonicalVersion(value, label = 'version') {
  if (typeof value !== 'string' || !VERSION_PATTERN.test(value)) {
    throw new Error(`${label} must be canonical SemVer X.Y.Z; received ${JSON.stringify(value)}`);
  }
  return value;
}

export function versionFromReleaseTag(tag) {
  if (typeof tag !== 'string') {
    throw new Error(`release tag must be rasen-vX.Y.Z; received ${JSON.stringify(tag)}`);
  }
  const match = TAG_PATTERN.exec(tag);
  if (!match) {
    throw new Error(`release tag must be canonical rasen-vX.Y.Z; received ${JSON.stringify(tag)}`);
  }
  return `${match[1]}.${match[2]}.${match[3]}`;
}

export function validateLockstepVersions({ cliVersion, uiVersion, releaseTag } = {}) {
  const cli = parseCanonicalVersion(cliVersion, 'CLI package version');
  const ui = parseCanonicalVersion(uiVersion, 'UI package version');
  if (cli !== ui) {
    throw new Error(`CLI/UI version mismatch: CLI ${cli}, UI ${ui}`);
  }
  if (releaseTag !== undefined) {
    const tagged = versionFromReleaseTag(releaseTag);
    if (tagged !== cli) {
      throw new Error(`release tag/package version mismatch: tag ${tagged}, packages ${cli}`);
    }
  }
  return cli;
}

export function extractRasenHistory(changelog) {
  if (typeof changelog !== 'string') {
    throw new Error('CHANGELOG.md content must be a string');
  }
  const start = changelog.indexOf(RASEN_HISTORY_START);
  const end = changelog.indexOf(RASEN_HISTORY_END);
  if (start < 0) throw new Error(`CHANGELOG.md is missing ${RASEN_HISTORY_START}`);
  if (end < 0) throw new Error(`CHANGELOG.md is missing ${RASEN_HISTORY_END}`);
  if (changelog.indexOf(RASEN_HISTORY_START, start + RASEN_HISTORY_START.length) >= 0) {
    throw new Error(`CHANGELOG.md contains duplicate ${RASEN_HISTORY_START}`);
  }
  if (changelog.indexOf(RASEN_HISTORY_END, end + RASEN_HISTORY_END.length) >= 0) {
    throw new Error(`CHANGELOG.md contains duplicate ${RASEN_HISTORY_END}`);
  }
  if (end <= start) throw new Error('CHANGELOG.md Rasen history markers are out of order');

  const history = changelog.slice(start + RASEN_HISTORY_START.length, end).trim();
  if (!history) throw new Error('CHANGELOG.md Rasen history region is empty');
  return history;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function extractReleaseNotes(history, version) {
  const canonical = parseCanonicalVersion(version, 'release-notes version');
  const heading = `## ${canonical}`;
  const occurrences = history.match(new RegExp(`^${escapeRegex(heading)}\\s*$`, 'gm')) ?? [];
  if (occurrences.length !== 1) {
    throw new Error(
      `Rasen history must contain exactly one ${heading} heading; found ${occurrences.length}`,
    );
  }
  const start = history.search(new RegExp(`^${escapeRegex(heading)}\\s*$`, 'm'));
  const afterHeading = start + history.slice(start).indexOf('\n') + 1;
  const nextHeading = history.slice(afterHeading).search(/^##\s+/m);
  const end = nextHeading < 0 ? history.length : afterHeading + nextHeading;
  const notes = history.slice(start, end).trim();
  if (!notes || notes === heading) {
    throw new Error(`${heading} release notes are empty`);
  }
  return notes;
}

export function loadReleaseContract({ rootDir, releaseTag } = {}) {
  const resolvedRoot = path.resolve(rootDir ?? path.dirname(path.dirname(fileURLToPath(import.meta.url))));
  const cliPackagePath = path.join(resolvedRoot, 'package.json');
  const uiPackagePath = path.join(resolvedRoot, 'packages', 'ui', 'package.json');
  const changelogPath = path.join(resolvedRoot, 'CHANGELOG.md');
  const cliPackage = JSON.parse(fs.readFileSync(cliPackagePath, 'utf8'));
  const uiPackage = JSON.parse(fs.readFileSync(uiPackagePath, 'utf8'));
  const version = validateLockstepVersions({
    cliVersion: cliPackage.version,
    uiVersion: uiPackage.version,
    releaseTag,
  });
  const history = extractRasenHistory(fs.readFileSync(changelogPath, 'utf8'));
  const notes = extractReleaseNotes(history, version);
  return { version, history, notes, cliPackagePath, uiPackagePath, changelogPath };
}

function parseArgs(argv) {
  const args = { rootDir: undefined, releaseTag: undefined, notesOutput: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--root') args.rootDir = argv[++index];
    else if (arg === '--tag') args.releaseTag = argv[++index];
    else if (arg === '--notes-output') args.notesOutput = argv[++index];
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (args.notesOutput && !args.releaseTag) {
    throw new Error('--notes-output requires --tag');
  }
  return args;
}

export function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const contract = loadReleaseContract(args);
  if (args.notesOutput) {
    const outputPath = path.resolve(args.notesOutput);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${contract.notes}\n`, 'utf8');
    console.log(`wrote release notes ${outputPath}`);
  }
  console.log(`verified lockstep release contract ${contract.version}`);
  return contract;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`release-contract: ${error.message}`);
    process.exitCode = 1;
  }
}
