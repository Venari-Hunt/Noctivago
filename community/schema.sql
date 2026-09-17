-- Community presets (D1). Apply with:
--   npx wrangler d1 execute noctivago-community --remote --file=schema.sql
-- (use --local instead of --remote for `wrangler dev`).

CREATE TABLE IF NOT EXISTS presets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  author TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  sound_count INTEGER NOT NULL,
  duration_seconds INTEGER,
  size_bytes INTEGER NOT NULL,
  downloads INTEGER NOT NULL DEFAULT 0,
  app_version TEXT,
  author_key_hash TEXT NOT NULL,
  uploader_hash TEXT NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0,
  report_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS presets_visible_new ON presets (hidden, created_at);
CREATE INDEX IF NOT EXISTS presets_visible_popular ON presets (hidden, downloads);
CREATE INDEX IF NOT EXISTS presets_author ON presets (author_key_hash);

CREATE TABLE IF NOT EXISTS reports (
  preset_id TEXT NOT NULL,
  reporter_hash TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  PRIMARY KEY (preset_id, reporter_hash)
);

-- Per-client daily counters (uploads, reports). `client` is a salted hash
-- of the caller's IP, never the IP itself.
CREATE TABLE IF NOT EXISTS rate_limits (
  client TEXT NOT NULL,
  action TEXT NOT NULL,
  day TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (client, action, day)
);
