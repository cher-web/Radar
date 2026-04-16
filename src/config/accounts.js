import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { RADAR_DIR } from '../scanner/browser.js';

export const ACCOUNTS_PATH = join(RADAR_DIR, 'accounts.json');

export const VALID_TAGS = new Set([
  'venue', 'music', 'art', 'promoter', 'gallery', 'festival', 'collective',
]);

const EMPTY_STORE = { version: 1, accounts: [] };

export function normalizeHandle(raw) {
  return String(raw || '').trim().replace(/^@/, '').toLowerCase();
}

export async function loadAccounts() {
  try {
    const buf = await readFile(ACCOUNTS_PATH, 'utf8');
    const parsed = JSON.parse(buf);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.accounts)) {
      throw new Error('accounts file is malformed');
    }
    return parsed;
  } catch (e) {
    if (e.code === 'ENOENT') return structuredClone(EMPTY_STORE);
    throw e;
  }
}

export async function saveAccounts(store) {
  await mkdir(dirname(ACCOUNTS_PATH), { recursive: true });
  await writeFile(ACCOUNTS_PATH, JSON.stringify(store, null, 2) + '\n');
}

export async function addAccount(handle, tag) {
  const username = normalizeHandle(handle);
  if (!username) throw new Error('username is required');
  if (tag && !VALID_TAGS.has(tag)) {
    throw new Error(`invalid tag '${tag}'. valid: ${[...VALID_TAGS].join(', ')}`);
  }
  const store = await loadAccounts();
  const existing = store.accounts.find((a) => a.username === username);
  if (existing) {
    if (tag) existing.tag = tag;
    existing.active = true;
    await saveAccounts(store);
    return { username, created: false, tag: existing.tag };
  }
  const entry = {
    username,
    tag: tag || null,
    active: true,
    added: new Date().toISOString().slice(0, 10),
  };
  store.accounts.push(entry);
  store.accounts.sort((a, b) => a.username.localeCompare(b.username));
  await saveAccounts(store);
  return { username, created: true, tag: entry.tag };
}

export async function removeAccount(handle) {
  const username = normalizeHandle(handle);
  const store = await loadAccounts();
  const before = store.accounts.length;
  store.accounts = store.accounts.filter((a) => a.username !== username);
  const removed = store.accounts.length < before;
  if (removed) await saveAccounts(store);
  return { username, removed };
}

export async function accountsExists() {
  try { await access(ACCOUNTS_PATH); return true; } catch { return false; }
}

export async function importAccountsFrom(path) {
  const buf = await readFile(path, 'utf8');
  const parsed = JSON.parse(buf);
  if (!parsed || !Array.isArray(parsed.accounts)) {
    throw new Error(`${path}: not a valid accounts file (missing 'accounts' array)`);
  }
  const store = await loadAccounts();
  const existing = new Map(store.accounts.map((a) => [a.username, a]));
  let added = 0, updated = 0, skipped = 0;

  for (const raw of parsed.accounts) {
    if (!raw || typeof raw.username !== 'string') { skipped++; continue; }
    const username = normalizeHandle(raw.username);
    if (!username) { skipped++; continue; }
    const tag = typeof raw.tag === 'string' && VALID_TAGS.has(raw.tag) ? raw.tag : null;
    const active = raw.active !== false;
    const added_on = typeof raw.added === 'string' ? raw.added : new Date().toISOString().slice(0, 10);

    const prev = existing.get(username);
    if (prev) {
      prev.tag = tag || prev.tag;
      prev.active = active;
      updated++;
    } else {
      store.accounts.push({ username, tag, active, added: added_on });
      added++;
    }
  }
  store.accounts.sort((a, b) => a.username.localeCompare(b.username));
  await saveAccounts(store);
  return { added, updated, skipped };
}

export async function exportAccountsTo(path) {
  const store = await loadAccounts();
  const out = {
    version: store.version ?? 1,
    accounts: store.accounts.map((a) => ({
      username: a.username,
      tag: a.tag,
      active: a.active !== false,
      added: a.added,
    })),
  };
  await writeFile(path, JSON.stringify(out, null, 2) + '\n');
  return out.accounts.length;
}
