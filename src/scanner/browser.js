import { chromium } from 'playwright';
import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const RADAR_DIR = join(homedir(), '.radar');
export const SESSION_PATH = join(RADAR_DIR, 'session.json');

export const HOME_URL = 'https://www.instagram.com/';
export const LOGIN_URL = 'https://www.instagram.com/accounts/login/';

export async function sessionExists() {
  try { await access(SESSION_PATH); return true; } catch { return false; }
}

export async function isLoggedIn(page) {
  if (page.url().includes('/accounts/login')) return false;
  const nav = await page.locator('nav').first().count().catch(() => 0);
  return nav > 0;
}

const _openBrowsers = new Set();

export async function launchContext({ headless = true, useSession = true } = {}) {
  const browser = await chromium.launch({ headless });
  _openBrowsers.add(browser);
  const storageState = useSession && (await sessionExists()) ? SESSION_PATH : undefined;
  const context = await browser.newContext({
    storageState,
    viewport: { width: 1280, height: 900 },
  });
  const originalClose = browser.close.bind(browser);
  browser.close = async () => {
    _openBrowsers.delete(browser);
    return originalClose();
  };
  return { browser, context };
}

export async function closeAllBrowsers() {
  const tasks = [..._openBrowsers].map((b) => b.close().catch(() => {}));
  _openBrowsers.clear();
  await Promise.all(tasks);
}

export async function verifySessionValid() {
  if (!(await sessionExists())) return false;
  const { browser, context } = await launchContext({ headless: true, useSession: true });
  try {
    const page = await context.newPage();
    await page.goto(HOME_URL, { waitUntil: 'domcontentloaded' });
    await sleep(1500);
    return await isLoggedIn(page);
  } finally {
    await browser.close();
  }
}

export async function saveSession(context) {
  await mkdir(dirname(SESSION_PATH), { recursive: true });
  const state = await context.storageState();
  await writeFile(SESSION_PATH, JSON.stringify(state, null, 2));
  return state.cookies.length;
}

export async function clearSession() {
  await rm(SESSION_PATH, { force: true });
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class SessionExpiredError extends Error {
  constructor(url) {
    super(`Instagram session expired (redirected to ${url})`);
    this.name = 'SessionExpiredError';
  }
}

export function checkNotLoginRedirect(page) {
  const url = page.url();
  if (url.includes('/accounts/login/')) throw new SessionExpiredError(url);
}
