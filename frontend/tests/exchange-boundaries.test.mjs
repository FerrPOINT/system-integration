import assert from 'node:assert/strict';
import { test } from 'node:test';
import { QueryClient } from '@tanstack/react-query';
import { invalidateExchange } from '../src/features/operations/api/invalidate-exchange.ts';
import { taskKeys } from '../src/features/tasks/api/task-keys.ts';
import { exchangeKeys } from '../src/features/operations/api/exchange-keys.ts';
import { decisionBasis, isDecisionStale, decisionActions } from '../src/features/operations/model/decision.ts';

test('exchange invalidation affects its subjects and lists, preserving other records and saved snapshots', async () => {
  const client = new QueryClient();
  const affected = [taskKeys.task('a'), taskKeys.history('a'), taskKeys.taskList({}), exchangeKeys.issue('a'), exchangeKeys.issueList('OPEN'), exchangeKeys.issueList('RESOLVED')];
  const unchanged = [taskKeys.task('b'), taskKeys.history('b'), exchangeKeys.issue('b'), exchangeKeys.reconciliation('a', 'saved')];
  for (const key of [...affected, ...unchanged]) client.setQueryData(key, { fixture: true });
  await invalidateExchange(client, { taskId: 'a', issueId: 'a' });
  for (const key of affected) assert.equal(client.getQueryState(key).isInvalidated, true, JSON.stringify(key));
  for (const key of unchanged) assert.equal(client.getQueryState(key).isInvalidated, false, JSON.stringify(key));
  client.clear();
});

test('global issues do not invalidate task data; an empty scope fails explicitly', async () => {
  const client = new QueryClient();
  client.setQueryData(taskKeys.task('a'), { fixture: true });
  client.setQueryData(exchangeKeys.issue('global'), { fixture: true });
  await invalidateExchange(client, { issueId: 'global' });
  assert.equal(client.getQueryState(taskKeys.task('a')).isInvalidated, false);
  assert.equal(client.getQueryState(exchangeKeys.issue('global')).isInvalidated, true);
  await assert.rejects(invalidateExchange(client, {}), /Не указан обмен/);
  client.clear();
});

test('decision basis stays frozen across revision, snapshot and status changes', () => {
  const issue = { issueRevision: 1, latestReconciliationId: 'first', status: 'OPEN', allowedActions: ['TAKE_OWNERSHIP', 'ACKNOWLEDGE_DIFFERENCE'] };
  const basis = decisionBasis(issue);
  assert.equal(isDecisionStale(basis, { ...issue }), false);
  assert.equal(isDecisionStale(basis, { ...issue, issueRevision: 2 }), true);
  assert.equal(isDecisionStale(basis, { ...issue, latestReconciliationId: 'second' }), true);
  assert.equal(isDecisionStale(basis, { ...issue, status: 'RESOLVED' }), true);
  assert.deepEqual(basis, { issueRevision: 1, latestReconciliationId: 'first' });
  assert.deepEqual(decisionActions(issue), ['ACKNOWLEDGE_DIFFERENCE']);
});
