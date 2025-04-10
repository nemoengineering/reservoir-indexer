-- Up Migration
ALTER TABLE "currencies" ADD COLUMN "is_spam" INT DEFAULT 0;

