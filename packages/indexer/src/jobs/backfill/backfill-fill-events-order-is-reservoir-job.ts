import { idb } from "@/common/db";

import { AbstractRabbitMqJobHandler } from "@/jobs/abstract-rabbit-mq-job-handler";
import { RabbitMQMessage } from "@/common/rabbit-mq";
import { fromBuffer, toBuffer } from "@/common/utils";
import _ from "lodash";
import { redis } from "@/common/redis";
import { logger } from "@/common/logger";

export type BackfillFillEventsOrderIsReservoirCursor = {
  txHash: string;
  logIndex: number;
  batchIndex: number;
  createdTs: number;
};

export type BackfillFillEventsOrderIsReservoirJobPayload = {
  cursor?: BackfillFillEventsOrderIsReservoirCursor;
};

export class BackfillFillEventsOrderIsReservoirJob extends AbstractRabbitMqJobHandler {
  queueName = "backfill-fill-events-order-is-reservoir-queue";
  maxRetries = 10;
  concurrency = 1;
  persistent = false;
  lazyMode = false;
  singleActiveConsumer = true;

  public async process(payload: BackfillFillEventsOrderIsReservoirJobPayload) {
    const cursor = payload.cursor as BackfillFillEventsOrderIsReservoirCursor;

    let continuationFilter = "";

    const limit = (await redis.get(`${this.queueName}-limit`)) || 500;

    if (cursor) {
      continuationFilter = `AND (fill_events_2.created_at, fill_events_2.tx_hash, fill_events_2.log_index, fill_events_2.batch_index) > (to_timestamp($/createdTs/), $/txHash/, $/logIndex/, $/batchIndex/)`;
    }

    const results = await idb.manyOrNone(
      `
          WITH x AS (  
          SELECT
            fill_events_2.tx_hash,
            fill_events_2.log_index,
            fill_events_2.batch_index,
            fill_events_2.created_at,
            fill_events_2.contract,
            fill_events_2.token_id,
            fill_events_2.timestamp,
            fill_events_2.price,
            extract(epoch from fill_events_2.created_at) created_ts,
            o.is_reservoir
          FROM fill_events_2
          LEFT JOIN LATERAL (
            SELECT is_reservoir
            FROM orders
            WHERE orders.id = fill_events_2.order_id
          ) o ON TRUE
          WHERE order_kind != 'mint'
          ${continuationFilter}
          ORDER BY fill_events_2.created_at, fill_events_2.tx_hash, fill_events_2.log_index, fill_events_2.batch_index
          LIMIT $/limit/
          )
          UPDATE fill_events_2 SET
              order_is_reservoir = x.is_reservoir,
              updated_at = now()
          FROM x
          WHERE fill_events_2.tx_hash = x.tx_hash
          AND fill_events_2.log_index = x.log_index
          AND fill_events_2.batch_index = x.batch_index
          RETURNING x.created_ts, x.tx_hash, x.log_index, x.batch_index
          `,
      {
        createdTs: cursor?.createdTs,
        txHash: cursor?.txHash ? toBuffer(cursor.txHash) : null,
        logIndex: cursor?.logIndex,
        batchIndex: cursor?.batchIndex,
        limit,
      }
    );

    logger.info(
      this.queueName,
      JSON.stringify({
        message: `Backfilled ${results.length} tokens.  limit=${limit}`,
        cursor,
      })
    );

    if (results.length >= limit) {
      const lastResult = _.last(results);

      return {
        addToQueue: true,
        addToQueueCursor: {
          txHash: fromBuffer(lastResult.tx_hash),
          logIndex: lastResult.log_index,
          batchIndex: lastResult.batch_index,
          createdTs: lastResult.created_ts,
        } as BackfillFillEventsOrderIsReservoirCursor,
      };
    }

    return { addToQueue: false };
  }

  public async onCompleted(
    rabbitMqMessage: RabbitMQMessage,
    processResult: {
      addToQueue: boolean;
      addToQueueCursor: BackfillFillEventsOrderIsReservoirCursor;
    }
  ) {
    if (processResult.addToQueue) {
      await this.addToQueue(processResult.addToQueueCursor, 1 * 1000);
    }
  }

  public async addToQueue(cursor?: BackfillFillEventsOrderIsReservoirCursor, delay = 0) {
    await this.send({ payload: { cursor } }, delay);
  }
}

export const backfillFillEventsOrderIsReservoirJob = new BackfillFillEventsOrderIsReservoirJob();
