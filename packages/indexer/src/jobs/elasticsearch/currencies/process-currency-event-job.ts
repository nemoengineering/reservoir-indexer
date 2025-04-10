import { config } from "@/config/index";

import { AbstractRabbitMqJobHandler } from "@/jobs/abstract-rabbit-mq-job-handler";

import { PendingCurrencyEventsQueue } from "@/elasticsearch/indexes/currencies/pending-currency-events-queue";
import { CurrencyCreatedEventHandler } from "@/elasticsearch/indexes/currencies/event-handlers/currency-created";

export enum EventKind {
  newCurrency = "newCurrency",
  currencyUpdated = "currencyUpdated",
}

export type ProcessCurrencyEventJobPayload = {
  kind: EventKind;
  data: CurrencyInfo;
  context?: string;
};

export class ProcessCurrencyEventJob extends AbstractRabbitMqJobHandler {
  queueName = "process-currency-event-queue";
  maxRetries = 10;
  concurrency = 15;
  persistent = true;
  enableFailedJobsRetry = true;

  public async process(payload: ProcessCurrencyEventJobPayload) {
    const { data } = payload;

    const pendingCurrencyEventsQueue = new PendingCurrencyEventsQueue();
    const currencyCreatedEventHandler = new CurrencyCreatedEventHandler(data.contract);

    const currencyDocumentInfo = await currencyCreatedEventHandler.generateCurrency();

    if (currencyDocumentInfo) {
      await pendingCurrencyEventsQueue.add([{ info: currencyDocumentInfo, kind: "index" }]);
    }
  }

  public async addToQueue(payloads: ProcessCurrencyEventJobPayload[]) {
    if (!config.doElasticsearchWork || !config.enableElasticsearchCurrencies) {
      return;
    }

    await this.sendBatch(payloads.map((payload) => ({ payload })));
  }
}

export const processCurrencyEventJob = new ProcessCurrencyEventJob();

interface CurrencyInfo {
  contract: string;
}
