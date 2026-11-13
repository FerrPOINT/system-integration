import assert from 'node:assert/strict';
import { test } from 'node:test';
import { taskRefreshInterval } from '../src/features/tasks/refresh-interval.ts';

test('active delivery and execution retain the three-second refresh', () => {
  for (const businessStatus of ['PENDING', 'RUNNING'])
    for (const deliveryStatus of ['QUEUED', 'RETRY_WAIT', 'UNKNOWN', 'ACKNOWLEDGED'])
      assert.equal(taskRefreshInterval({ businessStatus, deliveryStatus }), 3000);
});

test('paused stopped and terminal tasks use a slower refresh without abandoning history', () => {
  for (const businessStatus of ['PENDING', 'RUNNING', 'SUCCEEDED', 'REJECTED'])
    for (const deliveryStatus of ['NEEDS_REVIEW', 'STOPPED'])
      assert.equal(taskRefreshInterval({ businessStatus, deliveryStatus }), 10000);
  for (const businessStatus of ['SUCCEEDED', 'REJECTED'])
    for (const deliveryStatus of ['QUEUED', 'RETRY_WAIT', 'UNKNOWN', 'ACKNOWLEDGED'])
      assert.equal(taskRefreshInterval({ businessStatus, deliveryStatus }), 10000);
});

test('no task data does not start a polling loop', () => {
  assert.equal(taskRefreshInterval(undefined), false);
});
