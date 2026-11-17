import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempDisposableSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../..', import.meta.url));
const tasks = [':backend:openApiGenerate', ':backend:generateExchangeApi', ':emulator:openApiGenerate'];

test(
  'Java apps own their task graphs and regenerate only consumers of a changed contract',
  { timeout: 180_000 },
  () => {
    mkdirSync(join(root, '.local'), { recursive: true });
    using directory = mkdtempDisposableSync(join(root, '.local', 'gradle-check-'));
    const fixture = directory.path;
    const run = (...args) =>
      execFileSync(
        'java',
        [
          '-Xmx64m',
          '-jar',
          'gradle/wrapper/gradle-wrapper.jar',
          '--console=plain',
          '--no-daemon',
          '--no-parallel',
          '--max-workers=1',
          '-Dorg.gradle.jvmargs=-Xmx512m -XX:ActiveProcessorCount=2',
          ...args,
        ],
        { cwd: fixture, encoding: 'utf8', timeout: 60_000, maxBuffer: 2 * 1024 * 1024 },
      ).replaceAll('\r\n', '\n');
    for (const name of [
      'settings.gradle',
      'build.gradle',
      'backend/build.gradle',
      'emulator/build.gradle',
      'contracts/internal-api.openapi.yaml',
      'contracts/external-exchange.openapi.yaml',
    ]) {
      mkdirSync(dirname(join(fixture, name)), { recursive: true });
      copyFileSync(join(root, name), join(fixture, name));
    }
    cpSync(join(root, 'contracts/templates'), join(fixture, 'contracts/templates'), { recursive: true });
    cpSync(join(root, 'gradle/wrapper'), join(fixture, 'gradle/wrapper'), { recursive: true });
    const backendJar = run(':backend:bootJar', '--dry-run');
    assert.ok(!backendJar.includes(':emulator:'));
    assert.ok(
      !backendJar.includes(':backend:generateExchangeApi'),
      'Production JAR cannot depend on test-only generation',
    );
    assert.ok(run(':backend:compileTestJava', '--dry-run').includes(':backend:generateExchangeApi'));
    assert.ok(!run(':emulator:bootJar', '--dry-run').includes(':backend:'));
    run(...tasks);
    for (const output of [
      'backend/build/generated/openapi/internal/src/main/java',
      'backend/build/generated/openapi/external/src/main/java',
      'emulator/build/generated/openapi/external/src/main/java',
    ])
      assert.ok(existsSync(join(fixture, output)), output);
    assert.ok(
      !existsSync(
        join(
          fixture,
          'backend/build/generated/openapi/external/src/main/java/com/azhukov/integration/contract/external/api',
        ),
      ),
      'Backend needs external models for tests, not unused server interfaces',
    );
    assert.ok(
      existsSync(
        join(
          fixture,
          'emulator/build/generated/openapi/external/src/main/java/com/azhukov/integration/contract/external/api/ExchangeApi.java',
        ),
      ),
    );
    const unchanged = run(...tasks);
    for (const task of tasks) assert.ok(unchanged.includes('> Task ' + task + ' UP-TO-DATE'), task);
    appendFileSync(join(fixture, 'contracts/external-exchange.openapi.yaml'), '\n# synthetic invalidation probe\n');
    const changed = run(...tasks);
    // Internal API references external schemas, so it is a real consumer too.
    for (const task of tasks) {
      assert.ok(changed.includes('> Task ' + task + '\n'), task);
      assert.ok(!changed.includes('> Task ' + task + ' UP-TO-DATE'), task);
    }
    appendFileSync(join(fixture, 'contracts/internal-api.openapi.yaml'), '\n# internal-only invalidation probe\n');
    const internalOnly = run(...tasks);
    assert.ok(!internalOnly.includes('> Task ' + tasks[0] + ' UP-TO-DATE'));
    for (const task of [tasks[1], tasks[2]]) assert.ok(internalOnly.includes('> Task ' + task + ' UP-TO-DATE'), task);
  },
);
