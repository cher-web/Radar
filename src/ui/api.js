import { readFile, writeFile } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import {
  ACCOUNTS_PATH, VALID_TAGS,
  addAccount, loadAccounts, removeAccount,
} from '../config/accounts.js';
import { listEvents } from '../db/events.js';
import { SCREENSHOT_ROOT } from '../scanner/screenshot.js';

const SCREENSHOT_DIR_ABS = resolve(SCREENSHOT_ROOT);

function screenshotUrl(storedPath) {
  if (!storedPath) return null;
  const rel = relative(SCREENSHOT_DIR_ABS, resolve(storedPath));
  if (!rel || rel.startsWith('..')) return null;
  return '/screenshots/' + rel.split(sep).map(encodeURIComponent).join('/');
}
import {
  SessionExpiredError,
  clearSession, isLoggedIn, launchContext, saveSession,
  sessionExists, sleep, HOME_URL, LOGIN_URL,
} from '../scanner/browser.js';
import { runAllAccounts } from '../cli/commands/scan.js';
import { VALID_PROVIDERS, DEFAULT_PROVIDER } from '../vision/extract.js';

const ENV_PATH = '.env';

function mask(key) {
  if (!key) return null;
  if (key.length <= 12) return '••••••';
  return `${key.slice(0, 8)}${'•'.repeat(24)}${key.slice(-4)}`;
}

async function readEnv() {
  try { return await readFile(ENV_PATH, 'utf8'); } catch { return ''; }
}

async function writeEnvValue(key, value) {
  const content = await readEnv();
  const lines = content.split('\n').filter((l) => l && !l.startsWith(`${key}=`));
  lines.push(`${key}=${value}`);
  await writeFile(ENV_PATH, lines.join('\n') + '\n');
  process.env[key] = value;
}

function activeProvider() {
  const p = (process.env.RADAR_VISION_PROVIDER || DEFAULT_PROVIDER).toLowerCase();
  return VALID_PROVIDERS.includes(p) ? p : DEFAULT_PROVIDER;
}

function currentProviderKeyPresent() {
  const p = activeProvider();
  if (p === 'gemini') return !!(process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY);
  return !!process.env.ANTHROPIC_API_KEY;
}

