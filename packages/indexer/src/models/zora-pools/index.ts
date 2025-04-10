import { idb } from "@/common/db";
import { fromBuffer, toBuffer } from "@/common/utils";

export type ZoraPool = {
  address: string;
  collection: string;
  tokenId: string;
  pool: string;
};

export const saveMarket = async (market: ZoraPool) => {
  await idb.none(
    `
      INSERT INTO zora_pools (
        address,
        collection,
        token_id,
        pool
      ) VALUES (
        $/address/,
        $/collection/,
        $/tokenId/,
        $/pool/
      )
      ON CONFLICT DO NOTHING
    `,
    {
      address: toBuffer(market.address),
      collection: toBuffer(market.collection),
      pool: toBuffer(market.pool),
      tokenId: market.tokenId,
    }
  );

  return market;
};

export const getMarket = async (address: string): Promise<ZoraPool | undefined> => {
  const result = await idb.oneOrNone(
    `
      SELECT
        zora_pools.address,
        zora_pools.collection,
        zora_pools.token_id,
        zora_pools.pool
      FROM zora_pools
      WHERE zora_pools.address = $/address/
    `,
    { address: toBuffer(address) }
  );
  if (!result) {
    return undefined;
  }

  return {
    address,
    collection: fromBuffer(result.collection),
    pool: fromBuffer(result.pool),
    tokenId: result.token_id,
  };
};

export const getMarketByPool = async (pool: string): Promise<ZoraPool | undefined> => {
  const result = await idb.oneOrNone(
    `
      SELECT
        zora_pools.address,
        zora_pools.collection,
        zora_pools.token_id,
        zora_pools.pool
      FROM zora_pools
      WHERE zora_pools.pool = $/pool/
    `,
    { pool: toBuffer(pool) }
  );
  if (!result) {
    return undefined;
  }

  return {
    address: fromBuffer(result.address),
    collection: fromBuffer(result.collection),
    pool: fromBuffer(result.pool),
    tokenId: result.token_id,
  };
};
