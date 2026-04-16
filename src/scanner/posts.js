import { postTilePath, screenshotDir } from './screenshot.js';
import { checkNotLoginRedirect, sleep } from './browser.js';
import { hasSeen, markSeen } from '../db/seen.js';
import { insertEvent } from '../db/events.js';
import { extractEvent, isPastEventDate } from '../vision/extract.js';

const GRID_TIMEOUT_MS = 15000;
const GRID_TOP_N = 5;

async function openProfile(page, username) {
  await page.goto(`https://www.instagram.com/${username}/`, { waitUntil: 'domcontentloaded' });
  checkNotLoginRedirect(page);
  try {
    await page.waitForSelector('a[href*="/p/"]', { timeout: GRID_TIMEOUT_MS });
  } catch {
    return false;
  }
  await sleep(1500);
  return true;
}

async function readGrid(page) {
  return page.evaluate(() => {
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
        alt: img?.getAttribute('alt') || '',
      });
    }
    return out;
  });
}

function shortcodeFromHref(href) {
  const m = href.match(/\/p\/([^/]+)\//);
  return m?.[1] ?? null;
}

function filterOwnedPosts(grid, username, limit) {
  const ownerPrefix = `/${username}/`;
  return grid
    .filter((g) => g.kind === 'post' && g.href.startsWith(ownerPrefix))
    .slice(0, limit);
}

export async function scanAccountPosts(context, username, { tag = null, logger, runVision = true } = {}) {
  const log = logger || (() => {});
  const page = await context.newPage();
  try {
    const opened = await openProfile(page, username);
    if (!opened) {
      log(`grid did not load for @${username}`);
      return { opened: false, posts: [] };
    }

    const grid = await readGrid(page);
    const owned = filterOwnedPosts(grid, username, GRID_TOP_N);
    if (owned.length === 0) {
      return { opened: true, posts: [] };
    }

    const dir = await screenshotDir(username);
    const posts = [];

    for (const tile of owned) {
      const shortcode = shortcodeFromHref(tile.href);
      if (!shortcode) continue;

      if (hasSeen(shortcode)) {
        posts.push({ shortcode, alt: tile.alt, isNew: false, event: null, screenshotPath: null });
        continue;
      }

      const anchor = page.locator(`a[href="${tile.href}"]`).first();
      const shotPath = postTilePath(dir, shortcode);
      let event = null;
      let visionError = null;
      let screenshotOk = true;

      try {
        await anchor.screenshot({ path: shotPath });
      } catch (e) {
        log(`could not screenshot ${shortcode}: ${e.message}`);
        screenshotOk = false;
      }

      if (screenshotOk && runVision) {
        try {
          const res = await extractEvent({
            imagePath: shotPath,
            sourceType: 'post',
            username,
            tag,
            captionText: tile.alt || undefined,
          });
          event = res.event;
          const isUpcoming = event?.event === true && !isPastEventDate(event.date);
          if (isUpcoming) {
            insertEvent({
              account: username,
              sourceType: 'post',
              sourceId: shortcode,
              sourceIdKind: 'shortcode',
              eventName: event.name ?? null,
              eventDate: event.date ?? null,
              eventTime: event.time ?? null,
              venue: event.venue ?? null,
              description: event.description ?? null,
              ticketUrl: event.ticket_url ?? null,
              confidence: event.confidence ?? null,
              screenshotPath: shotPath,
              rawResponse: res.raw,
            });
          }
        } catch (e) {
          visionError = e.message;
          log(`vision error on ${shortcode}: ${e.message}`);
        }
      }

      const wasEvent = event?.event === true && !isPastEventDate(event.date);
      markSeen({
        sourceId: shortcode,
        sourceIdKind: 'shortcode',
        account: username,
        sourceType: 'post',
        wasEvent,
        error: visionError,
      });

      posts.push({
        shortcode,
        alt: tile.alt,
        isNew: true,
        event: wasEvent ? event : null,
        visionError,
        screenshotPath: screenshotOk ? shotPath : null,
      });
    }

    return { opened: true, posts };
  } finally {
    await page.close().catch(() => {});
  }
}
