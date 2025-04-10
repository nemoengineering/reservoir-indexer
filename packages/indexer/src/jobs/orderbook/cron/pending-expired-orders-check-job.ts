import cron from "node-cron";

import { ridb } from "@/common/db";
import { logger } from "@/common/logger";
import { redlock } from "@/common/redis";
import { config } from "@/config/index";
import { AbstractRabbitMqJobHandler } from "@/jobs/abstract-rabbit-mq-job-handler";
import * as backfillExpiredOrders from "@/jobs/backfill/backfill-expired-orders-2";

export class PendingExpiredOrdersCheckJob extends AbstractRabbitMqJobHandler {
  queueName = "pending-expired-orders-check-queue";
  maxRetries = 1;
  concurrency = 1;
  singleActiveConsumer = true;

  public async process() {
    const result = await ridb.oneOrNone(
      `
        SELECT
          count(*) AS expired_count, floor(extract(epoch FROM min(upper(orders.valid_between)))) AS min_timestamp, floor(extract(epoch FROM now() - min(upper(orders.valid_between)))) AS min_timestamp_diff
        FROM orders
        WHERE upper(orders.valid_between) >= now() - INTERVAL '1 HOURS'
        AND upper(orders.valid_between) < now()
        AND (orders.fillability_status = 'fillable' OR orders.fillability_status = 'no-balance')
      `
    );

    logger.info(
      this.queueName,
      JSON.stringify({
        message: `Found ${result.expired_count} expired orders`,
        pendingExpiredOrdersCount: result.expired_count,
        minTimestamp: result.min_timestamp,
        minTimestampDiff: result.min_timestamp_diff,
      })
    );

    if (result.expired_count > 0) {
      await backfillExpiredOrders.addToQueue([
        {
          from: Number(result.min_timestamp),
          to: Number(result.min_timestamp) + 10000,
        },
      ]);
    }
  }

  public async addToQueue() {
    await this.send();
  }
}

export const pendingExpiredOrdersCheckJob = new PendingExpiredOrdersCheckJob();

if (config.doBackgroundWork) {
  cron.schedule(
    `0 */1 * * *`,
    async () =>
      await redlock
        .acquire(["pending-expired-orders-check-lock"], (1 * 3600 - 5) * 1000)
        .then(async () => {
          await pendingExpiredOrdersCheckJob.addToQueue();
        })
        .catch(() => {
          // Skip any errors
        })
  );
}
