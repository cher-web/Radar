import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export const SCREENSHOT_ROOT = process.env.RADAR_SCREENSHOT_DIR || './screenshots';

export function scanDateFolder(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export async function screenshotDir(account, date = new Date()) {
  const dir = join(SCREENSHOT_ROOT, scanDateFolder(date), account);
  await mkdir(dir, { recursive: true });
  return dir;
}

export function storyFramePath(dir, frameIndex) {
  return join(dir, `story-${String(frameIndex).padStart(2, '0')}.png`);
}

export function postTilePath(dir, shortcode) {
  return join(dir, `post-${shortcode}.png`);
}

export async function captureFullFrame(page, path) {
  await page.screenshot({ path, fullPage: false });
  return path;
}
