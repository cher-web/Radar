// Spike 1 — login flow + session persistence
//
// Goal: produce a storageState at ~/.radar/session.json that survives 2FA,
// the "save login info" prompt, and the "turn on notifications" prompt, and
// that is reusable by a headless context on a later run.
//
// Flow:
//   1. Launch headed Chromium.
//   2. Navigate to instagram.com. If already logged in (reused storageState),
//      confirm and exit.
//   3. Otherwise wait for the user to complete login manually (including 2FA).
//      Detect completion by polling for the main feed URL / nav.
//   4. Save storageState.
//   5. Close the context, reopen headless with the saved state, hit
//      instagram.com, and verify we didn't get redirected to /accounts/login.

import { chromium } from 'playwright';
import { writeFile, mkdir, access } from 'node:fs/promises';
import { dirname } from 'node:path';
import { SESSION_PATH, log, sleep } from './_shared.mjs';

const LOGIN_URL = 'https://www.instagram.com/accounts/login/';
const HOME_URL = 'https://www.instagram.com/';

async function sessionExists() {
  try { await access(SESSION_PATH); return true; } catch { return false; }
}

async function isLoggedIn(page) {
  // Heuristic: logged-in users see a `nav` with aria-label including "Primary"
  // or a link to /direct/inbox/. Logged-out users are redirected to /accounts/login/.
  const url = page.url();
  if (url.includes('/accounts/login')) return false;
  const nav = await page.locator('nav').first().count().catch(() => 0);
  return nav > 0;
}

async function waitForLogin(page, timeoutMs = 5 * 60_000) {
  const start = Date.now();
  log('waiting for manual login (up to 5 minutes)...');
  while (Date.now() - start < timeoutMs) {
    if (await isLoggedIn(page)) return true;
    await sleep(1500);
  }
  return false;
}

async function main() {
  await mkdir(dirname(SESSION_PATH), { recursive: true });

  const hadSession = await sessionExists();
  log(`session file at ${SESSION_PATH}: ${hadSession ? 'present' : 'missing'}`);

  // Phase A: headed, capture/refresh storageState
  log('launching headed chromium...');
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext({
    storageState: hadSession ? SESSION_PATH : undefined,
    viewport: { width: 1280, height: 900 },
  });
  const page = await ctx.newPage();

  await page.goto(HOME_URL, { waitUntil: 'domcontentloaded' });
  await sleep(2000);

  if (await isLoggedIn(page)) {
    log('already logged in via stored session — refreshing storageState.');
  } else {
    log('not logged in. navigating to login page...');
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });
    const ok = await waitForLogin(page);
    if (!ok) {
      log('ERROR: timed out waiting for login. aborting.');
      await browser.close();
      process.exit(1);
    }
    log('login detected.');
  }

  // Dismiss common post-login interstitials if present
  for (const label of ['Not Now', 'Not now']) {
    const btn = page.getByRole('button', { name: label });
    if (await btn.count().catch(() => 0)) {
      await btn.first().click().catch(() => {});
      await sleep(500);
    }
  }

  const state = await ctx.storageState();
  await writeFile(SESSION_PATH, JSON.stringify(state, null, 2));
  log(`saved storageState → ${SESSION_PATH} (${state.cookies.length} cookies)`);

  await browser.close();

  // Phase B: headless verification
  log('reopening headless with saved state to verify...');
  const headless = await chromium.launch({ headless: true });
  const hctx = await headless.newContext({ storageState: SESSION_PATH });
  const hpage = await hctx.newPage();
  await hpage.goto(HOME_URL, { waitUntil: 'domcontentloaded' });
  await sleep(2500);
  const ok = await isLoggedIn(hpage);
  const finalUrl = hpage.url();
  log(`headless check — url=${finalUrl} loggedIn=${ok}`);
  await headless.close();

  if (!ok) {
    log('WARNING: headless context was not logged in. May need to re-run or fall back to headed.');
    process.exit(2);
  }
  log('done. session is valid headless.');
}

main().catch((e) => { console.error(e); process.exit(1); });
