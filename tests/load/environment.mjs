import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const compose = ['compose', '-f', 'compose.yml', '-f', 'compose.load.yml', '--profile', 'app'];

export function loadEnvironment() {
  return ['backend', 'postgres', 'emulator', 'frontend'].map(service => {
    const id = execFileSync('docker', [...compose, 'ps', '-q', service], { cwd: root, encoding: 'utf8' }).trim();
    if (!id) throw new Error(`Missing load service: ${service}`);
    const [container] = JSON.parse(execFileSync('docker', ['inspect', id], { encoding: 'utf8' }));
    if (!container.State.Running) throw new Error(`The ${service} container must be running`);
    const env = Object.fromEntries(container.Config.Env.map(value => { const i = value.indexOf('='); return [value.slice(0, i), value.slice(i + 1)]; }));
    if (service === 'backend' && (env.SI_DB_URL !== 'jdbc:postgresql://postgres:5432/si_test' || env.SI_DB_USER !== 'si_test'))
      throw new Error('The backend must use the isolated si_test database');
    if (service === 'emulator' && (env.SI_EMULATOR_DB_URL !== 'jdbc:postgresql://postgres:5432/si_emulator_test' || env.SI_EMULATOR_DB_USER !== 'si_emulator_test'))
      throw new Error('The emulator must use the isolated si_emulator_test database');
    return { service, containerId: id, image: container.Image, cpu: container.HostConfig.NanoCpus / 1e9,
      memory: container.HostConfig.Memory, startedAt: container.State.StartedAt, sourceCommit: container.Config.Labels?.['org.opencontainers.image.revision'] };
  });
}

export function qualifiedLoadEnvironment(sourceCommit) {
  const resources = loadEnvironment();
  const cpu = resources.reduce((sum, item) => sum + item.cpu, 0);
  const memory = resources.reduce((sum, item) => sum + item.memory, 0);
  if (cpu > 2 || memory > 4 * 1024 ** 3) throw new Error('Load budget is 2 CPU / 4 GiB');
  for (const item of resources) {
    if (!Number.isFinite(item.cpu) || item.cpu <= 0 || !Number.isSafeInteger(item.memory) || item.memory <= 0)
      throw new Error('Explicit container resource limits are required');
    if (item.service !== 'postgres' && item.sourceCommit !== sourceCommit)
      throw new Error('Load images must match the qualified source commit');
  }
  return resources;
}
