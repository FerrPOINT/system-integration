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

test('component fixtures are absent from the production payload', async () => {
  const files = await readdir(new URL('../dist/', import.meta.url), { recursive: true });
  assert.ok(!files.some(name => name.includes('choice-form') || name.includes('pagination-navigation')), 'Test entry must not be a production asset');
  for (const file of files.filter(name => name.endsWith('.js'))) {
    const source = await readFile(new URL('../dist/' + file, import.meta.url), 'utf8');
    assert.ok(!source.includes('Choice field fixture'), file);
    assert.ok(!source.includes('Navigate with queued measurement'), file);
  }
});
