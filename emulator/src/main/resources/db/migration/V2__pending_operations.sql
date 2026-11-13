CREATE INDEX pending_operations ON operations(accepted_at,id) WHERE executions = 0;
