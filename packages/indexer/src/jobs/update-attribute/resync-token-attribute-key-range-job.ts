import { AbstractRabbitMqJobHandler } from "@/jobs/abstract-rabbit-mq-job-handler";
import { AttributeKeys } from "@/models/attribute-keys";
import _ from "lodash";
import { Tokens } from "@/models/tokens";
import { idb, redb } from "@/common/db";

export type ResyncTokenAttributeKeyRangeJobPayload = {
  contract: string;
  tokenId: string;
};

export default class ResyncTokenAttributeKeyRangeJob extends AbstractRabbitMqJobHandler {
  queueName = "resync-token-attribute-key-range";
  maxRetries = 10;
  concurrency = 3;

  public async process(payload: ResyncTokenAttributeKeyRangeJobPayload) {
    const { contract, tokenId } = payload;

    // Get all number kind attribute keys
    const tokenAttributeNumberKeys = await AttributeKeys.getTokenAttributeKeys(
      contract,
      tokenId,
      "number"
    );

    // If the token has any number kind keys
    if (!_.isEmpty(tokenAttributeNumberKeys)) {
      const tokenAttributes = await Tokens.getTokenAttributes(contract, tokenId);
      for (const tokenAttributeKey of tokenAttributeNumberKeys) {
        const attribute = _.find(
          tokenAttributes,
          (ta) => ta.attributeKeyId === Number(tokenAttributeKey.id)
        );

        if (attribute) {
          // Get the max range
          const newMaxRangeQuery = `
            SELECT value
            FROM "attributes" a 
            WHERE a.attribute_key_id = $/attributeKeyId/
            AND token_count > 0
            AND value IS NOT NULL
            AND value != 'null'
            ORDER BY value::numeric DESC
            LIMIT 1
          `;

          const newMaxRange = await redb.oneOrNone(newMaxRangeQuery, {
            attributeKeyId: tokenAttributeKey.id,
          });

          // Get the min range
          const newMinRangeQuery = `
            SELECT value
            FROM "attributes" a 
            WHERE a.attribute_key_id = $/attributeKeyId/
            AND token_count > 0
            AND value IS NOT NULL
            AND value != 'null'
            ORDER BY value::numeric ASC
            LIMIT 1
          `;

          const newMinRange = await redb.oneOrNone(newMinRangeQuery, {
            attributeKeyId: tokenAttributeKey.id,
          });

          // Update the range
          if (newMaxRange && newMinRange) {
            await idb.none(
              `
              UPDATE attribute_keys
              SET info = info || jsonb_build_object('max_range', $/newMaxRange/, 'min_range', $/newMinRange/)
              WHERE attribute_keys.id = $/attributeKeyId/
            `,
              {
                newMaxRange: newMaxRange.value,
                newMinRange: newMinRange.value,
                attributeKeyId: tokenAttributeKey.id,
              }
            );
          }
        }
      }
    }
  }

  public async addToQueue(
    params: ResyncTokenAttributeKeyRangeJobPayload,
    delay = 0,
    forceRefresh = false
  ) {
    const token = `${params.contract}:${params.tokenId}`;
    const jobId = forceRefresh ? undefined : token;
    await this.send({ payload: params, jobId }, delay);
  }
}

export const resyncTokenAttributeKeyRangeJob = new ResyncTokenAttributeKeyRangeJob();
