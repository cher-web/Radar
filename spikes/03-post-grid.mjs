// Spike 3 — post grid discovery
//
// Goal: for a given account, visit the profile grid and answer:
//   - Can we list the most-recent N posts without opening each one?
//   - Is a shortcode (/p/<code>/) available as a stable ID?
//   - Are timestamps exposed on the grid (hover / DOM), or only inside the
//     post modal?
//   - What does opening one post reveal (caption, timestamp, ticket links)?
//
// Usage:
//   node spikes/03-post-grid.mjs <username>
//
// Output: spikes/out/<timestamp>-posts-<user>/
//   grid.json       (top 12 hrefs + anything we can scrape without clicking)
//   post-01.png     (screenshot of the first opened post)
//   post-01.json    (caption, timestamp, shortcode)
//   log.txt

import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SESSION_PATH, makeRunDir, sleep, log } from './_shared.mjs';

const username = process.argv[2];
if (!username) {
  console.error('usage: node spikes/03-post-grid.mjs <username>');
  process.exit(1);
}

async function readGrid(page) {
  return page.evaluate(() => {
    // Grid tiles are anchors with href like /p/<shortcode>/ or /reel/<code>/.
    const anchors = Array.from(document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]'));
    const out = [];
    const seen = new Set();
    for (const a of anchors) {
      const href = a.getAttribute('href');
      if (!href || seen.has(href)) continue;
      seen.add(href);
      const img = a.querySelector('img');
      out.push({
        href,
        kind: href.includes('/reel/') ? 'reel' : 'post',
        alt: img?.getAttribute('alt') || null,
        ariaLabel: a.getAttribute('aria-label'),
      });
      if (out.length >= 12) break;
    }
    return out;
  });
}

async function readPostDetail(page) {
  return page.evaluate(() => {
    const time = document.querySelector('time');
    const caption =
      document.querySelector('h1')?.textContent
      || document.querySelector('article h1')?.textContent
      || document.querySelector('article div[role="button"] span')?.textContent
      || null;
    const links = Array.from(document.querySelectorAll('article a[href]'))
      .map((a) => a.getAttribute('href'))
      .filter((h) => h && !h.startsWith('/') && !h.includes('instagram.com'))
      .slice(0, 10);
    const shortcodeMatch = location.pathname.match(/\/(p|reel)\/([^/]+)/);
    return {
      url: location.href,
      shortcode: shortcodeMatch?.[2] ?? null,
      kind: shortcodeMatch?.[1] ?? null,
      timestamp: time?.getAttribute('datetime') ?? null,
      timestampText: time?.textContent ?? null,
      caption: (caption || '').slice(0, 500),
      externalLinks: links,
    };
  });
}

async function run() {
  const outDir = await makeRunDir(`posts-${username}`);
  const logLines = [];
  const note = (m) => { log(m); logLines.push(`${new Date().toISOString()} ${m}`); };

  note(`target=@${username} out=${outDir}`);

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ storageState: SESSION_PATH, viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();

  await page.goto(`https://www.instagram.com/${username}/`, { waitUntil: 'domcontentloaded' });
  // Grid tiles are lazy-loaded — wait explicitly for one to appear.
  try {
    await page.waitForSelector('a[href*="/p/"], a[href*="/reel/"]', { timeout: 15000 });
  } catch {
    note('WARN: timed out waiting for grid anchors');
  }
  await sleep(1500);

  // Debug: always screenshot the profile + dump title for triage on empty grid.
  await page.screenshot({ path: join(outDir, 'profile.png'), fullPage: false });
  const pageTitle = await page.title();
  note(`profile title: ${pageTitle}`);

  const grid = await readGrid(page);
  note(`grid entries: ${grid.length}`);
  await writeFile(join(outDir, 'grid.json'), JSON.stringify(grid, null, 2));

  if (grid.length === 0) {
    // Dump DOM shape so we can see if anchors are there under a different href pattern.
    const domShape = await page.evaluate(() => ({
      url: location.href,
      anchorHrefs: Array.from(document.querySelectorAll('a[href]'))
        .map((a) => a.getAttribute('href'))
        .filter((h) => h && (h.includes('/p/') || h.includes('/reel/') || h.includes('/tv/')))
        .slice(0, 30),
      totalAnchors: document.querySelectorAll('a').length,
      articleCount: document.querySelectorAll('article').length,
      mainCount: document.querySelectorAll('main').length,
      bodyLen: document.body.innerHTML.length,
    }));
    await writeFile(join(outDir, 'dom-shape.json'), JSON.stringify(domShape, null, 2));
    note(`empty grid. dom-shape.json written. anchors=${domShape.totalAnchors} postHrefs=${domShape.anchorHrefs.length}`);
    await writeFile(join(outDir, 'log.txt'), logLines.join('\n'));
    await browser.close();
    return;
  }

  // Open the first *post* (skip reels — v1 spec excludes reels).
  const firstPost = grid.find((g) => g.kind === 'post') ?? grid[0];
  note(`opening first post: ${firstPost.href}`);
  await page.goto(`https://www.instagram.com${firstPost.href}`, { waitUntil: 'domcontentloaded' });
  await sleep(2500);

  const detail = await readPostDetail(page);
  await writeFile(join(outDir, 'post-01.json'), JSON.stringify(detail, null, 2));
  await page.screenshot({ path: join(outDir, 'post-01.png'), fullPage: false });
  note(`post detail: shortcode=${detail.shortcode} ts=${detail.timestamp} caption_len=${detail.caption.length}`);

  await writeFile(join(outDir, 'log.txt'), logLines.join('\n'));
  await browser.close();
  note('done.');
}

run().catch((e) => { console.error(e); process.exit(1); });
