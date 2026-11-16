import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCgroupCpu } from './metrics.mjs';

test('cgroup v2 retains CPU counters and additional nonnegative counters', () => {
  assert.deepEqual(
    parseCgroupCpu('usage_usec 100\nuser_usec 60\nsystem_usec 40\nnr_periods 20\nnr_throttled 5\nthrottled_usec 300\n'),
    { usage_usec: 100, user_usec: 60, system_usec: 40, nr_periods: 20, nr_throttled: 5, throttled_usec: 300 },
  );
});

test('missing or malformed CPU counters fail explicitly', () => {
  for (const value of ['', 'usage_usec 1', 'usage_usec NaN', 'usage_usec -1', 'usage_usec 9007199254740992']) {
    assert.throws(() => parseCgroupCpu(value));
  }
});
