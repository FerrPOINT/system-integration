-- Narrow exact-count access; ordered pages continue using tasks_owner_status_created.
CREATE INDEX tasks_owner_status_count ON tasks(owner_id,business_status);
