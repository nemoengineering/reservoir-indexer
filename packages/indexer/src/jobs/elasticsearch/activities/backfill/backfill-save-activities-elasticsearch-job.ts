import { config } from "@/config/index";
import { logger } from "@/common/logger";
import { ridb } from "@/common/db";

import * as ActivitiesIndex from "@/elasticsearch/indexes/activities";

import { AbstractRabbitMqJobHandler, BackoffStrategy } from "@/jobs/abstract-rabbit-mq-job-handler";
import {
  EventCursorInfo,
  OrderCursorInfo,
} from "@/jobs/elasticsearch/activities/backfill/backfill-activities-elasticsearch-job";
import { AskCreatedEventHandler } from "@/elasticsearch/indexes/activities/event-handlers/ask-created";
import { elasticsearch as defaultElasticsearch } from "@/common/elasticsearch";
import { AskCancelledEventHandler } from "@/elasticsearch/indexes/activities/event-handlers/ask-cancelled";
import { BidCreatedEventHandler } from "@/elasticsearch/indexes/activities/event-handlers/bid-created";
import { BidCancelledEventHandler } from "@/elasticsearch/indexes/activities/event-handlers/bid-cancelled";
import { FillEventCreatedEventHandler } from "@/elasticsearch/indexes/activities/event-handlers/fill-event-created";
import { fromBuffer, toBuffer } from "@/common/utils";
import { NftTransferEventCreatedEventHandler } from "@/elasticsearch/indexes/activities/event-handlers/nft-transfer-event-created";
import { redis } from "@/common/redis";
import crypto from "crypto";
import { ActivityDocument, ActivityType } from "@/elasticsearch/indexes/activities/base";
import { RabbitMQMessage } from "@/common/rabbit-mq";
import { add, isAfter } from "date-fns";
import { FtTransferEventCreatedEventHandler } from "@/elasticsearch/indexes/activities/event-handlers/ft-transfer-event-created";
import { TransactionCreatedEventHandler } from "@/elasticsearch/indexes/activities/event-handlers/transaction-created";
import { Client } from "@elastic/elasticsearch";

export type BackfillSaveActivitiesElasticsearchJobPayload = {
  type: "ask" | "ask-cancel" | "bid" | "bid-cancel" | "sale" | "transfer";
  cursor?: OrderCursorInfo | EventCursorInfo;
  fromTimestamp?: number;
  toTimestamp?: number;
  clusterUrl?: string;
  clusterUsername?: string;
  clusterPassword?: string;
  indexName?: string;
  keepGoing?: boolean;
  upsert?: boolean;
  sortDirection?: "ASC" | "DESC";
};

export class BackfillSaveActivitiesElasticsearchJob extends AbstractRabbitMqJobHandler {
  queueName = "backfill-save-activities-elasticsearch-queue";
  maxRetries = 10;
  concurrency = 1;
  persistent = true;
  timeout = 5 * 60 * 1000;

  backoff = {
    type: "fixed",
    delay: 5000,
  } as BackoffStrategy;

