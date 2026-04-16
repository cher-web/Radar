import { extractWithClaude } from './providers/claude.js';
import { extractWithGemini } from './providers/gemini.js';

export const VALID_PROVIDERS = ['claude', 'gemini'];
export const DEFAULT_PROVIDER = 'claude';

function activeProvider() {
  const p = (process.env.RADAR_VISION_PROVIDER || DEFAULT_PROVIDER).toLowerCase();
  return VALID_PROVIDERS.includes(p) ? p : DEFAULT_PROVIDER;
}

/**
 * True if a vision-extracted event.date refers to a day strictly before today.
 * Null/unparseable dates return false (we keep "Date TBD" events).
 */
export function isPastEventDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return false;
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return false;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00`);
  if (isNaN(d.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d < today;
}

/**
 * Extract event data from a screenshot using the active vision provider.
 *
 * @param {object} args
 * @param {string} args.imagePath   — absolute path to PNG
 * @param {'story'|'post'} args.sourceType
 * @param {string} args.username    — owner handle (without @)
 * @param {string|null} args.tag    — account tag, or null
 * @param {string} [args.captionText] — optional accompanying caption text
 * @returns {Promise<{ event: object, raw: string, usage?: object }>}
 */
export async function extractEvent(args) {
  const provider = activeProvider();
  if (provider === 'gemini') return extractWithGemini(args);
  return extractWithClaude(args);
}
