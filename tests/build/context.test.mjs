import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../..', import.meta.url));

test('Docker COPY excludes private env variants at every depth and retains templates', () => {
  mkdirSync(join(root, '.local'), { recursive: true });
  const fixture = mkdtempSync(join(root, '.local', 'context-check-'));
  const context = join(fixture, 'context'), output = join(fixture, 'output');
  const excluded = ['.env', '.env.local', '.env.production', 'frontend/.env', 'frontend/.env.production',
    'backend/.env.test', 'nested/deep/.env', 'nested/deep/.env.staging'];
  const retained = ['.env.example', 'frontend/.env.example', 'nested/deep/.env.example',
    'frontend/src/probe.ts', 'backend/src/Probe.java'];
  try {
    mkdirSync(context);
    for (const name of [...excluded, ...retained]) {
      const path = join(context, name);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, 'synthetic context fixture\n');
    }
    writeFileSync(join(context, '.dockerignore'), readFileSync(join(root, '.dockerignore')));
    execFileSync('docker', ['build', '--network=none', '--file=-', '--output=type=local,dest=' + output, context], {
      input: 'FROM scratch\nCOPY . /copied/\n', stdio: ['pipe', 'pipe', 'pipe'], timeout: 30_000,
    });
    for (const name of excluded)
      assert.equal(existsSync(join(output, 'copied', name)), false, 'Excluded private env input: ' + name);
    for (const name of retained)
      assert.equal(existsSync(join(output, 'copied', name)), true, 'Required build input: ' + name);
  } finally {
    assert.ok(resolve(fixture).startsWith(resolve(root, '.local') + '/context-check-'));
    rmSync(fixture, { recursive: true });
  }
});
