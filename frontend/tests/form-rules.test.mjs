import assert from 'node:assert/strict';
import test from 'node:test';
import {
  titleInputProps,
  validReason,
  referenceInputProps,
  quantityInputProps,
  usernameInputProps,
} from '../src/shared/lib/form-rules.ts';

test('request and login inputs use the contract format and numeric bounds', () => {
  const reference = new RegExp('^(?:' + referenceInputProps.pattern + ')$', 'u');
  for (const value of ['REQ-000001', 'REQ-999999']) assert.ok(reference.test(value));
  for (const value of ['XREQ-000001', 'REQ-00000', 'REQ-0000001', 'REQ-ABCDEF']) assert.ok(!reference.test(value));
  assert.deepEqual(quantityInputProps, { min: 1, max: 1000, step: 1 });
  assert.equal(usernameInputProps.maxLength, 64);
  const username = new RegExp('^(?:' + usernameInputProps.pattern + ')$', 'u');
  for (const value of ['initiator.one', 'operator', 'test_user-1']) assert.ok(username.test(value));
  for (const value of ['with spaces', 'кириллица']) assert.ok(!username.test(value));
});

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
