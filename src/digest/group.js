const CONF_RANK = { high: 3, medium: 2, low: 1 };

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function parseEventDate(s) {
  if (!s || typeof s !== 'string') return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00`);
  return isNaN(d.getTime()) ? null : d;
}

function daysBetween(a, b) {
  return Math.floor((a - b) / (1000 * 60 * 60 * 24));
}

/**
 * Bucket events for digest display.
 *
 * @param events          rows from db.events.listEvents()
 * @param opts.minConfidence  'high' | 'medium' | 'low' (default 'medium')
 * @param opts.upcomingOnly   drop past events (default true)
 */
export function groupForDigest(events, { minConfidence = 'medium', upcomingOnly = true } = {}) {
  const today = startOfToday();
  const minRank = CONF_RANK[minConfidence] ?? 2;

  const buckets = { thisWeek: [], nextWeek: [], later: [], undated: [] };
  for (const e of events) {
    if ((CONF_RANK[e.confidence] ?? 0) < minRank) continue;
    const d = parseEventDate(e.event_date);
    if (!d) {
      buckets.undated.push(e);
      continue;
    }
    if (upcomingOnly && d < today) continue;
    const diff = daysBetween(d, today);
    if (diff < 7) buckets.thisWeek.push(e);
    else if (diff < 14) buckets.nextWeek.push(e);
    else buckets.later.push(e);
  }

  for (const k of ['thisWeek', 'nextWeek', 'later']) {
    buckets[k].sort((a, b) => (a.event_date || '').localeCompare(b.event_date || ''));
  }
  return buckets;
}
