-- Up Migration

ALTER TABLE currencies REPLICA IDENTITY FULL;

-- Down Migration

ALTER TABLE currencies REPLICA IDENTITY DEFAULT;