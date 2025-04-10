-- Up Migration

ALTER TABLE "usd_prices" ADD COLUMN "volume" NUMERIC(78, 0) DEFAULT 0;

ALTER TABLE "currencies" ADD COLUMN "day1_volume" NUMERIC(78, 0) DEFAULT 0;
ALTER TABLE "currencies" ADD COLUMN "day7_volume" NUMERIC(78, 0) DEFAULT 0;
ALTER TABLE "currencies" ADD COLUMN "day30_volume" NUMERIC(78, 0) DEFAULT 0;
ALTER TABLE "currencies" ADD COLUMN "all_time_volume" NUMERIC(78, 0) DEFAULT 0;

ALTER TABLE "usd_prices" ADD COLUMN "volume_usd" NUMERIC(78, 0) DEFAULT 0;

ALTER TABLE "currencies" ADD COLUMN "day1_volume_usd" NUMERIC(78, 0) DEFAULT 0;
ALTER TABLE "currencies" ADD COLUMN "day7_volume_usd" NUMERIC(78, 0) DEFAULT 0;
ALTER TABLE "currencies" ADD COLUMN "day30_volume_usd" NUMERIC(78, 0) DEFAULT 0;
ALTER TABLE "currencies" ADD COLUMN "all_time_volume_usd" NUMERIC(78, 0) DEFAULT 0;
