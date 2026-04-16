// Spike 2 — story iteration + frame ID extraction
//
// Goal: for a given target account, open their story viewer, iterate through
// every frame, screenshot each, and dump whatever ID-ish metadata we can find
// (URL mediaId, DOM data attrs, timestamps). Run both headless and headed so
// we can compare reliability.
//
// Usage:
//   node spikes/02-story-scan.mjs <username> [--headed]
//
// Output (per run):
//   spikes/out/<timestamp>-story-<user>/
//     frame-01.png ... frame-NN.png
//     dom-01.json  ... dom-NN.json   (URL, data attrs, story header text)
//     log.txt                         (chronological notes)

import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SESSION_PATH, makeRunDir, sleep, log } from './_shared.mjs';

const username = process.argv[2];
const headed = process.argv.includes('--headed');
if (!username) {
  console.error('usage: node spikes/02-story-scan.mjs <username> [--headed]');
  process.exit(1);
}

const MAX_FRAMES = 15; // safety cap per story
const FRAME_SETTLE_MS = 1200;

async function captureFrameMeta(page) {
  const url = page.url();
  // Pull anything that smells like an ID from the DOM.
  const meta = await page.evaluate(() => {
    const pick = (sel, attrs) => {
      const els = Array.from(document.querySelectorAll(sel));
      return els.slice(0, 5).map((el) => {
        const out = { tag: el.tagName.toLowerCase() };
        for (const a of attrs) {
          if (el.hasAttribute(a)) out[a] = el.getAttribute(a);
        }
        const txt = (el.textContent || '').trim().slice(0, 120);
        if (txt) out.text = txt;
        return out;
      });
    };
    return {
      title: document.title,
      imgSrcs: Array.from(document.querySelectorAll('img'))
        .map((i) => i.src)
        .filter((s) => /cdninstagram|fbcdn/.test(s))
        .slice(0, 5),
      videoSrcs: Array.from(document.querySelectorAll('video'))
        .map((v) => v.currentSrc || v.src)
        .filter(Boolean)
        .slice(0, 5),
      time: Array.from(document.querySelectorAll('time')).map((t) => ({
        datetime: t.getAttribute('datetime'),
        text: t.textContent,
      })),
      headerButtons: pick('header button, section button', ['aria-label']),
      progressBars: document.querySelectorAll('[role="progressbar"]').length,
    };
  });
  return { url, ...meta };
}

async function advanceFrame(page) {
  // IG stories: right-arrow key advances. Fallback: click the right half of viewport.
  await page.keyboard.press('ArrowRight').catch(() => {});
  await sleep(FRAME_SETTLE_MS);
}

async function pauseVideos(page) {
  await page.evaluate(() => {
    for (const v of document.querySelectorAll('video')) {
      try { v.pause(); v.currentTime = 0; } catch {}
    }
  });
}

async function openStoryFromProfile(page, user) {
  await page.goto(`https://www.instagram.com/${user}/`, { waitUntil: 'domcontentloaded' });
  await sleep(2000);
  // Story ring lives in the header — usually a button/link at the top of the profile.
  // Try several selectors before giving up.
  const candidates = [
    page.getByRole('button', { name: new RegExp(user, 'i') }),
    page.locator('header canvas').first(), // the ring is drawn on a canvas
    page.locator(`header a[href*="/stories/${user}/"]`).first(),
  ];
  for (const c of candidates) {
    if (await c.count().catch(() => 0)) {
      await c.first().click().catch(() => {});
      await sleep(1500);
      if (page.url().includes('/stories/')) return true;
    }
  }
  // Last-ditch: navigate directly.
  await page.goto(`https://www.instagram.com/stories/${user}/`, { waitUntil: 'domcontentloaded' });
  await sleep(2000);
  return page.url().includes('/stories/');
}

async function run() {
  const outDir = await makeRunDir(`story-${username}${headed ? '-headed' : '-headless'}`);
  const logLines = [];
  const note = (m) => { log(m); logLines.push(`${new Date().toISOString()} ${m}`); };

  note(`target=@${username} mode=${headed ? 'headed' : 'headless'} out=${outDir}`);

  const browser = await chromium.launch({ headless: !headed });
  const ctx = await browser.newContext({ storageState: SESSION_PATH, viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();

  const opened = await openStoryFromProfile(page, username);
  if (!opened) {
    note('ERROR: could not open story viewer');
    await writeFile(join(outDir, 'log.txt'), logLines.join('\n'));
    await browser.close();
    process.exit(2);
  }
  note(`story viewer url: ${page.url()}`);

  let lastUrl = '';
  for (let i = 1; i <= MAX_FRAMES; i++) {
    await pauseVideos(page);
    await sleep(400);
    const meta = await captureFrameMeta(page);
    const shotPath = join(outDir, `frame-${String(i).padStart(2, '0')}.png`);
    await page.screenshot({ path: shotPath, fullPage: false });
    await writeFile(
      join(outDir, `dom-${String(i).padStart(2, '0')}.json`),
      JSON.stringify(meta, null, 2),
    );
    note(`frame ${i} url=${meta.url}`);

    // end-of-story detection: URL stops changing after advance, OR we bounce
    // back to the profile, OR no progressbars remain.
    if (meta.url === lastUrl && i > 1) {
      note('URL did not change on last advance — likely end of story');
      break;
    }
    if (!meta.url.includes('/stories/')) {
      note('navigated out of /stories/ — end of story');
      break;
    }
    lastUrl = meta.url;
    await advanceFrame(page);
    const after = page.url();
    if (!after.includes('/stories/')) {
      note('advance bounced us out of /stories/ — done');
      break;
    }
  }

  await writeFile(join(outDir, 'log.txt'), logLines.join('\n'));
  await browser.close();
  note('done.');
}

run().catch((e) => { console.error(e); process.exit(1); });
