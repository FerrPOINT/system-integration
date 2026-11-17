-- The coordinated upgrade may stage mappings for faults armed before an
-- operation existed. Bound faults already carry their operation identity.
CREATE TABLE IF NOT EXISTS task_number_fault_mapping (
    reference text PRIMARY KEY,
    operation_id uuid NOT NULL UNIQUE
);

ALTER TABLE faults ADD COLUMN operation_id uuid;
UPDATE faults SET operation_id = bound_operation_id WHERE bound_operation_id IS NOT NULL;
UPDATE faults AS f
SET operation_id = m.operation_id
FROM task_number_fault_mapping AS m
WHERE f.bound_operation_id IS NULL AND f.reference = m.reference;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM faults WHERE operation_id IS NULL) THEN
        RAISE EXCEPTION 'Resolve unbound fault references with the coordinated upgrade before migrating';
    END IF;
    IF EXISTS (
        SELECT 1
        FROM task_number_fault_mapping AS m
        LEFT JOIN faults AS f ON f.reference = m.reference AND f.bound_operation_id IS NULL
        WHERE f.reference IS NULL
    ) THEN
        RAISE EXCEPTION 'Fault upgrade mappings do not match the pending configurations';
    END IF;
END
$$;

ALTER TABLE faults
    DROP COLUMN reference,
    DROP COLUMN bound_operation_id,
    ADD PRIMARY KEY (operation_id);
DROP TABLE task_number_fault_mapping;

UPDATE operations SET result = result #- '{request,reference}' WHERE result IS NOT NULL;
UPDATE result_events SET payload = payload #- '{request,reference}';
ALTER TABLE operations DROP COLUMN reference;
