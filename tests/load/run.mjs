import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const profile = process.env.SI_LOAD_PROFILE || 'nf08';
if (!['nf08', 'capacity'].includes(profile)) throw new Error('SI_LOAD_PROFILE must be nf08 or capacity');
const directory = new URL('../results/', import.meta.url);
await mkdir(directory, { recursive: true });
const output = new URL(profile + '.json', directory);
const started = {
  profile, sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: new URL('../..', import.meta.url), encoding: 'utf8' }).trim(),
  startedAt: new Date().toISOString(), passed: false, status: 'running',
};
await writeFile(output, JSON.stringify(started, null, 2));
try {
  if (profile === 'nf08') await import('./nf08.mjs');
  else await import('./capacity.mjs');
} catch (error) {
  await writeFile(output, JSON.stringify({ ...started, status: 'failed', finishedAt: new Date().toISOString(), errorType: error.name }, null, 2));
  throw error;
}
