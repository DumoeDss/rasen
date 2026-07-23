# Design: cli-locale-workflow-list-skill-title-fixes

## Context

Three independent defects share CLI surfaces and were confirmed against the live
codebase:

1. `resolveCliLocale()` (`src/utils/locale.ts`) resolves `auto` from
   `LC_ALL`/`LC_MESSAGES`/`LANG`, then `Intl.DateTimeFormat().resolvedOptions().locale`.
   Node's ICU default does not reflect the macOS system language: with no locale
   environment variables, `Intl` reports `en-US` even when `AppleLocale=ja_JP`.
   Additionally, the first *set* environment variable wins outright — an
   unparseable value (`LC_ALL=C`, `LANG=UTF-8`) returns English immediately without
   consulting the remaining keys or the system locale. Confirmed in the field: a
   JetBrains IDE terminal exposes only `LC_CTYPE=UTF-8` (no `LANG`), so `auto`
   resolved to English on a Japanese-configured macOS. The current spec already
   promises a system-locale fallback; on macOS the runtime cannot deliver it
   without consulting the OS.
2. `loadWorkflowCatalog()` (`src/core/workflow-registry/registry.ts`) reports every
   non-directory entry of `~/.rasen/workflows/` as an invalid workflow
   (`registry_entry_not_directory`), so Finder's `.DS_Store` surfaces as
   `.DS_Store  ユーザー  無効` in `rasen workflow list`. The list itself prints
   tab-separated columns (`src/commands/workflow-library.ts`), which misalign as soon
   as IDs of different lengths mix (`new` vs `verify-enhanced-command`).
3. The profile picker (`src/commands/profile-editor.ts`) displays a user workflow as
   `<id> - <skill.template.name>`. The SKILL.md `name:` is constrained to the skill
   ID (`rasen-example-local-verify`), and the manifest's `command:` block — where a
   human title once lived — is retired and ignored
   (`command_field_ignored`, `src/core/workflow-registry/validator.ts`). There is no
   author-controlled display title. The skills-only delivery decision
   (`rasen/office-hours/skills-only-delivery-runtime-next-steps.md`) removed the
   command surface deliberately; this change gives its presentation metadata a new,
   skill-native home.

## Goals / Non-Goals

**Goals:**

- `language: auto` yields the user's language in every launch context on macOS,
  including processes that receive no locale environment variables.
- The user workflow library tolerates OS metadata files without noise.
- `rasen workflow list` human output is column-aligned.
- User workflow authors can declare a human display title that pickers show.

**Non-Goals:**

- No new locale (catalog set stays `en`/`ja`/`zh-cn`); no change to `RASEN_LANG`
  precedence or to persisted `language` handling.
- No resurrection of the command delivery surface; `skill:` is presentation
  metadata only, it generates no files.
- No display-title lookup changes for built-in workflows (locale catalogs remain
  their source).
- No change to `rasen workflow list --json` shape beyond adding `title`.
- No Linux OS-locale probe (environment variables are the OS contract there).

## Decisions

### D1: `auto` resolution order gains a macOS OS-locale probe and junk fall-through

New order for `language: auto` on non-Windows platforms:

