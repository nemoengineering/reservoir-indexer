/* eslint-disable @typescript-eslint/no-explicit-any */

import { idb, redb } from "@/common/db";
import { bn, toBuffer } from "@/common/utils";
import { AbstractRabbitMqJobHandler } from "@/jobs/abstract-rabbit-mq-job-handler";
import _ from "lodash";
import { acquireLock } from "@/common/redis";
import { Collections } from "@/models/collections";
import { CollectionsEntity } from "@/models/collections/collections-entity";
import { isSharedContract } from "@/metadata/extend";
import { logger } from "@/common/logger";

export type CollectionReclacSupplyJobPayload = {
  collection: string;
};

export default class CollectionReclacSupplyJob extends AbstractRabbitMqJobHandler {
  queueName = "collection-reclac-supply";
  maxRetries = 1;
  concurrency = 1;
  useSharedChannel = true;

  public async process(payload: CollectionReclacSupplyJobPayload) {
    const { collection } = payload;

    const collectionEntity = await Collections.getById(collection);

    if (!collectionEntity) {
      logger.info(this.queueName, `collection ${collection} not found`);
      return;
    }

    // For large supply collections calc once a day
    if (
      collectionEntity &&
      collectionEntity.tokenCount > 10000 &&
      !(await acquireLock(`${this.queueName}:large:${collection}`, 60 * 60 * 24))
    ) {
      return;
    }

    const { totalSupply, remainingSupply, lastMintTimestamp } =
      await this.calcTotalSupplyAndRemainingSupply(collectionEntity);

    await idb.none(
      `
        UPDATE collections SET
          supply = $/totalSupply/,
          remaining_supply = $/remainingSupply/,
          last_mint_timestamp = GREATEST(last_mint_timestamp, $/lastMintTimestamp/),
          updated_at = now()
        WHERE collections.id = $/collection/
          AND (supply IS DISTINCT FROM $/totalSupply/ OR remaining_supply IS DISTINCT FROM $/remainingSupply/ OR COALESCE(last_mint_timestamp, 0) < $/lastMintTimestamp/)
      `,
      {
        collection,
        totalSupply,
        remainingSupply,
        lastMintTimestamp,
      }
    );
  }

  public async calcTotalSupplyAndRemainingSupply(collection: CollectionsEntity) {
    const limit = 1000;
    let totalSupply = "0";
    let remainingSupply = "0";
    let lastMintTimestamp = 0;
    let continuation = "";
    let tokens = [];

    const values: {
      contract: Buffer;
      limit: number;
      collection: string;
      tokenId?: string;
    } = {
      contract: toBuffer(collection.contract),
      collection: collection.id,
      limit,
    };

    do {
      const query = `
        SELECT token_id,
               COALESCE(supply, 0) AS supply,
               COALESCE(remaining_supply, 0) AS remaining_supply,
               COALESCE(minted_timestamp, 0) AS minted_timestamp
        FROM tokens
        WHERE contract = $/contract/
        ${isSharedContract(collection.contract) ? `AND collection_id = $/collection/` : ""}
        ${continuation}
        ORDER BY token_id
        LIMIT $/limit/
      `;

      tokens = await redb.manyOrNone(query, values);
      continuation = `AND token_id > $/tokenId/`;

      if (!_.isEmpty(tokens)) {
        for (const token of tokens) {
          if (token.minted_timestamp > lastMintTimestamp) {
            lastMintTimestamp = token.minted_timestamp;
          }
        }

        tokens.map((event) => (totalSupply = bn(event.supply).add(totalSupply).toString()));
        tokens.map(
          (event) => (remainingSupply = bn(event.remaining_supply).add(remainingSupply).toString())
        );

        const lastEvent = _.last(tokens);
        values.tokenId = lastEvent.token_id;
      }
    } while (tokens.length >= limit);

    return { totalSupply, remainingSupply, lastMintTimestamp };
  }

  public async addToQueue(collections: CollectionReclacSupplyJobPayload[], delay = 60 * 30 * 1000) {
    await this.sendBatch(collections.map((c) => ({ payload: c, jobId: `${c.collection}`, delay })));
  }
}

export const collectionReclacSupplyJob = new CollectionReclacSupplyJob();
