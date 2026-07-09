## 1. npm publish job in release.yml

- [x] 1.1 Add a `publish-npm` job to `.github/workflows/release.yml` with `needs: release`, `permissions: { contents: read, id-token: write }`, and `actions/setup-node@v4` configured with `registry-url: 'https://registry.npmjs.org'`.
- [x] 1.2 Gate publication on `NPM_TOKEN`: add an early step that reads `secrets.NPM_TOKEN` into an env var, sets a step output (present/absent), and — when absent — emits a `::notice::` "npm publish skipped — NPM_TOKEN not set" and skips the publish step (release stays green).
- [x] 1.3 Add the publish step (conditioned on the token-present output) running `pnpm install --frozen-lockfile`, `pnpm build`, then `npm publish --provenance --access public` with `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}`; version is read implicitly from `package.json` (no tag parsing, no bump).
- [x] 1.4 Static-verify `release.yml` parses as valid YAML (`node -e` with a YAML load, or `python -c` yaml.safe_load) and review job wiring: `needs: release`, job-scoped `id-token: write`, no committed `.npmrc`, tarball job unchanged.
- [x] 1.5 Confirm against the spec: publish runs after tarball (Scenario "Publish runs after a successful tarball build"), version from package.json, graceful skip on missing token, loud failure on a configured-but-failing publish.

## 2. CI node-version coverage in ci.yml

- [x] 2.1 Add a `node` field to each existing `test_matrix` include, set to the floor `20.19.0`, and wire `actions/setup-node@v4`'s `node-version` to `${{ matrix.node }}` (replacing the hardcoded `'20.19.0'`).
- [x] 2.2 Add one `ubuntu-latest` matrix leg at the current Node major (pin the concrete latest LTS at implementation time, e.g. `22.x`/`24.x`) with a distinct `label` (e.g. `linux-bash-node22`), `shell: bash`, and `vitest_workers: 4`; leave the Windows leg's `vitest_workers: 2` untouched.
- [x] 2.3 Static-verify `ci.yml` parses as valid YAML and that matrix `label` values are unique so status-check names don't collide; confirm the aggregate gates (`test_pr_required`, `required-checks-*`) still key on whole-matrix `result` and need no change.
- [x] 2.4 Confirm against the spec: floor covered on all three OSes, current-major covered on Linux with a distinct label, added leg is Linux with the standard worker cap (Windows flake surface untouched).

## 3. Codify the Nix pnpm-hash freshness guarantee

- [x] 3.1 Static-review `ci.yml`'s `nix-flake-validate` job to confirm `nix build` runs before any hash-recompute/restore step, so a stale `pnpmDeps.hash` (mismatch vs `pnpm-lock.yaml` via `fetchPnpmDeps`) fails the job. No workflow edit expected — this task verifies the guarantee the spec now pins.
- [x] 3.2 If the review finds the guarantee is NOT actually enforced (e.g., `nix build` is skipped or the fetch is cached around), record the gap and adjust `ci.yml` minimally to enforce it; otherwise record that the existing job already satisfies the added scenario.
- [x] 3.3 Confirm the design's documented maintainer recheck path (run `scripts/update-flake.sh` on a Nix host; CI is the backstop) is accurate against the current `scripts/update-flake.sh` and `flake.nix` (`pnpmDeps.hash` at flake.nix:54, dynamic version at flake.nix:30). No local hash recomputation (no Nix on this host).

## 4. Telemetry production endpoint verification

- [x] 4.1 Probe TLS/reachability: `curl -sv https://telemetry.rasen.io/` (apply the proxy caveat — try direct, then `--noproxy '*'` or the configured proxy per network). Capture the full `-v` transcript (cert issuer/validity, HTTP status) to `workDir/research/`.
- [x] 4.2 Synthetic ingest probe: POST a well-formed event `{command, version, distinctId, os, node_version}` to the endpoint and record the HTTP status (expect 202). Save the command and response to `workDir/research/`.
- [x] 4.3 Real CLI event: run a genuine `rasen` command in a shell with telemetry enabled (`RASEN_TELEMETRY` unset, not `CI=true`) and confirm the CLI exits promptly with no surfaced network error; record the outcome.
- [x] 4.4 TLS is live (not provisioning) — verified 2026-07-09/10: both proxied and direct probes returned valid TLS + `Server: cloudflare`, and the synthetic probe returned 202. No pending-dependency note needed; endpoint-contract scenario is verified-live. Evidence: `work/research/4.0-telemetry-verification-summary.md`.

## 5. Validate and finalize

- [x] 5.1 Run `node dist/cli/index.js validate phase-c-infra-hardening` until clean.
- [x] 5.2 Re-run `git status` on `.github/workflows/ci.yml`, `.github/workflows/release.yml`, and the spec files to confirm no concurrent-session edits crept in before ship; ship in `local` mode with explicit `git commit -- <paths>` + `git show --stat` review (never `git add -A`). Status re-checked clean (only `.github/workflows/ci.yml` and `release.yml` modified, no foreign edits). Ship itself is deferred to the ship-stage worker per instructions — no commit made here.
