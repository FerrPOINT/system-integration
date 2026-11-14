import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { localOrigin } from '../support/http.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const compose = ['compose', '-p', 'system-integration-load', '-f', 'compose.yml', '-f', 'compose.load.yml', '--profile', 'app'];

export function loadEnvironment({ frontend = 'container' } = {}) {
  if (!['container', 'vite'].includes(frontend)) throw new Error('Unsupported frontend runtime');
  if (frontend === 'vite' && new URL(localOrigin(process.env.SI_FRONTEND_URL || 'http://127.0.0.1:19673')).port !== '19673')
    throw new Error('Native UI checks require the isolated Vite port 19673');
  const services = frontend === 'container' ? ['backend', 'postgres', 'emulator', 'frontend'] : ['backend', 'postgres', 'emulator'];
  return services.map(service => {
    const id = execFileSync('docker', [...compose, 'ps', '-q', service], { cwd: root, encoding: 'utf8' }).trim();
    if (!id) throw new Error(`Missing load service: ${service}`);
    const [container] = JSON.parse(execFileSync('docker', ['inspect', id], { encoding: 'utf8' }));
    if (!container.State.Running) throw new Error(`The ${service} container must be running`);
    if (container.Config.Labels?.['com.docker.compose.project'] !== 'system-integration-load')
      throw new Error('Load checks require the isolated system-integration-load project');
    const internalPort = service === 'postgres' ? '5432/tcp' : '8080/tcp';
    const binding = container.NetworkSettings.Ports[internalPort]?.find(item => item.HostIp === '127.0.0.1');
    if (!binding) throw new Error('Load services must publish diagnostics only on loopback');
    const endpoints = {
      backend: ['SI_BACKEND_URL', 'http://127.0.0.1:19680'],
      emulator: ['SI_EMULATOR_URL', 'http://127.0.0.1:19681'],
      frontend: ['SI_FRONTEND_URL', 'http://127.0.0.1:19673'],
    };
    if (service !== 'postgres') {
      const [variable, fallback] = endpoints[service];
      if (new URL(localOrigin(process.env[variable] || fallback)).port !== binding.HostPort)
        throw new Error(variable + ' must match the isolated container port');
    }
    const env = Object.fromEntries(container.Config.Env.map(value => { const i = value.indexOf('='); return [value.slice(0, i), value.slice(i + 1)]; }));
    if (service === 'backend' && (env.SI_DB_URL !== 'jdbc:postgresql://postgres:5432/si_test' || env.SI_DB_USER !== 'si_test'))
      throw new Error('The backend must use the isolated si_test database');
    if (service === 'emulator' && (env.SI_EMULATOR_DB_URL !== 'jdbc:postgresql://postgres:5432/si_emulator_test' || env.SI_EMULATOR_DB_USER !== 'si_emulator_test'))
      throw new Error('The emulator must use the isolated si_emulator_test database');
    return { service, hostPort: Number(binding.HostPort), containerId: id, image: container.Image, cpu: container.HostConfig.NanoCpus / 1e9,
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

export function loadUiEnvironment() {
  return loadEnvironment({ frontend: process.env.SI_UI_FRONTEND_RUNTIME || 'container' });
}
