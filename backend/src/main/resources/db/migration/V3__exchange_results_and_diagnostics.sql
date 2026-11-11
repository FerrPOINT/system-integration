ALTER TABLE tasks ADD COLUMN exchange_version bigint NOT NULL DEFAULT 1 CHECK (exchange_version BETWEEN 1 AND 9007199254740991);
ALTER TABLE tasks ADD COLUMN accepted_result jsonb;
ALTER TABLE task_history ADD COLUMN observed_result jsonb;
ALTER TABLE task_history ADD COLUMN observation_fingerprint text;
CREATE UNIQUE INDEX history_observation ON task_history(operation_id,observation_fingerprint) WHERE observation_fingerprint IS NOT NULL;

CREATE TABLE delivery_attempts (
    id uuid PRIMARY KEY,
    operation_id uuid NOT NULL REFERENCES tasks(operation_id),
    number integer NOT NULL CHECK (number >= 1),
    step text NOT NULL CHECK (step IN ('PUT','GET')),
    started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    finished_at timestamptz,
    outcome text,
    UNIQUE (operation_id,number)
);

CREATE TABLE incoming_position (
    id integer PRIMARY KEY CHECK (id = 1),
    last_cursor bigint NOT NULL CHECK (last_cursor BETWEEN 0 AND 9007199254740991)
);
INSERT INTO incoming_position VALUES (1,0);

CREATE TABLE exchange_issues (
    id uuid PRIMARY KEY,
    task_id uuid REFERENCES tasks(id),
    operation_id uuid,
    scope text NOT NULL,
    fingerprint text NOT NULL,
    issue_revision bigint NOT NULL DEFAULT 1 CHECK (issue_revision BETWEEN 1 AND 9007199254740991),
    kind text NOT NULL CHECK (kind IN ('DELIVERY_UNCERTAIN','DELIVERY_DELAYED','PROTOCOL_ERROR','RESULT_CONFLICT','RECONCILIATION_DIFFERENCE')),
    status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','RESOLVED')),
    opened_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    summary text NOT NULL,
    evidence jsonb NOT NULL,
    UNIQUE (scope,fingerprint)
);
CREATE INDEX issues_status_created ON exchange_issues(status,opened_at DESC,id DESC);
