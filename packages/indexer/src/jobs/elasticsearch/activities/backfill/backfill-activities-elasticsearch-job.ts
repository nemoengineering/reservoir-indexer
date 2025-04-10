import { config } from "@/config/index";
import { logger } from "@/common/logger";
import { ridb } from "@/common/db";

import { AbstractRabbitMqJobHandler } from "@/jobs/abstract-rabbit-mq-job-handler";

import { backfillSaveActivitiesElasticsearchJob } from "@/jobs/elasticsearch/activities/backfill/backfill-save-activities-elasticsearch-job";

import { getChainName } from "@/config/network";
import * as ActivitiesIndex from "@/elasticsearch/indexes/activities";

export class BackfillActivitiesElasticsearchJob extends AbstractRabbitMqJobHandler {
  queueName = "backfill-activities-elasticsearch-queue";
  maxRetries = 10;
  concurrency = 1;
  persistent = true;

  public async process(payload: BackfillActivitiesElasticsearchJobPayload) {
    logger.info(
      this.queueName,
      JSON.stringify({
        topic: "backfillElasticsearch",
        message: `Start.`,
        payload,
      })
    );

    const { clusterUrl, clusterUsername, clusterPassword, keepGoing } = payload;

    let indexName: string;

    if (payload.indexName) {
      indexName = `${getChainName()}.${payload.indexName}`;
    } else {
      indexName = ActivitiesIndex.getIndexName();
    }

    const promises = [];

    const backfillTransferActivities = async () => {
      const query =
        "SELECT min(timestamp) AS min_timestamp, MAX(timestamp) AS max_timestamp from nft_transfer_events where is_deleted = 0;";

      const timestamps = await ridb.oneOrNone(query);
      const startTimestamp = payload.fromTimestamp || timestamps.min_timestamp;
      const endTimestamp = payload.toTimestamp || timestamps.max_timestamp;

      if (keepGoing && payload.fromTimestamp) {
        await backfillSaveActivitiesElasticsearchJob.addToQueue(
          "transfer",
          undefined,
          startTimestamp,
          undefined,
          clusterUrl,
          clusterUsername,
          clusterPassword,
          indexName,
          true,
          payload.upsert,
          payload.sortDirection
        );
      } else {
        await backfillSaveActivitiesElasticsearchJob.addToQueue(
          "transfer",
          undefined,
          startTimestamp,
          endTimestamp,
          clusterUrl,
          clusterUsername,
          clusterPassword,
          indexName,
          false,
          payload.upsert,
          payload.sortDirection
        );

        if (keepGoing) {
          await backfillSaveActivitiesElasticsearchJob.addToQueue(
            "transfer",
            undefined,
            endTimestamp,
            undefined,
            clusterUrl,
            clusterUsername,
            clusterPassword,
            indexName,
            true,
            payload.upsert,
            payload.sortDirection
          );
        }
      }
    };

    const backfillSaleActivities = async () => {
      const query =
        "SELECT min(timestamp) AS min_timestamp, MAX(timestamp) AS max_timestamp from fill_events_2 where is_deleted = 0;";

      const timestamps = await ridb.oneOrNone(query);
      const fromTimestamp = payload.fromTimestamp || timestamps.min_timestamp;
      const endTimestamp = payload.toTimestamp || timestamps.max_timestamp;

      if (keepGoing && payload.fromTimestamp) {
        await backfillSaveActivitiesElasticsearchJob.addToQueue(
          "sale",
          undefined,
          fromTimestamp,
          undefined,
          clusterUrl,
          clusterUsername,
          clusterPassword,
          indexName,
          true,
          payload.upsert,
          payload.sortDirection
        );
      } else {
        await backfillSaveActivitiesElasticsearchJob.addToQueue(
          "sale",
          undefined,
          fromTimestamp,
          endTimestamp,
          clusterUrl,
          clusterUsername,
          clusterPassword,
          indexName,
          false,
          payload.upsert,
          payload.sortDirection
        );

        if (keepGoing) {
          await backfillSaveActivitiesElasticsearchJob.addToQueue(
            "sale",
            undefined,
            endTimestamp,
            undefined,
            clusterUrl,
            clusterUsername,
            clusterPassword,
            indexName,
            true,
            payload.upsert,
            payload.sortDirection
          );
        }
      }
    };

    const backfillAskActivities = async () => {
      const query =
        "SELECT extract(epoch from min(updated_at)) AS min_timestamp, extract(epoch from max(updated_at)) AS max_timestamp from orders WHERE side = 'sell';";

      const timestamps = await ridb.oneOrNone(query);
      const fromTimestamp = payload.fromTimestamp || timestamps.min_timestamp;
      const endTimestamp = payload.toTimestamp || timestamps.max_timestamp;

      if (keepGoing && payload.fromTimestamp) {
        await backfillSaveActivitiesElasticsearchJob.addToQueue(
          "ask",
          undefined,
          fromTimestamp,
          undefined,
          clusterUrl,
          clusterUsername,
          clusterPassword,
          indexName,
          true,
          payload.upsert,
          payload.sortDirection
        );
      } else {
        await backfillSaveActivitiesElasticsearchJob.addToQueue(
          "ask",
          undefined,
          fromTimestamp,
          endTimestamp,
          clusterUrl,
          clusterUsername,
          clusterPassword,
          indexName,
          false,
          payload.upsert,
          payload.sortDirection
        );

        if (keepGoing) {
          await backfillSaveActivitiesElasticsearchJob.addToQueue(
            "ask",
            undefined,
            endTimestamp,
            undefined,
            clusterUrl,
            clusterUsername,
            clusterPassword,
            indexName,
            true,
            payload.upsert,
            payload.sortDirection
          );
        }
      }
    };

    const backfillAskCancelActivities = async () => {
      const query =
        "SELECT extract(epoch from min(updated_at)) AS min_timestamp, extract(epoch from max(updated_at)) AS max_timestamp from orders WHERE side = 'sell' AND fillability_status = 'cancelled';";

      const timestamps = await ridb.oneOrNone(query);
      const fromTimestamp = payload.fromTimestamp || timestamps.min_timestamp;
      const endTimestamp = payload.toTimestamp || timestamps.max_timestamp;

      if (keepGoing && payload.fromTimestamp) {
        await backfillSaveActivitiesElasticsearchJob.addToQueue(
          "ask-cancel",
          undefined,
          fromTimestamp,
          undefined,
          clusterUrl,
          clusterUsername,
          clusterPassword,
          indexName,
          true,
          payload.upsert,
          payload.sortDirection
        );
      } else {
        await backfillSaveActivitiesElasticsearchJob.addToQueue(
          "ask-cancel",
          undefined,
          fromTimestamp,
          endTimestamp,
          clusterUrl,
          clusterUsername,
          clusterPassword,
          indexName,
          false,
          payload.upsert,
          payload.sortDirection
        );

        if (keepGoing) {
          await backfillSaveActivitiesElasticsearchJob.addToQueue(
            "ask-cancel",
            undefined,
            endTimestamp,
            undefined,
            clusterUrl,
            clusterUsername,
            clusterPassword,
            indexName,
            true,
            payload.upsert,
            payload.sortDirection
          );
        }
      }
    };

    const backfillBidActivities = async () => {
      const query =
        "SELECT extract(epoch from min(updated_at)) AS min_timestamp, extract(epoch from max(updated_at)) AS max_timestamp from orders WHERE side = 'buy';";

      const timestamps = await ridb.oneOrNone(query);
      const fromTimestamp = payload.fromTimestamp || timestamps.min_timestamp;
      const endTimestamp = payload.toTimestamp || timestamps.max_timestamp;

      if (keepGoing && payload.fromTimestamp) {
        await backfillSaveActivitiesElasticsearchJob.addToQueue(
          "bid",
          undefined,
          fromTimestamp,
          undefined,
          clusterUrl,
          clusterUsername,
          clusterPassword,
          indexName,
          true,
          payload.upsert,
          payload.sortDirection
        );
      } else {
        await backfillSaveActivitiesElasticsearchJob.addToQueue(
          "bid",
          undefined,
          fromTimestamp,
          endTimestamp,
          clusterUrl,
          clusterUsername,
          clusterPassword,
          indexName,
          false,
          payload.upsert,
          payload.sortDirection
        );

        if (keepGoing) {
          await backfillSaveActivitiesElasticsearchJob.addToQueue(
            "bid",
            undefined,
            endTimestamp,
            undefined,
            clusterUrl,
            clusterUsername,
            clusterPassword,
            indexName,
            true,
            payload.upsert,
            payload.sortDirection
          );
        }
      }
    };

    const backfillBidCancelActivities = async () => {
      const query =
        "SELECT extract(epoch from min(updated_at)) AS min_timestamp, extract(epoch from max(updated_at)) AS max_timestamp from orders WHERE side = 'buy' AND fillability_status = 'cancelled';";

      const timestamps = await ridb.oneOrNone(query);
      const fromTimestamp = payload.fromTimestamp || timestamps.min_timestamp;
      const endTimestamp = payload.toTimestamp || timestamps.max_timestamp;

      if (keepGoing && payload.fromTimestamp) {
        await backfillSaveActivitiesElasticsearchJob.addToQueue(
          "bid-cancel",
          undefined,
          fromTimestamp,
          undefined,
          clusterUrl,
          clusterUsername,
          clusterPassword,
          indexName,
          true,
          payload.upsert,
          payload.sortDirection
        );
      } else {
        await backfillSaveActivitiesElasticsearchJob.addToQueue(
          "bid-cancel",
          undefined,
          fromTimestamp,
          endTimestamp,
          clusterUrl,
          clusterUsername,
          clusterPassword,
          indexName,
          false,
          payload.upsert,
          payload.sortDirection
        );

        if (keepGoing) {
          await backfillSaveActivitiesElasticsearchJob.addToQueue(
            "bid-cancel",
            undefined,
            endTimestamp,
            undefined,
            clusterUrl,
            clusterUsername,
            clusterPassword,
            indexName,
            true,
            payload.upsert,
            payload.sortDirection
          );
        }
      }
    };

    const backfillFtTransferActivities = async () => {
      const query =
        "SELECT extract(epoch from min(updated_at)) AS min_timestamp, extract(epoch from max(updated_at)) AS max_timestamp from ft_transfer_events;";

      const timestamps = await ridb.oneOrNone(query);
      const startTimestamp = payload.fromTimestamp || timestamps.min_timestamp;
      const endTimestamp = payload.toTimestamp || timestamps.max_timestamp;

      if (keepGoing && payload.fromTimestamp) {
        await backfillSaveActivitiesElasticsearchJob.addToQueue(
          "ft_transfer",
          undefined,
          startTimestamp,
          undefined,
          clusterUrl,
          clusterUsername,
          clusterPassword,
          indexName,
          true,
          payload.upsert,
          payload.sortDirection
        );
      } else {
        await backfillSaveActivitiesElasticsearchJob.addToQueue(
          "ft_transfer",
          undefined,
          startTimestamp,
          endTimestamp,
          clusterUrl,
          clusterUsername,
          clusterPassword,
          indexName,
          false,
          payload.upsert,
          payload.sortDirection
        );

        if (keepGoing) {
          await backfillSaveActivitiesElasticsearchJob.addToQueue(
            "ft_transfer",
            undefined,
            endTimestamp,
            undefined,
            clusterUrl,
            clusterUsername,
            clusterPassword,
            indexName,
            true,
            payload.upsert,
            payload.sortDirection
          );
        }
      }
    };

    const backfillContractCallActivities = async () => {
      const query =
        "SELECT extract(epoch from min(created_at)) AS min_timestamp, extract(epoch from max(created_at)) AS max_timestamp from transactions;";

      const timestamps = await ridb.oneOrNone(query);
      const startTimestamp = payload.fromTimestamp || timestamps.min_timestamp;
      const endTimestamp = payload.toTimestamp || timestamps.max_timestamp;

      if (keepGoing && payload.fromTimestamp) {
        await backfillSaveActivitiesElasticsearchJob.addToQueue(
          "contract_call",
          undefined,
          startTimestamp,
          undefined,
          clusterUrl,
          clusterUsername,
          clusterPassword,
          indexName,
          true,
          payload.upsert,
          payload.sortDirection
        );
      } else {
        await backfillSaveActivitiesElasticsearchJob.addToQueue(
          "contract_call",
          undefined,
          startTimestamp,
          endTimestamp,
          clusterUrl,
          clusterUsername,
          clusterPassword,
          indexName,
          false,
          payload.upsert,
          payload.sortDirection
        );

        if (keepGoing) {
          await backfillSaveActivitiesElasticsearchJob.addToQueue(
            "contract_call",
            undefined,
            endTimestamp,
            undefined,
            clusterUrl,
            clusterUsername,
            clusterPassword,
            indexName,
            true,
            payload.upsert,
            payload.sortDirection
          );
        }
      }
    };

    if (payload.backfillTransferActivities) {
      promises.push(backfillTransferActivities());
    }

    if (payload.backfillSaleActivities) {
      promises.push(backfillSaleActivities());
    }

    if (payload.backfillAskActivities) {
      promises.push(backfillAskActivities());
    }

    if (payload.backfillAskCancelActivities) {
      promises.push(backfillAskCancelActivities());
    }

    if (payload.backfillBidActivities) {
      promises.push(backfillBidActivities());
    }

    if (payload.backfillBidCancelActivities) {
      promises.push(backfillBidCancelActivities());
    }

    if (payload.backfillFtTransferActivities) {
      promises.push(backfillFtTransferActivities());
    }

    if (payload.backfillContractCallActivities) {
      promises.push(backfillContractCallActivities());
    }

    if (promises.length) {
      await Promise.all(promises);
    }
  }

