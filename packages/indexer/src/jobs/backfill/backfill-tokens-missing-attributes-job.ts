import { idb } from "@/common/db";

import { AbstractRabbitMqJobHandler } from "@/jobs/abstract-rabbit-mq-job-handler";
import { RabbitMQMessage } from "@/common/rabbit-mq";
import { redis } from "@/common/redis";
import { logger } from "@/common/logger";

export class BackfillTokensMissingAttributesJob extends AbstractRabbitMqJobHandler {
  queueName = "backfill-tokens-missing-attributes-queue";
  maxRetries = 10;
  concurrency = 1;
  persistent = false;
  lazyMode = false;
  singleActiveConsumer = true;

  public async process() {
    const limit = (await redis.get(`${this.queueName}-limit`)) || 1000;

    const results = await idb.manyOrNone(
      `
            WITH x AS (
              select 
                removed_attributes.id removed_id, removed_attributes.deleted_at removed_deleted_at,
                t.id existing_id 
              from 
                removed_attributes 
                join collections ON collections.id = removed_attributes.collection_id
                JOIN LATERAL (
                  SELECT 
                    * 
                  FROM 
                    attributes 
                  WHERE 
                    attributes.collection_id = removed_attributes.collection_id 
                    AND attributes.key = removed_attributes."key" 
                    AND attributes.value = removed_attributes."value" 
                  LIMIT 
                    1
                ) t ON TRUE 
              WHERE 
                EXISTS (
                  SELECT 
                    1 
                  FROM 
                    token_attributes 
                  WHERE 
                    attribute_id = removed_attributes.id 
                  LIMIT 
                    1
                ) AND collections.all_time_rank <= 1000 
              ORDER BY 
                deleted_at, 
                removed_attributes.id 
              LIMIT 
                $/limit/
            ), y AS (
              SELECT 
                token_attributes.contract, 
                token_attributes.token_id, 
                x.existing_id, 
                x.removed_id,
                x.removed_deleted_at 
              FROM 
                x 
                JOIN token_attributes ON token_attributes.attribute_id = x.removed_id 
                AND x.existing_id IS NOT NULL 
              LIMIT 
                $/limit/
            ) 
            UPDATE 
              token_attributes 
            SET 
              attribute_id = y.existing_id, 
              updated_at = now() 
            FROM 
              y 
            WHERE 
              token_attributes.contract = y.contract 
              AND token_attributes.token_id = y.token_id 
              AND token_attributes.attribute_id = y.removed_id 
              AND y.removed_id <> y.existing_id RETURNING *

          `,
      {
        limit,
      }
    );

    logger.info(
      this.queueName,
      JSON.stringify({
        message: `Backfilled ${results.length} tokens. limit=${limit}, removedDeletedAt=${
          results?.length ? results[0].removed_deleted_at : null
        }`,
      })
    );

    if (!results.length) {
      const noResultsRetryCount = await redis.incr(`${this.queueName}-no-results-max-retries`);

      if (noResultsRetryCount > 10) {
        await redis.del(`${this.queueName}-no-results-max-retries`);

        logger.info(
          this.queueName,
          JSON.stringify({
            message: `Backfilled done. limit=${limit}`,
          })
        );

        return { addToQueue: false };
      }
    }
    return { addToQueue: true };
  }

  public async onCompleted(
    rabbitMqMessage: RabbitMQMessage,
    processResult: {
      addToQueue: boolean;
    }
  ) {
    if (processResult.addToQueue) {
      await this.addToQueue(60 * 1000);
    }
  }

  public async addToQueue(delay = 1000) {
    await this.send({ payload: {} }, delay);
  }
}

export const backfillTokensMissingAttributesJob = new BackfillTokensMissingAttributesJob();
