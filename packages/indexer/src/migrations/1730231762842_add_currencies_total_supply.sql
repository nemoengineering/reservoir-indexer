-- Up Migration

ALTER TABLE currencies ADD COLUMN "total_supply" NUMERIC(78, 0);
ALTER TABLE currencies ADD COLUMN "created_at" TIMESTAMPTZ DEFAULT now();
ALTER TABLE currencies ADD COLUMN "updated_at" TIMESTAMPTZ DEFAULT now();
