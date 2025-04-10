-- Up Migration
ALTER TABLE "currencies" ADD COLUMN "hour24_volume" NUMERIC(78, 0) DEFAULT 0;
ALTER TABLE "currencies" ADD COLUMN "hour24_volume_usd" NUMERIC(78, 0) DEFAULT 0;