  public async process(payload: BackfillSaveActivitiesElasticsearchJobPayload) {
    const type = payload.type;
    const cursor = payload.cursor;
    const fromTimestamp = payload.fromTimestamp || 0;
    const toTimestamp = payload.toTimestamp || 9999999999;
    const clusterUrl = payload.clusterUrl;
    const clusterUsername = payload.clusterUsername;
    const clusterPassword = payload.clusterPassword;
    const indexName = payload.indexName ?? ActivitiesIndex.getIndexName();
    const keepGoing = payload.keepGoing;
    const upsert = payload.upsert ?? true;
    const sortDirection = keepGoing ? "ASC" : payload.sortDirection ?? "ASC";

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

    const fromTimestampISO = new Date(fromTimestamp * 1000).toISOString();
    const toTimestampISO = new Date(toTimestamp * 1000).toISOString();

    let addToQueue = false;
    let addToQueueCursor: OrderCursorInfo | EventCursorInfo | undefined;

    const limit = Number(await redis.get(`${this.queueName}-limit`)) || 1000;

    const jobId = crypto
      .createHash("sha256")
      .update(
        `${type}:${JSON.stringify(cursor)}${fromTimestamp}:${toTimestamp}:${indexName}:${keepGoing}`
      )
      .digest("hex");

    try {
      const { activities, nextCursor } = await getActivities(
        type,
        fromTimestamp,
        toTimestamp,
        cursor,
        limit,
        sortDirection
      );

      if (activities.length) {
        if (activities.length === limit || keepGoing) {
          addToQueue = true;
          addToQueueCursor = nextCursor;
        }

        const bulkParams = {
          body: activities.flatMap((activity) => [
            { [upsert ? "index" : "create"]: { _index: indexName, _id: activity.id } },
            activity,
          ]),
        };

        const bulkResponse = await elasticsearch.bulk(bulkParams);

        let errorActivities: ActivityDocument[] = [];

        if (bulkResponse.errors) {
          const errorItems = bulkResponse.items.filter((item) => item.index?.error);
          const errorItemsIds = errorItems.map((item) => item.index?._id);
          errorActivities = activities.filter((activity) => errorItemsIds.includes(activity.id));
        }

        logger.info(
          this.queueName,
          JSON.stringify({
            topic: "backfillElasticsearch",
            message: `Backfilled ${activities.length} activities. type=${type}, fromTimestamp=${fromTimestampISO}, toTimestamp=${toTimestampISO}, keepGoing=${keepGoing}, limit=${limit}`,
            type,
            fromTimestamp,
            fromTimestampISO,
            toTimestamp,
            toTimestampISO,
            cursor,
            clusterUrl,
            clusterUsername,
            clusterPassword,
            indexName,
            keepGoing,
            sortDirection,
            jobId,
            nextCursor,
            hasNextCursor: !!nextCursor,
            hasErrors: bulkResponse.errors,
            errorItems: bulkResponse.items.filter((item) => item.index?.error),
            errorActivities,
            payloadJSON: JSON.stringify(payload),
          })
        );
      } else if (keepGoing) {
        logger.info(
          this.queueName,
          JSON.stringify({
            topic: "backfillElasticsearch",
            message: `KeepGoing. type=${type}, fromTimestamp=${fromTimestampISO}, toTimestamp=${toTimestampISO}, limit=${limit}`,
            type,
            fromTimestamp,
            fromTimestampISO,
            toTimestamp,
            toTimestampISO,
            cursor,
            clusterUrl,
            clusterUsername,
            clusterPassword,
            indexName,
            keepGoing,
            sortDirection,
            jobId,
          })
        );

        addToQueue = true;
        addToQueueCursor = cursor;
      }
    } catch (error) {
      logger.error(
        this.queueName,
        JSON.stringify({
          topic: "backfillElasticsearch",
          message: `Error. type=${type}, fromTimestamp=${fromTimestampISO}, toTimestamp=${toTimestampISO}, keepGoing=${keepGoing}, error=${error}`,
          type,
          fromTimestamp,
          fromTimestampISO,
          toTimestamp,
          toTimestampISO,
          cursor,
          clusterUrl,
          clusterUsername,
          clusterPassword,
          indexName,
          keepGoing,
          sortDirection,
          jobId,
          payloadJSON: JSON.stringify(payload),
        })
      );

      throw error;
    }

    if (!addToQueue) {
      logger.info(
        this.queueName,
        JSON.stringify({
          topic: "backfillElasticsearch",
          message: `End. type=${type}, fromTimestamp=${fromTimestampISO}, toTimestamp=${toTimestampISO}, keepGoing=${keepGoing}, limit=${limit}`,
          type,
          fromTimestamp,
          fromTimestampISO,
          toTimestamp,
          toTimestampISO,
          cursor,
          clusterUrl,
          clusterUsername,
          clusterPassword,
          indexName,
          keepGoing,
          sortDirection,
          jobId,
        })
      );
    }

    return { addToQueue, addToQueueCursor };
  }

  public async onCompleted(
    rabbitMqMessage: RabbitMQMessage,
    processResult: {
      addToQueue: boolean;
      addToQueueCursor: OrderCursorInfo | EventCursorInfo | undefined;
    }
  ) {
    if (processResult.addToQueue) {
      await this.addToQueue(
        rabbitMqMessage.payload.type,
        processResult.addToQueueCursor,
        rabbitMqMessage.payload.fromTimestamp,
        rabbitMqMessage.payload.toTimestamp,
        rabbitMqMessage.payload.clusterUrl,
        rabbitMqMessage.payload.clusterUsername,
        rabbitMqMessage.payload.clusterPassword,
        rabbitMqMessage.payload.indexName,
        rabbitMqMessage.payload.keepGoing,
        rabbitMqMessage.payload.upsert,
        rabbitMqMessage.payload.sortDirection
      );
    }
  }

