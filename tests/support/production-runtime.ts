import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/** Real production Nginx + built assets, isolated network, no API/DB. Tests mock /api. */
export default async function setup() {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const dist = path.join(root, 'frontend/dist');
  const config = path.join(root, 'frontend/nginx.conf');
  const dockerfile = await readFile(path.join(root, 'frontend/Dockerfile'), 'utf8');
  const image = dockerfile.match(/^FROM (nginx:\S+)/m)?.[1];
  if (!image || !(await readFile(path.join(dist, 'index.html'), 'utf8')).includes('__STYLE_NONCE__')) {
    throw new Error('Build the current frontend before production tests');
  }
  const name = 'si-frontend-csp-' + randomUUID();
  const docker = (args: string[]) =>
    execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  let network: string | undefined;
  let container: string | undefined;
  const cleanup = () => {
    if (container) docker(['rm', '-f', container]);
    if (network) docker(['network', 'rm', network]);
  };
  try {
    network = docker(['network', 'create', name]);
    container = docker([
      'create',
      '--name',
      name,
      '--network',
      name,
      '--memory',
      '64m',
      '--cpus',
      '0.1',
      '-p',
      '127.0.0.1:19778:8080',
      '--mount',
      `type=bind,src=${dist},dst=/usr/share/nginx/html,readonly`,
      '--mount',
      `type=bind,src=${config},dst=/etc/nginx/conf.d/default.conf,readonly`,
      image,
    ]);
    docker(['start', container]);
    const until = Date.now() + 15_000;
    while (true) {
      const response = await fetch('http://127.0.0.1:19778/').catch(() => undefined);
      if (response?.ok) break;
      if (Date.now() >= until) throw new Error('Production Nginx did not become ready: ' + docker(['logs', container]));
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const results = path.join(root, 'tests/results/production');
    await mkdir(results, { recursive: true });
    await writeFile(path.join(results, 'runtime.json'), JSON.stringify({ image, container, network, dist }, null, 2));
    return cleanup;
  } catch (error) {
    cleanup();
    throw error;
  }
}
