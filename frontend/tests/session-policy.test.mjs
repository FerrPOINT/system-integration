import assert from 'node:assert/strict';
import { test } from 'node:test';
import { QueryClient } from '@tanstack/react-query';
import {
  acceptSession,
  clearSession,
  expireSession,
  sessionKey,
  startSessionCommand,
} from '../src/features/auth/model/session-policy.ts';
import { ApiError } from '../src/shared/api/http.ts';

const a = { userId: 'account-a', role: 'INITIATOR', username: 'alice' };
async function accept(client, user) {
  client.setQueryData(sessionKey, await acceptSession(client, user));
}

for (const change of [
  { ...a, userId: 'account-b' },
  { ...a, role: 'OPERATOR' },
]) {
  test('late command 401 cannot expire accepted identity ' + JSON.stringify(change), async () => {
    const client = new QueryClient();
    try {
      await accept(client, a);
      const old = {};
      startSessionCommand(client, old);
      await accept(client, change);
      client.setQueryData(['private-new'], 'visible');
      await expireSession(client, new ApiError(401), old);
      assert.deepEqual(client.getQueryData(sessionKey), change);
      assert.equal(client.getQueryData(['private-new']), 'visible');
      const current = {};
      startSessionCommand(client, current);
      await expireSession(client, new ApiError(401), current);
      assert.equal(client.getQueryData(sessionKey), null);
      assert.equal(client.getQueryData(['private-new']), undefined);
    } finally {
      client.clear();
    }
  });
}

test('same identity refetch keeps a current failure valid; logout then re-login isolates old commands', async () => {
  const client = new QueryClient();
  try {
    await accept(client, a);
    const current = {};
    startSessionCommand(client, current);
    await accept(client, { ...a });
    await expireSession(client, new ApiError(401), current);
    assert.equal(client.getQueryData(sessionKey), null);
    await accept(client, a);
    const old = {};
    startSessionCommand(client, old);
    await clearSession(client);
    await accept(client, a);
    await expireSession(client, new ApiError(401), old);
    assert.deepEqual(client.getQueryData(sessionKey), a);
    await expireSession(client, new ApiError(403));
    assert.deepEqual(client.getQueryData(sessionKey), a);
    await expireSession(client, new ApiError(401));
    assert.equal(client.getQueryData(sessionKey), null);
  } finally {
    client.clear();
  }
});
