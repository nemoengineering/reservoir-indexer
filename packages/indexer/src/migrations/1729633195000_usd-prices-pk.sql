-- Up Migration
ALTER TABLE usd_prices
DROP CONSTRAINT usd_prices_pk;

ALTER TABLE usd_prices
ADD CONSTRAINT usd_prices_pk PRIMARY KEY (currency, "timestamp", provider);

ALTER TABLE usd_prices_minutely
DROP CONSTRAINT usd_prices_minutely_pk;

ALTER TABLE usd_prices_minutely
ADD CONSTRAINT usd_prices_minutely_pk PRIMARY KEY (currency, "timestamp", provider);

ALTER TABLE usd_prices_hourly
DROP CONSTRAINT usd_prices_hourly_pk;

ALTER TABLE usd_prices_hourly
ADD CONSTRAINT usd_prices_hourly_pk PRIMARY KEY (currency, "timestamp", provider);

-- Down Migration

