import { existsSync } from 'node:fs';
import { listEvents } from '../db/events.js';
import { putFileContentAddressed, putJson } from './r2.js';

/** Strip internal fields and shape the row for public consumption. */
function serializeEvent(row, screenshotUrl) {
  return {
    id: row.id,
    account: row.account,
    source_type: row.source_type,
    source_id: row.source_id,
    event_name: row.event_name,
    event_date: row.event_date,
    event_time: row.event_time,
    venue: row.venue,
    description: row.description,
    ticket_url: row.ticket_url,
    confidence: row.confidence,
    screenshot_url: screenshotUrl,
    found_at: row.found_at,
  };
}

/**
 * Publish all upcoming events to R2.
 * Uploads new screenshots (content-hashed, dedup'd) and writes events.json + meta.json.
 * Returns { events, uploaded, skipped }.
 */
export async function publishToR2({ logger = () => {} } = {}) {
  const rows = listEvents({ upcomingOnly: false });
  logger(`publishing ${rows.length} events`);

  let uploaded = 0;
  let skipped = 0;
  let missingScreenshots = 0;
  const published = [];

  for (const row of rows) {
    let screenshotUrl = null;
    if (row.screenshot_path && existsSync(row.screenshot_path)) {
      try {
        const r = await putFileContentAddressed(row.screenshot_path);
        screenshotUrl = r.url;
        if (r.uploaded) uploaded++; else skipped++;
      } catch (e) {
        logger(`screenshot upload failed for ${row.id}: ${e.message}`);
      }
    } else if (row.screenshot_path) {
      missingScreenshots++;
    }
    published.push(serializeEvent(row, screenshotUrl));
  }

  await putJson('data/events.json', {
    events: published,
    count: published.length,
  });
  await putJson('data/meta.json', {
    last_published: new Date().toISOString(),
    event_count: published.length,
    screenshots_uploaded: uploaded,
    screenshots_reused: skipped,
    screenshots_missing: missingScreenshots,
  });

  logger(`published · ${published.length} events · +${uploaded} screenshots (${skipped} reused${missingScreenshots ? `, ${missingScreenshots} missing` : ''})`);
  return { events: published.length, uploaded, skipped, missingScreenshots };
}
