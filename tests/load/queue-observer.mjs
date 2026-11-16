import { Client } from 'pg';
import { setTimeout as pause } from 'node:timers/promises';

// The CHECK constraint admits exactly these two unfinished business states.
// One statement observes count, age and its database timestamp together.
export const queueSql = `
SELECT json_build_object(
  'at',statement_timestamp(),
  'app',json_build_object(
    'pending',count(*),
    'oldestPendingSeconds',coalesce(max(extract(epoch FROM statement_timestamp()-created_at)),0)
  )
) AS sample FROM tasks WHERE business_status IN ('PENDING','RUNNING')
`;

/** One read-only test connection; no pool, overlapping queries or reconnect path. */
export async function observeQueue(client) {
  if (!client) {
    if (!process.env.SI_TEST_DB_PASSWORD) throw new Error('SI_TEST_DB_PASSWORD is required for queue observation');
    client = new Client({
      host: '127.0.0.1',
      port: 19632,
      database: 'si_test',
      user: 'si_test',
      password: process.env.SI_TEST_DB_PASSWORD,
      application_name: 'si-load-queue-observer',
      options: '-c default_transaction_read_only=on',
      connectionTimeoutMillis: 15000,
      query_timeout: 15000,
    });
  }
  const samples = [],
    errors = [];
  const stopped = new AbortController();
  const onError = (error) => {
    errors.push(error.code || error.name);
    stopped.abort();
  };
  client.on('error', onError);
  const collect = async () => {
    const result = await client.query(queueSql);
    const sample = result.rows[0]?.sample;
    if (
      !sample ||
      !Number.isFinite(Date.parse(sample.at)) ||
      ![sample.app?.pending, sample.app?.oldestPendingSeconds].every((v) => Number.isFinite(v) && v >= 0)
    )
      throw new Error('Invalid queue observation');
    samples.push({ at: new Date(sample.at).toISOString(), app: sample.app });
  };
  try {
    await client.connect();
    await collect();
  } catch (error) {
    await client.end();
    throw error;
  }
  // Reproducible jitter avoids locking onto the 200/250 ms background periods.
  let seed = 101;
  const done = (async () => {
    try {
      while (!stopped.signal.aborted) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        await pause(40 + (seed % 21), undefined, { signal: stopped.signal });
        if (!stopped.signal.aborted) await collect();
      }
    } catch (error) {
      if (!(stopped.signal.aborted && error.name === 'AbortError')) onError(error);
    }
  })();
  let closing;
  return {
    samples,
    errors,
    cadence: {
      targetIntervalMs: 50,
      jitterMs: 10,
      source: 'single-statement database snapshot',
      connection: 'private read-only si_test',
    },
    stop() {
      return (closing ??= (async () => {
        stopped.abort();
        await done;
        try {
          await client.end();
        } catch (error) {
          onError(error);
        }
        client.off('error', onError);
      })());
    },
  };
}
