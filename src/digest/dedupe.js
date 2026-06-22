const CONF_RANK = { high: 3, medium: 2, low: 1 };
const SOURCE_RANK = { post: 2, story: 1 };
const TAG_RANK = { venue: 3, gallery: 3, festival: 2, promoter: 2, collective: 1, music: 1, art: 1 };

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'at', 'in', 'on', 'to', 'with',
  'presents', 'present', 'feat', 'featuring', 'ft', 'vs', 'x',
  'live', 'show', 'night', 'party', 'event',
]);

function normalizeName(s) {
  if (!s) return '';
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOPWORDS.has(w))
    .join(' ')
    .trim();
}

function normalizeVenue(s) {
  if (!s) return '';
  return s
    .toLowerCase()
    .split(/[,·•|]/)[0]
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function trigrams(s) {
  const padded = `  ${s}  `;
  const out = new Set();
  for (let i = 0; i < padded.length - 2; i++) out.add(padded.slice(i, i + 3));
  return out;
}

function trigramSimilarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const ta = trigrams(a);
  const tb = trigrams(b);
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const union = ta.size + tb.size - inter;
  return union === 0 ? 0 : inter / union;
}

function tokenContainment(a, b) {
  if (!a || !b) return 0;
  const ta = new Set(a.split(' ').filter(Boolean));
  const tb = new Set(b.split(' ').filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / Math.min(ta.size, tb.size);
}

function namesMatch(a, b, threshold) {
  if (!a || !b) return false;
  if (trigramSimilarity(a, b) >= threshold) return true;
  return tokenContainment(a, b) >= 0.75;
}

function rankKey(e, accountTagFor) {
  return [
    CONF_RANK[e.confidence] ?? 0,
    SOURCE_RANK[e.source_type] ?? 0,
    TAG_RANK[accountTagFor?.(e.account)] ?? 0,
    e.found_at || '',
  ];
}

function compareRank(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] > b[i]) return -1;
    if (a[i] < b[i]) return 1;
  }
  return 0;
}

/**
 * Collapse duplicate events into clusters. Non-destructive — returns the kept
 * winners with `merged` arrays attached for inspection.
 *
 * Two events are considered the same if:
 *   - same event_date AND same normalized venue AND name similarity >= nameThreshold
 *   - OR (no date) same normalized venue AND name similarity >= undatedNameThreshold
 *
 * @param events                  rows from listEvents()
 * @param opts.nameThreshold      trigram similarity for dated dupes (default 0.45)
 * @param opts.undatedNameThreshold  stricter threshold when date is missing (default 0.7)
 * @param opts.crossAccount       merge across accounts too (default true)
 * @param opts.accountTagFor      (account) => tag, used as a tiebreaker
 */
export function dedupeEvents(events, {
  nameThreshold = 0.45,
  undatedNameThreshold = 0.7,
  crossAccount = true,
  accountTagFor = null,
} = {}) {
  const enriched = events.map((e) => ({
    e,
    nameNorm: normalizeName(e.event_name),
    venueNorm: normalizeVenue(e.venue),
  }));

  const buckets = new Map();
  for (const item of enriched) {
    const dateKey = item.e.event_date || '~undated';
    const accountKey = crossAccount ? '*' : item.e.account || '~';
    const key = `${dateKey}|${item.venueNorm}|${accountKey}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(item);
  }

  const clusters = [];
  for (const [key, items] of buckets) {
    const isUndated = key.startsWith('~undated|');
    const hasVenue = items[0].venueNorm.length > 0;
    const threshold = isUndated ? undatedNameThreshold : nameThreshold;

    if (!hasVenue) {
      for (const item of items) clusters.push([item]);
      continue;
    }

    const used = new Array(items.length).fill(false);
    for (let i = 0; i < items.length; i++) {
      if (used[i]) continue;
      const cluster = [items[i]];
      used[i] = true;
      for (let j = i + 1; j < items.length; j++) {
        if (used[j]) continue;
        if (namesMatch(items[i].nameNorm, items[j].nameNorm, threshold)) {
          cluster.push(items[j]);
          used[j] = true;
        }
      }
      clusters.push(cluster);
    }
  }

  const out = [];
  for (const cluster of clusters) {
    cluster.sort((a, b) => compareRank(rankKey(a.e, accountTagFor), rankKey(b.e, accountTagFor)));
    const winner = { ...cluster[0].e };
    if (cluster.length > 1) {
      winner.merged = cluster.slice(1).map((c) => ({
        id: c.e.id,
        account: c.e.account,
        source_type: c.e.source_type,
        event_name: c.e.event_name,
      }));
    }
    out.push(winner);
  }
  return out;
}

/**
 * Compute the (loserId -> winnerId) pairs that `dedupeEvents` would collapse,
 * for persisting via `applyMerges`. Same options as `dedupeEvents`.
 */
export function computeMergePairs(events, opts = {}) {
  const winners = dedupeEvents(events, opts);
  const pairs = [];
  for (const w of winners) {
    if (!w.merged) continue;
    for (const m of w.merged) pairs.push({ loserId: m.id, winnerId: w.id });
  }
  return pairs;
}
