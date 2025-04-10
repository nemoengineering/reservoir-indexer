-- Up Migration

ALTER TABLE "orders" ADD COLUMN "is_native_off_chain_cancellable" BOOLEAN;

-- Down Migration

ALTER TABLE "orders" DROP COLUMN "is_native_off_chain_cancellable";