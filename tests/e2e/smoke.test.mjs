import assert from 'node:assert/strict';
import { test } from 'node:test';
import { get as httpGet } from 'node:http';
import { get as httpsGet } from 'node:https';
import { gunzipSync } from 'node:zlib';

const backend = process.env.SI_BACKEND_URL ?? 'http://127.0.0.1:19680';
const frontend = process.env.SI_FRONTEND_URL ?? 'http://127.0.0.1:19673';

test('backend is healthy', async () => {
  const response = await fetch(new URL('/actuator/health', backend), {
    signal: AbortSignal.timeout(5000),
  });

  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, 'UP');
});

test('frontend serves the built application and its JavaScript', async () => {
  const page = await fetch(frontend, { signal: AbortSignal.timeout(5000) });

  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /<title>Обмен с внешней системой<\/title>/);

  const entry = html.match(/<script\b[^>]*\bsrc="([^"]+\.js)"/);
  assert.ok(entry, 'The built page must reference a JavaScript entry point');

  const script = await fetch(new URL(entry[1], page.url), {
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(script.status, 200);
  assert.match(script.headers.get('content-type') ?? '', /javascript/);
});


test('frontend proxies protected API routes to the backend', async () => {
  const response = await fetch(new URL('/api/session', frontend), { signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, 'SESSION_REQUIRED');
});

function rawGet(value, encoding) {
  const url = new URL(value);
  assert.ok(['http:', 'https:'].includes(url.protocol));
  return new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? httpsGet : httpGet)(url, {
      headers: { 'Accept-Encoding': encoding }, signal: AbortSignal.timeout(5000),
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('error', reject);
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
    });
    request.on('error', reject);
  });
}

test('built JS and CSS negotiate precompressed gzip and retain exact identity bytes', async () => {
  const page = await fetch(frontend, { signal: AbortSignal.timeout(5000) });
  const html = await page.text();
  const js = html.match(/<script\b[^>]*\bsrc="([^"]+\.js)"/)?.[1];
  const css = html.match(/<link\b[^>]*\bhref="([^"]+\.css)"/)?.[1];
  assert.ok(js && css, 'Both compiled JS and CSS must be referenced');
  for (const path of [js, css]) {
    const url = new URL(path, page.url);
    const identity = await rawGet(url, 'identity');
    const compressed = await rawGet(url, 'gzip');
    const refused = await rawGet(url, 'gzip;q=0, identity');
    assert.equal(identity.status, 200);
    assert.equal(compressed.status, 200);
    assert.equal(refused.status, 200);
    assert.equal(identity.headers['content-encoding'], undefined);
    assert.equal(compressed.headers['content-encoding'], 'gzip');
    assert.equal(refused.headers['content-encoding'], undefined);
    assert.match(String(identity.headers.vary), /accept-encoding/i);
    assert.match(String(compressed.headers.vary), /accept-encoding/i);
    assert.deepEqual(gunzipSync(compressed.body), identity.body);
    assert.deepEqual(refused.body, identity.body);
    assert.ok(compressed.body.length < identity.body.length, 'Precompression should reduce asset bytes');
  }
  const api = await rawGet(new URL('/api/session', frontend), 'gzip');
  assert.equal(api.status, 401);
  assert.equal(api.headers['content-encoding'], undefined, 'Static gzip policy must not be inherited by private API');
});
