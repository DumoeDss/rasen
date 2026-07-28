## Why

`remoteCarriesCredentials` in `src/core/store/remote.ts` checks only URL userinfo (`username`/`password`) to detect embedded credentials. It ignores `url.search` and `url.hash` entirely, so `https://host/repo.git?access_token=secret`, signed URLs, and fragment-embedded tokens pass `assertCredentialFreeRemote`, get written into shared Store metadata and project pointer files, and are echoed verbatim in human/JSON output and clone-failure diagnostics. The existing test at `remote.test.ts:51-73` actively asserts this is correct behavior — calling `?token=` and `?access_token=` "not credentials." The PR #88 acceptance review classifies this as a Blocker (B4) and the test as `[WRONG-TEST]`.

## What Changes

- Extend `remoteCarriesCredentials` to treat ANY non-empty `url.search` or `url.hash` as credential-bearing — a default-deny policy on query strings and fragments. Git clone URLs never legitimately carry query parameters or fragments; the only real-world use is deploy tokens, signed URLs, and other credentials. A codebase-wide search for `.git?` found zero legitimate uses.
- Fix `redactRemote` to never echo the raw query or fragment when credentials are detected. The redacted form drops `search`/`hash` and appends `?<redacted>` when they were present, so the secret value is never displayed.
- Flip the wrong test: `?token=abc` and `?access_token=xyz` now assert `remoteCarriesCredentials === true`, assert `assertCredentialFreeRemote` throws `StoreError`, and assert `redactRemote` does not echo the raw secret. Keep the existing legitimate-pass tests (plain https, SSH, scp-style, file paths) unchanged.

## Capabilities

### New Capabilities

- `store-remote-credential-hygiene`: The observable contract that Store metadata and pointer files never accept or echo a remote URL carrying credentials in userinfo, query string, or fragment — and that a rejected value is rendered only in its redacted form.

### Modified Capabilities

## Impact

- `src/core/store/remote.ts` — extend `remoteCarriesCredentials` with query/hash detection; fix `redactRemote` to drop search/hash from output.
- `test/core/store/remote.test.ts` — flip the `?token`/`?access_token` tests from "passes" to "rejected"; add `redactRemote` no-leak assertions; add signed-URL and fragment cases.
- Downstream callers (`assertCredentialFreeRemote` in bootstrap, foundation, membership, operations, project-records, upgrade-identity) automatically gain the stricter check with no code changes — they all delegate to `remoteCarriesCredentials`.
- `migration-ops.ts` and `operations.ts` use `!remoteCarriesCredentials()` to decide whether to surface a recorded remote — these now correctly suppress query-param-credential URLs.
- No public API changes. No dependency changes.
