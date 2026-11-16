-- Paused deliveries retain attempts and history, but are not candidates for automatic work.
UPDATE delivery_queue q
SET due_at = 'infinity'
FROM tasks t
WHERE t.operation_id = q.operation_id
  AND t.delivery_status = 'NEEDS_REVIEW';
