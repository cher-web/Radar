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
  return _db;
}

export function closeDb() {
  if (_db) {
    _db.close();
    _db = null;
  }
}
