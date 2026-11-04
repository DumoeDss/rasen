# Handoff: ecp-linux-process-authority-provider — implementer package/CI #1

## Original intent

Implement only Tasks 10.1-10.6: locked isolated Linux-provider build/export/package seams, adversarial package resolution, Windows non-runtime target evidence, unprivileged Linux CI, and manual-only protected broker wiring. Preserve the shared dirty worktree, legacy ProcessCapsule semantics, native primary/broker implementation ownership, TypeScript provider/runtime ownership, tasks, and run-state.

## Position

Pipeline: `small-feature`. Planning and the TypeScript review loop are complete; Linux native primary/broker work remains independently owned. Current stage: apply, build/package/CI slice implemented and locally verified.

## Done / Remaining

Done: implementation evidence is sufficient for LEAD review of 10.1-10.6 and the build-seam part of 3.7. The final Windows installed-target check compiles both the primary helper and unprivileged broker client. Files and exact receipts are in `evidence/implementation-package-ci-1.md`.

Remaining: LEAD must inspect and mark tasks; a fresh reviewer should review this delta; the new workflow has not been remotely run; actual Linux namespace policy, protected installed-broker/cgroup-v2, clean package matrix, closure, and ECP-8 gates remain open. Task 10.7 was intentionally not claimed.

## Key decisions (and why)

- Source `build-authority.ts` remains empty; the locked packaging script overwrites only the compiled `dist/**/build-authority.js` with exact authenticated identities. This preserves source-test fail-closed behavior and prevents mutable helper+manifest self-signing.
- Cross-target checking never emits a package authority. Only a native-Linux provenance record with the exact source/compiler may enter staged assembly.
- The npm package contains the unprivileged primary helper and broker client with separate public manifests and build identities, not the privileged broker daemon/install assets/private key/state/socket.
- Linux native build is conditional in `build.js`; Windows/macOS builds do not silently promote a Linux target. A separate Windows job produces only non-runtime compile evidence.
- Broker CI is isolated as a manual protected-environment job with exact repository/input/runner/install/cgroup/sudo checks. It ends with an explicit open Section 9 summary and is unreachable from ordinary/fork CI.
- Workflow auto-cancellation is disabled because interruption is unsafe for future protected authority operations.

## Dead ends & gotchas

- Treating the privileged broker daemon as the packaged broker client would be a false capability claim. It remains excluded.
- The broker client landed concurrently after the initial package seam. Requiring it in the package immediately exposed two native-owner compile errors (`NativeFailureCode::AuthorityUnavailable` and `AuthorityUncertain` did not exist); the exact receipt was sent to `/root/linux_broker_resume` rather than patched across ownership. That owner fixed the mapping/imports, and the final dual-binary target check passed.
- Reusing the existing WSL native receipt for this new build script would be inaccurate. The persistent isolated WSL toolchain lacks the previously temporary linker wrapper, so this worker did not mutate profiles or install a linker merely to manufacture a receipt.
- `git diff` does not show the three new untracked product/test/workflow files unless explicitly named through status or no-index inspection. Do not infer absence from a normal tracked diff.
- `rasen agent context --latest` and `--runtime codex` both returned `no-transcript` for this sibling worktree; no occupancy percentage is available.

## Eliminated hypotheses

- "A Windows cross-built helper can be staged if it has matching source/compiler text" — ruled out by the cross-built staging mutation. Current rule: check-only is non-runtime and produces no package authority; staging accepts only native-Linux provenance.
- "The common broker manifest entry requires npm to ship the root broker binary" — ruled out by the privilege/install boundary and package audit. Current rule: npm ships and pins the unprivileged broker client, while the root daemon/key/state remain an explicit administrative installation.
- "A successful broker fixture job can close the privileged gate" — ruled out by the task/spec gate partition. Current rule: even the protected manual wiring job records Section 9 as open until installed service, actual lifecycle/cgroup mutations, and security review pass.

## Working set

- `scripts/build-linux-process-authority.mjs`
- `.github/workflows/linux-process-authority.yml`
- `test/core/session-host/linux-process-authority-package-ci.test.ts`
- additive edits in `build.js` and `package.json`
- `evidence/implementation-package-ci-1.md`

No commit, push, workflow dispatch, administrative action, task edit, or run-state edit was made.

## Next action

Run a fresh path-scoped review of the five implementation files against Tasks 10.1-10.6, then let the LEAD mark only the task IDs supported by `evidence/implementation-package-ci-1.md` and fold the delta into the Linux child verification round.
