## Context

`src/core/store/remote.ts` is the single credential-hygiene module for Store remotes. Three exported functions form a pipeline:

1. `remoteCarriesCredentials(remote)` — detection. Currently checks only `url.username`/`url.password` via the `URL` parser.
2. `redactRemote(remote)` — rendering. Currently echoes `url.search` + `url.hash` verbatim even when credentials are detected in userinfo.
3. `assertCredentialFreeRemote(remote, target)` — write-path guard. Calls (1), throws `StoreError` if credentials found, using (2) for the error message.

Every Store write path delegates to (3): `bootstrap.ts`, `foundation.ts`, `membership.ts`, `operations.ts`, `project-records.ts`, `upgrade-identity.ts`. Every human/JSON display path delegates to (2): `relationship-health.ts`, `git.ts`, `identity-diagnostics.ts`, `operations.ts`. Two read-path callers use (1) directly to decide whether a recorded remote is safe to surface: `migration-ops.ts:153,233` and `operations.ts:1304,1306`.

The gap: `new URL('https://host/repo.git?access_token=secret')` puts the token in `url.search`, not `url.username`/`url.password`. The current (1) returns `false`. The token is written to disk and echoed in every display path.

## Goals / Non-Goals

**Goals:**

- `remoteCarriesCredentials` detects credentials in query string AND fragment, not just userinfo.
- `redactRemote` never echoes the raw value of a detected credential — not the query, not the fragment, not the userinfo password.
- The wrong test is flipped: `?token=`, `?access_token=` are now correctly rejected.
- Legitimate credential-free remotes (plain https, SSH `git@host:`, `ssh://`, `file://`, local paths) are unaffected.
- Each regression test is deterministically red on `728688ba` and green after the fix.

**Non-Goals:**

- Changing the clone execution path (clone already rejects userinfo credentials before invoking git).
- Building an allowlist of "safe" query parameter names (default-deny is simpler and safer; see D1).
- Sanitizing/removing credentials from already-written Store metadata files on disk (the write-path guard prevents new writes; existing data is a separate migration concern).
- Changing the `StoreError` diagnostic shape or error code (`store_remote_credentials`).

## Decisions

### D1: Default-deny on ANY non-empty query or fragment (not a denylist)

**Decision:** `remoteCarriesCredentials` returns `true` when `url.search !== ''` OR `url.hash !== ''`, regardless of parameter names.

**Rationale:**
- Git clone URLs never legitimately carry query strings or fragments. `git clone` uses `--branch` for branch selection, not URL fragments. A codebase-wide search for `.git?` found zero matches.
- The only real-world query-bearing git URLs are deploy tokens (`?private_token=`, `?token=`), signed URLs (`?Signature=`, `?expires=`), and cloud-provider auth (`?access_token=`). All are credentials.
- A denylist of parameter names (`token`, `access_token`, `key`, `signature`, ...) is fragile: a novel parameter name bypasses it, and the list grows with every cloud provider's convention. Default-deny cannot be bypassed by renaming a parameter.

**Alternative considered — denylist of known credential parameter names:** Rejected because (a) incomplete coverage for novel names, (b) false sense of security, (c) requires ongoing maintenance as new auth schemes appear.

**Alternative considered — allowlist of known-safe parameter names:** Rejected because there are no known-safe query parameters in git clone URLs. An empty allowlist is equivalent to default-deny.

### D2: redactRemote drops search/hash and appends `?<redacted>`

**Decision:** When credentials are detected, the redacted form is:
```
${url.protocol}//[<redacted>@]${url.host}${url.pathname}[?<redacted>]
```
- `<redacted>@` appears only when userinfo credentials were detected.
- `?<redacted>` appears only when `url.search` or `url.hash` was non-empty.
- The raw `url.search` and `url.hash` values are NEVER included in the output.

**Examples:**
| Input | Redacted output |
|---|---|
| `https://user:secret@host/repo.git` | `https://<redacted>@host/repo.git` |
| `https://token@host/repo.git` | `https://<redacted>@host/repo.git` |
| `https://host/repo.git?token=abc` | `https://host/repo.git?<redacted>` |
| `https://host/repo.git?token=abc#frag` | `https://host/repo.git?<redacted>` |
| `https://token@host/repo.git?secret=1` | `https://<redacted>@host/repo.git?<redacted>` |

**Current bug:** The existing code at line 44 includes `${url.search}${url.hash}` in the output — so even when userinfo credentials ARE detected, any query-string secret is echoed alongside the redacted userinfo.

### D3: Keep the unparseable-remote passthrough unchanged

**Decision:** scp-style SSH (`git@github.com:org/repo.git`), local paths (`/srv/repos/team.git`), and other values that `new URL()` cannot parse continue to pass through `remoteCarriesCredentials` as `false` and `redactRemote` as verbatim. The file header comment already documents this design choice: "an unparseable value is passed through unchanged rather than guessed at." These forms carry no query strings or fragments by definition (they're not URLs), so the default-deny policy does not affect them.

## Risks / Trade-offs

- **[False positive on a hypothetical legitimate query param]** → If a future git hosting platform introduces a non-credential query parameter in clone URLs, default-deny would reject it. This is extremely unlikely (git's URL spec has no query-param semantics), and the rejection error names the credential-free alternative, so the user knows what to do. The trade-off favors security: a false positive is a clear error message, while a false negative is a silently leaked credential.
- **[Existing Store metadata with query-param URLs]** → This fix prevents NEW writes of credential-bearing URLs. Stores that already recorded one before the fix will have the credential on disk. The read-path callers (`migration-ops.ts`, `operations.ts`) now correctly suppress these remotes from display/output. A separate cleanup/migration is out of scope.
- **[Test expects old behavior]** → The existing test at `remote.test.ts:51-73` explicitly documents and asserts the vulnerable behavior. Flipping it is a breaking change to the test contract, which is the intended fix. The test's comment block (lines 10-13, 52-56) explaining why `?token` is "not a credential" is also removed.
