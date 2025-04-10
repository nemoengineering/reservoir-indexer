-- Up Migration
CREATE INDEX "usd_prices_hourly_timestamp_index"
  ON "usd_prices_hourly" ("timestamp");

-- Down Migration

