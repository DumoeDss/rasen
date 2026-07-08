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

## Step 4 — Permanent rollup store (D1) + daily cron + backfill

Analytics Engine only retains raw events on a ~90-day rolling window. A D1
database (`rasen-telemetry-rollups`, binding `ROLLUPS`) holds **day-grained
aggregate counts** permanently, fed by a daily cron and a one-time backfill. The
store holds only aggregate counts per `(date, command, version, os,
node_version)` — never any `distinctId` (the privacy contract is unchanged).

This is already provisioned (`database_id` `6ef1574a-b82c-4433-aab4-9d719ad4524b`,
region APAC). The steps below are the reference procedure / for a rebuild.

1. **Create the database** (once):

   ```bash
   wrangler d1 create rasen-telemetry-rollups
   # copy the printed database_id
   ```

   **Fallback if this fails on a missing `d1` OAuth scope** (`wrangler` was
   authorized without D1 permissions): do NOT retry blindly. Create the database
   in the dashboard instead — **Workers & Pages → D1 SQL Database → Create** →
   name it `rasen-telemetry-rollups` → copy its **Database ID**.

2. **Wire it in `wrangler.toml`** (top-level tables, alongside the existing
   config — do not disturb `workers_dev`, `routes`, `[assets]`, or `[vars]`):

   ```toml
   [[d1_databases]]
   binding = "ROLLUPS"
   database_name = "rasen-telemetry-rollups"
   database_id = "<database_id from step 1>"

   [triggers]
   crons = ["0 1 * * *"]   # 01:00 UTC daily — aggregates the prior UTC day
   ```

3. **Apply the schema** (create the `rollups` table):

   ```bash
   # optional local iteration first: add --local
   wrangler d1 execute rasen-telemetry-rollups --remote --file migrations/0001_rollups.sql
   ```

4. **Deploy** — this activates the `scheduled` handler, the backfill route, and
   the stats-v2 hot/cold layers:

   ```bash
   wrangler deploy
   # deploy output must list `schedule: 0 1 * * *`
   ```

5. **One-time historical backfill** — seed the store with all history currently
   retained in Analytics Engine (before daily rollups began). This is a
   maintainer-only endpoint behind the same Access gate, so invoke it **from a
   browser signed into Cloudflare Access** (or any client that carries a valid
   `Cf-Access-Jwt-Assertion`):

   ```
   POST https://telemetry.rasen.io/api/admin/backfill
   ```

   From the signed-in panel's origin you can run it in the browser devtools
   console:

   ```js
   await fetch('/api/admin/backfill', { method: 'POST' }).then(r => r.json())
   // → { ok: true, days: <N>, rows: <M> }
   ```

   It is idempotent (shares the daily rollup's key tuple + UPSERT), so re-running
   it never double-counts. Unauthenticated requests return `403`.

6. **Verify rows landed:**

   ```bash
   wrangler d1 execute rasen-telemetry-rollups --remote \
     --command "SELECT date, count(*) AS tuples, SUM(events) AS events FROM rollups GROUP BY date ORDER BY date"
   ```

   After the backfill (or the first 01:00 UTC cron), this lists one or more days
   with tuple/event counts.

> Note: `wrangler dev --test-scheduled` cannot exercise the rollup against real
> data locally — the `TELEMETRY_SQL_TOKEN` secret lives only on the deployed
> Worker (remote-dev previews do not carry `wrangler secret put` secrets). Trust
> the daily cron / the authenticated backfill for real population; the unit tests
> cover the aggregation and UPSERT-idempotency logic.

---

## Quick reference — what each missing piece does

| Missing                                   | Effect                                            |
| ----------------------------------------- | ------------------------------------------------- |
| `ACCESS_TEAM_DOMAIN` / `ACCESS_AUD`       | all admin paths → `403` (fail-closed)             |
| `TELEMETRY_SQL_TOKEN`                     | hot-layer `/api/admin/*` → `503` with hint (panel notice) |
| `ROLLUPS` D1 binding                      | cold-layer (`range=all`) reads → `503`; ingest + hot layer unaffected |
| `[triggers] crons`                        | no daily rollup; cold store stops growing (backfill still works) |
| `rasen.io` zone not Active                | admin reachable only via `workers.dev` (still gated) |
