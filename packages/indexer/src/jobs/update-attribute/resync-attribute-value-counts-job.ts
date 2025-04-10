import { AbstractRabbitMqJobHandler } from "@/jobs/abstract-rabbit-mq-job-handler";
import { Tokens } from "@/models/tokens";
import { Attributes } from "@/models/attributes";
import { redb } from "@/common/db";
import { orderRevalidationsJob } from "@/jobs/order-fixes/order-revalidations-job";
import { logger } from "@/common/logger";
import { acquireLock, doesLockExist } from "@/common/redis";

export type ResyncAttributeValueCountsJobPayload = {
  collection: string;
  key: string;
  value: string;
  continuation?: string;
  count?: number;
};

export default class ResyncAttributeValueCountsJob extends AbstractRabbitMqJobHandler {
  queueName = "resync-attribute-value-counts-queue";
  maxRetries = 1;
  concurrency = 3;

  public async process(payload: ResyncAttributeValueCountsJobPayload) {
    const { collection, key, value, continuation } = payload;
    const currentCount = Number(payload.count ?? 0);
    const largeAttributeTokenCount = `large-attribute-lock:${collection}:${key}:${value}`;
    const minLargeAttributeTokenCount = 100000;

    if (collection === "0x251be3a17af4892035c37ebf5890f4a4d889dcad") {
      return;
    }

    // If lock exist skip counting
    if (await doesLockExist(largeAttributeTokenCount)) {
      return;
    }

    const attributeValueCount = await Tokens.getTokenAttributesValueCount(
      collection,
      key,
      value,
      continuation ?? ""
    );

    if (attributeValueCount || currentCount) {
      // If there are more to count
      if (attributeValueCount && attributeValueCount.continuation) {
        await this.addToQueue(
          {
            ...payload,
            continuation: attributeValueCount.continuation,
            count: currentCount + attributeValueCount.count,
          },
          0
        );
      } else {
        // For large attributes count only once a day
        if (currentCount + (attributeValueCount?.count ?? 0) > minLargeAttributeTokenCount) {
          await acquireLock(largeAttributeTokenCount, 60 * 60 * 24 - 5);
        }

        let attributeId = attributeValueCount?.attributeId;

        if (!attributeId && continuation) {
          [attributeId] = continuation.split(":");
        }

        if (attributeId) {
          await Attributes.update(Number(attributeId), {
            tokenCount: currentCount + (attributeValueCount?.count ?? 0),
          });
        }
      }
    } else {
      // Clean the attribute
      const attribute = await Attributes.getAttributeByCollectionKeyValue(collection, key, value);

      if (attribute) {
        await Attributes.delete(attribute.id);

        try {
          // Invalidate any active orders that are associated with this attribute.
          const query = `
            SELECT 
              orders.id 
            FROM 
              orders 
              JOIN token_sets ON orders.token_set_id = token_sets.id 
            WHERE 
              orders.side = 'buy' 
              AND orders.fillability_status = 'fillable' 
              AND orders.approval_status = 'approved' 
              AND token_sets.attribute_id = $/attributeId/
          `;

          const values = {
            attributeId: attribute.id,
          };

          const orders = await redb.manyOrNone(query, values);

          if (orders.length) {
            logger.info(
              this.queueName,
              JSON.stringify({
                message: `Invalidating orders. collection=${collection}, key=${key}, value=${value}, attributeId=${attribute.id}`,
                attribute,
                orders,
              })
            );

            await orderRevalidationsJob.addToQueue(
              orders.map((order) => ({
                by: "id",
                data: { id: order.id, status: "inactive" },
              }))
            );
          }
        } catch (error) {
          logger.error(
            this.queueName,
            JSON.stringify({
              message: `Invalidating orders error. collection=${collection}, key=${key}, value=${value}, attributeId=${attribute.id}`,
              attribute,
              error,
            })
          );
        }
      }
    }
  }

  public async addToQueue(params: ResyncAttributeValueCountsJobPayload, delay = 60 * 60 * 1000) {
    const jobId = delay ? `${params.collection}:${params.key}:${params.value}` : undefined;
    await this.send({ payload: params, jobId }, delay);
  }
}

export const resyncAttributeValueCountsJob = new ResyncAttributeValueCountsJob();
