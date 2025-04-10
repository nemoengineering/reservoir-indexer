import { idb } from "@/common/db";

import { AbstractRabbitMqJobHandler } from "@/jobs/abstract-rabbit-mq-job-handler";
import { RabbitMQMessage } from "@/common/rabbit-mq";
import _ from "lodash";
import { logger } from "@/common/logger";
import { collectionReclacSupplyJob } from "@/jobs/collection-updates/collection-reclac-supply-job";
// import { config } from "@/config/index";
// import { redlock } from "@/common/redis";

export type BackfillCollectionsSupplyJobCursorInfo = {
  collectionId?: string;
  day30Volume?: string;
};

export class BackfillCollectionsSupplyJob extends AbstractRabbitMqJobHandler {
  queueName = "backfill-collections-supply";
  maxRetries = 10;
  concurrency = 1;
  persistent = false;
  lazyMode = false;
  singleActiveConsumer = true;

  public async process(payload: BackfillCollectionsSupplyJobCursorInfo) {
    const { collectionId, day30Volume } = payload;
    const values: {
      limit: number;
      collectionId?: string;
      day30Volume?: string;
    } = {
      limit: 1000,
    };

    let cursor = "";

    if (collectionId && day30Volume) {
      cursor = `AND (day30_volume, id) < ($/day30Volume/, $/collectionId/)`;
      values.day30Volume = day30Volume;
      values.collectionId = collectionId;
    }

    const collections = await idb.manyOrNone(
      `
        SELECT day30_volume, id
        FROM collections
        WHERE (last_mint_timestamp IS NULL OR supply IS NULL OR remaining_supply IS NULL)
        ${cursor}
        ORDER BY collections.day30_volume DESC, id DESC
        LIMIT $/limit/
        `,
      values
    );

    if (collections) {
      await collectionReclacSupplyJob.addToQueue(
        collections.map((c) => ({ collection: c.id })),
        0
      );

      // Check if there are more potential users to sync
      if (collections.length == values.limit) {
        const lastItem = _.last(collections);
        logger.info(this.queueName, `Cursor ${lastItem.day30_volume} - ${lastItem.id}`);

        return {
          addToQueue: true,
          cursor: { day30Volume: lastItem.day30_volume, collectionId: lastItem.id },
        };
      }
    }

    logger.info(this.queueName, `Done updating collections supply`);
    return { addToQueue: false };
  }

  public async onCompleted(
    rabbitMqMessage: RabbitMQMessage,
    processResult: {
      addToQueue: boolean;
      cursor?: BackfillCollectionsSupplyJobCursorInfo;
    }
  ) {
    if (processResult.addToQueue) {
      await this.addToQueue(processResult.cursor, 60 * 1000);
    }
  }

  public async addToQueue(cursor?: BackfillCollectionsSupplyJobCursorInfo, delay = 0) {
    await this.send({ payload: cursor ?? {} }, delay);
  }
}

export const backfillCollectionsSupplyJob = new BackfillCollectionsSupplyJob();

// if (!_.includes([1, 8453, 17069], config.chainId)) {
//   redlock
//     .acquire([`${backfillCollectionsSupplyJob.getQueue()}-lock`], 60 * 60 * 24 * 30 * 1000)
//     .then(async () => {
//       await backfillCollectionsSupplyJob.addToQueue();
//     })
//     .catch(() => {
//       // Skip on any errors
//     });
// }
