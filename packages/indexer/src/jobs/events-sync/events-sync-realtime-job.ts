import { AbstractRabbitMqJobHandler, BackoffStrategy } from "@/jobs/abstract-rabbit-mq-job-handler";
import { config } from "@/config/index";
import { logger } from "@/common/logger";
import { checkForOrphanedBlock, syncEvents } from "@/events-sync/index";
import { RabbitMQMessage } from "@/common/rabbit-mq";
import { traceSyncJob } from "./trace-sync-job";
import { acquireLock, redis } from "@/common/redis";
import { Network } from "@reservoir0x/sdk/dist/utils";

export type EventsSyncRealtimeJobPayload = {
  block: number;
  blockEventTimeReceived?: number;
  useArchiveRpcProvider?: boolean;
};

export class EventsSyncRealtimeJob extends AbstractRabbitMqJobHandler {
  queueName = "events-sync-realtime";
  maxRetries = 30;
  concurrency = [
    Network.Base,
    Network.Arbitrum,
    Network.Zora,
    Network.Optimism,
    Network.Ethereum,
    Network.Abstract,
    Network.Apechain,
    Network.Shape,
    Network.Apex,
  ].includes(config.chainId)
    ? 20
    : 5;
  timeout = 5 * 60 * 1000;
  backoff = {
    type: "fixed",
    delay: 1000,
  } as BackoffStrategy;
  enableFailedJobsRetry = ![
    Network.SeiTestnet,
    Network.Bitlayer,
    Network.FlowPreviewnet,
    Network.Sei,
  ].includes(config.chainId);

  public async process(payload: EventsSyncRealtimeJobPayload) {
    const { block } = payload;

    try {
      // Update the latest block synced
      const latestBlock = await redis.get("latest-block-realtime");
      if (latestBlock && block > Number(latestBlock)) {
        await redis.set("latest-block-realtime", block);
      }

      await syncEvents(
        {
          fromBlock: block,
          toBlock: block,
        },
        {
          useArchiveRpcProvider: payload.useArchiveRpcProvider,
        },
        {
          blockEventTimeReceived: payload.blockEventTimeReceived,
          rabbitMqMessagePublishTime: this.rabbitMqMessage?.publishTime,
        }
      );
      await traceSyncJob.addToQueue({
        block: block,
        useArchiveRpcProvider: payload.useArchiveRpcProvider,
      });
      //eslint-disable-next-line
    } catch (error: any) {
      // if the error is block not found, add back to queue
      if (error?.message.includes("not found with RPC provider") && !config.isTestnet) {
        const delay = [
          Network.Arbitrum,
          Network.Optimism,
          Network.Zora,
          Network.Base,
          Network.Ethereum,
          Network.Abstract,
          Network.Apechain,
        ].includes(config.chainId)
          ? 250
          : 1000;

        if (
          [
            Network.Arbitrum,
            Network.Optimism,
            Network.Zora,
            Network.Base,
            Network.Polygon,
            Network.Bsc,
            Network.Ethereum,
            Network.Abstract,
            Network.Apechain,
          ].includes(config.chainId)
        ) {
          logger.info(
            this.queueName,
            JSON.stringify({
              message: `${error?.message}. Retrying block ${block} in ${delay}ms`,
              baseNetworkHttpUrl: config.baseNetworkHttpUrl,
              block,
            })
          );
        }

        return {
          addToQueue: true,
          delay,
        };
      } else if (error?.message.includes("unfinalized")) {
        return { addToQueue: true, delay: 2000 };
      } else {
        throw error;
      }
    }

    await checkForOrphanedBlock(block);
  }

  public async onCompleted(
    message: RabbitMQMessage,
    processResult: { addToQueue?: boolean; delay?: number }
  ) {
    if (processResult?.addToQueue) {
      await this.addToQueue(message.payload, processResult.delay);
    }
  }

  public async processDeadLetter(payload: EventsSyncRealtimeJobPayload) {
    const { block } = payload;

    // Prevent retrying duplicate messages
    if (!(await acquireLock(`processDeadLetter:${this.queueName}:${block}`, 60 * 5))) {
      return;
    }

    return this.process(payload);
  }

  public async addToQueue(params: EventsSyncRealtimeJobPayload, delay = 0, force = false) {
    await this.send({ payload: params, jobId: force ? undefined : `${params.block}` }, delay);
  }
}

export const eventsSyncRealtimeJob = new EventsSyncRealtimeJob();
