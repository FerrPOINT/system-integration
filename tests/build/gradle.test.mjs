import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../..', import.meta.url));
const tasks = [':backend:openApiGenerate', ':backend:generateExchangeApi', ':emulator:openApiGenerate'];

test('Java apps own their task graphs and regenerate only consumers of a changed contract', { timeout: 180_000 }, () => {
  mkdirSync(join(root, '.local'), { recursive: true });
  const fixture = mkdtempSync(join(root, '.local', 'gradle-check-'));
  const run = (...args) => execFileSync('sh', ['./gradlew', '--no-daemon', '--no-parallel', '--max-workers=1', ...args],
    { cwd: fixture, encoding: 'utf8', timeout: 60_000, maxBuffer: 2 * 1024 * 1024 });
  try {
    for (const name of ['settings.gradle', 'build.gradle', 'gradlew', 'backend/build.gradle', 'emulator/build.gradle',
      'contracts/internal-api.openapi.yaml', 'contracts/external-exchange.openapi.yaml']) {
      mkdirSync(dirname(join(fixture, name)), { recursive: true });
      copyFileSync(join(root, name), join(fixture, name));
    }
    cpSync(join(root, 'gradle/wrapper'), join(fixture, 'gradle/wrapper'), { recursive: true });
    assert.ok(!run(':backend:bootJar', '--dry-run').includes(':emulator:'));
    assert.ok(!run(':emulator:bootJar', '--dry-run').includes(':backend:'));
    run(...tasks);
    for (const output of ['backend/build/generated/openapi/internal/src/main/java',
      'backend/build/generated/openapi/external/src/main/java', 'emulator/build/generated/openapi/external/src/main/java'])
      assert.ok(existsSync(join(fixture, output)), output);
    const unchanged = run(...tasks);
    for (const task of tasks) assert.ok(unchanged.includes('> Task ' + task + ' UP-TO-DATE'), task);
    appendFileSync(join(fixture, 'contracts/external-exchange.openapi.yaml'), '\n# synthetic invalidation probe\n');
    const changed = run(...tasks);
    assert.ok(changed.includes('> Task :backend:openApiGenerate UP-TO-DATE'));
    for (const task of [tasks[1], tasks[2]]) {
      assert.ok(changed.includes('> Task ' + task + '\n'), task);
      assert.ok(!changed.includes('> Task ' + task + ' UP-TO-DATE'), task);
    }
  } finally {
    assert.ok(resolve(fixture).startsWith(resolve(root, '.local') + '/gradle-check-'));
    rmSync(fixture, { recursive: true });
  }
});
