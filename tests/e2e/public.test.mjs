import assert from 'node:assert/strict';
import { test } from 'node:test';
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { ApiSession, ApiFailure } from '../support/http.mjs';

const origin = 'https://demo.azhukov-dev.ru';

test('TC-16: public HTTPS, secure session, roles and private service boundaries', async () => {
  assert.ok(process.env.SI_DEMO_PASSWORD, 'SI_DEMO_PASSWORD is required');
  const receipt = { origin, checkedAt: new Date().toISOString(), roles: [], passed: false };
  const response = await fetch(origin, { signal: AbortSignal.timeout(10_000) });
  assert.equal(response.status, 200);
  assert.ok(response.headers.has('strict-transport-security'));
  const html = await response.text();
  assert.match(html, /<title>Обмен с внешней системой<\/title>/);
  const asset = html.match(/<script\b[^>]*\bsrc="([^"]+\.js)"/)[1];
  const script = await fetch(new URL(asset, origin), { signal: AbortSignal.timeout(10_000) });
  assert.equal(script.status, 200);
  receipt.asset = {
    path: asset,
    sha256: createHash('sha256')
      .update(Buffer.from(await script.arrayBuffer()))
      .digest('hex'),
  };
  const csrf = await fetch(origin + '/api/csrf', { signal: AbortSignal.timeout(10_000) });
  assert.equal(csrf.status, 200);
  assert.ok(
    csrf.headers.get('cache-control')?.includes('no-store'),
    'Session-bound API responses must not be stored by HTTP caches',
  );
  const cookies = csrf.headers.getSetCookie().join('; ');
  for (const flag of [/;\s*Secure(?:;|$)/i, /;\s*HttpOnly(?:;|$)/i, /SameSite=Strict/i])
    assert.ok(flag.test(cookies), 'Public session cookie must be Secure, HttpOnly and SameSite=Strict');
  const sessions = [];
  for (const [username, role] of [
    ['initiator.one', 'INITIATOR'],
    ['initiator.two', 'INITIATOR'],
    ['operator', 'OPERATOR'],
  ]) {
    const client = new ApiSession(origin);
    const session = await client.login(username, process.env.SI_DEMO_PASSWORD);
    assert.equal(session.username, username);
    assert.equal(session.role, role);
    const list = await client.get('/api/tasks');
    assert.ok(list.items.length > 0);
    if (role === 'INITIATOR') assert.ok(list.items.every((task) => task.ownerId === session.userId));
    sessions.push({ client, list });
    receipt.roles.push({ username, role, visibleItems: list.items.length });
  }
  const foreign = sessions[0].list.items[0].taskId;
  await assert.rejects(
    sessions[1].client.get('/api/tasks/' + foreign),
    (error) => error instanceof ApiFailure && error.status === 404,
  );
  assert.equal((await sessions[2].client.get('/api/tasks/' + foreign)).taskId, foreign);
  for (const { client } of sessions) {
    await client.command('POST', '/api/logout');
    await assert.rejects(client.get('/api/tasks'), (error) => error.status === 401);
  }
  for (const path of ['/actuator/health', '/test/faults/REQ-900001', '/operations']) {
    const reply = await fetch(origin + path, { signal: AbortSignal.timeout(10_000) });
    assert.ok(
      !reply.headers.get('content-type')?.includes('application/json'),
      'Internal service must not be publicly routed',
    );
  }
  receipt.secureCookie = true;
  receipt.foreignTaskDenied = true;
  receipt.logoutEnforced = true;
  receipt.internalServicesPrivate = true;
  receipt.passed = true;
  await writeFile(new URL('../results/public.json', import.meta.url), JSON.stringify(receipt, null, 2) + '\n');
});
