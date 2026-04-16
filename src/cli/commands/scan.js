import chalk from 'chalk';
import { SessionExpiredError, launchContext, sessionExists, sleep } from '../../scanner/browser.js';
import { scanAccountStories } from '../../scanner/stories.js';
import { scanAccountPosts } from '../../scanner/posts.js';
import { loadAccounts } from '../../config/accounts.js';
import { finishScan, startScan } from '../../db/scans.js';
import { publishToR2 } from '../../publish/events.js';
import { err, heading, info, ok, warn } from '../output.js';

const RULE = '─'.repeat(56);

function sleepRandom(minMs, maxMs) {
  const ms = minMs + Math.floor(Math.random() * (maxMs - minMs));
  return sleep(ms);
}

function pluralize(n, one, many) { return n === 1 ? one : many; }

function confBadge(c) {
  if (c === 'high') return chalk.green(c);
  if (c === 'medium') return chalk.yellow(c);
  return chalk.dim(c ?? '?');
}

function printEventDetail(indent, e, screenshotPath) {
  const pad = ' '.repeat(indent);
  console.log(`${pad}${chalk.bold(e.name ?? '(unnamed)')}  ${chalk.dim('·')} ${confBadge(e.confidence)}`);
  const parts = [e.date, e.time, e.venue].filter(Boolean).join(' · ');
  if (parts) console.log(`${pad}  ${parts}`);
  if (e.ticket_url) console.log(`${pad}  ${chalk.blue(e.ticket_url)}`);
}

function accountLine({ pad, mark, handle, status, detail }) {
  const h = `@${handle}`.padEnd(pad + 1);
  const stat = status.padEnd(14);
  console.log(`  ${mark}  ${h}  ${chalk.dim(stat)} ${detail}`);
}

async function scanOneStories(context, username, { tag, pad, verbose }) {
  const { opened, frames } = await scanAccountStories(context, username, {
    tag, logger: verbose ? info : () => {},
  });
  if (!opened) {
    accountLine({ pad, mark: chalk.dim('–'), handle: username, status: 'no stories', detail: '' });
    return { newEvents: [], visionErrors: 0 };
  }
  const fresh = frames.filter((f) => f.isNew);
  const newEvents = fresh.filter((f) => f.event?.event === true);
  const visionErrors = fresh.filter((f) => f.visionError).length;
  const statusTxt = `${frames.length} ${pluralize(frames.length, 'story', 'stories')}`;
  const eventsTxt = newEvents.length === 0
    ? chalk.dim('no new events')
    : `${chalk.green(newEvents.length)} ${pluralize(newEvents.length, 'event', 'events')} found`;
  const tail = visionErrors ? `  ${chalk.red(`${visionErrors} vision err`)}` : '';
  accountLine({ pad, mark: chalk.green('✓'), handle: username, status: statusTxt, detail: eventsTxt + tail });
  for (const f of newEvents) printEventDetail(5, f.event, f.screenshotPath);
  return { newEvents, visionErrors };
}

async function scanOnePosts(context, username, { tag, pad, verbose }) {
  const { opened, posts } = await scanAccountPosts(context, username, {
    tag, logger: verbose ? info : () => {},
  });
  if (!opened) {
    accountLine({ pad, mark: chalk.dim('–'), handle: username, status: 'no grid', detail: '' });
    return { newEvents: [], visionErrors: 0 };
  }
  const fresh = posts.filter((p) => p.isNew);
  const newEvents = fresh.filter((p) => p.event?.event === true);
  const visionErrors = fresh.filter((p) => p.visionError).length;
  const statusTxt = `${posts.length} ${pluralize(posts.length, 'post', 'posts')}`;
  const eventsTxt = newEvents.length === 0
    ? chalk.dim('no new events')
    : `${chalk.green(newEvents.length)} ${pluralize(newEvents.length, 'event', 'events')} found`;
  const tail = visionErrors ? `  ${chalk.red(`${visionErrors} vision err`)}` : '';
  accountLine({ pad, mark: chalk.green('✓'), handle: username, status: statusTxt, detail: eventsTxt + tail });
  for (const p of newEvents) printEventDetail(5, p.event, p.screenshotPath);
  return { newEvents, visionErrors };
}

function resolveSections(opts) {
  if (opts.stories && !opts.posts) return { stories: true, posts: false };
  if (opts.posts && !opts.stories) return { stories: false, posts: true };
  return { stories: true, posts: true };
}

