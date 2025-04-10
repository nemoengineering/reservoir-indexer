import { AbstractRabbitMqJobHandler } from "@/jobs/abstract-rabbit-mq-job-handler";
import { RabbitMQMessage } from "@/common/rabbit-mq";
import { logger } from "@/common/logger";
import axios from "axios";
import { eventsSyncBackfillJob } from "@/jobs/events-sync/events-sync-backfill-job";

export type BackfillErc20TransfersBlocksJobPayload = {
  uri: string;
  dryRun?: boolean;
};

export class BackfillErc20TransfersBlocksJob extends AbstractRabbitMqJobHandler {
  queueName = "backfill-erc20-transfers-blocks-queue";
  maxRetries = 10;
  concurrency = 1;
  persistent = false;
  lazyMode = false;
  singleActiveConsumer = true;

  public async process(payload: BackfillErc20TransfersBlocksJobPayload) {
    const { uri, dryRun } = payload;

    const { data } = await axios.get(uri, {
      headers: {
        "X-Dune-API-Key": String(process.env.DUNE_API_KEY),
      },
    });

    if (!dryRun) {
      for (const row of data.result.rows) {
        await eventsSyncBackfillJob.addToQueue(row.block_number, row.block_number, {
          backfill: true,
          blocksPerBatch: 1,
        });
      }
    }

    const lastRow = data.result.rows.length
      ? data?.result.rows[data?.result.rows.length - 1]
      : null;

    logger.info(
      this.queueName,
      JSON.stringify({
        message: `Backfilled ${data.result.rows.length} blocks. uri=${uri}, dryRun=${dryRun}, next_uri=${data.next_uri}`,
        lastRow,
      })
    );

    if (data.next_uri) {
      return {
        addToQueue: true,
        addToQueueNextUri: data.next_uri,
      };
    }

    return { addToQueue: false };
  }

  public async onCompleted(
    rabbitMqMessage: RabbitMQMessage,
    processResult: {
      addToQueue: boolean;
      addToQueueNextUri: string;
    }
  ) {
    if (processResult.addToQueue) {
      await this.addToQueue(
        processResult.addToQueueNextUri,
        rabbitMqMessage.payload.dryRun,
        5 * 1000
      );
    }
  }

  public async addToQueue(uri: string, dryRun = false, delay = 0) {
    await this.send({ payload: { uri, dryRun } }, delay);
  }
}

export const backfillErc20TransfersBlocksJob = new BackfillErc20TransfersBlocksJob();
