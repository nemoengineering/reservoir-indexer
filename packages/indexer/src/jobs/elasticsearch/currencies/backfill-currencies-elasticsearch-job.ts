import { config } from "@/config/index";
import { logger } from "@/common/logger";
import { idb } from "@/common/db";
import { redis } from "@/common/redis";

import { AbstractRabbitMqJobHandler } from "@/jobs/abstract-rabbit-mq-job-handler";

import * as CurrenciesIndex from "@/elasticsearch/indexes/currencies";
import { elasticsearch as defaultElasticsearch } from "@/common/elasticsearch";
import { Client } from "@elastic/elasticsearch";
import { fromBuffer, toBuffer } from "@/common/utils";
import { CurrencyCreatedEventHandler } from "@/elasticsearch/indexes/currencies/event-handlers/currency-created";
import { CurrencyEvent } from "@/elasticsearch/indexes/currencies/pending-currency-events-queue";

export class BackfillCurrenciesElasticsearchJob extends AbstractRabbitMqJobHandler {
  queueName = "backfill-currencies-elasticsearch-queue";
  maxRetries = 10;
  concurrency = 5;
  persistent = true;

  public async process(payload: BackfillCurrenciesElasticsearchJobPayload) {
    if (!payload.cursor) {
      logger.info(
        this.queueName,
        JSON.stringify({
          topic: "backfillElasticsearch",
          message: `Start. fromTimestamp=${payload.fromTimestamp}`,
          payload,
        })
      );
    }

    if (payload.keepGoing) {
      if (await redis.exists(`${this.queueName}-keep-going-disabled`)) {
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
      indexName = CurrenciesIndex.getIndexName();
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

    const currencyEvents = [];

    try {
      let continuationFilter = "";
      let fromTimestampFilter = "";

      const limit = Number(await redis.get(`${this.queueName}-limit`)) || 1000;

      if (payload.cursor) {
        continuationFilter = `WHERE (currencies.updated_at, currencies.contract) > (to_timestamp($/updatedAt/), $/contract/)`;
      }

      if (payload.fromTimestamp) {
        if (payload.cursor) {
          fromTimestampFilter = `AND (currencies.updated_at) > (to_timestamp($/fromTimestamp/))`;
        } else {
          fromTimestampFilter = `WHERE (currencies.updated_at) > (to_timestamp($/fromTimestamp/))`;
        }
      }

      query = `
            ${CurrencyCreatedEventHandler.buildBaseQuery()}
              ${continuationFilter}
              ${fromTimestampFilter}
              ORDER BY currencies.updated_at, currencies.contract
              LIMIT $/limit/;
          `;

      const rawResults = await idb.manyOrNone(query, {
        fromTimestamp: payload.fromTimestamp,
        updatedAt: payload.cursor?.updatedAt,
        contract: payload.cursor?.contract ? toBuffer(payload.cursor.contract) : null,
        limit,
      });

      if (rawResults.length) {
        for (const rawResult of rawResults) {
          const contract = fromBuffer(rawResult.contract);

          try {
            const eventHandler = new CurrencyCreatedEventHandler(contract);
            const currencyDocument = await eventHandler.buildDocument(rawResult);

            currencyEvents.push({
              kind: "index",
              info: { id: eventHandler.getDocumentId(), document: currencyDocument },
            } as CurrencyEvent);
          } catch (error) {
            logger.error(
              this.queueName,
              JSON.stringify({
                topic: "backfillElasticsearch",
                message: `Error generating currency document. error=${error}`,
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
        };

        if (currencyEvents.length) {
          const bulkIndexOps = currencyEvents
            .filter((currencyEvent) => currencyEvent.kind == "index")
            .flatMap((currencyEvent) => [
              { index: { _index: indexName, _id: currencyEvent.info.id } },
              currencyEvent.info.document,
            ]);

          const bulkIndexResponse = await elasticsearch.bulk({
            body: bulkIndexOps,
          });

          logger.info(
            this.queueName,
            JSON.stringify({
              topic: "backfillElasticsearch",
              message: `Indexed ${bulkIndexOps.length} currencies.`,
              payload,
              indexName,
              nextCursor,
              hasErrors: bulkIndexResponse.errors,
              bulkIndexResponse: bulkIndexResponse.errors ? bulkIndexResponse : undefined,
            })
          );

          await backfillCurrenciesElasticsearchJob.addToQueue(
            payload.indexName,
            payload.clusterUrl,
            payload.clusterUsername,
            payload.clusterPassword,
            payload.keepGoing,
            payload.fromTimestamp,
            nextCursor
          );
        }
      } else if (payload.keepGoing) {
        logger.info(
          this.queueName,
          JSON.stringify({
            topic: "backfillElasticsearch",
            message: `Keep going. No currencies found.`,
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
          message: `Error generating currency document. error=${error}`,
          error,
          payload,
        })
      );

      throw error;
    }
  }

  public async addToQueue(
    indexName?: string,
    clusterUrl?: string,
    clusterUsername?: string,
    clusterPassword?: string,
    keepGoing?: boolean,
    fromTimestamp?: number,
    cursor?: {
      updatedAt: string;
      contract: string;
    },
    delay = 1000
  ) {
    if (!config.doElasticsearchWork || !config.enableElasticsearchCurrencies) {
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
      },
      delay
    );
  }
}

export const backfillCurrenciesElasticsearchJob = new BackfillCurrenciesElasticsearchJob();

export type BackfillCurrenciesElasticsearchJobPayload = {
  indexName?: string;
  clusterUrl?: string;
  clusterUsername?: string;
  clusterPassword?: string;
  keepGoing?: boolean;
  fromTimestamp?: number;
  cursor?: {
    updatedAt: string;
    contract: string;
  };
};
