# NUL/control-byte corruption, and how it was found

## What happened

Two files, freshly written during Section 2/3 of this child, had literal
regex/string escape sequences written as **raw control bytes** in the source
file instead of their textual escape form:

- `src/core/store/query/module.ts` — the composite bucket key at what is now
  `module.ts:280` (`` `${projectId}\0${targetLineId}` ``) had a literal raw
  NUL byte (0x00) between the two template-literal interpolations instead of
  the two-character escape text `\0`.
- `src/core/store/issues/records.ts` — `CONTROL_PATTERN` (now `records.ts:40`,
  `/[\x00-\x1f\x7f]/u`) had its `\x00`, `\x1f`, `\x7f` hex escapes written as
  raw bytes 0x00/0x1f/0x7f inside the regex literal instead of their escape
  text.

Neither file had been committed anywhere before the fix (both were introduced
earlier in this child's own apply stage), so this was a clean fix with no
history to reconcile — folded into commit `af6f3e9d`.

## Why this is worse than an ordinary typo

`module.ts`'s own comment, sitting right next to the corrupted byte,
literally warns against this exact outcome: a raw NUL makes Git classify the
whole file as binary, which silently costs the diff and every whitespace
gate. It happened anyway, in code that:

- compiled cleanly under `tsc --noEmit`,
- passed every test in the suites that exercised it,
- would have passed a normal code-review read-through, because a control
  byte renders invisibly or as an ambiguous glyph in most editors and PR
  diff viewers.

**Neither `tsc` nor any test suite ever surfaces this.** It is a new variant
of a hazard this repo already knows in its multibyte form (see memory
`write-tool-mangles-multibyte-chinese` — a CJK character silently corrupted
to U+FFFD), now showing up in hex/NUL-escape form instead.

## Detection method — the transferable part

Two commands exposed it, neither of which is a test:

```sh
file src/core/store/query/module.ts
#   before fix: ...: data
#   after fix:  ...: ASCII text / Unicode text, UTF-8 text
```

```sh
rg -n 'GROUPING' src/core/store/query/module.ts
# before fix: rg refuses — reports the file as binary and skips it
```

`file` reporting `data` instead of `ASCII/UTF-8 text` for a `.ts` source
file, and ripgrep refusing to grep a source file as binary, are both
immediate, cheap, zero-setup signals. Anyone editing a file with a
control-character literal in it (a NUL separator, a hex-escape regex, a
delimiter constant) should run `file <path>` on it before trusting `tsc`
or the test suite to have caught a mangled byte.

## Verification of the fix

- `file src/core/store/query/module.ts` and `file src/core/store/issues/records.ts`
  both now report UTF-8/ASCII text (independently re-confirmed by LEAD).
- A raw-control-byte grep across the whole of `issues/**` and `query/**`
  (`rg -P '[\x00-\x08\x0e-\x1f\x7f]' -l src/core/store/issues src/core/store/query`)
  returns no matches.

## Scope of the finding

This is a **detection-method** finding, not a claim that the repo's write
tooling is broadly unsafe — it is one more concrete instance (alongside the
multibyte-mangling case already in project memory) of "a file can look and
compile fine while carrying bytes no diff or test will ever show you."
Anyone who introduces a literal control-byte escape (NUL separators, hex
escapes in a character class, delimiter constants) should treat `file
<path>` as a cheap pre-commit sanity check, the same way `git diff --check`
is already relied on for whitespace.
