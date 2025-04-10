import { redb } from "@/common/db";

import { AbstractRabbitMqJobHandler } from "@/jobs/abstract-rabbit-mq-job-handler";
import { RabbitMQMessage } from "@/common/rabbit-mq";

import { logger } from "@/common/logger";
import { redis } from "@/common/redis";

export class BackfillGenericCollectionMintsTokenIdV2Job extends AbstractRabbitMqJobHandler {
  queueName = "backfill-generic-collection-mints-token-id-v2-queue";
  maxRetries = 10;
  concurrency = 1;
  persistent = false;
  lazyMode = false;
  singleActiveConsumer = true;

  public async process() {
    const limit = (await redis.get(`${this.queueName}-limit`)) || 500;

    const results = await redb.manyOrNone(
      `
        WITH x AS (
          SELECT 
            cm1.id 
          FROM 
            collection_mints cm1 
            JOIN collection_mint_standards ON cm1.collection_id = collection_mint_standards.collection_id 
            JOIN collection_mints cm2 ON cm2.collection_id = cm1.collection_id 
          WHERE 
            cm1.token_id IS NULL 
            and standard = 'unknown' 
            and cm1.status = 'open' 
            AND cm2.token_id IS NOT NULL 
            and cm2.status = 'open' 
          LIMIT $/limit/
        ) 
        UPDATE 
          collection_mints 
        SET 
          status = 'closed', 
          updated_at = now() 
        FROM 
          x 
        WHERE 
          collection_mints.id = x.id RETURNING collection_mints.id
          `,
      {
        limit,
      }
    );

    logger.info(this.queueName, `Backfill start. resultsCount=${results.length}`);

    if (results.length >= limit) {
      return {
        addToQueue: true,
      };
    }

    logger.info(this.queueName, `Backfill done!`);

    return { addToQueue: false };
  }

  public async onCompleted(
    rabbitMqMessage: RabbitMQMessage,
    processResult: {
      addToQueue: boolean;
    }
  ) {
    if (processResult.addToQueue) {
      await this.addToQueue(1 * 1000);
    }
  }

  public async addToQueue(delay = 0) {
    await this.send({ payload: {} }, delay);
  }
}

export const backfillGenericCollectionMintsTokenIdV2Job =
  new BackfillGenericCollectionMintsTokenIdV2Job();
