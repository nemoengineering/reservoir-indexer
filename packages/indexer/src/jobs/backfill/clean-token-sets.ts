import { idb, ridb } from "@/common/db";

import { AbstractRabbitMqJobHandler } from "@/jobs/abstract-rabbit-mq-job-handler";
import { RabbitMQMessage } from "@/common/rabbit-mq";
import { logger } from "@/common/logger";

export type CleanTokenSetsJobCursorInfo = {
  attributeId?: number;
  total?: number;
};

export class CleanTokenSetsJob extends AbstractRabbitMqJobHandler {
  queueName = "clean-token-sets";
  maxRetries = 10;
  concurrency = 1;
  persistent = false;
  lazyMode = false;
  singleActiveConsumer = true;

  public async process(payload: CleanTokenSetsJobCursorInfo) {
    const { attributeId } = payload;
    let total = payload.total ?? 0;
    // const limit = 200;
    const deleteLimit = 2000;
    const maxAttributeId = 32241521;

    const tokenSetsQuery = `
      SELECT *
      FROM (
        SELECT id, schema_hash, attribute_id, (SELECT count(*) FROM orders WHERE orders.token_set_id = token_sets.id) AS count
        FROM token_sets 
        WHERE attribute_id IS NOT NULL
        ${attributeId ? `AND attribute_id = $/attributeId/` : ""}
        ORDER BY attribute_id 
      ) x
      WHERE x.count = 0
    `;

    const tokenSets = await ridb.manyOrNone(tokenSetsQuery, {
      attributeId,
    });

    for (const tokenSet of tokenSets) {
      let query;
      let deleteCount = 0;

      // Delete from token_sets_tokens
      do {
        query = `
          DELETE FROM token_sets_tokens
          WHERE (token_set_id, contract, token_id) IN (
            SELECT token_set_id, contract, token_id
            FROM token_sets_tokens
            WHERE token_set_id = $/tokenSetId/
            LIMIT ${deleteLimit}
          )
        `;

        const result = await idb.result(query, { tokenSetId: tokenSet.id });

        deleteCount = result.rowCount;
        total += result.rowCount;
      } while (deleteCount >= deleteLimit);

      // Delete from token_sets
      query = `
        DELETE FROM token_sets
        WHERE id = $/tokenSetId/
        AND schema_hash = $/schemaHash/
      `;

      await idb.result(query, { tokenSetId: tokenSet.id, schemaHash: tokenSet.schema_hash });
    }

    // Check if there are more potential users to sync
    const nextAttributeId = Number(attributeId) + 1;
    if (maxAttributeId >= nextAttributeId) {
      if (payload.total !== total) {
        logger.info(
          this.queueName,
          `Total token sets deleted ${total} last attribute id ${Number(attributeId)}`
        );
      }

      return {
        addToQueue: true,
        cursor: {
          attributeId: nextAttributeId,
          total,
        },
      };
    }

    logger.info(this.queueName, `Done cleaning token sets deleted ${total}`);

    return { addToQueue: false };
  }

  public async onCompleted(
    rabbitMqMessage: RabbitMQMessage,
    processResult: {
      addToQueue: boolean;
      cursor?: CleanTokenSetsJobCursorInfo;
    }
  ) {
    if (processResult.addToQueue) {
      await this.addToQueue(processResult.cursor);
    }
  }

  public async addToQueue(cursor?: CleanTokenSetsJobCursorInfo, delay = 0) {
    await this.send({ payload: cursor ?? {} }, delay);
  }
}

export const cleanTokenSetsJob = new CleanTokenSetsJob();
