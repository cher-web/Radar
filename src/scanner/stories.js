import { createHash } from 'node:crypto';
import { captureFullFrame, screenshotDir, storyFramePath } from './screenshot.js';
import { checkNotLoginRedirect, sleep } from './browser.js';
import { hasSeen, markSeen } from '../db/seen.js';
import { insertEvent } from '../db/events.js';
import { extractEvent, isPastEventDate } from '../vision/extract.js';

const MAX_FRAMES = 15;
const FRAME_SETTLE_MS = 1200;
const STORY_URL_RE = /\/stories\/[^/]+\/(\d+)\/?/;

function deriveSourceId(url, account, storyTakenAt) {
  const m = url.match(STORY_URL_RE);
  if (m) return { sourceId: m[1], kind: 'url_mediaid' };
  if (storyTakenAt) {
    const hash = createHash('sha256').update(`${account}:${storyTakenAt}`).digest('hex').slice(0, 32);
    return { sourceId: hash, kind: 'time_hash' };
  }
  return null;
}

async function readFrameMeta(page) {
  return page.evaluate(() => {
    const t = document.querySelector('time');
    return { storyTakenAt: t?.getAttribute('datetime') ?? null };
  });
}

async function pauseVideos(page) {
  await page.evaluate(() => {
    for (const v of document.querySelectorAll('video')) {
      try { v.pause(); v.currentTime = 0; } catch {}
    }
  });
}

async function advance(page) {
  await page.keyboard.press('ArrowRight').catch(() => {});
  await sleep(FRAME_SETTLE_MS);
}

async function openStoryViewer(page, username) {
  await page.goto(`https://www.instagram.com/stories/${username}/`, { waitUntil: 'domcontentloaded' });
  await sleep(2000);
  checkNotLoginRedirect(page);
  return page.url().includes('/stories/');
}

/**
 * Scan one account's stories end-to-end.
 *
 * For each frame: derive an ID, skip if already in seen, otherwise screenshot
 * and mark seen. Returns per-frame results (new frames have screenshotPath set,
 * seen frames don't) so callers can feed new frames to Vision.
 */
export async function scanAccountStories(context, username, { logger, tag = null, runVision = true } = {}) {
  const log = logger || (() => {});
  const page = await context.newPage();
  try {
    const opened = await openStoryViewer(page, username);
    if (!opened) {
      log(`no stories for @${username}`);
      return { opened: false, frames: [] };
    }

    const dir = await screenshotDir(username);
    const frames = [];
    let lastUrl = '';

    for (let i = 1; i <= MAX_FRAMES; i++) {
      await pauseVideos(page);
      await sleep(400);

      const url = page.url();
      if (!url.includes('/stories/')) break;

      const { storyTakenAt } = await readFrameMeta(page);
      const idInfo = deriveSourceId(url, username, storyTakenAt);

      if (!idInfo) {
        log(`frame ${i}: no usable id (url=${url} takenAt=${storyTakenAt}) — skipping`);
      } else if (hasSeen(idInfo.sourceId)) {
        frames.push({
          frameIndex: i, ...idInfo, storyTakenAt, isNew: false,
          screenshotPath: null, event: null,
        });
      } else {
        const shotPath = storyFramePath(dir, i);
        await captureFullFrame(page, shotPath);

        let event = null;
        let visionError = null;
        if (runVision) {
          try {
            const res = await extractEvent({
              imagePath: shotPath,
              sourceType: 'story',
              username,
              tag,
            });
            event = res.event;
            const isUpcoming = event?.event === true && !isPastEventDate(event.date);
            if (isUpcoming) {
              insertEvent({
                account: username,
                sourceType: 'story',
                sourceId: idInfo.sourceId,
                sourceIdKind: idInfo.kind,
                storyTakenAt,
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
            log(`frame ${i}: vision error — ${e.message}`);
          }
        }

        const wasEvent = event?.event === true && !isPastEventDate(event.date);
        markSeen({
          sourceId: idInfo.sourceId,
          sourceIdKind: idInfo.kind,
          account: username,
          sourceType: 'story',
          storyTakenAt,
          wasEvent,
          error: visionError,
        });

        frames.push({
          frameIndex: i, ...idInfo, storyTakenAt, isNew: true,
          screenshotPath: shotPath, event: wasEvent ? event : null, visionError,
        });
      }

      if (url === lastUrl && i > 1) break;
      lastUrl = url;
      await advance(page);
      if (!page.url().includes('/stories/')) break;
    }

    return { opened: true, frames };
  } finally {
    await page.close().catch(() => {});
  }
}
