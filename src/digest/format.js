import chalk from 'chalk';

const WEEKDAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function formatCalendarDate(iso) {
  if (!iso || typeof iso !== 'string') return '';
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00`);
  if (isNaN(d.getTime())) return iso;
  return `${WEEKDAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

function makeStylers(md) {
  return {
    h1: (s) => md ? `# ${s}` : chalk.bold(s),
    h2: (s) => md ? `## ${s}` : chalk.bold.underline(s),
    dateHead: (s) => md ? `### ${s}` : chalk.bold(s),
    eventName: (s) => md ? `**${s}**` : chalk.bold(s),
    dim: (s) => md ? s : chalk.dim(s),
    url: (s) => md ? s : chalk.blue(s),
    rule: (n = 60) => md ? '' : chalk.dim('─'.repeat(n)),
  };
}

function renderEvent(e, st) {
  const out = [];
  out.push(`    ${st.eventName(e.event_name ?? '(untitled)')}`);
  const meta = [e.venue, e.event_time].filter(Boolean);
  if (meta.length) out.push(`    ${meta.join(' · ')}`);
  if (e.ticket_url) out.push(`    Tickets: ${st.url(e.ticket_url)}`);
  out.push(`    ${st.dim(`via @${e.account} (${e.source_type})`)}`);
  return out.join('\n');
}

function renderBucket(events, st) {
  const byDate = new Map();
  for (const e of events) {
    const key = e.event_date || '~undated';
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key).push(e);
  }
  const keys = [...byDate.keys()].sort();
  const chunks = [];
  for (const k of keys) {
    const label = k === '~undated' ? 'Date TBD' : formatCalendarDate(k);
    chunks.push(`  ${st.dateHead(label)}`);
    for (const e of byDate.get(k)) chunks.push(renderEvent(e, st));
    chunks.push('');
  }
  return chunks.join('\n').trimEnd();
}

export function formatDigest(buckets, { format = 'text', date = new Date(), accountCount, scanTime } = {}) {
  const md = format === 'markdown';
  const st = makeStylers(md);
  const lines = [];
  const today = formatCalendarDate(date.toISOString().slice(0, 10));

  lines.push(st.h1(`RADAR DIGEST — ${today}`));
  if (!md) lines.push(st.rule());

  const sections = [
    ['This week', buckets.thisWeek],
    ['Next week', buckets.nextWeek],
    ['Later', buckets.later],
  ];
  for (const [label, events] of sections) {
    if (events.length === 0) continue;
    lines.push('');
    lines.push(st.h2(label));
    if (!md) lines.push(st.rule(label.length));
    lines.push(renderBucket(events, st));
  }

  if (buckets.undated.length) {
    lines.push('');
    lines.push(st.h2('Date TBD'));
    if (!md) lines.push(st.rule('Date TBD'.length));
    for (const e of buckets.undated) {
      lines.push(renderEvent(e, st));
      lines.push('');
    }
  }

  const total = buckets.thisWeek.length + buckets.nextWeek.length +
                buckets.later.length + buckets.undated.length;
  lines.push('');
  if (!md) lines.push(st.rule());

  const footer = [
    `${total} event${total === 1 ? '' : 's'}`,
    accountCount != null ? `scanned ${accountCount} account${accountCount === 1 ? '' : 's'}` : null,
    scanTime ? formatCalendarDate(scanTime.toISOString().slice(0, 10)) : null,
  ].filter(Boolean).join('  ·  ');
  lines.push(st.dim(footer));

  return lines.join('\n');
}

export function formatEventsList(events, { format = 'text' } = {}) {
  const md = format === 'markdown';
  const st = makeStylers(md);
  if (events.length === 0) return st.dim('no events');
  const byDate = new Map();
  for (const e of events) {
    const key = e.event_date || '~undated';
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key).push(e);
  }
  const keys = [...byDate.keys()].sort();
  const chunks = [];
  for (const k of keys) {
    const label = k === '~undated' ? 'Date TBD' : formatCalendarDate(k);
    chunks.push(`${st.dateHead(label)}`);
    for (const e of byDate.get(k)) chunks.push(renderEvent(e, st));
    chunks.push('');
  }
  return chunks.join('\n').trimEnd();
}
