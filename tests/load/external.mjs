import { spawn, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createServer, connect } from 'node:net';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { hostname } from 'node:os';
import { setTimeout as pause } from 'node:timers/promises';
import { prepareNf08Clients, runNf08Workload } from './nf08-workload.mjs';

const host = process.env.SI_EXTERNAL_SSH_HOST;
const remoteRoot = process.env.SI_EXTERNAL_REMOTE_ROOT;
const port = Number(process.env.SI_EXTERNAL_LOCAL_PORT);
if (
  !host ||
  !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(host) ||
  !remoteRoot ||
  !/^\/[a-zA-Z0-9._/-]+$/.test(remoteRoot) ||
  !Number.isInteger(port) ||
  port < 1024 ||
  port > 65535
)
  throw new Error('Set SI_EXTERNAL_SSH_HOST, SI_EXTERNAL_REMOTE_ROOT and a free SI_EXTERNAL_LOCAL_PORT (1024..65535)');
if (Number(process.versions.node.split('.')[0]) !== 26) throw new Error('Use the qualified Node 26 toolchain');

const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
const setup =
  'cd ' +
  quote(remoteRoot) +
  ' && set -a && . ./.env && set +a && export PATH="$PWD/.local/toolchains/node-v26.13.1-linux-x64/bin:$PATH" && ';
