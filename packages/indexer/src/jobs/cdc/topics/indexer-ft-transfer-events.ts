/* eslint-disable @typescript-eslint/no-explicit-any */

import { KafkaEventHandler } from "./KafkaEventHandler";

import {
  EventKind as ProcessActivityEventKind,
  processActivityEventJob,
} from "@/jobs/elasticsearch/activities/process-activity-event-job";
import { config } from "@/config/index";
import { getCurrency } from "@/utils/currencies";

export class IndexerFtTransferEventsHandler extends KafkaEventHandler {
  topicName = "indexer.public.ft_transfer_events";

  protected async handleInsert(payload: any): Promise<void> {
    if (!payload.after) {
      return;
    }

    if (config.enableElasticsearchCurrencies) {
      await getCurrency(payload.after.address);
    }

    if (config.enableElasticsearchFtActivities) {
      await processActivityEventJob.addToQueue([
        {
          kind: ProcessActivityEventKind.ftTransferEvent,
          data: {
            txHash: payload.after.tx_hash,
            logIndex: payload.after.log_index,
          },
        },
      ]);
    }
  }

  protected async handleUpdate(): Promise<void> {
    // Do nothing here
  }

  protected async handleDelete(): Promise<void> {
    // Do nothing here
  }
}
