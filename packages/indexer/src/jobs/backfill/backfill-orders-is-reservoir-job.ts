import { idb } from "@/common/db";

import { AbstractRabbitMqJobHandler } from "@/jobs/abstract-rabbit-mq-job-handler";
import { RabbitMQMessage } from "@/common/rabbit-mq";
import { redis } from "@/common/redis";
import { logger } from "@/common/logger";

export class BackfillOrdersIsReservoirJob extends AbstractRabbitMqJobHandler {
  queueName = "backfill-orders-is-reservoir-queue";
  maxRetries = 10;
  concurrency = 1;
  persistent = false;
  lazyMode = false;
  singleActiveConsumer = true;

  public async process() {
    const limit = (await redis.get(`${this.queueName}-limit`)) || 500;

    const results = await idb.manyOrNone(
      `
            WITH x AS (
              SELECT 
                orders.id 
              FROM 
                orders 
              WHERE (orders.kind = 'payment-processor' OR orders.kind = 'payment-processor-v2' OR orders.kind = 'alienswap')
              AND orders.is_reservoir IS NOT TRUE
              LIMIT 
                $/limit/
            ) 
            UPDATE 
              orders 
            SET 
              is_reservoir = TRUE,
              updated_at = now()
            FROM 
              x 
            WHERE 
              orders.id = x.id RETURNING x.id
          `,
      {
        limit,
      }
    );

    logger.info(
      this.queueName,
      JSON.stringify({
        message: `Backfilled ${results.length} orders. limit=${limit}`,
        lastResult: results.length ? results[results.length - 1] : null,
      })
    );

    return { addToQueue: results.length > 0 };
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

export const backfillOrdersIsReservoirJob = new BackfillOrdersIsReservoirJob();
