/* eslint-disable @typescript-eslint/no-explicit-any */

import { KafkaEventHandler } from "./KafkaEventHandler";

import {
  EventKind as ProcessCurrencyEventKind,
  processCurrencyEventJob,
} from "@/jobs/elasticsearch/currencies/process-currency-event-job";

export class IndexerCurrenciesHandler extends KafkaEventHandler {
  topicName = "indexer.public.currencies";

  protected async handleInsert(payload: any): Promise<void> {
    if (!payload.after) {
      return;
    }

    await processCurrencyEventJob.addToQueue([
      {
        kind: ProcessCurrencyEventKind.newCurrency,
        data: {
          contract: payload.after.contract,
        },
      },
    ]);
  }

  protected async handleUpdate(payload: any): Promise<void> {
    await processCurrencyEventJob.addToQueue([
      {
        kind: ProcessCurrencyEventKind.currencyUpdated,
        data: {
          contract: payload.after.contract,
        },
      },
    ]);
  }

  protected async handleDelete(): Promise<void> {
    // Do nothing here
  }
}
