## Context

Phase C hardens Rasen's release/CI/telemetry infrastructure so a single `rasen-v*` tag ships both GitHub Release and npm, and so guarantees that hold today survive future edits. The LEAD-seeded planning-context framed four items (#7 npm publish, #8 flake hash recheck, #10 telemetry TLS/e2e, #11 CI matrix backfill). **Verifying the tree against that framing surfaced two material discrepancies that reshape scope:**

1. **CI OS matrix is already complete.** `ci.yml` already runs a 3-OS matrix (`ubuntu-latest`, `macos-latest`, `windows-latest`) with per-OS `VITEST_MAX_WORKERS` (Windows capped at 2 — the deliberate softener for the known EBUSY flake). "Matrix backfill" for OS is done. The only genuine remaining interpretation is node-version coverage.
2. **The Nix pnpm-hash check is already enforced in CI.** `ci.yml`'s `nix-flake-validate` job runs `nix build` first; `fetchPnpmDeps` re-fetches against `pnpm-lock.yaml`, so a stale `pnpmDeps.hash` makes `nix build` fail and the job fail. The subsequent `update-flake.sh` + diff steps are informational (the "Check flake.nix modifications" step never exits non-zero and `Restore flake.nix` runs `git checkout -- flake.nix`). So item #8 needs **no new code** — the guarantee exists but is uncodified.

