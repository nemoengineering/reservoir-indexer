import { idb, pgp } from "@/common/db";

import { AbstractRabbitMqJobHandler } from "@/jobs/abstract-rabbit-mq-job-handler";
import { RabbitMQMessage } from "@/common/rabbit-mq";
import { redis } from "@/common/redis";
import { logger } from "@/common/logger";
import { isOrderNativeOffChainCancellable } from "@/utils/offchain-cancel";

export class BackfillOrdersIsNativeOffChainCancellableJob extends AbstractRabbitMqJobHandler {
  queueName = "backfill-orders-is-native-off-chain-cancellable-queue";
  maxRetries = 10;
  concurrency = 1;
  persistent = false;
  lazyMode = false;
  singleActiveConsumer = true;

  public async process(payload: { onlyActive?: boolean }) {
    const limit = (await redis.get(`${this.queueName}-limit`)) || 500;

    const results = await idb.manyOrNone(
      `
        SELECT
            orders.id,
            orders.raw_data
          FROM 
            orders 
          WHERE 
          (
          orders.kind = 'alienswap' OR 
          orders.kind = 'mintify' OR 
          orders.kind = 'payment-processor' OR 
          orders.kind = 'payment-processor-v2' OR 
          orders.kind = 'payment-processor-v2.1' OR 
          orders.kind = 'seaport' OR 
          orders.kind = 'seaport-v1.4' OR 
          orders.kind = 'seaport-v1.5' OR 
          orders.kind = 'seaport-v1.6'
          )
          AND orders.is_native_off_chain_cancellable IS NULL
          AND orders.raw_data IS NOT NULL
          ${
            payload.onlyActive
              ? `AND orders.fillability_status = 'fillable' AND orders.approval_status = 'approved'`
              : ""
          }
          LIMIT 
            $/limit/
          `,
      {
        limit,
      }
    );

    const values = [];
    const columns = new pgp.helpers.ColumnSet(["id", "is_native_off_chain_cancellable"], {
      table: "orders",
    });

    for (const order of results) {
      try {
        const isNativeOffChainCancellable = isOrderNativeOffChainCancellable(order.raw_data);

        values.push({
          id: order.id,
          is_native_off_chain_cancellable: isNativeOffChainCancellable,
        });
      } catch (error) {
        logger.error(
          this.queueName,
          JSON.stringify({
            message: `Error processing order ${order.id}`,
          })
        );
      }
    }

    if (values.length) {
      await idb.none(
        `
          UPDATE orders SET
            is_native_off_chain_cancellable = x.is_native_off_chain_cancellable::BOOLEAN
          FROM (
            VALUES ${pgp.helpers.values(values, columns)}
          ) AS x(id, is_native_off_chain_cancellable)
          WHERE orders.id = x.id
        `
      );
    }

    logger.info(
      this.queueName,
      JSON.stringify({
        message: `Backfilled ${results.length} orders. limit=${limit}`,
        lastResult: results.length ? results[results.length - 1] : null,
      })
    );

    return { addToQueue: results.length > 0, onlyActive: payload.onlyActive };
  }

  public async onCompleted(
    rabbitMqMessage: RabbitMQMessage,
    processResult: {
      addToQueue: boolean;
      onlyActive?: boolean;
    }
  ) {
    if (processResult.addToQueue) {
      await this.addToQueue(1 * 1000, processResult.onlyActive);
    }
  }

  public async addToQueue(delay = 0, onlyActive?: boolean) {
    await this.send({ payload: { onlyActive } }, delay);
  }
}

export const backfillOrdersIsNativeOffChainCancellable =
  new BackfillOrdersIsNativeOffChainCancellableJob();
