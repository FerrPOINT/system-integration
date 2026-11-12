import assert from 'node:assert/strict';
import { test } from 'node:test';

const backend = process.env.SI_BACKEND_URL ?? 'http://127.0.0.1:19580';
const frontend = process.env.SI_FRONTEND_URL ?? 'http://127.0.0.1:19573';

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
