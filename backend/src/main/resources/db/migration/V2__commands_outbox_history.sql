CREATE TABLE command_receipts (
    actor_id uuid NOT NULL REFERENCES users(id),
    command_type text NOT NULL,
    idempotency_key uuid NOT NULL,
    fingerprint text NOT NULL,
    http_status integer NOT NULL,
    response_body jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (actor_id, command_type, idempotency_key)
);

CREATE TABLE delivery_queue (
    operation_id uuid PRIMARY KEY REFERENCES tasks(operation_id),
    next_step text NOT NULL DEFAULT 'PUT' CHECK (next_step IN ('PUT','GET')),
    due_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    claim_id uuid,
    claimed_until timestamptz,
    CHECK ((claim_id IS NULL) = (claimed_until IS NULL))
);
CREATE INDEX delivery_due ON delivery_queue(due_at);

CREATE TABLE task_history (
    id uuid PRIMARY KEY,
    task_id uuid NOT NULL REFERENCES tasks(id),
    operation_id uuid NOT NULL REFERENCES tasks(operation_id),
    occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    actor text NOT NULL CHECK (actor IN ('USER','SYSTEM')),
    actor_user_id uuid REFERENCES users(id),
    event_type text NOT NULL,
    summary text NOT NULL,
    details jsonb NOT NULL DEFAULT '{}',
    CHECK ((actor = 'USER') = (actor_user_id IS NOT NULL))
);
CREATE INDEX history_task_created ON task_history(task_id, occurred_at DESC, id DESC);

CREATE FUNCTION reject_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Task history is append-only';
END;
$$;
CREATE TRIGGER history_immutable BEFORE UPDATE OR DELETE ON task_history
    FOR EACH ROW EXECUTE FUNCTION reject_history_mutation();