  public async addToQueue(
    type:
      | "ask"
      | "ask-cancel"
      | "bid"
      | "bid-cancel"
      | "sale"
      | "transfer"
      | "ft_transfer"
      | "contract_call",
    cursor?: OrderCursorInfo | EventCursorInfo,
    fromTimestamp?: number,
    toTimestamp?: number,
    clusterUrl?: string,
    clusterUsername?: string,
    clusterPassword?: string,
    indexName?: string,
    keepGoing?: boolean,
    upsert?: boolean,
    sortDirection?: "ASC" | "DESC"
  ) {
    if (!config.doElasticsearchWork) {
      return;
    }

    // const jobId = crypto
    //   .createHash("sha256")
    //   .update(
    //     `${type}:${JSON.stringify(cursor)}${fromTimestamp}:${toTimestamp}:${indexName}:${keepGoing}`
    //   )
    //   .digest("hex");

    return this.send(
      {
        payload: {
          type,
          cursor,
          fromTimestamp,
          toTimestamp,
          clusterUrl,
          clusterUsername,
          clusterPassword,
          indexName,
          keepGoing,
          upsert,
          sortDirection,
        },
        // jobId,
      },
      keepGoing ? 2000 : 1000
    );
  }
}

export const backfillSaveActivitiesElasticsearchJob = new BackfillSaveActivitiesElasticsearchJob();

const getActivities = async (
  type: string,
  fromTimestamp: number,
  toTimestamp: number,
  cursor?: OrderCursorInfo | EventCursorInfo,
  limit = 1000,
  sortDirection = "DESC"
) => {
  switch (type) {
    case "ask":
      return getAskActivities(
        fromTimestamp,
        toTimestamp,
        cursor as OrderCursorInfo,
        limit,
        sortDirection
      );
    case "ask-cancel":
      return getAskCancelActivities(
        fromTimestamp,
        toTimestamp,
        cursor as OrderCursorInfo,
        limit,
        sortDirection
      );
    case "bid":
      return getBidActivities(
        fromTimestamp,
        toTimestamp,
        cursor as OrderCursorInfo,
        limit,
        sortDirection
      );
    case "bid-cancel":
      return getBidCancelActivities(
        fromTimestamp,
        toTimestamp,
        cursor as OrderCursorInfo,
        limit,
        sortDirection
      );
    case "sale":
      return getSaleActivities(
        fromTimestamp,
        toTimestamp,
        cursor as EventCursorInfo,
        limit,
        sortDirection
      );
    case "transfer":
      return getTransferActivities(
        fromTimestamp,
        toTimestamp,
        cursor as EventCursorInfo,
        limit,
        sortDirection
      );
    case "ft_transfer":
      return getFtTransferActivities(
        fromTimestamp,
        toTimestamp,
        cursor as EventCursorInfo,
        limit,
        sortDirection
      );
    case "contract_call":
      return getContractCallActivities(
        fromTimestamp,
        toTimestamp,
        cursor as EventCursorInfo,
        limit,
        sortDirection
      );
    default:
      throw new Error("Unknown type!");
  }
};
const getAskActivities = async (
  fromTimestamp: number,
  toTimestamp: number,
  cursor?: OrderCursorInfo,
  limit = 1000,
  sortDirection = "DESC"
) => {
  const activities = [];
  let nextCursor: OrderCursorInfo | undefined;

  let continuationFilter = "";

  if (cursor) {
    continuationFilter = `AND (updated_at, id) ${
      sortDirection == "DESC" ? "<" : ">"
    } (to_timestamp($/updatedAt/), $/id/)`;
  }

  const timestampFilter = `AND (updated_at >= to_timestamp($/fromTimestamp/) AND updated_at <= to_timestamp($/toTimestamp/))`;

  const query = `
            ${AskCreatedEventHandler.buildBaseQuery()}
            WHERE side = 'sell'
            AND kind != 'element-erc1155'
            ${timestampFilter}
            ${continuationFilter}
            ORDER BY updated_at ${sortDirection}, id ${sortDirection}
            LIMIT $/limit/;
          `;

  const results = await ridb.manyOrNone(query, {
    id: cursor?.id,
    updatedAt: cursor?.updatedAt,
    fromTimestamp,
    toTimestamp,
    limit,
  });

  if (results.length) {
    for (const result of results) {
      const eventHandler = new AskCreatedEventHandler(
        result.order_id,
        result.event_tx_hash,
        result.event_log_index,
        result.event_batch_index
      );

      const activity = eventHandler.buildDocument(result);

      activities.push(activity);
    }

    const lastResult = results[results.length - 1];

    nextCursor = {
      updatedAt: lastResult.updated_ts,
      id: lastResult.order_id,
    };
  }

  return { activities, nextCursor };
};

