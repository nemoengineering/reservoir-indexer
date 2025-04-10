import cron from "node-cron";

import { logger } from "@/common/logger";
import { config } from "@/config/index";
import { redlock } from "@/common/redis";

import { AbstractRabbitMqJobHandler } from "@/jobs/abstract-rabbit-mq-job-handler";
import * as CurrenciesIndex from "@/elasticsearch/indexes/currencies";
import { elasticsearchCurrencies as elasticsearch } from "@/common/elasticsearch";
import { PendingCurrencyEventsQueue } from "@/elasticsearch/indexes/currencies/pending-currency-events-queue";

const BATCH_SIZE = 1000;

export default class ProcessCurrencyEventsJob extends AbstractRabbitMqJobHandler {
  queueName = "process-currency-events-queue";
  maxRetries = 10;
  concurrency = 1;
  persistent = true;

  public async process() {
    const pendingCurrencyEventsQueue = new PendingCurrencyEventsQueue();
    const pendingCurrencyEvents = await pendingCurrencyEventsQueue.get(BATCH_SIZE);

    if (pendingCurrencyEvents.length > 0) {
      try {
        const bulkOps = [];

        for (const pendingCurrencyEvent of pendingCurrencyEvents) {
          if (pendingCurrencyEvent.kind === "index") {
            bulkOps.push({
              index: {
                _index: CurrenciesIndex.getIndexName(),
                _id: pendingCurrencyEvent.info.id,
              },
            });
            bulkOps.push(pendingCurrencyEvent.info.document);
          }

          if (pendingCurrencyEvent.kind === "delete") {
            bulkOps.push({
              delete: {
                _index: CurrenciesIndex.getIndexName(),
                _id: pendingCurrencyEvent.info.id,
              },
            });
          }
        }

        const response = await elasticsearch.bulk({
          body: bulkOps,
        });

        if (response.errors) {
          logger.error(
            this.queueName,
            JSON.stringify({
              topic: "debugCurrenciesIndex",
              message: `Index errors.`,
              data: {
                bulkOps: JSON.stringify(bulkOps),
              },
              response,
            })
          );
        }
      } catch (error) {
        logger.error(
          this.queueName,
          JSON.stringify({
            topic: "debugCurrenciesIndex",
            message: `failed to index currencies. error=${error}`,
            pendingCurrencyEvents,
            error,
          })
        );

        await pendingCurrencyEventsQueue.add(pendingCurrencyEvents);
      }

      const pendingCurrencyEventsCount = await pendingCurrencyEventsQueue.count();

      if (pendingCurrencyEventsCount > 0) {
        await processCurrencyEventsJob.addToQueue();
      }
    }
  }

  public async addToQueue() {
    if (!config.doElasticsearchWork || !config.enableElasticsearchCurrencies) {
      return;
    }

    await this.send();
  }
}

export const getLockName = () => {
  return `${processCurrencyEventsJob.queueName}-lock`;
};

export const processCurrencyEventsJob = new ProcessCurrencyEventsJob();

if (config.doBackgroundWork && config.doElasticsearchWork) {
  cron.schedule(
    "*/5 * * * * *",
    async () =>
      await redlock
        .acquire([`${processCurrencyEventsJob.queueName}-queue-lock`], 5 * 1000 - 500)
        .then(async () => processCurrencyEventsJob.addToQueue())
        .catch(() => {
          // Skip on any errors
        })
  );
}