const files = ['tests/load/external.mjs', 'tests/load/nf08-workload.mjs', 'tests/support/http.mjs'];
const children = new Set();
const sshOptions = [
  '-o',
  'BatchMode=yes',
  '-o',
  'ConnectTimeout=10',
  '-o',
  'ServerAliveInterval=10',
  '-o',
  'ServerAliveCountMax=3',
  '-o',
  'ControlMaster=no',
  '-o',
  'ControlPath=none',
  '-o',
  'ControlPersist=no',
];
function startSsh(args, control = false) {
  const child = spawn('ssh', [...sshOptions, ...args], { stdio: [control ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
  const handle = { child, stderr: '' };
  child.stderr.on('data', (part) => {
    handle.stderr = (handle.stderr + part).slice(-4000);
  });
  child.stdin?.on('error', () => {}); // end() callback / exit status owns the failed report delivery.
  handle.closed = new Promise((resolve) => {
    child.once('error', (error) => {
      handle.spawnError = error;
    });
    child.once('close', (code, signal) => {
      children.delete(handle);
      resolve({ code, signal, error: handle.spawnError });
    });
  });
  children.add(handle);
  return handle;
}
function killChildren() {
  for (const handle of children) handle.child.kill();
}
for (const [signal, code] of [
  ['SIGINT', 130],
  ['SIGTERM', 143],
])
  process.once(signal, () => {
    killChildren();
    process.exit(code);
  });

function remoteText(command, label) {
  try {
    return execFileSync('ssh', [...sshOptions, host, setup + command], {
      encoding: 'utf8',
      timeout: 60000,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    // The preflight response contains a password in a private pipe, never in diagnostics or files.
    throw new Error(label + ' failed (SSH exit ' + (error.status ?? 'spawn-error') + ')');
  }
}
async function portFree() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  await new Promise((resolve) => server.close(resolve));
}
async function ready(tunnel) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (tunnel.spawnError || tunnel.child.exitCode !== null || tunnel.child.signalCode !== null)
      throw new Error('SSH port forward failed: ' + tunnel.stderr.trim());
    try {
      await new Promise((resolve, reject) => {
        const socket = connect({ host: '127.0.0.1', port });
        socket.once('connect', () => {
          socket.destroy();
          resolve();
        });
        socket.once('error', reject);
        socket.setTimeout(250, () => socket.destroy(new Error('Forward is not ready')));
      });
      return;
    } catch {
      await pause(100);
    }
  }
  throw new Error('SSH loopback port forward did not become ready within 10 seconds');
}
async function stop(handle) {
  if (!handle || !children.has(handle)) return;
  if (handle.child.stdin) {
    handle.child.stdin.end();
    const ended = await Promise.race([handle.closed.then(() => true), pause(5000).then(() => false)]);
    if (ended) return;
  }
  handle.child.kill();
  const closed = await Promise.race([handle.closed.then(() => true), pause(5000).then(() => false)]);
  if (!closed) {
    handle.child.kill('SIGKILL');
    await handle.closed;
  }
}
const directory = new URL('../results/', import.meta.url);
await mkdir(directory, { recursive: true });
const output = new URL('external-driver.json', directory);
const receipt = {
  passed: false,
  startedAt: new Date().toISOString(),
  generatorHost: hostname(),
  remoteHostAlias: host,
  remoteRoot,
  localForwardPort: port,
  scope: 'Independent generator -> loopback SSH forward -> Firebat API; not public HTTPS',
};
await writeFile(output, JSON.stringify(receipt, null, 2));
let tunnel, controller, lines;
try {
  await portFree();
  tunnel = startSsh(['-N', '-o', 'ExitOnForwardFailure=yes', '-L', '127.0.0.1:' + port + ':127.0.0.1:19680', host]);
  await ready(tunnel);
  const preflight = [
    "import {readFileSync} from 'node:fs';",
    "import {createHash} from 'node:crypto';",
    "import {execFileSync} from 'node:child_process';",
    "import {hostname} from 'node:os';",
    "import {qualifiedLoadEnvironment} from './tests/load/environment.mjs';",
    "const ref=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();",
    "if(execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim())throw new Error('Commit the candidate');",
    'qualifiedLoadEnvironment(ref);',
    "const dataset=JSON.parse(readFileSync('tests/results/load-dataset.json','utf8'));",
    "if(dataset.initialCount!==5000 || !process.env.SI_DEMO_PASSWORD)throw new Error('Prepare the isolated NF08 data');",
    'const hashes=Object.fromEntries(' +
      JSON.stringify(files) +
      ".map(p=>[p,createHash('sha256').update(readFileSync(p)).digest('hex')]));",
    'console.log(JSON.stringify({sourceCommit:ref,serverHost:hostname(),nodeVersion:process.version,dataset,hashes,password:process.env.SI_DEMO_PASSWORD}));',
  ].join('\n');
  let configuration;
  try {
    configuration = JSON.parse(
      remoteText('timeout --kill-after=5s 55s node --input-type=module -e ' + quote(preflight), 'Remote preflight'),
    );
  } catch {
    throw new Error('Remote preflight failed; verify committed images, isolated data and SSH access on Firebat');
  }
  if (configuration.nodeVersion !== process.version)
    throw new Error('Use the same Node version as Firebat: ' + configuration.nodeVersion);
  if (configuration.serverHost.toLowerCase() === hostname().toLowerCase())
    throw new Error('The external generator must run on another host');
  for (const name of files) {
    const local = new URL(name.replace('tests/load/', '').replace('tests/support/', '../support/'), import.meta.url);
    const sha = createHash('sha256')
      .update(await readFile(local))
      .digest('hex');
    if (sha !== configuration.hashes[name])
      throw new Error('Portable generator differs from qualified source: ' + name);
  }
  receipt.sourceCommit = configuration.sourceCommit;
  receipt.serverHost = configuration.serverHost;
  const clients = await prepareNf08Clients(configuration.dataset, 'http://127.0.0.1:' + port, configuration.password);
  delete configuration.password;
  controller = startSsh(
    [host, setup + 'exec timeout --kill-after=5s 900s env SI_LOAD_PROFILE=nf08-external node tests/load/run.mjs'],
    true,
  );
  lines = createInterface({ input: controller.child.stdout, terminal: false });
  const iterator = lines[Symbol.asyncIterator]();
  async function message(milliseconds, phase) {
    let timer;
    try {
      const next = await Promise.race([
        iterator.next(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Server controller timed out: ' + phase)), milliseconds);
        }),
      ]);
      if (next.done) throw new Error('Server controller ended before completing the NF08 exchange');
      return JSON.parse(next.value);
    } finally {
      clearTimeout(timer);
    }
  }
  const start = await message(60000, 'preparation');
  if (start.type !== 'nf08-start' || start.sourceCommit !== receipt.sourceCommit)
    throw new Error('Server source changed before measurement');
  receipt.serverWindowStartedAt = start.serverWindowStartedAt;
  receipt.serverControllerPid = start.controllerPid;
  const workload = await runNf08Workload(clients);
  receipt.generator = workload.generator;
  await new Promise((resolve, reject) =>
    controller.child.stdin.write(
      JSON.stringify({ type: 'nf08-workload', sourceCommit: receipt.sourceCommit, workload }) + '\n',
      (error) => (error ? reject(new Error('Cannot deliver the external workload report')) : resolve()),
    ),
  );
  const finished = await message(900000, 'qualification');
  if (finished.type !== 'nf08-finished' || finished.sourceCommit !== receipt.sourceCommit)
    throw new Error('Invalid server qualification reply');
  controller.child.stdin.end();
  const exit = await controller.closed;
  const serialized = remoteText('cat tests/results/nf08-external.json', 'Server report retrieval');
  if (createHash('sha256').update(serialized).digest('hex') !== finished.reportSha256)
    throw new Error('Server qualification receipt hash differs');
  await writeFile(new URL('nf08-external-server.json', directory), serialized);
  receipt.serverQualification = finished;
  receipt.passed = exit.code === 0 && finished.passed === true;
  if (!receipt.passed) process.exitCode = 1;
} catch (error) {
  receipt.error = { type: error.name, message: error.message };
  process.exitCode = 1;
  console.error(error.message);
} finally {
  lines?.close();
  await stop(controller);
  await stop(tunnel);
  receipt.finishedAt = new Date().toISOString();
  receipt.childrenClosed = children.size === 0;
  await writeFile(output, JSON.stringify(receipt, null, 2));
}
console.log(
  JSON.stringify({
    passed: receipt.passed,
    sourceCommit: receipt.sourceCommit,
    generatorHost: receipt.generatorHost,
    serverHost: receipt.serverHost,
    childrenClosed: receipt.childrenClosed,
  }),
);
