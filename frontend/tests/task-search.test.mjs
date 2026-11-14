import assert from 'node:assert/strict';
import { test } from 'node:test';
import { changeTaskFilters, parseTaskSearch, utcFilterValue } from '../src/features/tasks/model/task-search.ts';

test('URL owns filters, validation and independent pagination resets', () => {
  const source = new URLSearchParams('businessStatus=SUCCEEDED&size=7&page=3&createdFrom=2026-11-14T00:00:00Z');
  const parsed = parseTaskSearch(source);
  assert.equal(parsed.validParameters, true);
  assert.equal(parsed.validPeriod, true);
  assert.equal(parsed.params.businessStatus, 'SUCCEEDED');
  const changed = changeTaskFilters(source, { businessStatus: 'REJECTED', createdFrom: undefined });
  assert.equal(changed.toString(), 'businessStatus=REJECTED&size=7');
  assert.equal(source.get('page'), '3');
  assert.equal(parseTaskSearch(new URLSearchParams('businessStatus=__proto__')).validParameters, false);
  assert.equal(parseTaskSearch(new URLSearchParams('createdFrom=invalid')).validParameters, false);
  assert.equal(
    parseTaskSearch(new URLSearchParams('createdFrom=2026-11-14T00:00:00Z&createdTo=2026-11-14T00:00:00Z')).validPeriod,
    false,
  );
  assert.equal(parseTaskSearch(new URLSearchParams()).hasFilters, false);
});

test('UTC editor displays instants independently of a supplied offset', () => {
  assert.equal(utcFilterValue('2026-11-14T07:30:00+07:00'), '2026-11-14T00:30');
  assert.equal(utcFilterValue('2026-11-14T00:30:00Z'), '2026-11-14T00:30');
  assert.equal(utcFilterValue('invalid'), '');
  assert.equal(utcFilterValue(undefined), '');
});

test('invalid calendar dates and unsupported UTC years never become valid filters', () => {
  for (const invalid of [
    '2026-02-30T00:00:00Z',
    '2025-02-29T00:00:00Z',
    '2026-13-01T00:00:00Z',
    '2026-11-14T24:00:00Z',
    '0000-01-01T00:00:00Z',
    '+010000-01-01T00:00:00Z',
    '2026-11-14T00:00:00-00:00',
    '2026-11-14T00:00:00',
    '2026-11-14',
  ]) {
    for (const field of ['createdFrom', 'createdTo']) {
      assert.equal(parseTaskSearch(new URLSearchParams({ [field]: invalid })).validParameters, false, invalid);
    }
    assert.equal(utcFilterValue(invalid), '', invalid);
  }
  assert.equal(parseTaskSearch(new URLSearchParams({ createdFrom: '2024-02-29T12:30:00Z' })).validParameters, true);
});

test('the API receives the same UTC instant that the filter editor displays', () => {
  const source = new URLSearchParams({ createdFrom: '2026-11-14T07:30:00+07:00' });
  const parsed = parseTaskSearch(source);
  assert.equal(parsed.validParameters, true);
  assert.equal(parsed.params.createdFrom, '2026-11-14T00:30:00Z');
  assert.equal(utcFilterValue(parsed.params.createdFrom), '2026-11-14T00:30');
  assert.equal(source.get('createdFrom'), '2026-11-14T07:30:00+07:00');
  assert.equal(
    parseTaskSearch(new URLSearchParams({ createdFrom: '0001-01-01T00:00:00+01:00' })).validParameters,
    false,
  );
});

test('half-open period comparison preserves sub-millisecond precision', () => {
  const from = '2026-11-14T00:00:00.000000001Z';
  const to = '2026-11-14T00:00:00.000000002Z';
  const parsed = parseTaskSearch(new URLSearchParams({ createdFrom: from, createdTo: to }));
  assert.equal(parsed.validParameters, true);
  assert.equal(parsed.validPeriod, true);
  assert.equal(parsed.params.createdFrom, from);
  assert.equal(parsed.params.createdTo, to);
  assert.equal(parseTaskSearch(new URLSearchParams({ createdFrom: to, createdTo: from })).validPeriod, false);
  assert.equal(parseTaskSearch(new URLSearchParams({ createdFrom: from, createdTo: from })).validPeriod, false);
});
