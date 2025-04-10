import { config } from "@/config/index";

import { AbstractRabbitMqJobHandler } from "@/jobs/abstract-rabbit-mq-job-handler";
import { PendingActivityEventsQueue } from "@/elasticsearch/indexes/activities/pending-activity-events-queue";
import {
  FtTransferEventInfo,
  NftTransferEventInfo,
  OrderEventInfo,
  RelayRequestProcessedInfo,
  SwapCreatedInfo,
  TransactionInfo,
} from "@/elasticsearch/indexes/activities/event-handlers/base";

export enum EventKind {
  fillEvent = "fillEvent",
  nftTransferEvent = "nftTransferEvent",
  newSellOrder = "newSellOrder",
  newBuyOrder = "newBuyOrder",
  sellOrderCancelled = "sellOrderCancelled",
  buyOrderCancelled = "buyOrderCancelled",
  ftTransferEvent = "ftTransferEvent",
  transactionCreated = "transactionCreated",
  relayRequestProcessed = "relayRequestProcessed",
  swapCreated = "swapCreated",
}

export type ProcessActivityEventJobPayload =
  | {
      kind: EventKind.newSellOrder;
      data: OrderEventInfo;
      context?: string;
    }
  | {
      kind: EventKind.newBuyOrder;
      data: OrderEventInfo;
      context?: string;
    }
  | {
      kind: EventKind.transactionCreated;
      data: TransactionInfo;
      context?: string;
    }
  | {
      kind: EventKind.nftTransferEvent;
      data: NftTransferEventInfo;
      context?: string;
    }
  | {
      kind: EventKind.ftTransferEvent;
      data: FtTransferEventInfo;
      context?: string;
    }
  | {
      kind: EventKind.fillEvent;
      data: NftTransferEventInfo;
      context?: string;
    }
  | {
      kind: EventKind.sellOrderCancelled;
      data: OrderEventInfo;
      context?: string;
    }
  | {
      kind: EventKind.buyOrderCancelled;
      data: OrderEventInfo;
      context?: string;
    }
  | {
      kind: EventKind.relayRequestProcessed;
      data: RelayRequestProcessedInfo;
      context?: string;
    }
  | {
      kind: EventKind.swapCreated;
      data: SwapCreatedInfo;
      context?: string;
    };

export class ProcessActivityEventJob extends AbstractRabbitMqJobHandler {
  queueName = "process-activity-event-queue";
  maxRetries = 10;
  concurrency = 15;
  persistent = true;
  enableFailedJobsRetry = true;

  public async process(payload: ProcessActivityEventJobPayload) {
    const { kind, data } = payload;

    switch (kind) {
      case EventKind.fillEvent:
        await new PendingActivityEventsQueue(EventKind.fillEvent).add([{ kind, data }]);
        break;
      case EventKind.transactionCreated:
        await new PendingActivityEventsQueue(EventKind.transactionCreated).add([{ kind, data }]);
        break;
      case EventKind.ftTransferEvent:
        await new PendingActivityEventsQueue(EventKind.ftTransferEvent).add([{ kind, data }]);
        break;
      case EventKind.nftTransferEvent:
        await new PendingActivityEventsQueue(EventKind.nftTransferEvent).add([{ kind, data }]);
        break;
      case EventKind.newSellOrder:
        await new PendingActivityEventsQueue(EventKind.newSellOrder).add([{ kind, data }]);
        break;
      case EventKind.newBuyOrder:
        await new PendingActivityEventsQueue(EventKind.newBuyOrder).add([{ kind, data }]);
        break;
      case EventKind.buyOrderCancelled:
        await new PendingActivityEventsQueue(EventKind.buyOrderCancelled).add([{ kind, data }]);
        break;
      case EventKind.sellOrderCancelled:
        await new PendingActivityEventsQueue(EventKind.sellOrderCancelled).add([{ kind, data }]);
        break;
      case EventKind.relayRequestProcessed:
        await new PendingActivityEventsQueue(EventKind.relayRequestProcessed).add([{ kind, data }]);
        break;
      case EventKind.swapCreated:
        await new PendingActivityEventsQueue(EventKind.swapCreated).add([{ kind, data }]);
        break;
    }
  }

  public async addToQueue(payloads: ProcessActivityEventJobPayload[]) {
    if (!config.doElasticsearchWork) {
      return;
    }

    await this.sendBatch(payloads.map((payload) => ({ payload })));
  }
}

export const processActivityEventJob = new ProcessActivityEventJob();
