import { AbstractRabbitMqJobHandler } from "@/jobs/abstract-rabbit-mq-job-handler";
import { Tokens } from "@/models/tokens";
import _ from "lodash";
import { resyncAttributeCacheJob } from "@/jobs/update-attribute/resync-attribute-cache-job";

export type HandleNewSellOrderJobPayload = {
  contract: string;
  tokenId: string;
  price: number | null;
  previousPrice: number | null;
  kind?: string;
  floorSellId?: string;
};

export default class HandleNewSellOrderJob extends AbstractRabbitMqJobHandler {
  queueName = "handle-new-sell-order-queue";
  maxRetries = 10;
  concurrency = 2;

  public async process(payload: HandleNewSellOrderJobPayload) {
    const { contract, tokenId } = payload;

    const maxTokensPerAttribute = 15000;

    const tokenAttributes = await Tokens.getTokenAttributes(
      contract,
      tokenId,
      maxTokensPerAttribute
    );

    if (_.isEmpty(tokenAttributes)) {
      return;
    }

    await resyncAttributeCacheJob.addToQueue(
      tokenAttributes.map((tokenAttribute) => ({
        attributeId: tokenAttribute.attributeId,
      })),
      0,
      true
    );
  }

  public async addToQueue(params: HandleNewSellOrderJobPayload) {
    await this.send({ payload: params });
  }
}

export const handleNewSellOrderJob = new HandleNewSellOrderJob();
