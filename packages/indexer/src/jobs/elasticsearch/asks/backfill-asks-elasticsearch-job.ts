import { config } from "@/config/index";
import { logger } from "@/common/logger";
import { idb } from "@/common/db";
import { redis } from "@/common/redis";

import { AbstractRabbitMqJobHandler } from "@/jobs/abstract-rabbit-mq-job-handler";

import * as AskIndex from "@/elasticsearch/indexes/asks";
import { elasticsearch as defaultElasticsearch } from "@/common/elasticsearch";
import { AskCreatedEventHandler } from "@/elasticsearch/indexes/asks/event-handlers/ask-created";
import { AskEvent } from "@/elasticsearch/indexes/asks/pending-ask-events-queue";
import { Client } from "@elastic/elasticsearch";
import { BulkOperationType, BulkResponseItem } from "@elastic/elasticsearch/lib/api/types";

export class BackfillAsksElasticsearchJob extends AbstractRabbitMqJobHandler {
  queueName = "backfill-asks-elasticsearch-queue";
  maxRetries = 10;
  concurrency = 5;
  persistent = true;

  public async process(payload: BackfillAsksElasticsearchJobPayload) {
    if (!payload.cursor) {
      logger.info(
        this.queueName,
        JSON.stringify({
          topic: "backfillElasticsearch",
          message: `Start. fromTimestamp=${payload.fromTimestamp}, onlyActive=${payload.onlyActive}`,
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
      indexName = payload.indexName;
    } else {
      indexName = AskIndex.getIndexName();
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

    const askEvents: AskEvent[] = [];

    try {
      let continuationFilter = "";
      let fromTimestampFilter = "";
      let orderKindFilter = "";

      const limit = Number(await redis.get(`${this.queueName}-limit`)) || 100;

      if (payload.cursor) {
        continuationFilter = `AND (orders.updated_at, orders.id) > (to_timestamp($/updatedAt/), $/id/)`;
      }

      if (payload.fromTimestamp) {
        fromTimestampFilter = `AND (orders.updated_at) > (to_timestamp($/fromTimestamp/))`;
      }

      if (payload.orderKind) {
        orderKindFilter = `AND orders.kind = $/orderKind/`;
      }

      query = `
            ${AskCreatedEventHandler.buildBaseQuery(payload.onlyActive)}
              ${continuationFilter}
              ${fromTimestampFilter}
              ${orderKindFilter}
              ORDER BY updated_at, id
              LIMIT $/limit/;
          `;

      const rawResults = await idb.manyOrNone(query, {
        fromTimestamp: payload.fromTimestamp,
        orderKind: payload.orderKind,
        updatedAt: payload.cursor?.updatedAt,
        id: payload.cursor?.id,
        limit,
      });

      if (rawResults.length) {
        for (const rawResult of rawResults) {
          try {
            const eventHandler = new AskCreatedEventHandler(rawResult.order_id);

            if (rawResult.status === "active") {
              const askDocument = eventHandler.buildDocument(rawResult);

              askEvents.push({
                kind: "index",
                info: { id: eventHandler.getAskId(), document: askDocument },
              } as AskEvent);
            } else {
              askEvents.push({
                kind: "delete",
                info: { id: eventHandler.getAskId() },
              } as AskEvent);
            }
          } catch (error) {
            logger.error(
              this.queueName,
              JSON.stringify({
                topic: "backfillElasticsearch",
                message: `Error generating ask document. error=${error}`,
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
          id: lastResult.order_id,
        };
      }
    } catch (error) {
      logger.error(
        this.queueName,
        JSON.stringify({
          topic: "backfillElasticsearch",
          message: `Error generating ask documents. error=${error}`,
          error,
          payload,
          query,
        })
      );

      throw error;
    }

    if (askEvents.length) {
      const bulkIndexOps = askEvents
        .filter((askEvent) => askEvent.kind == "index")
        .flatMap((askEvent) => [
          { index: { _index: indexName, _id: askEvent.info.id } },
          askEvent.info.document,
        ]);

      const bulkDeleteOps = askEvents
        .filter((askEvent) => askEvent.kind == "delete")
        .flatMap((askEvent) => ({
          delete: { _index: indexName, _id: askEvent.info.id },
        }));

      let createdAsks: Partial<Record<BulkOperationType, BulkResponseItem>>[] = [];
      let bulkIndexOpsResponse;

      if (bulkIndexOps.length) {
        bulkIndexOpsResponse = await elasticsearch.bulk({
          body: bulkIndexOps,
        });

        createdAsks = bulkIndexOpsResponse.items.filter((item) => item.create?.status === 201);
      }

      let deletedAsks: Partial<Record<BulkOperationType, BulkResponseItem>>[] = [];
      let bulkDeleteOpsResponse;

      if (bulkDeleteOps.length) {
        bulkDeleteOpsResponse = await elasticsearch.bulk({
          body: bulkDeleteOps,
        });

        deletedAsks = bulkDeleteOpsResponse.items.filter((item) => item.delete?.status === 200);
      }

      logger.info(
        this.queueName,
        JSON.stringify({
          topic: "backfillElasticsearch",
          message: `Backfilled ${bulkIndexOps.length / 2} asks. createdAsksCount=${
            createdAsks.length
          }. Deleted ${bulkDeleteOps.length} asks. deletedAsksCount=${deletedAsks.length}`,
          payload,
          nextCursor,
          indexName,
          bulkIndexOpsResponseHasErrors: bulkIndexOpsResponse?.errors,
          bulkIndexOpsResponse: bulkIndexOpsResponse?.errors ? bulkIndexOpsResponse : undefined,
          bulkDeleteOpsResponseHasErrors: bulkDeleteOpsResponse?.errors,
          bulkDeleteOpsResponse: bulkDeleteOpsResponse?.errors ? bulkDeleteOpsResponse : undefined,
        })
      );

      await this.addToQueue(
        payload.indexName,
        payload.clusterUrl,
        payload.clusterUsername,
        payload.clusterPassword,
        payload.keepGoing,
        payload.fromTimestamp,
        payload.orderKind,
        payload.onlyActive,
        nextCursor
      );
    } else if (payload.keepGoing) {
      logger.info(
        this.queueName,
        JSON.stringify({
          topic: "backfillElasticsearch",
          message: `Keep going. No asks found.`,
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
        payload.orderKind,
        false,
        payload.cursor,
        30000
      );
    }
  }

  public async addToQueue(
    indexName?: string,
    clusterUrl?: string,
    clusterUsername?: string,
    clusterPassword?: string,
    keepGoing?: boolean,
    fromTimestamp?: number,
    orderKind?: string,
    onlyActive?: boolean,
    cursor?: {
      updatedAt: string;
      id: string;
    },
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
          orderKind,
          onlyActive,
          cursor,
        },
      },
      delay
    );
  }
}

export const backfillAsksElasticsearchJob = new BackfillAsksElasticsearchJob();

export type BackfillAsksElasticsearchJobPayload = {
  indexName?: string;
  clusterUrl?: string;
  clusterUsername?: string;
  clusterPassword?: string;
  keepGoing?: boolean;
  fromTimestamp?: number;
  onlyActive?: boolean;
  orderKind?: string;
  cursor?: {
    updatedAt: string;
    id: string;
  };
};
