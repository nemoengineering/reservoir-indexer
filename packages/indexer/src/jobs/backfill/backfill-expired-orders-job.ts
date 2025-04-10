import { idb } from "@/common/db";
import { AbstractRabbitMqJobHandler } from "@/jobs/abstract-rabbit-mq-job-handler";
import { now } from "@/common/utils";
import { logger } from "@/common/logger";
import {
  orderUpdatesByIdJob,
  OrderUpdatesByIdJobPayload,
} from "@/jobs/order-updates/order-updates-by-id-job";

export type BackfillExpiredOrdersJobPayload = {
  timestamp: number;
};

export class BackfillExpiredOrdersJob extends AbstractRabbitMqJobHandler {
  queueName = "backfill-expired-orders";
  maxRetries = 10;
  concurrency = 1;

  public async process(payload: BackfillExpiredOrdersJobPayload) {
    const { timestamp } = payload;

    const expiredOrders: { id: string }[] = await idb.manyOrNone(
      `
          WITH x AS (
            SELECT
              orders.id,
              upper(orders.valid_between) AS expiration
            FROM orders
            WHERE upper(orders.valid_between) = to_timestamp($/timestamp/)
              AND upper(orders.valid_between) < now()
              AND (orders.fillability_status = 'fillable' OR orders.fillability_status = 'no-balance')
          )
          UPDATE orders SET
            fillability_status = 'expired',
            expiration = x.expiration,
            updated_at = now()
          FROM x
          WHERE orders.id = x.id AND orders.fillability_status != 'expired'
          RETURNING orders.id
        `,
      { timestamp }
    );

    if (expiredOrders.length) {
      logger.debug(
        this.queueName,
        JSON.stringify({
          message: `Invalidated ${expiredOrders.length} orders`,
        })
      );
    }

    const currentTime = now();
    await orderUpdatesByIdJob.addToQueue(
      expiredOrders.map(
        ({ id }) =>
          ({
            context: `expired-orders-check-${currentTime}-${id}`,
            id,
            trigger: { kind: "expiry" },
          } as OrderUpdatesByIdJobPayload)
      )
    );
  }

  public async addToQueue(timestamps: number[]) {
    await this.sendBatch(
      timestamps.map((timestamp) => ({ payload: { timestamp }, jobId: timestamp.toString() }))
    );
  }
}

export const backfillExpiredOrdersJob = new BackfillExpiredOrdersJob();
