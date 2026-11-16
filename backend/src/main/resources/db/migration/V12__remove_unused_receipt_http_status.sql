-- HTTP responses belong to controllers; replay needs only the fingerprint and body.
ALTER TABLE command_receipts DROP COLUMN http_status;
