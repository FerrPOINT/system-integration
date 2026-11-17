import assert from 'node:assert/strict';
import test from 'node:test';
import { loadEnvironment } from '../tests/load/environment.mjs';

test('seed installation selection rejects unknown targets before any Docker access', () => {
  for (const target of ['', 'production', 'system-integration', 'LOAD'])
    assert.throws(() => loadEnvironment({ target }), /Unsupported installation target/);
});

test('demo seeding requires all installation containers, never a native frontend', () => {
  assert.throws(() => loadEnvironment({ target: 'demo', frontend: 'vite' }), /frontend container/);
});
