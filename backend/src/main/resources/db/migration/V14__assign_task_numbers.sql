ALTER TABLE tasks ADD COLUMN task_number bigint;

WITH numbered AS (
    SELECT id, row_number() OVER (ORDER BY created_at, id) AS task_number
    FROM tasks
)
UPDATE tasks AS t
SET task_number = numbered.task_number
FROM numbered
WHERE t.id = numbered.id;

CREATE SEQUENCE task_number_seq AS bigint OWNED BY tasks.task_number;
SELECT setval('task_number_seq', coalesce(max(task_number), 1), count(*) > 0)
FROM tasks;

ALTER TABLE tasks
    ALTER COLUMN task_number SET DEFAULT nextval('task_number_seq'),
    ALTER COLUMN task_number SET NOT NULL,
    ADD CONSTRAINT tasks_task_number_positive CHECK (task_number > 0),
    ADD CONSTRAINT tasks_task_number_unique UNIQUE (task_number);
