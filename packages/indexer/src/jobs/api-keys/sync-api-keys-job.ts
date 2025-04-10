import { AbstractRabbitMqJobHandler } from "@/jobs/abstract-rabbit-mq-job-handler";
import { AllChainsChannel } from "@/pubsub/channels";
import { redb } from "@/common/db";
import { AllChainsPubSub } from "@/pubsub/index";
import _ from "lodash";

export type SyncApiKeysJobPayload = {
  apiKey?: string;
  scope?: string;
};

export class SyncApiKeysJob extends AbstractRabbitMqJobHandler {
  queueName = "sync-api-keys";
  maxRetries = 10;
  concurrency = 30;

  public async process(payload: SyncApiKeysJobPayload) {
    const { apiKey, scope } = payload;
    const limit = 5000;
    const conditions: string[] = [];
    let apiKeyValues;

    if (apiKey) {
      conditions.push("key = $/apiKey/");
    }

    do {
      apiKeyValues = await redb.manyOrNone(
        `
        SELECT *
        FROM api_keys
        ${conditions.length ? `WHERE ` + conditions.map((c) => `(${c})`).join(" AND ") : ""}
        ORDER BY key ASC
        LIMIT $/limit/
      `,
        {
          apiKey,
          limit,
        }
      );

      if (apiKeyValues) {
        for (const apiKeyValue of apiKeyValues) {
          await AllChainsPubSub.publish(
            AllChainsChannel.ApiKeyCreated,
            JSON.stringify({ values: apiKeyValue, scope })
          );
        }

        conditions.push(`key > '${_.last(apiKeyValues).key}'`);
      }
    } while (apiKeyValues.length === limit);
  }

  public async addToQueue(info: SyncApiKeysJobPayload, delay = 0) {
    await this.send({ payload: info }, delay);
  }
}

export const syncApiKeysJob = new SyncApiKeysJob();
