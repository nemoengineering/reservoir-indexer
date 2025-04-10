import { AbstractRabbitMqJobHandler, BackoffStrategy } from "@/jobs/abstract-rabbit-mq-job-handler";
import { logger } from "@/common/logger";
import { syncTraces } from "@/events-sync/index";
import { config } from "@/config/index";
import { archiveProvider } from "@/common/provider";

export type TraceSyncJobPayload = {
  block: number;
  useArchiveRpcProvider?: boolean;
};

export class TraceSyncJob extends AbstractRabbitMqJobHandler {
  queueName = "trace-sync";
  maxRetries = 30;
  concurrency = [42161].includes(config.chainId) ? 5 : 1;
  consumerTimeout = 10 * 60 * 1000;
  backoff = {
    type: "fixed",
    delay: 1000,
  } as BackoffStrategy;

  public async process(payload: TraceSyncJobPayload) {
    const { block } = payload;

    try {
      await syncTraces(block, payload.useArchiveRpcProvider ? archiveProvider : undefined);
      //eslint-disable-next-line
    } catch (error: any) {
      // if the error is block not found, add back to queue
      if (error?.message.includes("not found with RPC provider")) {
        logger.info(
          this.queueName,
          `Block ${block} not found with RPC provider, adding back to queue`
        );

        return { addToQueue: true, delay: 1000 };
      } else {
        throw error;
      }
    }
  }

  public async addToQueue(params: TraceSyncJobPayload, delay = 5000) {
    if (config.disableSyncTraces) {
      return;
    }

    await this.send({ payload: params, jobId: `${params.block}` }, delay);
  }
}

export const traceSyncJob = new TraceSyncJob();
