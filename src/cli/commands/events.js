import { listEvents, applyMerges, unmergeAll } from '../../db/events.js';
import { loadAccounts } from '../../config/accounts.js';
import { computeMergePairs } from '../../digest/dedupe.js';
import { formatEventsList } from '../../digest/format.js';
import { heading, info, ok } from '../output.js';

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

export async function dedupe(opts) {
  const apply = !!opts.apply;
  const rows = listEvents({ upcomingOnly: false, includeMerged: false });
  const store = await loadAccounts();
  const tagByAccount = new Map(store.accounts.map((a) => [a.username, a.tag]));
  const pairs = computeMergePairs(rows, { accountTagFor: (a) => tagByAccount.get(a) });

  const byId = new Map(rows.map((r) => [r.id, r]));
  heading(apply ? 'applying merges' : 'dedupe preview (dry run)');
  console.log();
  if (pairs.length === 0) {
    info('no duplicates found');
    return;
  }

  const groups = new Map();
  for (const p of pairs) {
    if (!groups.has(p.winnerId)) groups.set(p.winnerId, []);
    groups.get(p.winnerId).push(p.loserId);
  }
  for (const [winnerId, loserIds] of groups) {
    const w = byId.get(winnerId);
    console.log(`  keep   [${w.confidence}] @${w.account} ${w.source_type} — ${w.event_name} (${w.event_date || 'TBD'})`);
    for (const lid of loserIds) {
      const l = byId.get(lid);
      console.log(`  merge  [${l.confidence}] @${l.account} ${l.source_type} — ${l.event_name}`);
    }
    console.log();
  }

  if (!apply) {
    info(`${pairs.length} merge${pairs.length === 1 ? '' : 's'} pending — re-run with --apply to persist`);
    return;
  }
  const n = applyMerges(pairs);
  ok(`merged ${n} event${n === 1 ? '' : 's'}`);
  info(`undo with: radar events dedupe --reset`);
}

export async function dedupeReset() {
  const n = unmergeAll();
  ok(`unmerged ${n} event${n === 1 ? '' : 's'}`);
}
