CREATE TABLE reconciliations (
    id uuid PRIMARY KEY,
    task_id uuid NOT NULL REFERENCES tasks(id),
    exchange_version bigint NOT NULL,
    checked_at timestamptz NOT NULL,
    checked_by uuid NOT NULL REFERENCES users(id),
    snapshot jsonb NOT NULL
);
CREATE INDEX reconciliations_task ON reconciliations(task_id,checked_at DESC,id DESC);

ALTER TABLE exchange_issues ADD COLUMN assigned_to uuid REFERENCES users(id);
ALTER TABLE exchange_issues ADD COLUMN latest_reconciliation_id uuid REFERENCES reconciliations(id);
ALTER TABLE exchange_issues ADD COLUMN resolution jsonb;

CREATE FUNCTION reject_snapshot_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Reconciliation snapshots are append-only';
END;
$$;
CREATE TRIGGER reconciliation_immutable BEFORE UPDATE OR DELETE ON reconciliations
    FOR EACH ROW EXECUTE FUNCTION reject_snapshot_mutation();
