CREATE TABLE users (
    id uuid PRIMARY KEY,
    username varchar(64) NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9._-]+$'),
    password_hash text NOT NULL,
    role text NOT NULL CHECK (role IN ('INITIATOR', 'OPERATOR'))
);

CREATE TABLE tasks (
    id uuid PRIMARY KEY,
    owner_id uuid NOT NULL REFERENCES users(id),
    operation_id uuid NOT NULL UNIQUE,
    title varchar(160) NOT NULL CHECK (title ~ '\S'),
    title_revision bigint NOT NULL DEFAULT 1 CHECK (title_revision BETWEEN 1 AND 9007199254740991),
    request_reference varchar(10) NOT NULL CHECK (request_reference ~ '^REQ-[0-9]{6}$'),
    request_quantity integer NOT NULL CHECK (request_quantity BETWEEN 1 AND 1000),
    delivery_status text NOT NULL DEFAULT 'QUEUED'
        CHECK (delivery_status IN ('QUEUED','RETRY_WAIT','UNKNOWN','ACKNOWLEDGED','NEEDS_REVIEW','STOPPED')),
    business_status text NOT NULL DEFAULT 'PENDING'
        CHECK (business_status IN ('PENDING','RUNNING','SUCCEEDED','REJECTED')),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX tasks_owner_created ON tasks(owner_id, created_at DESC, id DESC);
CREATE INDEX tasks_created ON tasks(created_at DESC, id DESC);
