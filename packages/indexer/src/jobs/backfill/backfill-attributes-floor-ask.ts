import { redb } from "@/common/db";

import { AbstractRabbitMqJobHandler } from "@/jobs/abstract-rabbit-mq-job-handler";
import { RabbitMQMessage } from "@/common/rabbit-mq";

import { resyncAttributeCacheJob } from "@/jobs/update-attribute/resync-attribute-cache-job";
import { logger } from "@/common/logger";
import { redis } from "@/common/redis";
import _ from "lodash";

export type BackfillAttributesFloorAskJobCursor = {
  updatedTs: number;
  id: number;
};

export type BackfillAttributesFloorAskJobPayload = {
  cursor?: BackfillAttributesFloorAskJobCursor;
};

export class BackfillAttributesFloorAskJob extends AbstractRabbitMqJobHandler {
  queueName = "backfill-attributes-floor-ask-queue";
  maxRetries = 10;
  concurrency = 1;
  persistent = false;
  lazyMode = false;
  singleActiveConsumer = true;

  public async process(payload: BackfillAttributesFloorAskJobPayload) {
    const cursor = payload.cursor as BackfillAttributesFloorAskJobCursor;

    const limit = (await redis.get(`${this.queueName}-limit`)) || 500;

    let continuationFilter = "";

    if (cursor) {
      continuationFilter = ` AND (updated_at, id) < (to_timestamp($/updatedTs/), $/id/)`;
    }

    const results = await redb.manyOrNone(
      `
       SELECT "attributes".id, extract(epoch from updated_at) updated_ts FROM "attributes" 
WHERE floor_sell_value IS NOT NULL
${continuationFilter}
ORDER BY updated_at DESC, id DESC LIMIT $/limit/
          `,
      {
        id: cursor?.id,
        updatedTs: cursor?.updatedTs,
        limit,
      }
    );

    logger.info(
      this.queueName,
      `Backfill start. resultsCount=${results.length}, cursor=${JSON.stringify(cursor)}`
    );

    for (const result of results) {
      const attributeId = result.id;

      await resyncAttributeCacheJob.addToQueue([{ attributeId }], 0);
    }

    if (results.length >= limit) {
      const lastResult = _.last(results);

      return {
        addToQueue: true,
        addToQueueCursor: {
          id: lastResult.id,
          updatedTs: lastResult.updated_ts,
        } as BackfillAttributesFloorAskJobCursor,
      };
    }

    logger.info(this.queueName, `Backfill done!`);

    return { addToQueue: false };
  }

  public async onCompleted(
    rabbitMqMessage: RabbitMQMessage,
    processResult: {
      addToQueue: boolean;
      addToQueueCursor: BackfillAttributesFloorAskJobCursor;
    }
  ) {
    if (processResult.addToQueue) {
      await this.addToQueue(processResult.addToQueueCursor, 1 * 1000);
    }
  }

  public async addToQueue(cursor?: BackfillAttributesFloorAskJobCursor, delay = 0) {
    await this.send({ payload: { cursor } }, delay);
  }
}

export const backfillAttributesFloorAskJob = new BackfillAttributesFloorAskJob();
