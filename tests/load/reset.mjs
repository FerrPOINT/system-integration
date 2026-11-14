import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const compose = [
  'compose',
  '-p',
  'system-integration-load',
  '-f',
  'compose.yml',
  '-f',
  'compose.load.yml',
  '--profile',
  'app',
];
const running = execFileSync('docker', [...compose, 'ps', '--status', 'running', '--services'], {
  cwd: root,
  encoding: 'utf8',
})
  .trim()
  .split(/\s+/);
if (running.some((service) => ['backend', 'emulator'].includes(service)))
  throw new Error('Stop backend and emulator before resetting the dedicated load databases');
for (const [file, command] of [
  ['reset-app.sql', 'PGPASSWORD="$SI_TEST_DB_PASSWORD" psql -h 127.0.0.1 -U si_test -d si_test -v ON_ERROR_STOP=1'],
  [
    'reset-emulator.sql',
    'PGPASSWORD="$SI_EMULATOR_TEST_DB_PASSWORD" psql -h 127.0.0.1 -U si_emulator_test -d si_emulator_test -v ON_ERROR_STOP=1',
  ],
]) {
  execFileSync('docker', [...compose, 'exec', '-T', 'postgres', 'sh', '-c', command], {
    cwd: root,
    input: readFileSync(new URL(file, import.meta.url)),
    stdio: ['pipe', 'inherit', 'inherit'],
  });
}
