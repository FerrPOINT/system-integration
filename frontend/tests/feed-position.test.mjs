import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clearFeedPositions, positionKey, readPosition, writePosition } from '../src/shared/lib/collections/feed-position-storage.ts';

function memoryStorage() {
  const entries = new Map();
  return { get length() { return entries.size; }, key: index => [...entries.keys()][index] ?? null,
    getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value), removeItem: key => entries.delete(key) };
}
const position = { page: 14, index: 7, id: 'record', offset: -12, scrollY: 850 };

test('positions are metadata scoped to identity, route and collection', () => {
  const storage = memoryStorage();
  const key = positionKey('user:INITIATOR', '/tasks', 'filters');
  assert.equal(writePosition(key, position, storage), undefined);
  assert.deepEqual(readPosition(key, 20, storage), { position });
  assert.deepEqual(readPosition(positionKey('other:INITIATOR', '/tasks', 'filters'), 20, storage), {});
  assert.deepEqual(readPosition(positionKey('user:INITIATOR', '/tasks', 'different-filters'), 20, storage), {});
  assert.deepEqual(readPosition(positionKey('user:INITIATOR', 'different-entry', 'filters'), 20, storage), {});
  storage.setItem('unrelated', 'keep');
  clearFeedPositions(storage);
  assert.equal(storage.getItem(key), null);
  assert.equal(storage.getItem('unrelated'), 'keep');
});

test('invalid and unavailable browser storage are explicit; reading is pure', () => {
  const storage = memoryStorage();
  const key = positionKey('user', 'route', 'query');
  for (const value of ['{broken', JSON.stringify({ version: 2, position }), ...[
    { ...position, page: -1 }, { ...position, index: 20 }, { ...position, id: 3 }, { ...position, scrollY: null },
  ].map(position => JSON.stringify({ version: 1, position }))]) {
    storage.setItem(key, value);
    assert.deepEqual(readPosition(key, 20, storage), { issue: 'invalid' });
    assert.equal(storage.getItem(key), value);
  }
  const unavailable = { getItem() { throw new DOMException('Blocked', 'SecurityError'); } };
  assert.deepEqual(readPosition(key, 20, unavailable), { issue: 'unavailable' });
  assert.equal(writePosition(key, position, unavailable), 'unavailable');
});

test('the browser metadata store remains bounded while active positions can be updated', () => {
  const storage = memoryStorage();
  storage.setItem('unrelated', 'keep');
  for (let index = 0; index < 50; index++) writePosition(positionKey('user', 'route-' + index, 'query'), position, storage);
  assert.equal(storage.length, 33);
  const last = positionKey('user', 'route-49', 'query');
  writePosition(last, { ...position, offset: 40 }, storage);
  assert.equal(storage.length, 33);
  assert.equal(readPosition(last, 20, storage).position.offset, 40);
});
