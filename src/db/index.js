import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { RADAR_DIR } from '../scanner/browser.js';
import { SCHEMA_SQL } from './schema.js';

export const DB_PATH = join(RADAR_DIR, 'radar.db');

let _db = null;

export function getDb() {
  if (_db) return _db;
  mkdirSync(RADAR_DIR, { recursive: true });
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  _db.exec(SCHEMA_SQL);
  migrate(_db);
  return _db;
}

function migrate(db) {
  const cols = db.prepare(`PRAGMA table_info(events)`).all();
  if (!cols.some((c) => c.name === 'merged_into')) {
    db.exec(`ALTER TABLE events ADD COLUMN merged_into TEXT`);
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_events_merged_into ON events(merged_into)`);
}

export function closeDb() {
  if (_db) {
    _db.close();
    _db = null;
  }
}
