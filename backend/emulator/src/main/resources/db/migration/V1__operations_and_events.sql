CREATE TABLE operations (
    id uuid PRIMARY KEY,
    reference varchar(10) NOT NULL CHECK (reference ~ '^REQ-[0-9]{6}$'),
    quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 1000),
    accepted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    executions integer NOT NULL DEFAULT 0 CHECK (executions IN (0,1)),
    result jsonb,
    completed_at timestamptz,
    CHECK ((executions = 1) = (result IS NOT NULL AND completed_at IS NOT NULL))
);

CREATE TABLE faults (
    reference varchar(10) PRIMARY KEY CHECK (reference ~ '^REQ-[0-9]{6}$'),
    mode text NOT NULL CHECK (mode IN ('UNAVAILABLE','DROP_RESPONSE_AFTER_EXECUTION','DUPLICATE_RESULT','DELAY_RESULT')),
    bound_operation_id uuid UNIQUE REFERENCES operations(id)
);

CREATE TABLE result_events (
    operation_id uuid NOT NULL REFERENCES operations(id),
    version integer NOT NULL CHECK (version IN (1,2)),
    copy_number integer NOT NULL DEFAULT 0 CHECK (copy_number IN (0,1)),
    cursor bigint UNIQUE CHECK (cursor BETWEEN 1 AND 9007199254740991),
    payload jsonb NOT NULL,
    publish_after timestamptz,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (operation_id,version,copy_number)
);
CREATE INDEX unpublished_events ON result_events(created_at,version,copy_number) WHERE cursor IS NULL;
CREATE TABLE feed_position (
    id integer PRIMARY KEY CHECK (id = 1),
    last_cursor bigint NOT NULL CHECK (last_cursor BETWEEN 0 AND 9007199254740991)
);
INSERT INTO feed_position VALUES (1,0);
