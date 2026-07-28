## 1. Extend credential detection to query and fragment (B4)

- [x] 1.1 In `src/core/store/remote.ts`, add to `remoteCarriesCredentials`: after the existing userinfo checks, return `true` when `url.search !== ''` OR `url.hash !== ''`. The check goes after the existing userinfo logic but before the implicit `return false`
- [x] 1.2 Fix `redactRemote` (same file, line 44): stop appending `${url.search}${url.hash}` to the output. Instead, build the redacted form to conditionally include `<redacted>@` for userinfo credentials and `?<redacted>` for non-empty search/hash, per design.md D2
- [x] 1.3 Verify `assertCredentialFreeRemote` needs no changes — it delegates to `remoteCarriesCredentials` and `redactRemote`, so it automatically gains the stricter detection and safer redaction

## 2. Flip the wrong test and add regression cases

- [x] 2.1 In `test/core/store/remote.test.ts`, replace the `describe('?token=abc query-string is NOT a credential ...')` block (lines 51-85) with a new block asserting these remotes ARE credentials: `?token=abc`, `?access_token=xyz`, `?private_token=`, `?Signature=&Expires=` (signed URL), and `#token=secret` (fragment). For each: assert `remoteCarriesCredentials === true`, assert `assertCredentialFreeRemote` throws `StoreError`, and assert `redactRemote` does NOT contain the secret value
- [x] 2.2 Add a `redactRemote` no-leak test: for `https://host.example.com/repo.git?access_token=secret`, assert the redacted output is `https://host.example.com/repo.git?<redacted>` (no `secret` substring). For `https://token@host.example.com/repo.git?private_token=xyz`, assert output is `https://<redacted>@host.example.com/repo.git?<redacted>`
- [x] 2.3 Keep the existing "passes credential-free remotes" tests unchanged — verify plain https, SSH, scp-style, and file paths still return `false` and pass through `redactRemote` verbatim
- [x] 2.4 Add the contrast test from the old suite (userinfo token IS rejected) — it should still pass unchanged

## 3. Verification

- [x] 3.1 Run `pnpm exec vitest test/core/store/remote.test.ts` in isolation — confirm all tests pass (the flipped tests are green, the legitimate-pass tests are unchanged)
- [x] 3.2 Run `pnpm exec tsc --noEmit` — confirm no type errors
- [x] 3.3 Run `pnpm lint` on changed files — confirm clean
