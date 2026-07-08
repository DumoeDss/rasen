# openspec-telemetry — operator runbook

The admin console ships **fail-closed and inert**: after `wrangler deploy` the
ingest path works, and every admin path returns `403` until you complete the two
manual Cloudflare steps below. Nothing here is a code change — it is Cloudflare
dashboard + `wrangler` configuration.

- Worker: `openspec-telemetry` · account `5cc51d8388c780c03fb4c6161bd403c4`
- Live: `https://openspec-telemetry.ws11579.workers.dev`
- Target admin host (custom domain): `https://telemetry.rasen.io/admin`

Run all `wrangler` commands from `telemetry-backend/`.

---

## Step 1 — Stats read token (`TELEMETRY_SQL_TOKEN`)

The admin stats API reads Analytics Engine through the Cloudflare SQL API, which
needs a token **separate** from your Workers deploy credential.

1. Cloudflare dashboard → **My Profile** → **API Tokens** → **Create Token**.
2. Choose **Create Custom Token** → **Get started**.
3. Name it e.g. `openspec-telemetry-sql-read`.
4. Under **Permissions** add: **Account** → **Account Analytics** → **Read**.
5. Under **Account Resources** select your account
   (`5cc51d8388c780c03fb4c6161bd403c4`).
6. **Continue to summary** → **Create Token** → copy the token value (shown once).
7. Store it as a Worker secret:

   ```bash
   wrangler secret put TELEMETRY_SQL_TOKEN
   # paste the token when prompted
   ```

Until this exists, `GET /api/admin/*` returns `503` with a hint (the Worker never
crashes). After setting it, the stats endpoints work for authenticated requests.

---

## Step 2 — Cloudflare Access application (`ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`)

This gates the admin surface at the edge and gives the Worker the values it needs
to verify the Access JWT.

1. Cloudflare dashboard → **Zero Trust**. Note your **team domain** on the
   **Settings → Custom Pages / General** screen — it looks like
   `your-team.cloudflareaccess.com`. This is `ACCESS_TEAM_DOMAIN` (the full host,
   including `.cloudflareaccess.com`).
2. **Zero Trust** → **Access** → **Applications** → **Add an application** →
   **Self-hosted**.
3. Application configuration:
   - **Application name:** `openspec-telemetry admin`
   - **Session duration:** your preference (e.g. 24h).
   - **Application domain:** TWO rows are REQUIRED (the Worker verifies the
     edge-injected `Cf-Access-Jwt-Assertion` header only, and `/api/admin` is
     NOT under the `/admin` path prefix — without the second row the panel
     loads but every stats request returns 403):
     - Row 1: subdomain `telemetry`, domain `rasen.io`, path `admin`
     - Row 2: subdomain `telemetry`, domain `rasen.io`, path `api/admin`
4. **Add a policy:**
   - **Policy name:** `maintainer`
   - **Action:** **Allow**
   - **Include** → **Emails** → `ws11579@gmail.com`
5. Save the application. Open it again → copy the **Application Audience (AUD)
   Tag** (a long hex string). This is `ACCESS_AUD`.
6. Set both as Worker vars and redeploy:

   ```bash
   # Either edit wrangler.toml [vars] (ACCESS_TEAM_DOMAIN / ACCESS_AUD) and deploy,
   # or set them without editing the file:
   wrangler deploy \
     --var ACCESS_TEAM_DOMAIN:your-team.cloudflareaccess.com \
     --var ACCESS_AUD:<application-aud-tag>
   ```

   (Editing `wrangler.toml` `[vars]` and running `wrangler deploy` is equivalent
   and persists the values in the repo.)

**Optional defense-in-depth** — pin the allowed email inside the Worker too
(atop the Access policy) by setting `ACCESS_ALLOWED_EMAILS` (JSON array or
comma-separated), e.g. `--var ACCESS_ALLOWED_EMAILS:'["ws11579@gmail.com"]'`.
When unset, a valid Access JWT for this AUD is sufficient because the Access
policy already restricts to your email.

### Verify

After Step 2, from a browser signed into Cloudflare Access, visit
`https://telemetry.rasen.io/admin` — you should get the panel. Unauthenticated
requests (e.g. `curl https://openspec-telemetry.ws11579.workers.dev/admin`) must
still return `403`.

---

## Step 3 — Custom domain `telemetry.rasen.io` (DONE — live 2026-07-09)

> Already attached and live: the route is set in `wrangler.toml` (`routes = [{ pattern
> = "telemetry.rasen.io", custom_domain = true }]` with `workers_dev = true`), the
> zone is Active, the edge TLS cert is provisioned, and the host is verified
> end-to-end (POST / → 202, GET /admin → 403). The steps below are the reference
> procedure / for re-attaching after a rollback.

The `rasen.io` zone must be **Active** on Cloudflare (NS propagation complete):

```bash
nslookup -type=NS rasen.io    # Active when the answer lists *.ns.cloudflare.com
```

When Active:

1. In `wrangler.toml`, uncomment the route line:

   ```toml
   routes = [{ pattern = "telemetry.rasen.io", custom_domain = true }]
   ```

2. `wrangler deploy`.
3. Smoke: `https://telemetry.rasen.io/` ingest → `202`; `/admin` → `403` before
   Step 2 is done, panel after.

Leave the route **commented** until the zone is Active — deploying the route
against an inactive zone fails. `workers.dev` keeps serving regardless.

---

## Quick reference — what each missing piece does

| Missing                                   | Effect                                            |
| ----------------------------------------- | ------------------------------------------------- |
| `ACCESS_TEAM_DOMAIN` / `ACCESS_AUD`       | all admin paths → `403` (fail-closed)             |
| `TELEMETRY_SQL_TOKEN`                     | `/api/admin/*` → `503` with hint (panel notice)   |
| `rasen.io` zone not Active                | admin reachable only via `workers.dev` (still gated) |
