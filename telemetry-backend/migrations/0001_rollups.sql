-- Cold store for permanent day-grained telemetry rollups.
--
-- Privacy contract: this table holds ONLY aggregate counts. There is no
-- distinctId/IP/path/arg column and there never must be — the rollup queries
-- select dimensions + aggregate functions only.
--
-- Idempotency: the composite primary key + UPSERT (see src/rollups.ts) means a
-- cron re-run or a backfill overlapping the same day replaces counts in place
-- rather than double-counting. Empty dimension values are normalized to '' on
-- write so the key stays stable (Analytics Engine returns '' for absent blobs).

CREATE TABLE IF NOT EXISTS rollups (
  date         TEXT NOT NULL,   -- 'YYYY-MM-DD' (UTC day)
  command      TEXT NOT NULL,
  version      TEXT NOT NULL,
  os           TEXT NOT NULL,
  node_version TEXT NOT NULL,
  events       INTEGER NOT NULL,
  users        INTEGER NOT NULL,  -- approximate (sampled distinct; NOT additive across days)
  PRIMARY KEY (date, command, version, os, node_version)
);
