DO $$ BEGIN
    IF current_database() <> 'si_test' THEN RAISE EXCEPTION 'Expected si_test'; END IF;
END $$;
BEGIN;
TRUNCATE task_history,delivery_queue,command_receipts,tasks,users CASCADE;
UPDATE incoming_position SET last_cursor = 0 WHERE id = 1;
COMMIT;
