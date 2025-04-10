-- Up Migration

ALTER TABLE "contracts" ADD COLUMN "is_offchain" BOOLEAN;

-- Down Migration