const getAskCancelActivities = async (
  fromTimestamp: number,
  toTimestamp: number,
  cursor?: OrderCursorInfo,
  limit = 1000,
  sortDirection = "DESC"
) => {
  const activities = [];
  let nextCursor: OrderCursorInfo | undefined;

  let continuationFilter = "";

  if (cursor) {
    continuationFilter = `AND (updated_at, id) ${
      sortDirection == "DESC" ? "<" : ">"
    } (to_timestamp($/updatedAt/), $/id/)`;
  }

  const timestampFilter = `AND (updated_at >= to_timestamp($/fromTimestamp/) AND updated_at <= to_timestamp($/toTimestamp/))`;

  const query = `
            ${AskCancelledEventHandler.buildBaseQuery()}
            WHERE side = 'sell' AND fillability_status = 'cancelled'
            AND kind != 'element-erc1155'
            ${timestampFilter}
            ${continuationFilter}
            ORDER BY updated_at ${sortDirection}, id ${sortDirection}
            LIMIT $/limit/;
          `;

  const results = await ridb.manyOrNone(query, {
    id: cursor?.id,
    updatedAt: cursor?.updatedAt,
    fromTimestamp,
    toTimestamp,
    limit,
  });

  if (results.length) {
    for (const result of results) {
      const eventHandler = new AskCancelledEventHandler(
        result.order_id,
        result.event_tx_hash,
        result.event_log_index,
        result.event_batch_index
      );

      const activity = eventHandler.buildDocument(result);

      activities.push(activity);
    }

    const lastResult = results[results.length - 1];

    nextCursor = {
      updatedAt: lastResult.updated_ts,
      id: lastResult.order_id,
    };
  }

  return { activities, nextCursor };
};

const getBidActivities = async (
  fromTimestamp: number,
  toTimestamp: number,
  cursor?: OrderCursorInfo,
  limit = 1000,
  sortDirection = "DESC"
) => {
  const activities = [];
  let nextCursor: OrderCursorInfo | undefined;

  let continuationFilter = "";

  if (cursor) {
    continuationFilter = `AND (updated_at, id) ${
      sortDirection == "DESC" ? "<" : ">"
    } (to_timestamp($/updatedAt/), $/id/)`;
  }

  const timestampFilter = `AND (updated_at >= to_timestamp($/fromTimestamp/) AND updated_at <= to_timestamp($/toTimestamp/))`;

  const query = `
            ${BidCreatedEventHandler.buildBaseQuery()}
            WHERE side = 'buy' AND fillability_status != 'expired'
            ${timestampFilter}
            ${continuationFilter}
            ORDER BY updated_at ${sortDirection}, id ${sortDirection}
            LIMIT $/limit/;
          `;

  const results = await ridb.manyOrNone(query, {
    id: cursor?.id,
    updatedAt: cursor?.updatedAt,
    fromTimestamp,
    toTimestamp,
    limit,
  });

  if (results.length) {
    for (const result of results) {
      const eventHandler = new BidCreatedEventHandler(
        result.order_id,
        result.event_tx_hash,
        result.event_log_index,
        result.event_batch_index
      );

      const activity = eventHandler.buildDocument(result);

      activities.push(activity);
    }

    const lastResult = results[results.length - 1];

    nextCursor = {
      updatedAt: lastResult.updated_ts,
      id: lastResult.order_id,
    };
  }

  return { activities, nextCursor };
};

