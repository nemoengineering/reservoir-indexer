import { config } from "@/config/index";
import { logger } from "@/common/logger";
import { idb } from "@/common/db";
import { redis } from "@/common/redis";

import { AbstractRabbitMqJobHandler } from "@/jobs/abstract-rabbit-mq-job-handler";

import * as TokenIndex from "@/elasticsearch/indexes/tokens";
import { elasticsearch as defaultElasticsearch } from "@/common/elasticsearch";
import { TokenCreatedEventHandler } from "@/elasticsearch/indexes/tokens/event-handlers/token-created";
import { fromBuffer, toBuffer } from "@/common/utils";
import { TokenEvent } from "@/elasticsearch/indexes/tokens/pending-token-events-queue";
import PgPromise from "pg-promise";
import { Client } from "@elastic/elasticsearch";
import { getChainName } from "@/config/network";

export class BackfillTokensElasticsearchJob extends AbstractRabbitMqJobHandler {
  queueName = "backfill-tokens-elasticsearch-queue";
  maxRetries = 10;
  concurrency = 5;
  persistent = true;

  public async process(payload: BackfillTokensElasticsearchJobPayload) {
    const startTimestamp = Date.now();

    if (!payload.cursor) {
      logger.info(
        this.queueName,
        JSON.stringify({
          topic: "backfillElasticsearch",
          message: `Start.`,
          payload,
        })
      );
    }

    if (payload.keepGoing) {
      if (await redis.exists(`backfill-elasticsearch-keep-going-disabled`)) {
        logger.info(
          this.queueName,
          JSON.stringify({
            topic: "backfillElasticsearch",
            message: `Keep going disabled.`,
            payload,
          })
        );

        return;
      }
    }

    const { clusterUrl, clusterUsername, clusterPassword } = payload;

    let indexName: string;

    if (payload.indexName) {
      indexName = `${getChainName()}.${payload.indexName}`;
    } else {
      indexName = TokenIndex.getIndexName();
    }

    let elasticsearch = defaultElasticsearch;

    if (clusterUrl) {
      elasticsearch = new Client({
        node: clusterUrl,
        requestTimeout: 10000,
        ...(clusterUsername && clusterPassword
          ? {
              auth: {
                username: clusterUsername,
                password: clusterPassword,
              },
            }
          : {}),
      });
    }

    let nextCursor;
    let query;

    const tokenEvents: TokenEvent[] = [];

    try {
      let continuationFilter = "";
      const fromTimestampFilter = "";

      const limit = Number(await redis.get(`${this.queueName}-limit`)) || 1000;

      if (payload.cursor) {
        continuationFilter = `WHERE (tokens.updated_at, tokens.contract, tokens.token_id) > (to_timestamp($/updatedAt/), $/contract/, $/tokenId/)`;
      }

      // if (payload.fromTimestamp) {
      //   if (payload.cursor) {
      //     fromTimestampFilter = `AND (tokens.updated_at) > (to_timestamp($/fromTimestamp/))`;
      //   } else {
      //     fromTimestampFilter = `WHERE (tokens.updated_at) > (to_timestamp($/fromTimestamp/))`;
      //   }
      // }

      // if (payload.cursor) {
      //   fromTimestampFilter = `AND (tokens.updated_at) > (to_timestamp(1726221600))`;
      // } else {
      //   fromTimestampFilter = `WHERE (tokens.updated_at) > (to_timestamp(1726221600))`;
      // }

      query = `
            ${TokenCreatedEventHandler.buildBaseQuery()}
              ${continuationFilter}
              ${fromTimestampFilter}
              ORDER BY tokens.updated_at, tokens.contract, tokens.token_id
              LIMIT $/limit/;
          `;

      const rawResults = await idb.manyOrNone(query, {
        // fromTimestamp: payload.fromTimestamp,
        updatedAt: payload.cursor?.updatedAt,
        contract: payload.cursor?.contract ? toBuffer(payload.cursor.contract) : null,
        tokenId: payload.cursor?.tokenId,
        limit,
      });

      if (rawResults.length) {
        for (const rawResult of rawResults) {
          const contract = fromBuffer(rawResult.contract);
          const tokenId = rawResult.token_id;

          try {
            const eventHandler = new TokenCreatedEventHandler(contract, tokenId);
            const tokenDocument = eventHandler.buildDocument(rawResult);

            tokenEvents.push({
              kind: "index",
              info: { id: eventHandler.getDocumentId(), document: tokenDocument },
            } as TokenEvent);
          } catch (error) {
            logger.error(
              this.queueName,
              JSON.stringify({
                topic: "backfillElasticsearch",
                message: `Error generating token document. error=${error}`,
                error,
                payload,
                rawResult,
              })
            );
          }
        }

        const lastResult = rawResults[rawResults.length - 1];

        nextCursor = {
          updatedAt: lastResult.updated_ts,
          contract: fromBuffer(lastResult.contract),
          tokenId: lastResult.token_id,
        };

        logger.info(
          this.queueName,
          JSON.stringify({
            topic: "backfillElasticsearch",
            message: `Backfilled ${tokenEvents.length} tokens out of ${rawResults.length} tokens.`,
            payload,
            payloadJSON: JSON.stringify(payload),
            nextCursor,
            nextCursorJSON: JSON.stringify(nextCursor),
            indexName: TokenIndex.getIndexName(),
            latency: Date.now() - startTimestamp,
            query: PgPromise.as.format(query, {
              updatedAt: payload.cursor?.updatedAt,
              contract: payload.cursor?.contract ? toBuffer(payload.cursor.contract) : null,
              tokenId: payload.cursor?.tokenId,
              limit,
            }),
          })
        );

        await this.addToQueue(
          payload.indexName,
          payload.clusterUrl,
          payload.clusterUsername,
          payload.clusterPassword,
          payload.keepGoing,
          payload.fromTimestamp,
          nextCursor
        );
      } else if (payload.keepGoing) {
        logger.info(
          this.queueName,
          JSON.stringify({
            topic: "backfillElasticsearch",
            message: `Keep going. No tokens found.`,
            payload,
            indexName,
          })
        );

        await this.addToQueue(
          payload.indexName,
          payload.clusterUrl,
          payload.clusterUsername,
          payload.clusterPassword,
          payload.keepGoing,
          payload.fromTimestamp,
          payload.cursor,
          30000
        );
      } else {
        logger.info(
          this.queueName,
          JSON.stringify({
            topic: "backfillElasticsearch",
            message: `Done.`,
            payload,
          })
        );
      }
    } catch (error) {
      logger.error(
        this.queueName,
        JSON.stringify({
          topic: "backfillElasticsearch",
          message: `Error generating token documents. error=${error}`,
          error,
          payload,
          query,
        })
      );

      throw error;
    }

    if (tokenEvents.length) {
      const bulkIndexOps = tokenEvents
        .filter((tokenEvent) => tokenEvent.kind == "index")
        .flatMap((tokenEvent) => [
          { index: { _index: indexName, _id: tokenEvent.info.id } },
          tokenEvent.info.document,
        ]);

      if (bulkIndexOps.length) {
        await elasticsearch.bulk({
          body: bulkIndexOps,
        });
      }
    }
  }

  public async addToQueue(
    indexName?: string,
    clusterUrl?: string,
    clusterUsername?: string,
    clusterPassword?: string,
    keepGoing?: boolean,
    fromTimestamp?: number,
    cursor?: { updatedAt: string; contract: string; tokenId: string },
    delay = 1000
  ) {
    if (!config.doElasticsearchWork) {
      return;
    }

    await this.send(
      {
        payload: {
          indexName,
          clusterUrl,
          clusterUsername,
          clusterPassword,
          keepGoing,
          fromTimestamp,
          cursor,
        },
        jobId: cursor ? `${cursor.contract}:${cursor.contract}:${cursor.tokenId}` : undefined,
      },
      delay
    );
  }
}

export const backfillTokensElasticsearchJob = new BackfillTokensElasticsearchJob();

export type BackfillTokensElasticsearchJobPayload = {
  indexName?: string;
  clusterUrl?: string;
  clusterUsername?: string;
  clusterPassword?: string;
  keepGoing?: boolean;
  fromTimestamp?: number;
  cursor?: {
    updatedAt: string;
    contract: string;
    tokenId: string;
  };
};
