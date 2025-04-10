/* eslint-disable @typescript-eslint/no-explicit-any */

import { idb, pgp, redb } from "@/common/db";
import { toBuffer } from "@/common/utils";
import { AbstractRabbitMqJobHandler } from "@/jobs/abstract-rabbit-mq-job-handler";
import _ from "lodash";
import { AttributeKeys } from "@/models/attribute-keys";
import { Tokens } from "@/models/tokens";
import { rarityQueueJob } from "@/jobs/collection-updates/rarity-queue-job";

export type BurnedTokenJobPayload = {
  contract: string;
  tokenId: string;
};

export default class BurnedTokenJob extends AbstractRabbitMqJobHandler {
  queueName = "burned-token";
  maxRetries = 0;
  concurrency = 1;

  public async process(payload: BurnedTokenJobPayload) {
    const { contract, tokenId } = payload;
    const queries = [];
    const collection = await Tokens.getCollection(contract, tokenId);

    if (collection) {
      queries.push(`
        UPDATE collections SET
          token_count = GREATEST(token_count - 1, 0),
          updated_at = now()
        WHERE id = $/collection/
      `);
    }

    queries.push(`
      UPDATE attributes SET
        token_count = GREATEST(token_count - 1, 0),
        updated_at = now()
      WHERE id IN (
        SELECT attributes.id
        FROM token_attributes ta
        JOIN attributes ON ta.attribute_id = attributes.id
        WHERE ta.contract = $/contract/
        AND ta.token_id = $/tokenId/
        AND ta.key != ''
      )
    `);

    // Update rarity
    queries.push(`
      UPDATE tokens SET
        rarity_score = null,
        rarity_rank = null,
        updated_at = now()
      WHERE contract = $/contract/
      AND token_id = $/tokenId/
      AND remaining_supply = 0
    `);

    if (!_.isEmpty(queries)) {
      await idb.none(pgp.helpers.concat(queries), {
        contract: toBuffer(contract),
        tokenId,
        collection: collection?.id,
      });
    }

    if (collection) {
      // Recalc rarity for the collection
      await rarityQueueJob.addToQueue({ collectionId: collection.id });
    }

    // Update token keys number ranges
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

        if (
          attribute &&
          tokenAttributeKey.info?.max_range &&
          Number(attribute.value) >= tokenAttributeKey.info.max_range
        ) {
          // If there's a new max range
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

          if (newMaxRange) {
            await idb.none(
              `
              UPDATE attribute_keys
              SET info = jsonb_set(info, '{max_range}', $/newMaxRange/)
              WHERE attribute_keys.id = $/attributeKeyId/
            `,
              { newMaxRange: newMaxRange.value, attributeKeyId: tokenAttributeKey.id }
            );
          }
        } else if (
          attribute &&
          tokenAttributeKey.info?.min_range &&
          Number(attribute.value) <= tokenAttributeKey.info.min_range
        ) {
          // If there's a new min range
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

          if (newMinRange) {
            await idb.none(
              `
              UPDATE attribute_keys
              SET info = jsonb_set(info, '{min_range}', $/newMinRange/)
              WHERE attribute_keys.id = $/attributeKeyId/
            `,
              { newMinRange: newMinRange.value, attributeKeyId: tokenAttributeKey.id }
            );
          }
        }
      }
    }
  }

  public async addToQueue(tokens: BurnedTokenJobPayload[]) {
    await this.sendBatch(tokens.map((t) => ({ payload: t, jobId: `${t.contract}:${t.tokenId}` })));
  }
}

export const burnedTokenJob = new BurnedTokenJob();
