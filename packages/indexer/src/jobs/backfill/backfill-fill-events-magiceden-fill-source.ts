/* eslint-disable @typescript-eslint/no-explicit-any */

import { idb, pgp } from "@/common/db";

import { AbstractRabbitMqJobHandler } from "@/jobs/abstract-rabbit-mq-job-handler";
import { RabbitMQMessage } from "@/common/rabbit-mq";
import { fromBuffer } from "@/common/utils";
import _ from "lodash";
import { redis } from "@/common/redis";
import { logger } from "@/common/logger";
import { extractAttributionData } from "@/events-sync/utils";
import pgPromise from "pg-promise";

export type BackfillFillEventsMagicEdenFillSourceCursor = {
  logIndex: number;
  batchIndex: number;
  timestamp: number;
};

export type BackfillFillEventsMagicEdenFillSourceJobPayload = {
  cursor?: BackfillFillEventsMagicEdenFillSourceCursor;

  doUpdate?: boolean;
};

export class BackfillFillEventsMagicEdenFillSourceJob extends AbstractRabbitMqJobHandler {
  queueName = "backfill-fill-events-magiceden-fill-source-queue";
  maxRetries = 10;
  concurrency = 1;
  persistent = false;
  lazyMode = false;
  singleActiveConsumer = true;

  public async process(payload: BackfillFillEventsMagicEdenFillSourceJobPayload) {
    const cursor = payload.cursor as BackfillFillEventsMagicEdenFillSourceCursor;

    let continuationFilter = "";

    const limit = (await redis.get(`${this.queueName}-limit`)) || 2;

    if (cursor) {
      continuationFilter = `AND (fill_events_2.timestamp, fill_events_2.log_index, fill_events_2.batch_index) < ($/timestamp/, $/logIndex/, $/batchIndex/)`;
    }

    const whereClause = "";

    const result = await idb.manyOrNone(
      `
          SELECT
            fill_events_2.order_kind,
            fill_events_2.order_id,
            fill_events_2.tx_hash,
            fill_events_2.log_index,
            fill_events_2.batch_index,
            fill_events_2.fill_source_id,
            fill_events_2.timestamp
          FROM fill_events_2
          ${whereClause}
          ${continuationFilter}
          ORDER BY
            fill_events_2.timestamp DESC,
            fill_events_2.log_index DESC,
            fill_events_2.batch_index DESC
          LIMIT $/limit/
        `,
      {
        timestamp: cursor?.timestamp,
        logIndex: cursor?.logIndex,
        batchIndex: cursor?.batchIndex,
        limit,
      }
    );

    const values: any[] = [];
    const columns = new pgp.helpers.ColumnSet(
      ["tx_hash", "log_index", "batch_index", "fill_source_id"],
      {
        table: "fill_events_2",
      }
    );

    for (const {
      tx_hash,
      log_index,
      batch_index,
      order_kind,
      order_id,
      fill_source_id,
    } of result) {
      const txHash = fromBuffer(tx_hash);

      const data = await extractAttributionData(txHash, order_kind);

      const fillSourceInvalid =
        data.fillSource?.domain &&
        ["magiceden.io", "magiceden.us"].includes(data.fillSource?.domain) &&
        data.fillSource?.id !== fill_source_id;

      if (fillSourceInvalid) {
        logger.info(
          this.queueName,
          JSON.stringify({
            message: `fillSourceInvalid. orderId=${order_id}, txHash=${txHash}, logIndex=${log_index}, batchIndex=${batch_index}`,
            cursor,
            result,
            data,
            query: pgPromise.as.format(
              `
          SELECT
            fill_events_2.order_kind,
            fill_events_2.order_id,
            fill_events_2.tx_hash,
            fill_events_2.log_index,
            fill_events_2.batch_index,
            fill_events_2.fill_source_id,
            fill_events_2.timestamp
          FROM fill_events_2
          ${whereClause}
          ${continuationFilter}
          ORDER BY
            fill_events_2.timestamp DESC,
            fill_events_2.log_index DESC,
            fill_events_2.batch_index DESC
          LIMIT $/limit/
        `,
              {
                timestamp: cursor?.timestamp,
                logIndex: cursor?.logIndex,
                batchIndex: cursor?.batchIndex,
                limit,
              }
            ),
          })
        );

        values.push({
          tx_hash,
          log_index,
          batch_index,
          fill_source_id: data.fillSource?.id,
        });
      }
    }

    if (values.length) {
      logger.info(
        this.queueName,
        JSON.stringify({
          message: `Updating ${result.length} sales.`,
          cursor,
          query: pgPromise.as.format(`
            UPDATE fill_events_2 SET
              fill_source_id = x.fill_source_id::INT,
              updated_at = now()
            FROM (
              VALUES ${pgp.helpers.values(values, columns)}
            ) AS x(tx_hash, log_index, batch_index, fill_source_id)
            WHERE fill_events_2.tx_hash = x.tx_hash::BYTEA
              AND fill_events_2.log_index = x.log_index::INT
              AND fill_events_2.batch_index = x.batch_index::INT
          `),
        })
      );

      if (payload.doUpdate) {
        await idb.none(
          `
            UPDATE fill_events_2 SET
              fill_source_id = x.fill_source_id::INT,
              updated_at = now()
            FROM (
              VALUES ${pgp.helpers.values(values, columns)}
            ) AS x(tx_hash, log_index, batch_index, fill_source_id)
            WHERE fill_events_2.tx_hash = x.tx_hash::BYTEA
              AND fill_events_2.log_index = x.log_index::INT
              AND fill_events_2.batch_index = x.batch_index::INT
          `
        );
      }
    }

    logger.info(
      this.queueName,
      JSON.stringify({
        message: `Backfilled ${result.length} events. limit=${limit}`,
        cursor,
      })
    );

    if (result.length >= limit) {
      const lastResult = _.last(result);

      return {
        addToQueue: true,
        addToQueueCursor: {
          txHash: fromBuffer(lastResult.tx_hash),
          logIndex: lastResult.log_index,
          batchIndex: lastResult.batch_index,
          timestamp: lastResult.timestamp,
        } as BackfillFillEventsMagicEdenFillSourceCursor,
      };
    }

    return { addToQueue: false };
  }

  public async onCompleted(
    rabbitMqMessage: RabbitMQMessage,
    processResult: {
      addToQueue: boolean;
      addToQueueCursor: BackfillFillEventsMagicEdenFillSourceCursor;
    }
  ) {
    if (processResult.addToQueue) {
      await this.addToQueue(
        processResult.addToQueueCursor,
        rabbitMqMessage.payload.doUpdate,
        1 * 1000
      );
    }
  }

  public async addToQueue(
    cursor?: BackfillFillEventsMagicEdenFillSourceCursor,
    doUpdate = false,
    delay = 0
  ) {
    await this.send({ payload: { cursor, doUpdate } }, delay);
  }
}

export const backfillFillEventsMagicEdenFillSourceJob =
  new BackfillFillEventsMagicEdenFillSourceJob();
