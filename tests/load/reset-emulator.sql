DO $$ BEGIN
    IF current_database() <> 'si_emulator_test' THEN RAISE EXCEPTION 'Expected si_emulator_test'; END IF;
END $$;
BEGIN;
TRUNCATE result_events,faults,operations CASCADE;
UPDATE feed_position SET last_cursor = 0 WHERE id = 1;
COMMIT;
