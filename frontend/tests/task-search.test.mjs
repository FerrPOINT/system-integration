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
  assert.equal(parseTaskSearch(new URLSearchParams('createdFrom=2026-11-14T00:00:00Z&createdTo=2026-11-14T00:00:00Z')).validPeriod, false);
  assert.equal(parseTaskSearch(new URLSearchParams()).hasFilters, false);
});

test('UTC editor displays instants independently of a supplied offset', () => {
  assert.equal(utcFilterValue('2026-11-14T07:30:00+07:00'), '2026-11-14T00:30');
  assert.equal(utcFilterValue('2026-11-14T00:30:00Z'), '2026-11-14T00:30');
  assert.equal(utcFilterValue('invalid'), '');
  assert.equal(utcFilterValue(undefined), '');
});
