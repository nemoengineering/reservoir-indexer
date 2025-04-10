import { idb } from "@/common/db";

import { AbstractRabbitMqJobHandler } from "@/jobs/abstract-rabbit-mq-job-handler";
import { RabbitMQMessage } from "@/common/rabbit-mq";
import { logger } from "@/common/logger";
import { Sources } from "@/models/sources";
import _ from "lodash";
import {
  orderRevalidationsJob,
  OrderRevalidationsJobPayload,
} from "@/jobs/order-fixes/order-revalidations-job";

export class BackfillOrdersCleanElementAndOkxJob extends AbstractRabbitMqJobHandler {
  queueName = "backfill-orders-clean-element-and-okx-queue";
  maxRetries = 10;
  concurrency = 1;
  persistent = false;
  lazyMode = false;
  singleActiveConsumer = true;

  public async process() {
    const limit = 1000;

    const sources = await Sources.getInstance();

    const sourceIds = ["okx.com", "element.market"]
      .map((source: string) => sources.getByDomain(source)?.id ?? 0)
      .filter((id: number) => id != 0);

    if (_.isEmpty(sourceIds)) {
      logger.error(
        this.queueName,
        JSON.stringify({
          message: `Error fetching sourceIds`,
        })
      );
      return { addToQueue: false };
    }

    const results = await idb.manyOrNone(
      `
        SELECT
            orders.id
          FROM 
            orders 
          WHERE 
            orders.source_id_int IN ($/sourceIds:csv/)
          AND orders.kind IN ('element-erc721', 'element-erc1155', 'okex')
          AND orders.fillability_status = 'fillable' 
          AND orders.approval_status = 'approved'
          LIMIT 
            $/limit/
          `,
      {
        sourceIds,
        limit,
      }
    );

    if (_.isEmpty(results)) {
      return { addToQueue: false };
    }

    const orderRevalidationsJobPayload = results.map((result: { id: string }) => {
      return {
        by: "id",
        data: {
          id: result.id,
          status: "inactive",
        },
      } as OrderRevalidationsJobPayload;
    });

    await orderRevalidationsJob.addToQueue(orderRevalidationsJobPayload);

    logger.info(
      this.queueName,
      JSON.stringify({
        message: `Added ${results.length} orders to revalidation queue.`,
      })
    );

    if (results.length < limit) {
      return { addToQueue: false };
    } else {
      return { addToQueue: true };
    }
  }

  public async onCompleted(
    rabbitMqMessage: RabbitMQMessage,
    processResult: {
      addToQueue: boolean;
      offset?: number;
    }
  ) {
    if (processResult.addToQueue) {
      await new Promise((resolve) => setTimeout(resolve, 30000));
      await this.addToQueue();
    }
  }

  public async addToQueue() {
    await this.send();
  }
}

export const backfillOrdersCleanElementAndOkxJob = new BackfillOrdersCleanElementAndOkxJob();
