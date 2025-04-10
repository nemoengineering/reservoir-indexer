import { config } from "@/config/index";

import { AbstractRabbitMqJobHandler } from "@/jobs/abstract-rabbit-mq-job-handler";
import { PendingTokenEventsQueue } from "@/elasticsearch/indexes/tokens/pending-token-events-queue";
import { TokenCreatedEventHandler } from "@/elasticsearch/indexes/tokens/event-handlers/token-created";

export enum EventKind {
  tokenCreated = "tokenCreated",
  tokenUpdated = "tokenUpdated",
  tokenAttributesChanged = "tokenAttributesChanged",
}

export type ProcessTokenEventJobPayload = {
  kind: EventKind;
  data: TokenInfo;
  retries?: number;
};

export class ProcessTokenEventJob extends AbstractRabbitMqJobHandler {
  queueName = "process-token-event-queue";
  maxRetries = 10;
  concurrency = 15;
  persistent = true;
  enableFailedJobsRetry = true;
  public async process(payload: ProcessTokenEventJobPayload) {
    const { data } = payload;

    if (data.contract === "0xea2a41c02fa86a4901826615f9796e603c6a4491") {
      return;
    }

    const pendingTokenEventsQueue = new PendingTokenEventsQueue();
    const tokenCreatedEventHandler = new TokenCreatedEventHandler(data.contract, data.token_id);

    const tokenDocumentInfo = await tokenCreatedEventHandler.generateToken();

    if (tokenDocumentInfo) {
      await pendingTokenEventsQueue.add([{ info: tokenDocumentInfo, kind: "index" }]);
    }
  }

  public async addToQueue(payloads: ProcessTokenEventJobPayload[], delay = 0) {
    if (!config.enableElasticsearchTokens) {
      return;
    }

    await this.sendBatch(payloads.map((payload) => ({ payload, delay })));
  }
}

export const processTokenEventJob = new ProcessTokenEventJob();

interface TokenInfo {
  contract: string;
  token_id: string;
}
