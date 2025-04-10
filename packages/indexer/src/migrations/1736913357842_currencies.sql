-- Up Migration
ALTER TABLE "currencies" ADD COLUMN "day1_fdv" NUMERIC(78, 0) DEFAULT 0;

