import { idb } from "@/common/db";

import { AbstractRabbitMqJobHandler } from "@/jobs/abstract-rabbit-mq-job-handler";
import { RabbitMQMessage } from "@/common/rabbit-mq";
import { redis } from "@/common/redis";
import { logger } from "@/common/logger";
import { fromBuffer } from "@/common/utils";

export class BackfillContractsDeployedAtJob extends AbstractRabbitMqJobHandler {
  queueName = "backfill-contracts-deployed-at-queue";
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
                contracts.address, 
                CASE WHEN c.minted_timestamp IS NULL THEN contracts.created_at ELSE to_timestamp(c.minted_timestamp) END AS minted_at
              FROM 
                contracts 
                LEFT JOIN LATERAL (
                  SELECT 
                    MIN(minted_timestamp) AS minted_timestamp
                  FROM 
                    tokens 
                  WHERE 
                    tokens.contract = contracts.address AND tokens.minted_timestamp IS NOT NULL
                ) c ON TRUE 
              WHERE 
                contracts.deployed_at is NULL 
              LIMIT 
                $/limit/
            ) 
            UPDATE 
              contracts 
            SET 
              deployed_at = minted_at
            FROM 
              x 
            WHERE 
              contracts.address = x.address RETURNING x.address
          `,
      {
        limit,
      }
    );

    logger.info(
      this.queueName,
      JSON.stringify({
        message: `Backfilled ${results.length} contracts. limit=${limit}`,
        lastContract: results.length ? fromBuffer(results[results.length - 1].address) : null,
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

export const backfillContractsDeployedAtJob = new BackfillContractsDeployedAtJob();
