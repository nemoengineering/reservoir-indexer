-- Up Migration

ALTER TABLE "collection_mint_standards" ADD COLUMN "created_at" TIMESTAMPTZ DEFAULT now();
ALTER TABLE "collection_mint_standards" ADD COLUMN "updated_at" TIMESTAMPTZ DEFAULT now();

-- Down Migration
