## 1. Product fix — Windows agent-CLI spawn (class a, D1)

- [x] 1.1 Add a Windows-aware spawn in `src/core/management-api/supervisor.ts`: when `process.platform === 'win32'` and `path.extname(bin).toLowerCase()` is `.cmd`/`.bat`, spawn `process.env.ComSpec || 'cmd.exe'` with `['/d','/s','/c', bin, ...argv]` and `{ shell:false, windowsHide:true }`; else keep the current direct `spawn(bin, argv, {shell:false, ...})`. Preserve `detached`, `stdio`, `env`, and the existing `try/catch` → 503 behavior for a genuinely unresolvable/erroring binary.
- [x] 1.2 Confirm `503 agent_cli_unavailable` is still produced only when no agent CLI resolves (resolver returns null), not for `.cmd`/`.bat` shim types. Do not alter `resolveAgentCliBin`/`candidateNames`.
- [x] 1.3 Verify tree-kill still reaps the descendant when the tracked pid is `cmd.exe` (the agent runs as its child): `killProcessTree(child.pid)` via `taskkill /T` covers the tree. Add/adjust no product behavior unless a leak is observed.

## 2. Test harness — cross-platform fixtures (class b, D2)

- [x] 2.1 Provide a Windows-spawnable fake CLI: add a `.cmd` wrapper (`@node "<abs>/session-fake-cli.mjs" %*`) resolution so that on win32 `RASEN_CLAUDE_BIN` / `resolveAgentCli` point at the wrapper, and on POSIX at the `.mjs`. Apply in `supervisor.test.ts`, `sessions-api.test.ts`, `server-shutdown.test.ts`, and `daemon-lifecycle.test.ts`.
- [x] 2.2 Update the `session-fake-cli.mjs` header comment (lines 9-10) to stop asserting POSIX direct-exec; document the Windows `.cmd` wrapper contract.
- [x] 2.3 Run `supervisor.test.ts`, `sessions-api.test.ts`, `server-shutdown.test.ts` on Windows; confirm launches now reach `ok:true`/201 and the kill/concurrency/tail assertions pass. Re-confirm the `PATH=''` → 503 test still passes.

## 3. Test harness — Windows-safe teardown (class b, D3)

- [x] 3.1 Add a shared test helper `removeDirWithRetry(dir)` (bounded retries + short backoff on `EPERM`/`EBUSY`/`ENOTEMPTY`) and use it in `submit.test.ts`'s `afterEach` (`:30`) in place of the bare `fs.rmSync`. Confirm the `504 cli_timeout` test passes (the 504 logic already does).
- [x] 3.2 Apply the same helper to any daemon-lifecycle / ui-launch teardown that removes a temp dir a dying child may still hold.

## 4. Test harness — platform-aware diagnostics (class b, D4)

- [x] 4.1 In `test/utils/file-system.test.ts` (`:282-286`, `:311-312`), assert the platform's actual `canWriteFile` diagnostic: on win32 the "Path component … exists but is not a directory" message (and drop `toContain(filePath)`, which is the parent on Windows); else the `ENOTDIR` "Unable to determine write permissions …" message. No product change to `file-system.ts`.

## 5. Timeouts / kill grace — evidence-gated (class c, D5)

- [x] 5.1 After tasks 1-3 land, re-run `daemon-lifecycle.test.ts` and `ui-launch-stale-replace.test.ts`. Capture whether the 10s hook timeouts are resolved.
- [x] 5.2 If a residual timeout remains, attribute it (Windows `taskkill /T` grace vs spawn overhead) with evidence, then either inject a short `killGraceMs` in the affected test path (preferred, test-scoped) or tighten the Windows grace / escalate `/F /T` sooner in `kill-tree.ts` (only if it also benefits real `daemon stop`). Do not blanket-bump timeouts.

## 6. Validate

- [x] 6.1 Run the full 8-file set on Windows; confirm all target failures are green except `command-file-id.test.ts` (split; task 7).
- [x] 6.2 Run the broader suite to confirm no POSIX regressions from the spawn/fixture/teardown changes.
- [x] 6.3 `rasen validate fix-management-api-windows --strict`.

## 7. Split — out of scope here

- [x] 7.1 Do NOT fix `test/core/command-generation/command-file-id.test.ts` in this change. Hand it to the expert-install-flip owners: the test passes a raw workflow list where `hasToolProfileOrDeliveryDrift` now requires the closure-resolved desired set (`profile-sync-drift.ts:129-136`); it fails cross-platform, not just on Windows.
