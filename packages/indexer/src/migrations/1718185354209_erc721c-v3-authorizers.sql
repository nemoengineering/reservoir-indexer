-- Up Migration

ALTER TABLE "erc721c_v3_lists" ADD COLUMN "authorizers" JSONB;

-- Down Migration

ALTER TABLE "erc721c_v3_lists" DROP COLUMN "authorizers";