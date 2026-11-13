import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readdir, readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';

test('compressed production assets decode to exactly the final JavaScript and CSS', async () => {
  const directory = new URL('../dist/assets/', import.meta.url);
  const files = (await readdir(directory)).filter(name => name.endsWith('.js') || name.endsWith('.css'));
  assert.ok(files.some(name => name.endsWith('.js')), 'Build JavaScript before checking assets');
  assert.ok(files.some(name => name.endsWith('.css')), 'Build CSS before checking assets');
  for (const name of files) {
    const [identity, compressed] = await Promise.all([
      readFile(new URL(name, directory)), readFile(new URL(name + '.gz', directory)),
    ]);
    assert.deepEqual(gunzipSync(compressed), identity, name);
  }
});
