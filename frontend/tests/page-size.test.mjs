import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fitPageSize, fitVariableRows } from '../src/shared/lib/pagination/use-page-size.ts';

test('fits complete rows using available height, gaps and grid columns', () => {
  assert.equal(fitPageSize(420, 200, 20, 2), 4);
  assert.equal(fitPageSize(419, 200, 20, 2), 2);
  assert.equal(fitPageSize(480, 48, 0, 1), 10);
  assert.equal(fitPageSize(240, 48, 0, 1), 5);
});
test('keeps one oversized row accessible and bounds requests at the API limit', () => {
  assert.equal(fitPageSize(100, 250, 0, 1), 1);
  assert.equal(fitPageSize(100000, 20, 0, 2), 100);
});

test('fits mixed rows using measured heights before estimating unread ones', () => {
  const rows = [112, 86, 86, 86, 86, 86, 86, 86];
  assert.equal(fitVariableRows(889, rows, 0, 112), 9);
  assert.equal(fitVariableRows(889, [...rows, 86], 0, 112), 9);
});

test('preserves one oversized row and stops expanding after finding a taller row', () => {
  assert.equal(fitVariableRows(200, [80, 80], 10, 80), 2);
  assert.equal(fitVariableRows(200, [80, 115], 10, 115), 1);
  assert.equal(fitVariableRows(200, [80], 10, 115), 1);
  assert.equal(fitVariableRows(200, [400], 10, 400), 1);
});
