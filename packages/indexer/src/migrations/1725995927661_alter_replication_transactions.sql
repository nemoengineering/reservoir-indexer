-- Up Migration

ALTER TABLE transactions REPLICA IDENTITY FULL;
ALTER TABLE transactions ADD COLUMN "block_hash" BYTEA;

-- Down Migration

ALTER TABLE transactions REPLICA IDENTITY DEFAULT;
ALTER TABLE transactions REMOVE COLUMN "block_hash";