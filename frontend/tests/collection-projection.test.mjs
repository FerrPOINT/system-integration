import assert from 'node:assert/strict';
import { test } from 'node:test';
import { projectCollection } from '../src/shared/lib/collections/project-collection.ts';

const identify = item => item.id;
test('empty, desktop and overlapping offset windows have explicit projections', () => {
  assert.deepEqual(projectCollection(undefined, false, identify), { items: [], meta: undefined });
  const first = { items: [{ id: 'a', version: 1 }, { id: 'b', version: 1 }], page: 0, hasNext: true, totalItems: 3, totalPages: 2 };
  const last = { ...first, items: [{ id: 'b', version: 2 }, { id: 'c', version: 1 }], page: 1, hasNext: false };
  assert.equal(projectCollection([first], false, identify).items, first.items);
  const feed = projectCollection([first, last], true, identify);
  assert.deepEqual(feed.items, [{ id: 'a', version: 1 }, { id: 'b', version: 2 }, { id: 'c', version: 1 }]);
  assert.deepEqual(feed.meta, { page: 1, firstPage: 0, hasNext: false, totalItems: 3, totalPages: 2 });
});