const getBidCancelActivities = async (
  fromTimestamp: number,
  toTimestamp: number,
  cursor?: OrderCursorInfo,
  limit = 1000,
  sortDirection = "DESC"
) => {
  const activities = [];
  let nextCursor: OrderCursorInfo | undefined;

  let continuationFilter = "";

  if (cursor) {
    continuationFilter = `AND (updated_at, id) ${
      sortDirection == "DESC" ? "<" : ">"
    } (to_timestamp($/updatedAt/), $/id/)`;
  }

  const timestampFilter = `AND (updated_at >= to_timestamp($/fromTimestamp/) AND updated_at <= to_timestamp($/toTimestamp/))`;

  const query = `
            ${BidCancelledEventHandler.buildBaseQuery()}
            WHERE side = 'buy' AND fillability_status = 'cancelled'
            ${timestampFilter}
            ${continuationFilter}
            ORDER BY updated_at ${sortDirection}, id ${sortDirection}
            LIMIT $/limit/;
          `;

  const results = await ridb.manyOrNone(query, {
    id: cursor?.id,
    updatedAt: cursor?.updatedAt,
    fromTimestamp,
    toTimestamp,
    limit,
  });

  if (results.length) {
    for (const result of results) {
      const eventHandler = new BidCancelledEventHandler(
        result.order_id,
        result.event_tx_hash,
        result.event_log_index,
        result.event_batch_index
      );

      const activity = eventHandler.buildDocument(result);

      activities.push(activity);
    }

    const lastResult = results[results.length - 1];

    nextCursor = {
      updatedAt: lastResult.updated_ts,
      id: lastResult.order_id,
    };
  }

  return { activities, nextCursor };
};

const getSaleActivities = async (
  fromTimestamp: number,
  toTimestamp: number,
  cursor?: EventCursorInfo,
  limit = 1000,
  sortDirection = "DESC"
) => {
  const activities = [];
  let nextCursor: EventCursorInfo | undefined;

  let continuationFilter = "";

  if (cursor) {
    continuationFilter = `AND (timestamp, tx_hash, log_index, batch_index)${
      sortDirection == "DESC" ? "<" : ">"
    } ($/timestamp/, $/txHash/, $/logIndex/, $/batchIndex/)`;
  }

  const query = `
            ${FillEventCreatedEventHandler.buildBaseQuery()}
            WHERE is_deleted = 0
            AND (timestamp >= $/fromTimestamp/ AND timestamp <= $/toTimestamp/) 
            ${continuationFilter}
            ORDER BY timestamp ${sortDirection}, tx_hash ${sortDirection}, log_index ${sortDirection}, batch_index ${sortDirection}
            LIMIT $/limit/;  
          `;

  const results = await ridb.manyOrNone(query, {
    timestamp: cursor?.timestamp || null,
    txHash: cursor?.txHash ? toBuffer(cursor.txHash) : null,
    logIndex: cursor?.logIndex,
    batchIndex: cursor?.batchIndex,
    fromTimestamp,
    toTimestamp,
    limit,
  });

  if (results.length) {
    for (const result of results) {
      const eventHandler = new FillEventCreatedEventHandler(
        result.event_tx_hash,
        result.event_log_index,
        result.event_batch_index
      );

      const activity = eventHandler.buildDocument(result);

      activities.push(activity);
    }

    const lastResult = results[results.length - 1];

    nextCursor = {
      timestamp: lastResult.event_timestamp,
      txHash: fromBuffer(lastResult.event_tx_hash),
      logIndex: lastResult.event_log_index,
      batchIndex: lastResult.event_batch_index,
    };
  }

  return { activities, nextCursor };
};

const getTransferActivities = async (
  fromTimestamp: number,
  toTimestamp: number,
  cursor?: EventCursorInfo,
  limit = 1000,
  sortDirection = "DESC"
) => {
  const activities = [];
  let nextCursor: EventCursorInfo | undefined;

  let continuationFilter = "";

  if (cursor) {
    continuationFilter = `AND (timestamp, tx_hash, log_index, batch_index) ${
      sortDirection == "DESC" ? "<" : ">"
    } ($/timestamp/, $/txHash/, $/logIndex/, $/batchIndex/)`;
  }

  const query = `
            ${NftTransferEventCreatedEventHandler.buildBaseQuery()}
            WHERE NOT EXISTS (
             SELECT 1
             FROM   fill_events_2 fe
             WHERE  fe.tx_hash = nft_transfer_events.tx_hash
             AND    fe.log_index = nft_transfer_events.log_index
             AND    fe.batch_index = nft_transfer_events.batch_index
             )
            AND (timestamp >= $/fromTimestamp/ AND timestamp <= $/toTimestamp/) 
            AND is_deleted = 0
            ${continuationFilter}
            ORDER BY timestamp ${sortDirection}, tx_hash ${sortDirection}, log_index ${sortDirection}, batch_index ${sortDirection}
            LIMIT $/limit/;  
          `;

  const results = await ridb.manyOrNone(query, {
    timestamp: cursor?.timestamp || null,
    txHash: cursor?.txHash ? toBuffer(cursor.txHash) : null,
    logIndex: cursor?.logIndex,
    batchIndex: cursor?.batchIndex,
    fromTimestamp,
    toTimestamp,
    limit,
  });

  if (results.length) {
    for (const result of results) {
      const eventHandler = new NftTransferEventCreatedEventHandler(
        result.event_tx_hash,
        result.event_log_index,
        result.event_batch_index
      );

      const activity = eventHandler.buildDocument(result);

      if (
        activity.type === ActivityType.nftMint &&
        isAfter(new Date(activity.createdAt), add(Date.now(), { days: -7 }))
      ) {
        const existingActivity = await ActivitiesIndex.getActivityById(activity.id);

        if (existingActivity) {
          activity.event = existingActivity.event;
        }
      }

      activities.push(activity);
    }

    const lastResult = results[results.length - 1];

    nextCursor = {
      timestamp: lastResult.event_timestamp,
      txHash: fromBuffer(lastResult.event_tx_hash),
      logIndex: lastResult.event_log_index,
      batchIndex: lastResult.event_batch_index,
    };
  }

  return { activities, nextCursor };
};

