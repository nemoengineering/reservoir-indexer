-- Up Migration
ALTER TABLE "fee_recipients" ADD COLUMN "updated_at" TIMESTAMPTZ DEFAULT now();
ALTER TABLE "fee_recipients" ADD COLUMN "is_deleted" INT NOT NULL DEFAULT 0;
