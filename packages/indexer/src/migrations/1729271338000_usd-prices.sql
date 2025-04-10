-- Up Migration
ALTER TABLE "usd_prices" ADD COLUMN "provider" TEXT;

UPDATE "usd_prices"
SET provider = 'coingecko'
WHERE provider IS NULL;

CREATE TABLE "usd_prices_minutely" (
	"currency" BYTEA NOT NULL,
	"timestamp" TIMESTAMPTZ NOT NULL,
	"provider" TEXT NOT NULL,
	"value" NUMERIC NOT NULL,
	"created_at" TIMESTAMPTZ DEFAULT now() NULL,
	CONSTRAINT usd_prices_minutely_pk PRIMARY KEY (currency, "timestamp")
);

CREATE INDEX "usd_prices_minutely_timestamp_index"
  ON "usd_prices_minutely" ("timestamp");

CREATE TABLE "usd_prices_hourly" (
	"currency" BYTEA NOT NULL,
	"timestamp" TIMESTAMPTZ NOT NULL,
	"provider" TEXT NOT NULL,
	"value" NUMERIC NOT NULL,
	"created_at" TIMESTAMPTZ DEFAULT now() NULL,
	CONSTRAINT usd_prices_hourly_pk PRIMARY KEY (currency, "timestamp")
);

CREATE TABLE "currencies_pricing_provider" (
  "contract" BYTEA NOT NULL,
  "provider" TEXT NOT NULL,
  "metadata" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT currencies_pricing_provider_pk PRIMARY KEY ("contract", "provider")
);

-- Down Migration

DROP TABLE "usd_prices_minutely";
DROP TABLE "usd_prices_hourly";
DROP TABLE "currencies_pricing_provider";