const getFtTransferActivities = async (
  fromTimestamp: number,
  toTimestamp: number,
  cursor?: EventCursorInfo,
  limit = 1000,
  sortDirection = "DESC"
) => {
  const activities = [];
  let nextCursor: EventCursorInfo | undefined;

  let continuationFilter = "";

  if (cursor) {
    continuationFilter = `AND (updated_at, tx_hash, log_index) ${
      sortDirection == "DESC" ? "<" : ">"
    } (to_timestamp($/timestamp/), $/txHash/, $/logIndex/)`;
  }

  const query = `
            ${FtTransferEventCreatedEventHandler.buildBaseQuery()}
            WHERE (updated_at >= to_timestamp($/fromTimestamp/) AND updated_at <= to_timestamp($/toTimestamp/)) 
            ${continuationFilter}
            ORDER BY updated_at ${sortDirection}, tx_hash ${sortDirection}, log_index ${sortDirection}
            LIMIT $/limit/;  
          `;

  const results = await ridb.manyOrNone(query, {
    timestamp: cursor?.timestamp || null,
    txHash: cursor?.txHash ? toBuffer(cursor.txHash) : null,
    logIndex: cursor?.logIndex,
    fromTimestamp,
    toTimestamp,
    limit,
  });

  if (results.length) {
    for (const result of results) {
      const eventHandler = new FtTransferEventCreatedEventHandler(
        result.event_tx_hash,
        result.event_log_index
      );

      const activity = eventHandler.buildDocument(result);

      activities.push(activity);
    }

    const lastResult = results[results.length - 1];

    nextCursor = {
      timestamp: lastResult.updated_ts,
      txHash: fromBuffer(lastResult.event_tx_hash),
      logIndex: lastResult.event_log_index,
    };
  }

  return { activities, nextCursor };
};

const getContractCallActivities = async (
  fromTimestamp: number,
  toTimestamp: number,
  cursor?: EventCursorInfo,
  limit = 1000,
  sortDirection = "DESC"
) => {
  const activities = [];
  let nextCursor: EventCursorInfo | undefined;

  let continuationFilter = "";

  if (cursor) {
    continuationFilter = `AND (created_at, hash) ${
      sortDirection == "DESC" ? "<" : ">"
    } (to_timestamp($/timestamp/), $/txHash/)`;
  }

  const query = `
            ${TransactionCreatedEventHandler.buildBaseQuery()}
            WHERE (created_at >= to_timestamp($/fromTimestamp/) AND created_at <= to_timestamp($/toTimestamp/)) 
            ${continuationFilter}
            ORDER BY created_at ${sortDirection}, hash ${sortDirection}
            LIMIT $/limit/;  
          `;

  const results = await ridb.manyOrNone(query, {
    timestamp: cursor?.timestamp || null,
    txHash: cursor?.txHash ? toBuffer(cursor.txHash) : null,
    fromTimestamp,
    toTimestamp,
    limit,
  });

  if (results.length) {
    for (const result of results) {
      const eventHandler = new TransactionCreatedEventHandler(result.event_tx_hash);

      const activity = eventHandler.buildDocument(result);

      activities.push(activity);
    }

    const lastResult = results[results.length - 1];

    nextCursor = {
      timestamp: lastResult.updated_ts,
      txHash: fromBuffer(lastResult.event_tx_hash),
    };
  }

  return { activities, nextCursor };
};
