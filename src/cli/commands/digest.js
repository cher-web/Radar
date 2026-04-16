import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { listEvents } from '../../db/events.js';
import { loadAccounts } from '../../config/accounts.js';
import { groupForDigest } from '../../digest/group.js';
import { formatDigest } from '../../digest/format.js';
import { info, ok } from '../output.js';

const DIGEST_ROOT = './digests';

export async function digest(opts) {
  const format = opts.format === 'markdown' ? 'markdown' : 'text';
  const minConfidence = opts.all ? 'low' : 'medium';

  const rows = listEvents({ upcomingOnly: true });
  const buckets = groupForDigest(rows, { minConfidence, upcomingOnly: true });
  const store = await loadAccounts();
  const accountCount = store.accounts.filter((a) => a.active !== false).length;

  const out = formatDigest(buckets, {
    format,
    date: new Date(),
    accountCount,
    scanTime: new Date(),
  });

  console.log(out);

  if (opts.save) {
    await mkdir(DIGEST_ROOT, { recursive: true });
    const dateStr = new Date().toISOString().slice(0, 10);
    const path = join(DIGEST_ROOT, `${dateStr}.md`);
    const md = format === 'markdown'
      ? out
      : formatDigest(buckets, { format: 'markdown', date: new Date(), accountCount, scanTime: new Date() });
    await writeFile(path, md + '\n');
    console.log();
    ok(`saved → ${path}`);
  }
}
