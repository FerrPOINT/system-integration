ALTER TABLE delivery_queue ADD COLUMN automatic_attempts integer NOT NULL DEFAULT 0;
UPDATE delivery_queue SET automatic_attempts = attempts;
ALTER TABLE delivery_queue ADD CONSTRAINT automatic_attempt_count
    CHECK (automatic_attempts >= 0 AND automatic_attempts <= attempts);
