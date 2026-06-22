export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS events (
  id              TEXT PRIMARY KEY,
  account         TEXT NOT NULL,
  source_type     TEXT NOT NULL CHECK (source_type IN ('story', 'post')),
  source_id       TEXT NOT NULL,
  source_id_kind  TEXT NOT NULL CHECK (source_id_kind IN ('url_mediaid', 'time_hash', 'shortcode')),
  story_taken_at  TEXT,
  event_name      TEXT,
  event_date      TEXT,
  event_time      TEXT,
  venue           TEXT,
  description     TEXT,
  ticket_url      TEXT,
  confidence      TEXT,
  screenshot_path TEXT,
  raw_response    TEXT,
  found_at        TEXT NOT NULL,
  merged_into     TEXT
);

CREATE INDEX IF NOT EXISTS idx_events_account     ON events(account);
CREATE INDEX IF NOT EXISTS idx_events_event_date  ON events(event_date);
CREATE INDEX IF NOT EXISTS idx_events_found_at    ON events(found_at);

CREATE TABLE IF NOT EXISTS seen (
  source_id       TEXT PRIMARY KEY,
  source_id_kind  TEXT NOT NULL,
  account         TEXT NOT NULL,
  source_type     TEXT NOT NULL CHECK (source_type IN ('story', 'post')),
  story_taken_at  TEXT,
  scanned_at      TEXT NOT NULL,
  was_event       INTEGER NOT NULL DEFAULT 0,
  error           TEXT
);

CREATE INDEX IF NOT EXISTS idx_seen_account ON seen(account);

CREATE TABLE IF NOT EXISTS scans (
  id                TEXT PRIMARY KEY,
  started_at        TEXT NOT NULL,
  completed_at      TEXT,
  accounts_scanned  INTEGER DEFAULT 0,
  events_found      INTEGER DEFAULT 0
);
`;
