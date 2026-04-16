import { GoogleGenAI } from '@google/genai';
import { readFile } from 'node:fs/promises';
import { CORE_CRITERIA, GEMINI_RESPONSE_SCHEMA, buildUserPrompt } from '../prompt.js';

const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [1000, 4000, 16000];

let _client = null;
function client() {
  if (!_client) {
    const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GOOGLE_API_KEY not set — save it in Settings');
    _client = new GoogleGenAI({ apiKey });
  }
  return _client;
}

function isRetryable(err) {
  const status = err?.status ?? err?.response?.status;
  if (typeof status === 'number' && (status === 429 || status >= 500)) return true;
  if (err?.message && /rate limit|timeout|ETIMEDOUT|ECONNRESET/i.test(err.message)) return true;
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

export async function extractWithGemini({ imagePath, sourceType, username, tag, captionText }) {
  const imgBytes = await readFile(imagePath);
  const b64 = imgBytes.toString('base64');

  const userText = buildUserPrompt({ sourceType, username, tag })
    + (captionText ? `\n\nAccompanying caption text:\n${captionText}` : '');

  const parts = [
    { inlineData: { mimeType: 'image/png', data: b64 } },
    { text: userText },
  ];

  const response = await withRetry(() =>
    client().models.generateContent({
      model: MODEL,
      contents: [{ role: 'user', parts }],
      config: {
        systemInstruction: CORE_CRITERIA,
        responseMimeType: 'application/json',
        responseSchema: GEMINI_RESPONSE_SCHEMA,
        temperature: 0.1,
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
  );

  const raw = response.text ?? '';
  if (!raw) throw new Error('Gemini response had no text');

  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (e) { throw new Error(`non-JSON response from Gemini: ${raw.slice(0, 200)}`); }

  return { event: parsed, raw, usage: response.usageMetadata };
}
