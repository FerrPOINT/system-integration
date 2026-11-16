import assert from 'node:assert/strict';
import { test } from 'node:test';
import { listPositionScope } from '../src/shared/lib/collections/list-position-scope.ts';

test('collection position identity follows the caller resource and filters', () => {
  for (const pathname of ['/tasks', '/issues', '/work-items']) {
    assert.equal(listPositionScope({ pathname, search: '?status=OPEN&page=4&size=20' }), pathname + '?status=OPEN');
    assert.equal(listPositionScope({ pathname, search: '?page=8&size=100' }), pathname);
  }
  assert.notEqual(
    listPositionScope({ pathname: '/work-items', search: '?status=OPEN' }),
    listPositionScope({ pathname: '/work-items', search: '?status=RESOLVED' }),
  );
});
