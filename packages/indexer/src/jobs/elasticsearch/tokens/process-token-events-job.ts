import cron from "node-cron";

import { logger } from "@/common/logger";
import { config } from "@/config/index";
import { redlock } from "@/common/redis";

import { AbstractRabbitMqJobHandler } from "@/jobs/abstract-rabbit-mq-job-handler";
import * as TokenIndex from "@/elasticsearch/indexes/tokens";
import { elasticsearchTokens as elasticsearch } from "@/common/elasticsearch";
import { PendingTokenEventsQueue } from "@/elasticsearch/indexes/tokens/pending-token-events-queue";

const BATCH_SIZE = 1000;

export default class ProcessTokenEventsJob extends AbstractRabbitMqJobHandler {
  queueName = "process-token-events-queue";
  maxRetries = 10;
  concurrency = 1;
  persistent = true;

  public async process() {
    const pendingTokenEventsQueue = new PendingTokenEventsQueue();
    const pendingTokenEvents = await pendingTokenEventsQueue.get(BATCH_SIZE);

    if (pendingTokenEvents.length > 0) {
      try {
        const bulkOps = [];

        for (const pendingTokenEvent of pendingTokenEvents) {
          if (pendingTokenEvent.kind === "index") {
            bulkOps.push({
              index: {
                _index: TokenIndex.getIndexName(),
                _id: pendingTokenEvent.info.id,
              },
            });
            bulkOps.push(pendingTokenEvent.info.document);
          }
        }

        const response = await elasticsearch.bulk({
          body: bulkOps,
          refresh: true,
        });

        if (response.errors) {
          logger.error(
            this.queueName,
            JSON.stringify({
              topic: "elasticsearch-tokens",
              message: "Bulk Response Errors",
              bulkOps: JSON.stringify(bulkOps),
              response: JSON.stringify(response),
            })
          );
        }
      } catch (error) {
        logger.error(
          this.queueName,
          JSON.stringify({
            topic: "elasticsearch-tokens",
            message: `failed to index tokens. error=${error}`,
            pendingTokenEvents,
            error,
          })
        );

        await pendingTokenEventsQueue.add(pendingTokenEvents);
      }

      const pendingTokenEventsCount = await pendingTokenEventsQueue.count();

      if (pendingTokenEventsCount > 0) {
        await this.addToQueue();
      }
    }
  }

  public async addToQueue() {
    if (!config.enableElasticsearchTokens) {
      return;
    }

    await this.send();
  }
}

export const getLockName = () => {
  return `${processTokenEventsJob.queueName}-lock`;
};

export const processTokenEventsJob = new ProcessTokenEventsJob();

if (config.doBackgroundWork && config.doElasticsearchWork && config.enableElasticsearchTokens) {
  cron.schedule(
    "*/1 * * * * *",
    async () =>
      await redlock
        .acquire([`${processTokenEventsJob.queueName}-queue-lock`], 1000 - 5)
        .then(async () => processTokenEventsJob.addToQueue())
        .catch(() => {
          // Skip on any errors
        })
  );
}
