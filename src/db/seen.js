import { getDb } from './index.js';

export function hasSeen(sourceId) {
  const db = getDb();
  const row = db.prepare('SELECT source_id FROM seen WHERE source_id = ?').get(sourceId);
  return !!row;
}

export function markSeen({ sourceId, sourceIdKind, account, sourceType, storyTakenAt = null, wasEvent = false, error = null }) {
  const db = getDb();
  db.prepare(`
    INSERT INTO seen (source_id, source_id_kind, account, source_type, story_taken_at, scanned_at, was_event, error)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_id) DO UPDATE SET
      was_event = excluded.was_event,
      error = excluded.error,
      scanned_at = excluded.scanned_at
  `).run(
    sourceId,
    sourceIdKind,
    account,
    sourceType,
    storyTakenAt,
    new Date().toISOString(),
    wasEvent ? 1 : 0,
    error,
  );
}

export function countSeen(account) {
  const db = getDb();
  const row = account
    ? db.prepare('SELECT COUNT(*) AS n FROM seen WHERE account = ?').get(account)
    : db.prepare('SELECT COUNT(*) AS n FROM seen').get();
  return row.n;
}
