import { AbstractRabbitMqJobHandler } from "@/jobs/abstract-rabbit-mq-job-handler";
import { ridb } from "@/common/db";
import _ from "lodash";
import { fromBuffer } from "@/common/utils";
import { logger } from "@/common/logger";

export type FillInOrphanBlockCheckJobPayload = {
  block: number;
  blockHash: string;
  orderId: string;
};

export class FillInOrphanBlockCheckJob extends AbstractRabbitMqJobHandler {
  queueName = "fill-in-orphan-block-check";
  maxRetries = 10;
  concurrency = 5;
  timeout = 60000;

  public async process(payload: FillInOrphanBlockCheckJobPayload) {
    const { block, blockHash, orderId } = payload;
    const query = `
      SELECT *
      FROM fill_events_2
      WHERE order_id = $/orderId/
    `;

    const fills = await ridb.manyOrNone(query, { orderId });
    let found = false;
    if (!_.isEmpty(fills)) {
      for (const fill of fills) {
        if (Number(fill.is_deleted) === 0 && fromBuffer(fill.block_hash) !== blockHash) {
          found = true;
          logger.info(
            this.queueName,
            `orderId ${orderId} was found in block ${fill.block} blockHash ${fromBuffer(
              fill.block_hash
            )}`
          );

          break;
        }
      }
    }

    if (!found) {
      logger.warn(
        this.queueName,
        `Orders filled in orphan block ${block} blockHash ${blockHash} orderId ${orderId}`
      );
    }
  }

  public async addToQueue(fillInfos: FillInOrphanBlockCheckJobPayload[], delay = 5 * 60 * 1000) {
    await this.sendBatch(fillInfos.map((info) => ({ payload: info, delay })));
  }
}

export const fillInOrphanBlockCheckJob = new FillInOrphanBlockCheckJob();
