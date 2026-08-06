# Adjacent finding — `local-runtime.mjs` trusts npm's reported pack filename

**Found:** 2026-08-06, while running the full suite for the ship gate of
`detect-omp-host-runtime`
**Status:** Out of scope for this change. Environment cause resolved; the code
gap remains open and needs a follow-up change.
**Severity:** Major for anyone whose `npm` reports the scoped pack filename —
`pnpm test` cannot go green, and the failure names a missing tarball rather than
the version mismatch that actually caused it.

## Why this is recorded here

It is not a defect in this change. `scripts/` is absent from this change's diff,
and the failure reproduces with no branch code involved (see Reproduction). It is
recorded in this change's evidence because it cost two full suite runs during the
ship gate and presented as a branch regression, so the next person to run the
suite on a machine with a mismatched `npm` should not have to re-derive it.

This is the same class as the review round's "adjacent leak found by running the
suite" — developer machine state the suite reads indirectly, which decision D8 in
`design.md` exists to neutralize. It differs in one important way: D8's leaks
were fixable inside `vitest.setup.ts`, whereas this one is a robustness gap in
production script code and cannot be scrubbed away by test setup.

## Symptom

Two tests in `test/scripts/local-version-runtime.test.ts` fail:

- `materializes a paired runtime without mutating the target and reuses it warm`
- `converges concurrent cold callers on one published runtime`

Both fail in the `install` phase with `ENOENT` on a tarball path:

```
npm ERR! code ENOENT
npm ERR! enoent ENOENT: no such file or directory, open
  '…/staging/…/packs/@atelierai/rasen-ui-0.2.0-fixture.1.tgz'
{"error":{"code":"COMMAND_FAILED","phase":"install",…,"exitCode":254}}
```

The reported path is a directory-nested form (`packs/@atelierai/rasen-ui-….tgz`)
that `npm pack` never created.

## Root cause

`scripts/local-version/local-runtime.mjs:413` builds the tarball path by joining
the pack destination with the `filename` field that `npm pack --json` reports:

```js
return { ...metadata[0], tarball: path.join(destination, metadata[0].filename) };
```

That field is not reliably the name npm actually wrote. For a scoped package,
some npm versions report the unflattened `@scope/name-version.tgz` while writing
the historical flattened `scope-name-version.tgz`. When they disagree, the join
produces a path that does not exist, and the subsequent `npm install` fails with
`ENOENT`.

Measured on this machine, the reported and written names disagree in one
direction and agree in the other — so the mismatch is a function of the npm
version, not of the package:

| npm | `filename` reported | file actually written | agree? |
|---|---|---|---|
| 8.3.0 | `@atelierai/rasen-ui-0.2.0-fixture.1.tgz` | `atelierai-rasen-ui-0.2.0-fixture.1.tgz` | no |
| 11.16.0 | `atelierai-rasen-ui-0.2.0-fixture.1.tgz` | `atelierai-rasen-ui-0.2.0-fixture.1.tgz` | yes |

## The repository already knows about this quirk elsewhere

`scripts/pack-version-check.mjs:36-46` handles exactly this case — it prefers the
reported name only when it exists on disk, and otherwise falls back to the
flattened form:

```js
const reported = String(file).trim();
if (existsSync(reported)) return reported;

// npm 11 may report a scoped filename as `@scope/name-x.y.z.tgz`
// while writing the historical flattened `scope-name-x.y.z.tgz`.
const flattened = reported.replace(/^@/, '').replaceAll('/', '-');
if (existsSync(flattened)) return flattened;

return reported;
```

`local-runtime.mjs` has no equivalent. The asymmetry is the whole defect: one
script is defensive about npm's reported filename and its sibling is not.

Note that the existing comment attributes the unflattened report to "npm 11",
while the measurement above shows npm 11.16.0 reporting the flattened form and
npm 8.3.0 reporting the unflattened one. The safe reading is that npm's reported
filename cannot be trusted to match what it wrote in either direction, so an
existence check is required rather than a version check.

## Reproduction (no branch code, no vitest, outside the repository)

```console
$ T=$(mktemp -d)/"cache with spaces"; mkdir -p "$T/packs" "$T/src"; cd "$T/src"
$ printf '{"name":"@atelierai/rasen-ui","version":"0.2.0-fixture.1"}' > package.json
$ npm pack --json --silent --ignore-scripts --pack-destination "$T/packs" | grep filename
    "filename": "@atelierai/rasen-ui-0.2.0-fixture.1.tgz",     # npm 8.3.0
$ ls -1 "$T/packs"
atelierai-rasen-ui-0.2.0-fixture.1.tgz
```

A two-line `package.json` in a temporary directory is enough. This is what
establishes that the failure is independent of `detect-omp-host-runtime`.

## Environment cause on this machine (resolved)

The shadowing npm was an orphan, not a managed install:

- `/opt/homebrew/bin/npm` → `/opt/homebrew/lib/node_modules/npm/bin/npm-cli.js`,
  version **8.3.0**.
- No Homebrew `node` or `npm` formula is installed — `brew ls npm` reports
  `No such keg: /opt/homebrew/Cellar/npm`, and `brew list --formula` matches
  neither name.
- `node` already resolved correctly to nvm's **v24.18.0**; only `npm` was
  shadowed, because `/opt/homebrew/bin` precedes the nvm bin directory in `PATH`.
- Node v24.18.0 ships npm 11.16.0 at
  `~/.local/share/nvm/v24.18.0/bin/npm`, which was being masked.

Resolved by the maintainer with `npm install -g npm@11.16.0`. Verified
afterwards: `npm --version` → `11.16.0`, and the reported filename matches the
written file. The full suite then passed bare, with no environment overrides —
**345/345 files, 6034 passed, 27 skipped**.

## Recommended follow-up

Give `npmPack` in `scripts/local-version/local-runtime.mjs` the same
existence-checked resolution `pack-version-check.mjs` already performs, rather
than trusting the reported `filename`. Preferring the reported name when it
exists and falling back to the flattened form keeps both npm behaviors working
and removes the version sensitivity entirely.

Two points worth carrying into that change:

- The failure message should name the real problem. `ENOENT` on a tarball path
  sends the reader looking for a packing failure, when the tarball was written
  successfully under a different name.
- Fixing it in `local-runtime.mjs` alone leaves the two scripts resolving pack
  filenames by different rules. Extracting one shared helper would prevent the
  next copy from drifting again.

This is deliberately not folded into `detect-omp-host-runtime`: that change
recognizes a host runtime and refuses unadapted surfaces, and it touches no
packaging code. Widening it to carry a packaging fix would put an unrelated
defect inside a change whose scope check is currently clean.
