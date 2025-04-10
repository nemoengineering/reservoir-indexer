-- Up Migration

ALTER TABLE "fill_events_2" ADD COLUMN "order_is_reservoir" BOOLEAN;

-- Down Migration

ALTER TABLE "fill_events_2" DROP COLUMN "order_is_reservoir";