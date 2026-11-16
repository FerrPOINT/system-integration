-- Retire the former delayed-but-still-scheduled model without discarding work or audit.
WITH affected AS MATERIALIZED (
    SELECT t.id,t.operation_id,t.delivery_status AS previous_status,q.claim_id
    FROM tasks t JOIN delivery_queue q ON q.operation_id=t.operation_id
    WHERE t.delivery_status IN ('QUEUED','RETRY_WAIT','UNKNOWN')
      AND EXISTS (
          SELECT 1 FROM exchange_issues i
          WHERE i.task_id=t.id AND i.operation_id=t.operation_id
            AND i.status='OPEN' AND i.kind='DELIVERY_DELAYED'
      )
    ORDER BY t.operation_id
    FOR UPDATE OF t,q
), finished_attempts AS (
    UPDATE delivery_attempts a
    SET finished_at=clock_timestamp(),outcome='INTERRUPTED'
    FROM affected d
    WHERE a.id=d.claim_id AND a.finished_at IS NULL
    RETURNING a.id
), parked AS (
    UPDATE delivery_queue q
    SET due_at='infinity',claim_id=NULL,claimed_until=NULL
    FROM affected d
    WHERE q.operation_id=d.operation_id
    RETURNING q.operation_id
), paused AS (
    UPDATE tasks t
    SET delivery_status='NEEDS_REVIEW',exchange_version=t.exchange_version+1
    FROM affected d
    WHERE t.id=d.id
    RETURNING t.id,t.operation_id
)
INSERT INTO task_history(id,task_id,operation_id,actor,event_type,summary,details)
SELECT gen_random_uuid(),p.id,p.operation_id,'SYSTEM','DELIVERY_UNCERTAIN',
       'Прежняя отложенная доставка приостановлена; для продолжения требуется сверка оператора',
       jsonb_build_object('migration','V11','previousDeliveryStatus',d.previous_status,'attemptId',d.claim_id)
FROM paused p JOIN affected d ON d.id=p.id;
