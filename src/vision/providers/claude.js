import Anthropic from '@anthropic-ai/sdk';
import { readFile } from 'node:fs/promises';
import { CLAUDE_SYSTEM_PROMPT, buildUserPrompt } from '../prompt.js';

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [1000, 4000, 16000];

let _client = null;
function client() {
  if (!_client) _client = new Anthropic();
  return _client;
}

function parseJsonFromText(text) {
  const trimmed = text.trim();
  try { return JSON.parse(trimmed); } catch {}
  const m = trimmed.match(/\{[\s\S]*\}/);
  if (m) {
    try { return JSON.parse(m[0]); } catch {}
  }
  throw new Error(`non-JSON response from Claude: ${trimmed.slice(0, 200)}`);
}

function isRetryable(err) {
  if (err instanceof Anthropic.RateLimitError) return true;
  if (err instanceof Anthropic.InternalServerError) return true;
  if (err && typeof err.status === 'number' && err.status >= 500) return true;
  return false;
}

async function withRetry(fn) {
  let lastErr;
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    try { return await fn(); }
    catch (e) {
      lastErr = e;
      if (i === MAX_ATTEMPTS - 1 || !isRetryable(e)) throw e;
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[i]));
    }
  }
  throw lastErr;
}

export async function extractWithClaude({ imagePath, sourceType, username, tag, captionText }) {
  const imgBytes = await readFile(imagePath);
  const b64 = imgBytes.toString('base64');

  const userBlocks = [
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: b64 } },
    { type: 'text', text: buildUserPrompt({ sourceType, username, tag }) },
  ];
  if (captionText) {
    userBlocks.push({ type: 'text', text: `Accompanying caption text:\n${captionText}` });
  }

  const response = await withRetry(() =>
    client().messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: [
        { type: 'text', text: CLAUDE_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
      ],
      messages: [{ role: 'user', content: userBlocks }],
    }),
  );

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock) throw new Error('Claude response had no text block');

  const parsed = parseJsonFromText(textBlock.text);
  return { event: parsed, raw: textBlock.text, usage: response.usage };
}
