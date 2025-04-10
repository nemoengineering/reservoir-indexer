import cron from "node-cron";

import { idb } from "@/common/db";
import { logger } from "@/common/logger";
import { redlock } from "@/common/redis";
import { AbstractRabbitMqJobHandler, BackoffStrategy } from "@/jobs/abstract-rabbit-mq-job-handler";
import { config } from "@/config/index";
import { mintsCheckJob } from "@/jobs/mints/mints-check-job";

export default class MintsExpiredJob extends AbstractRabbitMqJobHandler {
  queueName = "expired-mints";
  maxRetries = 1;
  concurrency = 1;
  backoff = {
    type: "exponential",
    delay: 10000,
  } as BackoffStrategy;
  intervalInSeconds = 60;

  public async process() {
    const results = await idb.manyOrNone(
      `
          UPDATE 
            collection_mints 
          SET 
            status = 'closed', 
            updated_at = now() 
          WHERE 
            collection_mints.end_time <= now() 
            AND collection_mints.status = 'open' RETURNING collection_mints.collection_id
        `
    );

    if (results.length) {
      const collectionIds = [...new Set(results.map((result) => result.collection_id))];

      logger.info(
        this.queueName,
        JSON.stringify({
          message: `Invalidated ${results.length} expired mints.`,
          collectionIds: JSON.stringify(collectionIds),
        })
      );

      await mintsCheckJob.addToQueueBatch(
        collectionIds.map((collectionId) => ({ collection: collectionId }))
      );
    }
  }

  public async addToQueue() {
    await this.send();
  }
}

export const mintsExpiredJob = new MintsExpiredJob();

if (config.doBackgroundWork) {
  cron.schedule(
    `*/${mintsExpiredJob.intervalInSeconds} * * * * *`,
    async () =>
      await redlock
        .acquire(["expired-mints-check-lock"], (mintsExpiredJob.intervalInSeconds - 3) * 1000)
        .then(async () => {
          await mintsExpiredJob.addToQueue();
        })
        .catch(() => {
          // Skip any errors
        })
  );
}
