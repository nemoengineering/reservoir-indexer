import { redb } from "@/common/db";
import { logger } from "@/common/logger";

import { AbstractRabbitMqJobHandler, BackoffStrategy } from "@/jobs/abstract-rabbit-mq-job-handler";

import { collectionWebsocketEventsTriggerQueueJob } from "@/jobs/websocket-events/collection-websocket-events-trigger-job";
import { fromBuffer, toBuffer } from "@/common/utils";
import { redis } from "@/common/redis";

export type CollectionSecurityConfigUpdatedJobPayload =
  | {
      by: "contract";
      data: {
        contract: string;
      };
      context?: string;
    }
  | {
      by: "transferValidator";
      data: {
        version: "v1" | "v2" | "v3";
        transferValidator: string;
        id: string;
      };
      context?: string;
    };

export default class CollectionSecurityConfigUpdatedJob extends AbstractRabbitMqJobHandler {
  queueName = "collection-security-config-updated";
  maxRetries = 5;
  concurrency = 20;
  backoff = {
    type: "exponential",
    delay: 10000,
  } as BackoffStrategy;

  public async process(payload: CollectionSecurityConfigUpdatedJobPayload) {
    const { by, data } = payload;

    try {
      switch (by) {
        case "contract": {
          await redis.del(`contract-security-config:${data.contract}`);
          await redis.del(`payment-processor-security-policy-by-id:${data.contract}`);

          const results = await redb.manyOrNone(
            `
          SELECT
            id
          FROM collections
          WHERE collections.contract = $/contract/
      `,
            {
              contract: toBuffer(data.contract),
            }
          );

          if (results.length) {
            await collectionWebsocketEventsTriggerQueueJob.addToQueue(
              results.map((result) => ({
                kind: "ForcedChange",
                data: {
                  id: result.id,
                  changed: ["securityConfig"],
                },
              }))
            );
          }

          break;
        }

        case "transferValidator": {
          let results: { contract: Buffer }[] = [];

          if (data.version === "v1") {
            results = await redb.manyOrNone(
              `
                  SELECT
                    contract
                  FROM erc721c_configs
                  WHERE erc721c_configs.transfer_validator = $/transferValidator/
                  AND erc721c_configs.operator_whitelist_id = $/id/
              `,
              {
                transferValidator: toBuffer(data.transferValidator),
                id: data.id,
              }
            );
          } else if (data.version === "v2") {
            results = await redb.manyOrNone(
              `
                  SELECT
                    contract
                  FROM erc721c_v2_configs
                  WHERE erc721c_v2_configs.transfer_validator = $/transferValidator/
                  AND erc721c_v2_configs.list_id = $/id/
              `,
              {
                transferValidator: toBuffer(data.transferValidator),
                id: data.id,
              }
            );
          } else if (data.version === "v3") {
            results = await redb.manyOrNone(
              `
                  SELECT
                    contract
                  FROM erc721c_v3_configs
                  WHERE erc721c_v3_configs.transfer_validator = $/transferValidator/
                  AND erc721c_v3_configs.list_id = $/id/
              `,
              {
                transferValidator: toBuffer(data.transferValidator),
                id: data.id,
              }
            );
          }

          if (results.length) {
            await this.addToQueue(
              results.map((result) => ({
                by: "contract",
                data: {
                  contract: fromBuffer(result.contract),
                },
                context: this.queueName,
              }))
            );
          }

          break;
        }
      }
    } catch (error) {
      logger.error(this.queueName, `Failed to handle job ${JSON.stringify(payload)}: ${error}`);
      throw error;
    }
  }

  public async addToQueue(infos: CollectionSecurityConfigUpdatedJobPayload[], delay?: number) {
    await this.sendBatch(
      infos.map((info) => {
        return {
          payload: info,
          delay: delay ? delay * 1000 : undefined,
        };
      })
    );
  }
}

export const collectionSecurityConfigUpdatedJob = new CollectionSecurityConfigUpdatedJob();
