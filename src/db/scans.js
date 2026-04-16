import { randomUUID } from 'node:crypto';
import { getDb } from './index.js';

export function startScan() {
  const db = getDb();
  const id = randomUUID();
  db.prepare('INSERT INTO scans (id, started_at) VALUES (?, ?)').run(id, new Date().toISOString());
  return id;
}

export function finishScan(id, { accountsScanned, eventsFound }) {
  const db = getDb();
  db.prepare(`
    UPDATE scans SET completed_at = ?, accounts_scanned = ?, events_found = ?
    WHERE id = ?
  `).run(new Date().toISOString(), accountsScanned, eventsFound, id);
}
