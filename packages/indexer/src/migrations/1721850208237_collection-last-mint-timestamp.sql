-- Up Migration

ALTER TABLE "collections" ADD COLUMN "last_mint_timestamp" INT;
ALTER TABLE "collections" ADD COLUMN "supply" NUMERIC(78, 0);
ALTER TABLE "collections" ADD COLUMN "remaining_supply" NUMERIC(78, 0);

--CREATE INDEX "collections_last_mint_timestamp_index"
--    ON "collections" ("last_mint_timestamp" DESC);

-- Down Migration

ALTER TABLE "collections" DROP COLUMN "last_mint_timestamp";
ALTER TABLE "collections" DROP COLUMN "supply";
ALTER TABLE "collections" DROP COLUMN "remaining_supply";