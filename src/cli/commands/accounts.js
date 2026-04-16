import chalk from 'chalk';
import {
  ACCOUNTS_PATH,
  addAccount,
  exportAccountsTo,
  importAccountsFrom,
  loadAccounts,
  removeAccount,
} from '../../config/accounts.js';
import { err, heading, info, ok, warn } from '../output.js';

export async function list() {
  heading('radar accounts');
  const store = await loadAccounts();
  if (store.accounts.length === 0) {
    info(`no accounts tracked (${ACCOUNTS_PATH})`);
    info('add one with: radar accounts add <handle> --tag venue');
    return;
  }
  const pad = Math.max(...store.accounts.map((a) => a.username.length));
  for (const a of store.accounts) {
    const marker = a.active ? chalk.green('●') : chalk.dim('○');
    const tag = a.tag ? chalk.cyan(a.tag) : chalk.dim('—');
    console.log(`  ${marker} @${a.username.padEnd(pad)}  ${tag}  ${chalk.dim(a.added)}`);
  }
  info(`${store.accounts.length} account${store.accounts.length === 1 ? '' : 's'}`);
}

export async function add(handle, opts) {
  heading(`radar accounts add ${handle}`);
  try {
    const res = await addAccount(handle, opts?.tag);
    if (res.created) {
      ok(`added @${res.username}${res.tag ? ` (${res.tag})` : ''}`);
    } else {
      warn(`@${res.username} already tracked${res.tag ? ` — tag set to ${res.tag}` : ''}`);
    }
  } catch (e) {
    err(e.message);
    process.exit(1);
  }
}

export async function remove(handle) {
  heading(`radar accounts remove ${handle}`);
  const res = await removeAccount(handle);
  if (res.removed) {
    ok(`removed @${res.username}`);
  } else {
    warn(`@${res.username} was not tracked`);
  }
}

export async function importFile(path) {
  heading(`radar accounts import ${path}`);
  try {
    const res = await importAccountsFrom(path);
    ok(`imported: ${res.added} added, ${res.updated} updated${res.skipped ? `, ${res.skipped} skipped` : ''}`);
  } catch (e) {
    err(e.message);
    process.exit(1);
  }
}

export async function exportFile(path) {
  heading(`radar accounts export ${path}`);
  try {
    const n = await exportAccountsTo(path);
    ok(`exported ${n} account${n === 1 ? '' : 's'} → ${path}`);
  } catch (e) {
    err(e.message);
    process.exit(1);
  }
}
