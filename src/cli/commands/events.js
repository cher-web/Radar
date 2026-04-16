import { listEvents } from '../../db/events.js';
import { formatEventsList } from '../../digest/format.js';
import { heading, info } from '../output.js';

function parseSince(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d+)d$/);
  if (!m) throw new Error(`invalid --since value '${s}' (expected e.g. '7d')`);
  return parseInt(m[1], 10);
}

export async function events(opts) {
  const upcomingOnly = !opts.all;
  const sinceDays = parseSince(opts.since);

  const rows = listEvents({ upcomingOnly, sinceDays });
  const filtered = opts.all ? rows : rows.filter((r) => r.confidence !== 'low');

  heading(
    upcomingOnly ? 'upcoming events' : 'all events',
  );
  if (sinceDays) info(`filtered to last ${sinceDays} days`);
  console.log();
  console.log(formatEventsList(filtered));
  console.log();
  info(`${filtered.length} event${filtered.length === 1 ? '' : 's'}`);
}
