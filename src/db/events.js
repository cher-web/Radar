import { createHash } from 'node:crypto';
import { getDb } from './index.js';

function eventId(account, sourceId, eventName) {
  return createHash('sha256')
    .update(`${account}:${sourceId}:${eventName || ''}`)
    .digest('hex')
    .slice(0, 32);
}

export function insertEvent(e) {
  const db = getDb();
  const id = eventId(e.account, e.sourceId, e.eventName);
  db.prepare(`
    INSERT OR REPLACE INTO events (
      id, account, source_type, source_id, source_id_kind, story_taken_at,
      event_name, event_date, event_time, venue, description, ticket_url,
      confidence, screenshot_path, raw_response, found_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    e.account,
    e.sourceType,
    e.sourceId,
    e.sourceIdKind,
    e.storyTakenAt ?? null,
    e.eventName ?? null,
    e.eventDate ?? null,
    e.eventTime ?? null,
    e.venue ?? null,
    e.description ?? null,
    e.ticketUrl ?? null,
    e.confidence ?? null,
    e.screenshotPath ?? null,
    e.rawResponse ?? null,
    e.foundAt ?? new Date().toISOString(),
  );
  return id;
}

export function listEvents({ upcomingOnly = false, sinceDays = null, includeMerged = false } = {}) {
  const db = getDb();
  const clauses = [];
  const args = [];
  if (!includeMerged) clauses.push(`merged_into IS NULL`);
  if (upcomingOnly) clauses.push(`(event_date IS NULL OR event_date >= date('now'))`);
  if (sinceDays != null) {
    clauses.push(`found_at >= datetime('now', ?)`);
    args.push(`-${Number(sinceDays)} days`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const sql = `SELECT * FROM events ${where} ORDER BY
    CASE WHEN event_date IS NULL THEN 1 ELSE 0 END,
    event_date ASC, found_at DESC`;
  return db.prepare(sql).all(...args);
}

export function applyMerges(merges) {
  const db = getDb();
  const stmt = db.prepare(`UPDATE events SET merged_into = ? WHERE id = ? AND merged_into IS NULL`);
  const tx = db.transaction((pairs) => {
    let n = 0;
    for (const { loserId, winnerId } of pairs) {
      const r = stmt.run(winnerId, loserId);
      n += r.changes;
    }
    return n;
  });
  return tx(merges);
}

export function unmergeAll() {
  const db = getDb();
  return db.prepare(`UPDATE events SET merged_into = NULL WHERE merged_into IS NOT NULL`).run().changes;
}
