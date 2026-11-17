import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { localOrigin } from '../support/http.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
export function loadEnvironment({ frontend = 'container', target = 'load' } = {}) {
  if (!['load', 'demo'].includes(target)) throw new Error('Unsupported installation target');
  if (target === 'demo' && frontend !== 'container')
    throw new Error('The demo installation requires its frontend container');
  const project = target === 'demo' ? 'system-integration' : 'system-integration-load';
  const databases =
    target === 'demo'
      ? { backend: 'si_app', emulator: 'si_emulator' }
      : { backend: 'si_test', emulator: 'si_emulator_test' };
  const portBase = target === 'demo' ? 19500 : 19600;
  const compose = [
    'compose',
    '-p',
    project,
    '-f',
    'compose.yml',
    '-f',
    target === 'demo' ? 'compose.public.yml' : 'compose.load.yml',
    '--profile',
    'app',
  ];
  if (!['container', 'vite'].includes(frontend)) throw new Error('Unsupported frontend runtime');
  if (
    frontend === 'vite' &&
    new URL(localOrigin(process.env.SI_FRONTEND_URL || 'http://127.0.0.1:19673')).port !== '19673'
  )
    throw new Error('Native UI checks require the isolated Vite port 19673');
  const services =
    frontend === 'container' ? ['backend', 'postgres', 'emulator', 'frontend'] : ['backend', 'postgres', 'emulator'];
  return services.map((service) => {
    const id = execFileSync('docker', [...compose, 'ps', '-q', service], { cwd: root, encoding: 'utf8' }).trim();
    if (!id) throw new Error(`Missing ${project} service: ${service}`);
    const [container] = JSON.parse(execFileSync('docker', ['inspect', id], { encoding: 'utf8' }));
    if (!container.State.Running) throw new Error(`The ${service} container must be running`);
    if (container.Config.Labels?.['com.docker.compose.project'] !== project)
      throw new Error('Installation does not match the selected Compose project');
    const internalPort = service === 'postgres' ? '5432/tcp' : '8080/tcp';
    const binding = container.NetworkSettings.Ports[internalPort]?.find((item) => item.HostIp === '127.0.0.1');
    if (!binding) throw new Error('Installation services must publish diagnostics only on loopback');
    const endpoints = {
      backend: ['SI_BACKEND_URL', 'http://127.0.0.1:' + (portBase + 80)],
      emulator: ['SI_EMULATOR_URL', 'http://127.0.0.1:' + (portBase + 81)],
      frontend: ['SI_FRONTEND_URL', 'http://127.0.0.1:' + (portBase + 73)],
    };
    if (service !== 'postgres') {
      const [variable, fallback] = endpoints[service];
      if (new URL(localOrigin(process.env[variable] || fallback)).port !== binding.HostPort)
        throw new Error(variable + ' must match the selected installation container port');
    }
    const env = Object.fromEntries(
      container.Config.Env.filter((value) => value.includes('=')).map((value) => {
        const i = value.indexOf('=');
        return [value.slice(0, i), value.slice(i + 1)];
      }),
    );
    if (
      service === 'backend' &&
      (env.SI_DB_URL !== 'jdbc:postgresql://postgres:5432/' + databases.backend ||
        (env.SI_DB_USER ?? 'si_app') !== databases.backend)
    )
      throw new Error('The backend database does not match the selected installation');
    if (
      service === 'emulator' &&
      (env.SI_EMULATOR_DB_URL !== 'jdbc:postgresql://postgres:5432/' + databases.emulator ||
        (env.SI_EMULATOR_DB_USER ?? 'si_emulator') !== databases.emulator)
    )
      throw new Error('The emulator database does not match the selected installation');
    return {
      service,
      database: databases[service],
      hostPort: Number(binding.HostPort),
      containerId: id,
      image: container.Image,
      cpu: container.HostConfig.NanoCpus / 1e9,
      memory: container.HostConfig.Memory,
      startedAt: container.State.StartedAt,
      sourceCommit: container.Config.Labels?.['org.opencontainers.image.revision'],
      runtimeSettings: Object.fromEntries(
        ['SI_EXCHANGE_MAX_IN_FLIGHT', 'SI_EMULATOR_EXECUTION_BATCH_SIZE', 'SPRING_DATASOURCE_HIKARI_MAXIMUM_POOL_SIZE']
          .filter((key) => Object.hasOwn(env, key))
          .map((key) => [key, env[key]]),
      ),
    };
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

export function loadUiEnvironment() {
  return loadEnvironment({ frontend: process.env.SI_UI_FRONTEND_RUNTIME || 'container' });
}
