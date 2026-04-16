import chalk from 'chalk';
import { publishToR2 } from '../../publish/events.js';
import { err, heading, info, ok } from '../output.js';

export async function publish() {
  heading('radar publish');
  const started = Date.now();
  try {
    const r = await publishToR2({ logger: (m) => info(m) });
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    ok(`${r.events} events live · ${elapsed}s`);
    const base = process.env.R2_PUBLIC_URL.replace(/\/$/, '');
    info(`${base}/data/events.json`);
  } catch (e) {
    err(`publish failed: ${e.message}`);
    process.exitCode = 1;
  }
}