  public async addToQueue(
    clusterUrl = "",
    clusterUsername = "",
    clusterPassword = "",
    indexName = "",
    keepGoing = false,
    backfillTransferActivities = false,
    backfillSaleActivities = false,
    backfillAskActivities = false,
    backfillAskCancelActivities = false,
    backfillBidActivities = false,
    backfillBidCancelActivities = false,
    backfillFtTransferActivities = false,
    backfillContractCallActivities = false,
    fromTimestamp?: number,
    toTimestamp?: number,
    upsert?: boolean,
    sortDirection?: "ASC" | "DESC"
  ) {
    if (!config.doElasticsearchWork) {
      return;
    }

    await this.send({
      payload: {
        clusterUrl,
        clusterUsername,
        clusterPassword,
        indexName,
        keepGoing,
        backfillTransferActivities,
        backfillSaleActivities,
        backfillAskActivities,
        backfillAskCancelActivities,
        backfillBidActivities,
        backfillBidCancelActivities,
        backfillFtTransferActivities,
        backfillContractCallActivities,
        fromTimestamp,
        toTimestamp,
        upsert,
        sortDirection,
      },
    });
  }
}

export const backfillActivitiesElasticsearchJob = new BackfillActivitiesElasticsearchJob();

export type BackfillActivitiesElasticsearchJobPayload = {
  clusterUrl?: string;
  clusterUsername?: string;
  clusterPassword?: string;
  indexName?: string;
  keepGoing?: boolean;
  backfillTransferActivities?: boolean;
  backfillSaleActivities?: boolean;
  backfillAskActivities?: boolean;
  backfillAskCancelActivities?: boolean;
  backfillBidActivities?: boolean;
  backfillBidCancelActivities?: boolean;
  backfillFtTransferActivities?: boolean;
  backfillContractCallActivities?: boolean;
  fromTimestamp?: number;
  toTimestamp?: number;
  upsert?: boolean;
  sortDirection?: "ASC" | "DESC";
};

export interface OrderCursorInfo {
  updatedAt: string;
  id: string;
}

export interface EventCursorInfo {
  timestamp: string;
  txHash: string;
  logIndex?: number;
  batchIndex?: string;
}
