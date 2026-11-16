import assert from 'node:assert/strict';
import test from 'node:test';
import { titleInputProps, validReason } from '../src/shared/lib/text-rules.ts';

test('generated contract rules count Unicode code points and preserve meaningful neighbors', () => {
  const title = new RegExp('^(?:' + titleInputProps.pattern + ')$', 'u');
  for (const valid of ['😀'.repeat(160), 'x'.repeat(160), '\uFEFF', 'X\uFEFF', 'X\u0085']) assert.ok(title.test(valid));
  for (const invalid of ['😀'.repeat(161), 'x'.repeat(161), '\u0085', '\u0000']) assert.ok(!title.test(invalid));
  assert.ok(validReason('😀'.repeat(500)));
  assert.ok(!validReason('😀'.repeat(501)));
  assert.ok(validReason('X\uFEFF'));
  assert.ok(validReason('\uFEFF'));
  for (const invalid of ['', '\u0085', '\u0000', '\uD800', '\uDC00']) assert.ok(!validReason(invalid));
});
