import { postgres } from '../../seed/postgres.mjs';

/** A fixture for the exclusive QA installation. Let the normal API commit its
 * task and outbox atomically, but keep that outbox row away from the worker
 * until a fault (or a conflicting external operation) has been staged. */
export async function createHeldDelivery(create) {
  const db = postgres('load', process.env.SI_UI_FRONTEND_RUNTIME || 'container');
  const currentDefault = db.read(
    'app',
    "SELECT to_jsonb(column_default) FROM information_schema.columns WHERE table_schema='public' AND table_name='delivery_queue' AND column_name='due_at';",
  );
  if (currentDefault !== 'clock_timestamp()')
    throw new Error('Expected the normal QA outbox default before holding delivery');
  db.query('app', "ALTER TABLE delivery_queue ALTER COLUMN due_at SET DEFAULT 'infinity'::timestamptz;");
  try {
    const task = await create();
    const id = operationUuid(task.operationId);
    const held = db.read(
      'app',
      "SELECT to_jsonb(count(*)) FROM delivery_queue WHERE operation_id='" +
        id +
        "' AND due_at='infinity' AND attempts=0 AND claim_id IS NULL;",
    );
    if (held !== 1) throw new Error('Expected a newly queued task with no delivery attempts');
    return task;
  } finally {
    db.query('app', 'ALTER TABLE delivery_queue ALTER COLUMN due_at SET DEFAULT clock_timestamp();');
  }
}

export function releaseHeldDelivery(operationId) {
  const id = operationUuid(operationId);
  const released = postgres('load', process.env.SI_UI_FRONTEND_RUNTIME || 'container').query(
    'app',
    "UPDATE delivery_queue SET due_at=clock_timestamp() WHERE operation_id='" +
      id +
      "' AND due_at='infinity' AND attempts=0 AND claim_id IS NULL RETURNING operation_id;",
  );
  if (released !== id) throw new Error('Expected exactly one held delivery to resume');
}

export function operationUuid(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value))
    throw new Error('Expected a canonical operation UUID');
  return value;
}
