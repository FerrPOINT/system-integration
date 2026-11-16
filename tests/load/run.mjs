import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const profile = process.env.SI_LOAD_PROFILE || 'nf08';
if (!['nf08', 'nf08-external', 'capacity', 'steady'].includes(profile))
  throw new Error('SI_LOAD_PROFILE must be nf08, nf08-external, capacity or steady');
const directory = new URL('../results/', import.meta.url);
await mkdir(directory, { recursive: true });
const output = new URL(profile + '.json', directory);
const started = {
  profile,
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: new URL('../..', import.meta.url),
    encoding: 'utf8',
  }).trim(),
  startedAt: new Date().toISOString(),
  passed: false,
  status: 'running',
};
await writeFile(output, JSON.stringify(started, null, 2));
try {
  if (profile === 'nf08' || profile === 'nf08-external') await import('./nf08.mjs');
  else if (profile === 'capacity') await import('./capacity.mjs');
  else await import('./steady.mjs');
} catch (error) {
  await writeFile(
    output,
    JSON.stringify(
      { ...started, status: 'failed', finishedAt: new Date().toISOString(), errorType: error.name },
      null,
      2,
    ),
  );
  throw error;
}
