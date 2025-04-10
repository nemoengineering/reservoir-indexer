/* eslint-disable @typescript-eslint/no-explicit-any */

import { KafkaEventHandler } from "./KafkaEventHandler";

import {
  EventKind as ProcessActivityEventKind,
  processActivityEventJob,
} from "@/jobs/elasticsearch/activities/process-activity-event-job";
import { config } from "@/config/index";

export class IndexerTransactionsHandler extends KafkaEventHandler {
  topicName = "indexer.public.transactions";

  protected async handleInsert(payload: any): Promise<void> {
    if (!payload.after) {
      return;
    }

    if (!config.enableElasticsearchFtActivities) {
      return;
    }

    await processActivityEventJob.addToQueue([
      {
        kind: ProcessActivityEventKind.transactionCreated,
        data: {
          txHash: payload.after.hash,
        },
      },
    ]);
  }

  protected async handleUpdate(): Promise<void> {
    // Do nothing here
  }

  protected async handleDelete(): Promise<void> {
    // Do nothing here
  }
}
