# Proposal: cli-locale-workflow-list-skill-title-fixes

## Why

Three user-reported defects degrade the CLI experience on real machines:

1. **`language: auto` does not detect the user's language on macOS.** When locale
   environment variables are absent (GUI-launched processes, terminals that do not
   inject `LANG`) or carry no language information (`LC_ALL=C`, `LANG=UTF-8`), the
   CLI falls back to Node's `Intl` default, which reports `en-US` regardless of the
   operating system's configured language (`AppleLocale=ja_JP`). Users must hard-set
   `"language": "ja"` to get their own language.
2. **`rasen workflow list` shows OS metadata files as invalid workflows.** Finder
   drops `.DS_Store` into `~/.rasen/workflows/`, and the registry scan reports it as
   an invalid user workflow (`.DS_Store  ユーザー  無効`). The list output is also
   tab-separated, so columns drift badly once IDs of different lengths mix.
3. **User workflows have no human-readable display name.** The profile picker shows
   `example-local-verify - rasen-example-local-verify` because the only name sources
   are the workflow ID and the SKILL.md `name:` (which naming rules force to the
   skill ID). The manifest's `command:` block — the one place a human title
   (`name: Example Local Verify`) could live — is retired and ignored, so authors
   have nowhere to declare a title.

## What Changes

- **Automatic language detection consults the OS on macOS.** In `auto` mode, when no
  locale environment variable determines a language, the CLI reads the operating
  system's configured locale (macOS `AppleLocale`) before falling back to English.
  Environment values that carry no language information (`C`, `POSIX`, `UTF-8`) no
  longer short-circuit resolution to English; a well-formed but unsupported language
  request (e.g. `LANG=fr_FR`) still falls back to English as specified today.
- **The workflow registry scan ignores OS junk entries.** Dot-prefixed entries
  (`.DS_Store`, `.git`, …) and Windows metadata files (`Thumbs.db`, `desktop.ini`)
  in the user workflow library are skipped silently instead of being surfaced as
  invalid workflows. Genuine stray entries (a non-hidden file, a broken workflow
  directory) continue to be reported.
- **`rasen workflow list` aligns its columns.** Human-readable output pads the ID and
  source columns with spaces so rows line up regardless of ID length; grouping,
  hiding rules, and `--json` output are unchanged.
- **The manifest `command:` block is succeeded by a `skill:` block.** A user
  workflow's `workflow.yaml` MAY declare skill presentation metadata:

  ```yaml
  skill:
    name: Example Local Verify
    category: Workflow
    tags: [workflow, verify, local]
  ```

  `skill.name` becomes the workflow's human-readable display title, used by the
  profile picker (falling back to the skill name when absent) and exposed in JSON
  output. Legacy `command:` blocks remain accepted-and-ignored exactly as today, with
  the existing warning updated to point authors at `skill:`.

## Capabilities

### New Capabilities

(None — all changes refine existing capabilities.)

### Modified Capabilities

- `profiles`: the `language: auto` resolution contract gains an OS-locale fallback on
  macOS and stops treating language-free environment values as an English request.
- `workflow-library`: the registry scan ignores OS metadata entries; `rasen workflow
  list` output is column-aligned; user workflow manifests may declare a `skill:`
  presentation block whose `name` is the display title shown by pickers and carried
  in JSON output.

## Impact

- **Code**: `src/utils/locale.ts` (resolution order, macOS probe),
  `src/core/workflow-registry/registry.ts` (scan filter),
  `src/core/workflow-registry/manifest.ts` / `validator.ts` / `types.ts`
  (`skill:` block schema, definition `title`),
  `src/commands/workflow-library.ts` (column alignment, JSON `title`),
  `src/commands/profile-editor.ts` (picker display title).
- **Specs**: `profiles` (auto-detection scenario), `workflow-library` (scan hygiene,
  list alignment, skill presentation metadata).
- **Compatibility**: no manifest version bump — `skill:` is an optional field within
  version 1, following the precedent set by `kind`. Older CLI versions reject
  manifests that declare `skill:` (strict schema), matching how `kind` rolled out.
  Existing packages with `command:` blocks keep installing unchanged. Workflow
  digests are unaffected by presentation metadata handling; a manifest edit changes
  the digest as any file edit does.
- **Docs**: workflow authoring documentation gains the `skill:` block; locale
  behavior notes updated.