export async function getSettings() {
  const anthropicKey = process.env.ANTHROPIC_API_KEY || null;
  const googleKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || null;
  const hasSession = await sessionExists();
  const provider = activeProvider();
  return {
    provider,
    validProviders: [...VALID_PROVIDERS],
    anthropic: {
      present: !!anthropicKey,
      masked: mask(anthropicKey),
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5',
    },
    google: {
      present: !!googleKey,
      masked: mask(googleKey),
      model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    },
    // Back-compat for any older UI code still reading these top-level fields.
    apiKey: { present: currentProviderKeyPresent(), masked: mask(provider === 'gemini' ? googleKey : anthropicKey) },
    model: provider === 'gemini'
      ? (process.env.GEMINI_MODEL || 'gemini-2.5-flash')
      : (process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5'),
    auth: { hasSession, status: hasSession ? 'saved' : 'missing' },
    validTags: [...VALID_TAGS],
    accountsPath: ACCOUNTS_PATH,
  };
}

export async function saveApiKey({ provider, apiKey }) {
  const target = (provider || '').toLowerCase();
  if (typeof apiKey !== 'string' || !apiKey.trim()) {
    return { error: 'api key is required' };
  }
  const trimmed = apiKey.trim();
  if (target === 'anthropic' || target === 'claude') {
    if (!trimmed.startsWith('sk-ant-')) return { error: 'Anthropic key must start with "sk-ant-"' };
    await writeEnvValue('ANTHROPIC_API_KEY', trimmed);
    return { ok: true, provider: 'anthropic', masked: mask(trimmed) };
  }
  if (target === 'google' || target === 'gemini') {
    await writeEnvValue('GOOGLE_API_KEY', trimmed);
    return { ok: true, provider: 'google', masked: mask(trimmed) };
  }
  return { error: `unknown provider "${provider}"` };
}

export async function saveProvider({ provider }) {
  const p = (provider || '').toLowerCase();
  if (!VALID_PROVIDERS.includes(p)) return { error: `provider must be one of: ${VALID_PROVIDERS.join(', ')}` };
  await writeEnvValue('RADAR_VISION_PROVIDER', p);
  return { ok: true, provider: p };
}

export async function listAccountsApi() {
  const store = await loadAccounts();
  return { accounts: store.accounts };
}

export async function addAccountApi({ username, tag }) {
  try {
    const res = await addAccount(username, tag || null);
    return { ok: true, ...res };
  } catch (e) {
    return { error: e.message };
  }
}

export async function removeAccountApi(username) {
  const res = await removeAccount(username);
  return { ok: true, ...res };
}

export async function listEventsApi({ upcoming = true, includeLow = false } = {}) {
  const rows = listEvents({ upcomingOnly: upcoming });
  const filtered = includeLow ? rows : rows.filter((r) => r.confidence !== 'low');
  const events = filtered.map((r) => ({ ...r, screenshot_url: screenshotUrl(r.screenshot_path) }));
  return { events };
}

// Auth login: spawns a headed Chromium, waits for manual login, saves session.
// Can take up to 5 minutes.
export async function loginApi() {
  const { browser, context } = await launchContext({ headless: false, useSession: await sessionExists() });
  try {
    const page = await context.newPage();
    await page.goto(HOME_URL, { waitUntil: 'domcontentloaded' });
    await sleep(2000);
    if (!(await isLoggedIn(page))) {
      await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });
      const deadline = Date.now() + 5 * 60_000;
      while (Date.now() < deadline) {
        if (await isLoggedIn(page)) break;
        await sleep(1500);
      }
      if (!(await isLoggedIn(page))) return { error: 'login timed out after 5 minutes' };
    }
    for (const label of ['Not Now', 'Not now']) {
      const btn = page.getByRole('button', { name: label });
      if (await btn.count().catch(() => 0)) {
        await btn.first().click().catch(() => {});
        await sleep(500);
      }
    }
    const cookies = await saveSession(context);
    return { ok: true, cookies };
  } finally {
    await browser.close();
  }
}

export async function logoutApi() {
  await clearSession();
  return { ok: true };
}

// Scan state. Single global slot — only one scan at a time.
let _scanState = {
  running: false,
  startedAt: null,
  completedAt: null,
  error: null,
  sessionExpired: false,
  eventsFound: null,
  progress: null, // { total, current, phase, accountName }
};

export function getScanState() {
  return _scanState;
}

export async function startScanApi() {
  if (_scanState.running) return { error: 'scan already in progress' };
  if (!(await sessionExists())) return { error: 'no Instagram session — please log in first' };
  if (!process.env.ANTHROPIC_API_KEY) return { error: 'ANTHROPIC_API_KEY not set — save it in Settings' };

  _scanState = {
    running: true,
    startedAt: new Date().toISOString(),
    completedAt: null,
    error: null,
    sessionExpired: false,
    eventsFound: null,
    progress: null,
  };

  (async () => {
    const eventsBefore = listEvents({ upcomingOnly: false }).length;
    try {
      await runAllAccounts({ stories: true, posts: true }, {
        onProgress: (p) => { _scanState.progress = { ...(_scanState.progress || {}), ...p }; },
      });
    } catch (e) {
      _scanState.error = e.message;
      if (e instanceof SessionExpiredError) _scanState.sessionExpired = true;
    }
    const eventsAfter = listEvents({ upcomingOnly: false }).length;
    _scanState.eventsFound = Math.max(0, eventsAfter - eventsBefore);
    _scanState.running = false;
    _scanState.completedAt = new Date().toISOString();
  })();

  return { ok: true };
}