1. `LC_ALL` → `LC_MESSAGES` → `LANG`, per key:
   - parses to a supported locale → return it;
   - names the portable locale (`C` / `POSIX`, optionally with encoding suffix) →
     return `en` (explicit request for unlocalized output);
   - names a language (first subtag is 2–3 ASCII letters, e.g. `fr`, `fr_FR.UTF-8`)
     that is unsupported → return `en` (preserves the existing "unsupported locales
     fall back to English" contract);
   - carries no language information (`UTF-8`, malformed values) → fall through to
     the next key instead of returning `en`.
2. macOS only: read the OS-configured locale via `defaults read -g AppleLocale`
   (silent `execSync`, `try/catch`, result memoized per process) and parse it.
3. `Intl.DateTimeFormat().resolvedOptions().locale` (unchanged).
4. `en`.

Windows keeps its current behavior (runtime-reported system locale, no environment
variable inspection).

*Why `defaults` instead of alternatives:* Node's ICU never consults macOS
preferences, so `Intl` cannot fix this; parsing
`~/Library/Preferences/.GlobalPreferences.plist` directly would add a binary-plist
dependency. `defaults` ships with every macOS. The probe runs only in `auto` mode
after the environment yields nothing — the GUI-launch/locale-free-shell path — so
its ~20–40 ms cost never touches correctly-configured shells, and memoization caps
it at once per process.

*Testability:* `ResolveCliLocaleOptions` gains `readOsLocale?: () => string |
undefined` so tests inject the probe; the real implementation is used only when the
(injected or real) platform is `darwin`. Existing `systemLocale` injection stays.

### D2: Registry scans skip OS junk silently; everything else stays loud

`loadWorkflowCatalog()` skips directory entries whose name starts with `.` or whose
lowercased name is `thumbs.db` or `desktop.ini`, before the is-directory check.
Workflow IDs can never begin with a dot (ID validation), so a dot entry is never a
legitimate workflow — reporting it is pure noise. Non-hidden stray files and broken
workflow directories continue to produce invalid records: they are actionable
signals.

The same junk rule applies inside `loadWorkflowSourceTree()` (the per-workflow file
walk in `src/core/workflow-registry/loader.ts`): a `.DS_Store` inside a staged
workflow directory must not be embedded into `files[]`, the digest, or an exported
`.rasenpkg` (it is binary; the walk reads utf8). Consequence: a hypothetical
already-installed workflow that embedded junk would change digest and be flagged as
drift once — accepted, since embedding the junk was itself the defect.

### D3: `workflow list` pads columns with spaces

Human-readable rows become `id · source-label · skill-name (· unused-marker)` with
the ID and source columns padded via `padEnd` to the widest value rendered in that
invocation (invalid rows included). Tabs are removed. Grouping, `--all`, and JSON
output are unchanged. Padding uses string length, which is safe because the ID and
skill columns are ASCII machine values and the source labels within any single
locale currently render at equal display width (`built-in`/`user`, `組み込み`/
`ユーザー`, `内置`/`用户`); the catalog-parity test suite keeps the label sets
reviewable if that ever changes.

### D4: Manifest `skill:` block — no `enabled` field

`workflow.yaml` (manifest version 1, no bump — same rollout precedent as `kind`)
gains an optional block:

```yaml
skill:
  name: Example Local Verify     # required within the block; display title
  category: Workflow             # optional
  tags: [workflow, verify]       # optional
```

- All values use the existing `FrontmatterScalarSchema` constraints (single-line,
  no control characters).
- **No `enabled` field.** The old `command:` block was a discriminated union on
  `enabled` because command generation was optional. The skill surface is the only
  delivery format and is always generated, so an on/off toggle has no meaning;
  strict validation rejects it like any unknown field.
- `category` and `tags` are accepted and carried on the definition for JSON
  consumers (board UI, future discovery); no CLI behavior attaches to them in this
  round.
- A manifest may carry both `command:` (ignored, warning) and `skill:` (honored).
  The `command_field_ignored` warning text now recommends migrating the title to
  `skill:`.

### D5: Display title plumbing

- `WorkflowDefinition` gains `title?: string` (plus optional `category`/`tags`),
  populated from `skill.name` for user workflows; built-ins leave it unset and keep
  sourcing presentation from the locale catalogs.
- Profile picker: a user workflow's choice label becomes
  `<display-id> - <title ?? skill.template.name>`; `short` uses the same value.
  The title is user-authored content and is never translated (existing
  `workflow-library` localization boundary).
- `rasen workflow list --json` and `rasen workflow show` expose `title` (omitted or
  `null` when absent); the human list keeps machine values only — it is the
  machine-identity surface, mirroring how built-in display names also do not appear
  there.
- Like `kind`, presentation metadata does not join digest computation as a separate
  input; editing the manifest changes the digest as any file edit does.

## Risks / Trade-offs

- [`defaults` unavailable or blocked (sandbox, stripped PATH)] → probe is wrapped in
  `try/catch` with absolute behavior fallback to the current chain; worst case is
  today's behavior.
- [Probe latency on the cold path] → runs only when environment variables carry no
  language and only once per process; interactive shells with `LANG` set never pay
  it.
- [`LC_ALL=C` users who *wanted* Japanese] → `C`/`POSIX` deliberately keep meaning
  "unlocalized → English" per POSIX semantics; documented, not a bug.
- [Dot-named workflow directory silently ignored] → impossible to install (IDs
  cannot start with `.`); acceptable.
- [Junk-skip changes digest of a tree containing `.DS_Store`] → one-time drift heal
  for a state that was already broken; called out in D2.
- [Older CLIs reject `skill:` manifests (strict schema)] → identical rollout story
  to `kind`; authors targeting old CLIs omit the block.
- [CJK source labels with unequal char counts would misalign padEnd] → current
  catalogs are equal-width per locale; alignment test pins the rendered output.

## Migration Plan

No user action required. Authors who relied on the ignored `command:` block rename
it to `skill:` and drop `enabled:`; re-validate and re-import the workflow.
Rollback is a straight revert — no persisted state changes shape.

## Open Questions

(None.)
