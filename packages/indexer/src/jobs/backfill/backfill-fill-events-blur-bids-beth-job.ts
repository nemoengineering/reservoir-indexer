/* eslint-disable @typescript-eslint/no-explicit-any */

import { idb } from "@/common/db";

import { AbstractRabbitMqJobHandler } from "@/jobs/abstract-rabbit-mq-job-handler";
import { RabbitMQMessage } from "@/common/rabbit-mq";
import { toBuffer } from "@/common/utils";
import { redis } from "@/common/redis";
import { logger } from "@/common/logger";

import { AddressZero } from "@ethersproject/constants";
import * as Sdk from "@reservoir0x/sdk";
import { config } from "@/config/index";

export class BackfillFillEventsBlurBidsBethJob extends AbstractRabbitMqJobHandler {
  queueName = "backfill-fill-events-blur-bids-beth-queue";
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
            fill_events_2.tx_hash,
            fill_events_2.log_index,
            fill_events_2.batch_index,
            extract(epoch from fill_events_2.created_at) created_ts
          FROM fill_events_2
          WHERE order_kind = 'blur-v2' and order_side = 'buy' AND currency = $/zeroAddress/
          ORDER BY fill_events_2.created_at, fill_events_2.tx_hash, fill_events_2.log_index, fill_events_2.batch_index
          LIMIT $/limit/
          )
          UPDATE fill_events_2 SET
              currency = $/bethAddress/,
              updated_at = now()
          FROM x
          WHERE fill_events_2.tx_hash = x.tx_hash
          AND fill_events_2.log_index = x.log_index
          AND fill_events_2.batch_index = x.batch_index
          RETURNING x.created_ts, x.tx_hash, x.log_index, x.batch_index
          `,
      {
        zeroAddress: toBuffer(AddressZero),
        bethAddress: toBuffer(Sdk.Blur.Addresses.Beth[config.chainId]),
        limit,
      }
    );

    logger.info(
      this.queueName,
      JSON.stringify({
        message: `Backfilled ${results.length} sales.  limit=${limit}`,
      })
    );

    if (results.length >= limit) {
      return {
        addToQueue: true,
      };
    }

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

export const backfillFillEventsBlurBidsBethJob = new BackfillFillEventsBlurBidsBethJob();
