-- Up Migration

CREATE INDEX "usd_prices_minutely_currency_provider_timestamp"
    ON "usd_prices_minutely" (currency, provider, timestamp DESC) INCLUDE (value);

CREATE INDEX "usd_prices_hourly_currency_provider_timestamp"
    ON "usd_prices_hourly" (currency, provider, timestamp DESC) INCLUDE (value);

-- Down Migration
