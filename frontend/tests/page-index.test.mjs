import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isPageIndex } from '../src/shared/lib/pagination/page-index.ts';

test('page indexes stay within the controller int32 boundary', () => {
  for (const value of [0, 1, 2_147_483_647]) assert.equal(isPageIndex(value), true);
  for (const value of [-1, 0.5, 2_147_483_648, Number.MAX_SAFE_INTEGER, NaN, Infinity, '1', null])
    assert.equal(isPageIndex(value), false);
});
