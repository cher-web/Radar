import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const SESSION_PATH = join(homedir(), '.radar', 'session.json');

export async function ensureDir(path) {
  await mkdir(path, { recursive: true });
}

export async function makeRunDir(label) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = join('spikes', 'out', `${ts}-${label}`);
  await ensureDir(dir);
  return dir;
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function log(...args) {
  console.log('[spike]', ...args);
}
