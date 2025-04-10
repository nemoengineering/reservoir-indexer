import { AbstractRabbitMqJobHandler } from "@/jobs/abstract-rabbit-mq-job-handler";
import { config } from "@/config/index";
import * as ActivitiesIndex from "@/elasticsearch/indexes/activities";

export type UpdateActivitiesParentJobPayload = {
  txHash: string;
  parentId: string;
  retries: number;
};

export default class UpdateActivitiesParentJob extends AbstractRabbitMqJobHandler {
  queueName = "update-activities-parent-queue";
  maxRetries = 10;
  concurrency = 1;
  persistent = true;
  useSharedChannel = true;

  public async process(payload: UpdateActivitiesParentJobPayload) {
    const { txHash, parentId } = payload;

    const keepGoing = await ActivitiesIndex.updateActivitiesParent(txHash, parentId);

    if (keepGoing) {
      await this.addToQueue(payload, true);
    }

    if (payload.retries < 5) {
      payload.retries += 1;

      await this.addToQueue(payload, true, payload.retries * 5000);
    }
  }

  public async addToQueue(payload: UpdateActivitiesParentJobPayload, force = false, delay = 5000) {
    if (!config.doElasticsearchWork) {
      return;
    }

    let jobId;

    if (!force) {
      jobId = `${payload.txHash}:${payload.parentId}`;
    }

    await this.send({ payload, jobId }, delay);
  }
}

export const updateActivitiesParentJob = new UpdateActivitiesParentJob();
