import { randomUUID } from 'node:crypto';

export class ApiFailure extends Error {
  constructor(status, code) { super(`HTTP ${status}: ${code}`); this.status = status; this.code = code; }
}

export class ApiSession {
  #cookies = new Map();
  #csrf;
  #requestHeaders;
  constructor(base, requestHeaders = {}) {
    this.base = new URL(base);
    this.#requestHeaders = { ...requestHeaders };
  }

  async request(method, path, body, headers = {}) {
    const response = await fetch(new URL(path, this.base), {
      method, redirect: 'manual', signal: AbortSignal.timeout(10_000),
      headers: { Accept: 'application/json', ...this.#requestHeaders, Cookie: [...this.#cookies].map(([k, v]) => `${k}=${v}`).join('; '), ...headers },
      body,
    });
    for (const value of response.headers.getSetCookie()) {
      const cookie = value.split(';', 1)[0]; const separator = cookie.indexOf('=');
      this.#cookies.set(cookie.slice(0, separator), cookie.slice(separator + 1));
    }
    const text = await response.text();
    let result;
    try { result = text ? JSON.parse(text) : undefined; }
    catch { throw new ApiFailure(response.status, 'INVALID_JSON'); }
    if (!response.ok) throw new ApiFailure(response.status, result?.code || 'UNEXPECTED_RESPONSE');
    return result;
  }

  get(path) { return this.request('GET', path); }

  async login(username, password) {
    this.#csrf = (await this.get('/api/csrf')).token;
    await this.request('POST', '/api/login', new URLSearchParams({ username, password }), {
      'Content-Type': 'application/x-www-form-urlencoded', 'X-CSRF-TOKEN': this.#csrf,
    });
    this.#csrf = (await this.get('/api/csrf')).token;
    return this.get('/api/session');
  }

  command(method, path, input, key = randomUUID()) {
    return this.request(method, path, input === undefined ? undefined : JSON.stringify(input), {
      'Content-Type': 'application/json', 'X-CSRF-TOKEN': this.#csrf, 'Idempotency-Key': key,
    });
  }
}

export function localOrigin(value) {
  const url = new URL(value);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    throw new Error('This test runner requires a local test origin');
  return url.origin;
}

export async function parallel(items, concurrency, operation) {
  let cursor = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (cursor < items.length) { const index = cursor++; await operation(items[index], index); }
  }));
}
