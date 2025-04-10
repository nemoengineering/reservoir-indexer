-- Up Migration

ALTER TYPE "order_kind_t" ADD VALUE 'zora-v4';

CREATE TABLE "zora_pools" (
  "address" BYTEA NOT NULL,
  "collection" BYTEA NOT NULL,
  "token_id" NUMERIC(78, 0) NOT NULL,
  "pool" BYTEA NOT NULL
);

ALTER TABLE "zora_pools"
  ADD CONSTRAINT "zora_pools_pk"
  PRIMARY KEY ("address");

CREATE INDEX "zora_pools_pool_collection_token_id_index"
  ON "zora_pools" ("pool", "collection", "token_id");

-- Down Migration

DROP TABLE "zora_pools";