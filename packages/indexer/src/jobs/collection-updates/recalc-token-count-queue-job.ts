import { idb } from "@/common/db";
import { AbstractRabbitMqJobHandler, BackoffStrategy } from "@/jobs/abstract-rabbit-mq-job-handler";
import _ from "lodash";
import { bn, toBuffer } from "@/common/utils";
import { config } from "@/config/index";
import * as tokensIndex from "@/elasticsearch/indexes/tokens";
import { logger } from "@/common/logger";

export type RecalcTokenCountQueueJobPayload = {
  collection: string;
  fromTokenId?: string;
  totalCurrentCount?: number;
  totalSupply?: string;
  remainingSupply?: string;
  force?: boolean;
};

export default class RecalcTokenCountQueueJob extends AbstractRabbitMqJobHandler {
  queueName = "collection-recalc-token-count-queue";
  maxRetries = 10;
  concurrency = 10;
  backoff = {
    type: "exponential",
    delay: 20000,
  } as BackoffStrategy;

  public async process(payload: RecalcTokenCountQueueJobPayload) {
    const { collection, fromTokenId } = payload;

    if (config.enableElasticsearchTokensSearch) {
      try {
        let tokenCount = 0;
        const { supply, remainingSupply } = await tokensIndex.getCollectionSupply(collection);

        if (remainingSupply > 0) {
          tokenCount = await tokensIndex.getCollectionTokenCount(collection);
        }

        if (!payload.force) {
          await this.addToQueue(
            {
              collection,
              force: true,
            },
            30 * 1000
          );
        }

        // No more tokens to count, update collections table
        const query = `
            UPDATE "collections"
            SET "token_count" = $/tokenCount/,
                "supply" = $/supply/,
                "remaining_supply" = $/remainingSupply/,
                "updated_at" = now()
            WHERE "id" = $/collection/
            AND ("token_count" IS DISTINCT FROM $/tokenCount/ OR supply IS DISTINCT FROM $/supply/ OR remaining_supply IS DISTINCT FROM $/remainingSupply/)
        `;

        await idb.none(query, {
          collection,
          tokenCount,
          supply,
          remainingSupply,
        });

        return;
      } catch (error) {
        logger.error(
          this.queueName,
          JSON.stringify({
            message: `getCollectionTokenCount error. collection=${collection}, error=${error}`,
            error,
          })
        );
      }
    }

    const limit = 2000;
    const continuation = fromTokenId ? `AND token_id > $/fromTokenId/` : "";

    let { totalCurrentCount, totalSupply, remainingSupply } = payload;
    totalCurrentCount = Number(totalCurrentCount ?? 0);
    totalSupply = totalSupply ?? "0";
    remainingSupply = remainingSupply ?? "0";

    const [contract] = _.split(collection, ":"); // Get the contract from the collection

    const tokenQuery = `
      SELECT token_id,
             COALESCE(supply, 0) AS supply,
             COALESCE(remaining_supply, 0) AS remaining_supply
      FROM tokens
      WHERE collection_id = $/collection/
      AND contract = $/contract/
      ${continuation}
      ORDER BY contract, token_id
      LIMIT ${limit}
    `;

    const tokens = await idb.manyOrNone(tokenQuery, {
      collection,
      fromTokenId,
      contract: toBuffer(contract),
    });

    for (const token of tokens) {
      totalSupply = bn(token.supply).add(totalSupply).toString();
      remainingSupply = bn(token.remaining_supply).add(remainingSupply).toString();
      if (_.isNull(token.remaining_supply) || bn(token.remaining_supply).gt(0)) {
        ++totalCurrentCount;
      }
    }

    // If there are more tokens to count
    if (tokens.length >= limit) {
      // Trigger the next count job from the last token_id of the current batch
      await this.addToQueue(
        {
          collection,
          fromTokenId: _.last(tokens).token_id,
          totalCurrentCount,
          totalSupply,
          remainingSupply,
        },
        _.random(1, 10) * 1000
      );
    } else {
      // No more tokens to count, update collections table
      const query = `
          UPDATE "collections"
          SET "token_count" = $/totalCurrentCount/,
              "supply" = $/totalSupply/,
              "remaining_supply" = $/remainingSupply/,
              "updated_at" = now()
          WHERE "id" = $/collection/
          AND ("token_count" IS DISTINCT FROM $/totalCurrentCount/ OR supply IS DISTINCT FROM $/totalSupply/ OR remaining_supply IS DISTINCT FROM $/remainingSupply/)
      `;

      await idb.none(query, {
        collection,
        totalCurrentCount,
        totalSupply,
        remainingSupply,
      });
    }
  }

  public async addToQueue(payload: RecalcTokenCountQueueJobPayload, delay = 5 * 60 * 1000) {
    payload.totalCurrentCount = payload.totalCurrentCount ?? 0;

    await this.send(
      {
        payload,
        jobId: payload.force ? undefined : `${payload.collection}:${payload.fromTokenId}`,
      },
      delay
    );
  }
}

export const recalcTokenCountQueueJob = new RecalcTokenCountQueueJob();
