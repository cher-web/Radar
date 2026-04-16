import {
  HOME_URL,
  LOGIN_URL,
  SESSION_PATH,
  clearSession,
  isLoggedIn,
  launchContext,
  saveSession,
  sessionExists,
  sleep,
} from '../../scanner/browser.js';
import { err, heading, info, ok, warn } from '../output.js';

const LOGIN_TIMEOUT_MS = 5 * 60_000;

async function waitForLogin(page, timeoutMs = LOGIN_TIMEOUT_MS) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isLoggedIn(page)) return true;
    await sleep(1500);
  }
  return false;
}

async function dismissInterstitials(page) {
  for (const label of ['Not Now', 'Not now']) {
    const btn = page.getByRole('button', { name: label });
    if (await btn.count().catch(() => 0)) {
      await btn.first().click().catch(() => {});
      await sleep(500);
    }
  }
}

export async function login() {
  heading('radar auth login');
  const hadSession = await sessionExists();
  info(`session file: ${hadSession ? 'present (will refresh)' : 'missing'}`);

  const { browser, context } = await launchContext({ headless: false, useSession: hadSession });
  const page = await context.newPage();
  await page.goto(HOME_URL, { waitUntil: 'domcontentloaded' });
  await sleep(2000);

  if (!(await isLoggedIn(page))) {
    info('opening login page — complete sign-in in the browser window (2FA if prompted).');
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });
    const signedIn = await waitForLogin(page);
    if (!signedIn) {
      err('timed out waiting for login (5 min)');
      await browser.close();
      process.exit(1);
    }
  }

  await dismissInterstitials(page);
  const cookieCount = await saveSession(context);
  ok(`saved session → ${SESSION_PATH} (${cookieCount} cookies)`);
  await browser.close();

  info('verifying headless reuse...');
  const { browser: hb, context: hctx } = await launchContext({ headless: true, useSession: true });
  const hpage = await hctx.newPage();
  await hpage.goto(HOME_URL, { waitUntil: 'domcontentloaded' });
  await sleep(2500);
  const valid = await isLoggedIn(hpage);
  await hb.close();

  if (!valid) {
    warn('headless context was not logged in — session saved but may need re-login');
    process.exit(2);
  }
  ok('session is valid headless');
}

export async function status() {
  heading('radar auth status');
  if (!(await sessionExists())) {
    warn(`no session saved at ${SESSION_PATH}`);
    info('run `radar auth login` to sign in');
    process.exit(1);
  }

  const { browser, context } = await launchContext({ headless: true, useSession: true });
  const page = await context.newPage();
  await page.goto(HOME_URL, { waitUntil: 'domcontentloaded' });
  await sleep(2000);
  const valid = await isLoggedIn(page);
  await browser.close();

  if (valid) {
    ok('session is valid');
  } else {
    err('session is invalid or expired');
    info('run `radar auth login` to re-authenticate');
    process.exit(1);
  }
}

export async function logout() {
  heading('radar auth logout');
  if (!(await sessionExists())) {
    info('no saved session to remove');
    return;
  }
  await clearSession();
  ok(`removed ${SESSION_PATH}`);
}
