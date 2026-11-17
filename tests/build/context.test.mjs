import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempDisposableSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../..', import.meta.url));

test('Docker COPY excludes private env variants and local artifacts at every depth', () => {
  mkdirSync(join(root, '.local'), { recursive: true });
  using fixture = mkdtempDisposableSync(join(root, '.local', 'context-check-'));
  const context = join(fixture.path, 'context'),
    output = join(fixture.path, 'output');
  const excluded = [
    '.env',
    '.env.local',
    '.env.production',
    'frontend/.env',
    'frontend/.env.production',
    'backend/.env.test',
    'nested/deep/.env',
    'nested/deep/.env.staging',
    '.local/.env.example',
    'frontend/.local/toolchains/probe',
    'nested/deep/.local/probe',
    '.git/.env.example',
    'frontend/node_modules/vendor/.env.example',
    'backend/build/.env.example',
    'tests/build/.env.production',
    'tests/build/.local/probe',
    'backend/.gradle/.env.example',
  ];
  const retained = [
    '.env.example',
    'frontend/.env.example',
    'nested/deep/.env.example',
    'frontend/src/probe.ts',
    'backend/src/Probe.java',
    'tests/build/gradle.test.mjs',
  ];
  mkdirSync(context);
  for (const name of [...excluded, ...retained]) {
    const path = join(context, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, 'synthetic context fixture\n');
  }
  writeFileSync(join(context, '.dockerignore'), readFileSync(join(root, '.dockerignore')));
  execFileSync('docker', ['build', '--network=none', '--file=-', '--output=type=local,dest=' + output, context], {
    input: 'FROM scratch\nCOPY . /copied/\n',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 30_000,
  });
  for (const name of excluded)
    assert.equal(existsSync(join(output, 'copied', name)), false, 'Excluded build input: ' + name);
  for (const name of retained)
    assert.equal(existsSync(join(output, 'copied', name)), true, 'Required build input: ' + name);
});
