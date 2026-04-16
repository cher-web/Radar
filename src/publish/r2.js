import { AwsClient } from 'aws4fetch';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

let _client = null;
let _endpoint = null;

function ensureConfig() {
  const req = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'R2_PUBLIC_URL'];
  const missing = req.filter((k) => !process.env[k]);
  if (missing.length) throw new Error(`R2 not configured — missing ${missing.join(', ')}`);
}

function client() {
  if (_client) return _client;
  ensureConfig();
  _client = new AwsClient({
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    service: 's3',
    region: 'auto',
  });
  _endpoint = `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${process.env.R2_BUCKET}`;
  return _client;
}

function objectUrl(key) {
  return `${_endpoint}/${key}`;
}

export function publicUrl(key) {
  return `${process.env.R2_PUBLIC_URL.replace(/\/$/, '')}/${key}`;
}

export async function objectExists(key) {
  const res = await client().fetch(objectUrl(key), { method: 'HEAD' });
  return res.status === 200;
}

export async function putObject(key, body, { contentType, cacheControl } = {}) {
  const headers = {};
  if (contentType) headers['content-type'] = contentType;
  if (cacheControl) headers['cache-control'] = cacheControl;
  const res = await client().fetch(objectUrl(key), { method: 'PUT', body, headers });
  if (!res.ok) throw new Error(`R2 PUT ${key} failed: ${res.status} ${res.statusText}`);
  return publicUrl(key);
}

/** Content-addressed upload — skips if the hash already exists in the bucket. */
export async function putFileContentAddressed(localPath, prefix = 'screenshots') {
  const buf = await readFile(localPath);
  const hash = createHash('sha256').update(buf).digest('hex').slice(0, 32);
  const ext = localPath.split('.').pop().toLowerCase();
  const key = `${prefix}/${hash}.${ext}`;
  const existed = await objectExists(key).catch(() => false);
  if (!existed) {
    await putObject(key, buf, {
      contentType: ext === 'png' ? 'image/png' : 'application/octet-stream',
      cacheControl: 'public, max-age=31536000, immutable',
    });
  }
  return { key, url: publicUrl(key), uploaded: !existed };
}

export async function putJson(key, data, { maxAge = 60 } = {}) {
  return putObject(key, JSON.stringify(data), {
    contentType: 'application/json; charset=utf-8',
    cacheControl: `public, max-age=${maxAge}, must-revalidate`,
  });
}
