import { idb } from "@/common/db";
import { AbstractRabbitMqJobHandler } from "@/jobs/abstract-rabbit-mq-job-handler";
import { logger } from "@/common/logger";
import { config } from "@/config/index";
import cron from "node-cron";
import { redlock } from "@/common/redis";

export class CleanUsdPricesJob extends AbstractRabbitMqJobHandler {
  queueName = "clean-usd-prices";
  maxRetries = 10;
  concurrency = 1;
  persistent = false;
  lazyMode = false;
  singleActiveConsumer = true;

  public async process() {
    const deleteLimit = 5000;
    let deleteCount = 0;
    let total = 0;

    // Delete from usd_prices_hourly
    do {
      const query = `
        DELETE FROM usd_prices_minutely
        WHERE (currency, timestamp, provider) IN (
          SELECT currency, timestamp, provider
          FROM usd_prices_minutely
          WHERE timestamp < NOW() - INTERVAL '48 HOURS'
          LIMIT ${deleteLimit}
        )
      `;

      const result = await idb.result(query);

      deleteCount = result.rowCount;
      total += result.rowCount;
    } while (deleteCount >= deleteLimit);

    logger.info(this.queueName, `Done cleaning usd_prices_minutely deleted ${total}`);

    deleteCount = 0;
    total = 0;

    // Delete from usd_prices_hourly
    do {
      const query = `
        DELETE FROM usd_prices_hourly
        WHERE (currency, timestamp, provider) IN (
          SELECT currency, timestamp, provider
          FROM usd_prices_hourly
          WHERE timestamp < NOW() - INTERVAL '31 DAYS'
          LIMIT ${deleteLimit}
        )
      `;

      const result = await idb.result(query);

      deleteCount = result.rowCount;
      total += result.rowCount;
    } while (deleteCount >= deleteLimit);

    logger.info(this.queueName, `Done cleaning usd_prices_hourly deleted ${total}`);
  }

  public async addToQueue() {
    await this.send();
  }
}

export const cleanUsdPricesJob = new CleanUsdPricesJob();

if (config.doBackgroundWork) {
  cron.schedule(
    "30 0 * * *",
    async () =>
      await redlock
        .acquire([cleanUsdPricesJob.getQueue()], (60 * 60 - 3) * 1000)
        .then(async () => {
          await cleanUsdPricesJob.addToQueue();
        })
        .catch(() => {
          // Skip any errors
        })
  );
}
