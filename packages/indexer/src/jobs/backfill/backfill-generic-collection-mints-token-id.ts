import { redb } from "@/common/db";

import { AbstractRabbitMqJobHandler } from "@/jobs/abstract-rabbit-mq-job-handler";
import { RabbitMQMessage } from "@/common/rabbit-mq";

import { logger } from "@/common/logger";
import { redis } from "@/common/redis";
import _ from "lodash";
import { mintsRefreshJob } from "@/jobs/mints/mints-refresh-job";

export type BackfillGenericCollectionMintsTokenIdJobCursor = {
  id: number;
};

export type BackfillGenericCollectionMintsTokenIdJobPayload = {
  cursor?: BackfillGenericCollectionMintsTokenIdJobCursor;
};

export class BackfillGenericCollectionMintsTokenIdJob extends AbstractRabbitMqJobHandler {
  queueName = "backfill-generic-collection-mints-token-id-queue";
  maxRetries = 10;
  concurrency = 1;
  persistent = false;
  lazyMode = false;
  singleActiveConsumer = true;

  public async process(payload: BackfillGenericCollectionMintsTokenIdJobPayload) {
    const cursor = payload.cursor as BackfillGenericCollectionMintsTokenIdJobCursor;

    const limit = (await redis.get(`${this.queueName}-limit`)) || 500;

    let continuationFilter = "";

    if (cursor) {
      continuationFilter = ` AND (collection_mints.id) < ($/id/)`;
    }

    const results = await redb.manyOrNone(
      `
        SELECT 
          collection_mints.id, collection_mints.collection_id
        FROM 
          collection_mints 
          JOIN collection_mint_standards ON collection_mints.collection_id = collection_mint_standards.collection_id 
          JOIN collections ON collection_mints.collection_id = collections.id
          JOIN contracts ON contracts.address = collections.contract
        WHERE 
          token_id IS NULL
          and standard = 'unknown' 
          and contracts.kind = 'erc1155'
        ${continuationFilter}
        ORDER BY collection_mints.id DESC LIMIT $/limit/
          `,
      {
        id: cursor?.id,
        limit,
      }
    );

    logger.info(
      this.queueName,
      `Backfill start. resultsCount=${results.length}, cursor=${JSON.stringify(cursor)}`
    );

    for (const result of results) {
      // Refresh collection mints
      await mintsRefreshJob.addToQueue({ collection: result.collection_id, forceRefresh: true });
    }

    if (results.length >= limit) {
      const lastResult = _.last(results);

      return {
        addToQueue: true,
        addToQueueCursor: {
          id: lastResult.id,
        } as BackfillGenericCollectionMintsTokenIdJobCursor,
      };
    }

    logger.info(this.queueName, `Backfill done!`);

    return { addToQueue: false };
  }

  public async onCompleted(
    rabbitMqMessage: RabbitMQMessage,
    processResult: {
      addToQueue: boolean;
      addToQueueCursor: BackfillGenericCollectionMintsTokenIdJobCursor;
    }
  ) {
    if (processResult.addToQueue) {
      await this.addToQueue(processResult.addToQueueCursor, 60 * 1000);
    }
  }

  public async addToQueue(cursor?: BackfillGenericCollectionMintsTokenIdJobCursor, delay = 0) {
    await this.send({ payload: { cursor } }, delay);
  }
}

export const backfillGenericCollectionMintsTokenIdJob =
  new BackfillGenericCollectionMintsTokenIdJob();