Net: the one genuine code gap is the npm publish job (#7). The other three items are best served by node-version coverage (#11), a codified regression guard (#8), and end-to-end verification (#10). This keeps the change honest and un-gold-plated.

Constraints (from planning-context, all verified against the tree): shared working tree with concurrent sessions (no external edits currently staged on `ci.yml`/`release.yml`/`flake.nix`/`src/telemetry/`); 26+ unpushed local commits so **no tag can be pushed** — `release.yml` is static-verified only; ship in `local` mode with explicit `git commit -- <paths>`; Phase A/B owns version/CHANGELOG/docs/specs-branding/push.

## Goals / Non-Goals

**Goals:**
- One `rasen-v*` tag push produces both a GitHub Release tarball and an npm registry publish (once `NPM_TOKEN` is configured).
- The npm publish is version-agnostic (reads `package.json`), supply-chain-hardened (provenance), and never turns a release red merely because `NPM_TOKEN` is absent.
- The declared `engines.node >= 20.19.0` support range is verified at both the floor and the current Node major.
- The existing Nix hash-freshness and OS-matrix guarantees are pinned by spec so a future edit that drops them is caught in review.
- The production telemetry endpoint (`telemetry.rasen.io`) is verified end-to-end with recorded evidence, degrading gracefully if TLS is still provisioning.

**Non-Goals:**
- No push, tag, GitHub Release, or `npm publish` execution — all release-workflow changes are static-verified (the CLI is not on PATH, and there are 26+ unpushed commits; a live tag trigger is impossible and out of scope).
- No changes to `package.json` version, CHANGELOG, README, `docs/`, or `rasen/specs` mixed-wording — those belong to the concurrent Phase A/B session.
- No telemetry source change: `src/telemetry/index.ts` already targets the correct endpoint with a sound fire-and-forget `node:https` design.
- No full 3-OS × N-node matrix explosion (gold-plating); bracket the range, don't carpet it.

## Decisions

### Decision 1 — npm publish job in `release.yml`

**Shape: a separate `publish-npm` job with `needs: release`.** Chosen over appending steps to the existing tarball job because the publish needs a different permission (`id-token: write` for provenance) that the tarball job should not carry, and a distinct job name surfaces publish status independently in the Actions UI. `needs: release` gates publish on a successful build+pack of the same commit, so a broken build never publishes.

**Version handling: version-agnostic.** `npm publish` publishes whatever version is in `package.json`; no version input, tag parsing, or bump. This sidesteps the 0.1.0-vs-0.1.1 concern entirely (Phase A owns the version), and the existing `check:pack-version` guard already asserts the packed CLI `--version` matches `package.json`.

**Missing-secret behavior: graceful skip with a loud `::notice::`, not hard fail.** Rationale: the GitHub Release tarball is the primary, always-available artifact; npm is the secondary channel. A maintainer who pushes a tag before configuring `NPM_TOKEN` should get a green release with a visible "npm publish skipped — NPM_TOKEN not set" annotation, not a red X that looks like a build break. To keep the skip from being *silent* (the real failure mode — "why isn't it on npm?"), the gate emits a workflow notice that appears in the run summary. Implemented as an early step that checks `secrets.NPM_TOKEN` via an env var and sets a step output; the publish step runs only when the token is present.
- _Alternative considered — hard fail on missing token:_ rejected. It couples a secondary channel's config to the primary channel's success and would have made the fork's very first tagged release (before any npm setup) look broken.

**Provenance + access: `npm publish --provenance --access public`, with `id-token: write`.** Provenance is free on public GitHub-hosted runners via OIDC and gives supply-chain attestation; `--access public` is explicit even though `publishConfig.access: public` already sets it (harmless, self-documenting). Requires `permissions: { contents: read, id-token: write }` on the job.

**Registry auth: `.npmrc` written at job runtime** with `//registry.npmjs.org/:_authToken=${NPM_TOKEN}` (or `setup-node`'s `registry-url` + `NODE_AUTH_TOKEN`). Use `actions/setup-node` `registry-url: 'https://registry.npmjs.org'` and `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}` — the standard, secret-safe pattern; no `.npmrc` is committed.

### Decision 2 — flake.nix pnpmDeps.hash (#8): codify, do not fabricate

**No local hash recomputation is invented.** This machine is Windows with no Nix; `scripts/update-flake.sh` requires `nix build`. Fabricating a "local verification" would be dishonest. The genuinely-useful, already-existing verification is the CI `nix-flake-validate` job: `nix build` re-fetches deps against `pnpm-lock.yaml` and fails on a stale hash.

**Action: add a scenario to `ci-nix-validation` pinning that a stale `pnpmDeps.hash` fails CI**, so a future reordering (e.g., moving `update-flake.sh` before `nix build`, or caching around the fetch) that would mask staleness is caught in spec review. The documented maintainer recheck path (run `scripts/update-flake.sh` on a Nix machine; CI is the backstop) lives here in design, not in a new doc file (docs/ is Phase A/B territory).
- _Alternative considered — a dedicated CI job that runs `update-flake.sh` and fails on any diff:_ rejected as redundant. `nix build` already fails on staleness; a diff-failing job would duplicate the signal and fight the existing "informational, then restore" design.

### Decision 3 — CI matrix backfill (#11): node-version bracketing only

**OS matrix is already complete; add exactly one node-version leg.** Keep the three existing legs (ubuntu/macos/windows) at the `engines` floor **Node 20.19.0**, and add **one `ubuntu-latest` leg at the current Node major** (e.g., `22.x` or `24.x` — pin the concrete latest LTS at implementation time) to verify the top of the declared `>=20.19.0` range. This brackets the support range at both ends for the cost of one extra leg.
- _Alternative considered — full 3-OS × 3-node matrix (9 legs):_ rejected as gold-plating. Rasen is a CLI with a modest Node-API surface; cross-OS behavior (the real risk, per the EBUSY history) is already covered per-OS, and node-major differences are overwhelmingly OS-independent, so a single Linux leg at the new major captures ~all the marginal signal.
- **EBUSY note:** the new leg is Linux, not Windows, so it does not touch the Windows EBUSY flake surface; the existing Windows leg keeps its `vitest_workers: 2` cap. The added leg should carry the standard Linux `vitest_workers: 4`.
- **Matrix bookkeeping:** the extra leg needs a distinct `label` (e.g., `linux-bash-node22`) so the `test_matrix` display names stay unique; the aggregate `Test` / `All checks passed` gates already key on `needs.test_matrix.result` (whole-matrix success) so they need no change.

### Decision 4 — Telemetry TLS + e2e (#10): verification, with a codified endpoint contract

**This is a verification task, not a code change.** The apply stage will, from this machine (honoring the proxy caveat — direct `rasen.io` may need `--noproxy '*'` or a proxy per network, per the workers.dev history):
1. **TLS/reachability probe:** `curl -sv https://telemetry.rasen.io/` capturing the TLS handshake (cert chain, issuer, validity) and HTTP status. Record verbatim to the work directory.
2. **Synthetic ingest probe:** `POST` a well-formed event (`{command, version, distinctId, os, node_version}`) and confirm a **202** (the Worker returns 202 even on internal error by design, so 202 confirms the endpoint terminates TLS and routes to the Worker — the client-observable contract).
3. **One real CLI-emitted event:** run a real `rasen` command with telemetry enabled (i.e., not in a `CI=true` shell, `RASEN_TELEMETRY` unset) and confirm the CLI exits promptly (the fire-and-forget/guard-timer contract) with no surfaced network error. Client-side receipt is unobservable by design (fire-and-forget, no receipt) — **dashboard confirmation that the event landed is explicitly the user's step**, recorded as such.

**Evidence recorded** to `workDir/research/`: the `curl -v` transcript, the synthetic POST status, and the CLI-run outcome.

**Graceful outcome if TLS is still provisioning** (it was as of 2026-07-09): do **not** block the change on Cloudflare's timeline. Record the probe result (e.g., cert-not-yet-valid / handshake failure) as a **known pending external dependency** in the ship notes, mark the endpoint-contract scenario as verified-pending, and let the change archive. The spec requirement is written so the *verification obligation* (probe + record) is what must be satisfied, not Cloudflare's provisioning state.
- _Alternative considered — block archive until a live 202:_ rejected; it hostages a code-complete change to an external TLS queue and the client already degrades safely (fire-and-forget) if the endpoint is down.

## Risks / Trade-offs

- **[Static-only verification of `release.yml` — the publish job is never actually run]** → Mitigation: validate YAML structure and job wiring (`needs`, permissions, secret gating) by review + a YAML parse; assert the pattern matches the canonical `setup-node` + `NODE_AUTH_TOKEN` publish recipe. The first real exercise is the user's first tag push (Phase A) — call this out in ship notes as the one unavoidable live-untested seam.
- **[Silent-skip masking a genuine npm outage]** → Mitigation: the skip is gated only on *token presence*, not on publish success; if the token is present and `npm publish` fails, the job fails loudly. Only the unconfigured-token path skips, and it emits a visible notice.
- **[Provenance requires `id-token: write` and OIDC]** → Mitigation: scope the permission to the `publish-npm` job only (not workflow-wide); provenance is a no-op-safe flag on public repos. If a future private-repo move breaks OIDC, provenance can be dropped without touching the publish logic.
- **[Added node leg increases CI minutes]** → Mitigation: one Linux leg only (~cheapest runner); `fail-fast: false` already isolates it so it can't cascade-cancel the floor legs.
- **[Telemetry endpoint TLS may still be provisioning at apply time]** → Mitigation: designed-in graceful outcome (record status, don't block); the verification obligation is satisfiable regardless of Cloudflare state.
- **[Shared working tree — clobbering another session's edits]** → Mitigation: `git status` before editing each target (done: no external edits on `ci.yml`/`release.yml` currently); ship with explicit `git commit -- .github/workflows/ci.yml .github/workflows/release.yml <spec paths>` + `git show --stat` review; never `git add -A`.

## Migration Plan

Deploy is inert until the user acts:
1. Merge/land the workflow edits locally (Phase C ship = `local` mode, no push).
2. **User (Phase A)** pushes the accumulated commits and configures the `NPM_TOKEN` repository secret.
3. **User (Phase A)** pushes a `rasen-v<version>` tag → `release.yml` builds the tarball (existing) and, with the token present, publishes to npm with provenance (new).
- **Rollback:** revert the `publish-npm` job (tarball job is untouched and independent); revert the extra matrix leg (a pure addition). Both are additive and independently reversible.

## Open Questions

- **Concrete newest Node major for the matrix leg** — pin the current latest LTS (22.x vs 24.x) at implementation time against what `actions/setup-node` resolves; not load-bearing for the design.
- **Telemetry TLS provisioning state at apply time** — unknown until probed; the change is designed to proceed either way.