export async function runSingleAccount(handle, sections) {
  const username = handle.replace(/^@/, '').toLowerCase();
  const store = await loadAccounts();
  const tracked = store.accounts.find((a) => a.username === username);
  const tag = tracked?.tag ?? null;

  heading(`radar scan @${username}${tag ? ` (${tag})` : ''}`);
  const started = Date.now();
  const { browser, context } = await launchContext({ headless: true, useSession: true });
  const scanId = startScan();
  let totalEvents = 0;
  const pad = username.length;

  try {
    if (sections.stories) {
      console.log('\n  ' + chalk.bold('Stories'));
      console.log('  ' + chalk.dim(RULE));
      const { newEvents } = await scanOneStories(context, username, { tag, pad, verbose: true });
      totalEvents += newEvents.length;
    }
    if (sections.posts) {
      console.log('\n  ' + chalk.bold('Posts'));
      console.log('  ' + chalk.dim(RULE));
      const { newEvents } = await scanOnePosts(context, username, { tag, pad, verbose: true });
      totalEvents += newEvents.length;
    }
  } catch (e) {
    if (e instanceof SessionExpiredError) {
      err('Instagram session expired');
      info('run `radar auth login` to re-authenticate');
      process.exitCode = 1;
    } else {
      throw e;
    }
  } finally {
    await browser.close();
  }
  finishScan(scanId, { accountsScanned: 1, eventsFound: totalEvents });
  console.log('\n  ' + chalk.dim(RULE));
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  info(`scan complete · ${elapsed}s · ${totalEvents} ${pluralize(totalEvents, 'event', 'events')}`);

  if (process.env.R2_BUCKET) {
    try {
      const r = await publishToR2({ logger: (m) => info(m) });
      info(`published · ${r.events} events · +${r.uploaded} screenshots`);
    } catch (e) {
      warn(`auto-publish skipped: ${e.message}`);
    }
  }
}

async function scanSection(context, accounts, pad, scanFn, label, onProgress) {
  console.log('\n  ' + chalk.bold(label));
  console.log('  ' + chalk.dim(RULE));
  let totalEvents = 0;
  let totalErrors = 0;
  let accountsScanned = 0;
  let sessionExpired = false;

  for (let i = 0; i < accounts.length; i++) {
    const a = accounts[i];
    if (onProgress) onProgress({ phase: label.toLowerCase(), current: i, accountName: a.username });
    try {
      const { newEvents } = await scanFn(context, a.username, { tag: a.tag, pad, verbose: false });
      totalEvents += newEvents.length;
      accountsScanned++;
      if (onProgress) onProgress({ phase: label.toLowerCase(), current: i + 1, accountName: a.username });
    } catch (e) {
      if (e instanceof SessionExpiredError) {
        sessionExpired = true;
        break;
      }
      accountLine({
        pad, mark: chalk.red('✗'), handle: a.username,
        status: 'error', detail: chalk.red(e.message),
      });
      totalErrors++;
    }
    if (i < accounts.length - 1) await sleepRandom(3000, 7000);
  }
  return { totalEvents, totalErrors, accountsScanned, sessionExpired };
}

export async function runAllAccounts(sections, { onProgress } = {}) {
  const store = await loadAccounts();
  const accounts = store.accounts.filter((a) => a.active !== false);
  if (accounts.length === 0) {
    warn('no active accounts — add some with `radar accounts add <handle> --tag <tag>`');
    return;
  }
  const pad = Math.max(...accounts.map((a) => a.username.length));
  heading(`Radar — scanning ${accounts.length} ${pluralize(accounts.length, 'account', 'accounts')}`);

  if (onProgress) onProgress({ total: accounts.length, current: 0, phase: null, accountName: null });

  const started = Date.now();
  const scanId = startScan();
  const { browser, context } = await launchContext({ headless: true, useSession: true });
  let totalNewEvents = 0;
  let totalErrors = 0;
  let sessionExpired = false;

  try {
    if (sections.stories) {
      const r = await scanSection(context, accounts, pad, scanOneStories, 'Stories', onProgress);
      totalNewEvents += r.totalEvents;
      totalErrors += r.totalErrors;
      sessionExpired = sessionExpired || r.sessionExpired;
    }
    if (!sessionExpired && sections.posts) {
      const r = await scanSection(context, accounts, pad, scanOnePosts, 'Posts', onProgress);
      totalNewEvents += r.totalEvents;
      totalErrors += r.totalErrors;
      sessionExpired = sessionExpired || r.sessionExpired;
    }
  } finally {
    await browser.close();
  }

  finishScan(scanId, { accountsScanned: accounts.length, eventsFound: totalNewEvents });

  console.log('\n  ' + chalk.dim(RULE));
  if (sessionExpired) {
    err('Instagram session expired mid-scan');
    info('run `radar auth login` to re-authenticate, then retry');
    process.exitCode = 1;
    return;
  }
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  const mins = Math.floor(elapsed / 60);
  const secs = (elapsed % 60).toFixed(0);
  const elapsedStr = mins ? `${mins}m ${secs}s` : `${secs}s`;
  info(`scan complete  ·  ${elapsedStr}`);
  const errTail = totalErrors ? `  ·  ${chalk.red(`${totalErrors} error${totalErrors === 1 ? '' : 's'}`)}` : '';
  info(`${totalNewEvents} ${pluralize(totalNewEvents, 'event', 'events')} found${errTail}`);

  if (process.env.R2_BUCKET) {
    try {
      const r = await publishToR2({ logger: (m) => info(m) });
      info(`published · ${r.events} events · +${r.uploaded} screenshots`);
    } catch (e) {
      warn(`auto-publish skipped: ${e.message}`);
    }
  }
}

export async function scan(opts) {
  if (!(await sessionExists())) {
    err('no session saved — run `radar auth login` first');
    process.exit(1);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    err('ANTHROPIC_API_KEY not set — add it to .env');
    process.exit(1);
  }
  const sections = resolveSections(opts);
  if (opts.account) return runSingleAccount(opts.account, sections);
  return runAllAccounts(sections);
}
