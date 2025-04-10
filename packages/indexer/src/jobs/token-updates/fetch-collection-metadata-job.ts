import _ from "lodash";

import { idb, pgp, PgPromiseQuery } from "@/common/db";
import { logger } from "@/common/logger";
import { sanitizeText, toBuffer } from "@/common/utils";
import { config } from "@/config/index";
import { getNetworkSettings } from "@/config/network";
import { AbstractRabbitMqJobHandler, BackoffStrategy } from "@/jobs/abstract-rabbit-mq-job-handler";
import { recalcOwnerCountQueueJob } from "@/jobs/collection-updates/recalc-owner-count-queue-job";
import { recalcTokenCountQueueJob } from "@/jobs/collection-updates/recalc-token-count-queue-job";
import { metadataIndexFetchJob } from "@/jobs/metadata-index/metadata-fetch-job";
import MetadataProviderRouter from "@/metadata/metadata-provider-router";
import * as marketplaceFees from "@/utils/marketplace-fees";
import * as royalties from "@/utils/royalties";
import { isSharedContract } from "@/metadata/extend";

export type FetchCollectionMetadataJobPayload = {
  contract: string;
  tokenId: string;
  mintedTimestamp?: number;
  context?: string;
};

export default class FetchCollectionMetadataJob extends AbstractRabbitMqJobHandler {
  queueName = "token-updates-fetch-collection-metadata-queue";
  maxRetries = 10;
  concurrency = 5;
  backoff = {
    type: "exponential",
    delay: 20000,
  } as BackoffStrategy;

  public async process(payload: FetchCollectionMetadataJobPayload) {
    const { contract, tokenId, mintedTimestamp, context } = payload;

    // Skip any further processing for offchain contracts
    const contractResult = await idb.oneOrNone(
      "SELECT contracts.is_offchain FROM contracts WHERE address = $/contract/",
      { contract: toBuffer(contract) }
    );

    if (contractResult?.is_offchain) {
      return;
    }

    logger.log(
      config.debugMetadataIndexingCollections.includes(contract) ? "info" : "debug",
      this.queueName,
      JSON.stringify({
        topic: "tokenMetadataIndexing",
        message: `Start. contract=${contract}, tokenId=${tokenId}, context=${context}`,
        payload,
        debugMetadataIndexingCollection: config.debugMetadataIndexingCollections.includes(contract),
      })
    );

    try {
      // Fetch collection metadata
      const collection = await MetadataProviderRouter.getCollectionMetadata(contract, tokenId, "", {
        allowFallback: true,
        context,
      });

      if (collection.metadata) {
        _.forOwn(collection.metadata, function (value, key) {
          if (collection.metadata && _.isString(value)) {
            collection.metadata[key] = sanitizeText(value);
          }
        });
      }

      let tokenIdRange: string | null = null;
      if (collection.tokenIdRange) {
        tokenIdRange = `numrange(${collection.tokenIdRange[0]}, ${collection.tokenIdRange[1]}, '[]')`;
      } else if (collection.id === contract) {
        tokenIdRange = `'(,)'::numrange`;
      }

      // For covering the case where the token id range is null
      const tokenIdRangeParam = tokenIdRange ? "$/tokenIdRange:raw/" : "$/tokenIdRange/";

      const queries: PgPromiseQuery[] = [];
      queries.push({
        query: `
          INSERT INTO "collections" (
            "id",
            "slug",
            "name",
            "community",
            "metadata",
            "contract",
            "token_id_range",
            "token_set_id",
            "minted_timestamp",
            "payment_tokens",
            "creator"
          ) VALUES (
            $/id/,
            $/slug/,
            $/name/,
            $/community/,
            $/metadata:json/,
            $/contract/,
            ${tokenIdRangeParam},
            $/tokenSetId/,
            $/mintedTimestamp/,
            $/paymentTokens/,
            $/creator/
          ) ON CONFLICT DO NOTHING;
        `,
        values: {
          id: collection.id,
          slug: collection.slug,
          name: sanitizeText(collection.name) ?? collection.contract,
          community: collection.community,
          metadata: collection.metadata,
          contract: toBuffer(collection.contract),
          tokenIdRange,
          tokenSetId: collection.tokenSetId,
          mintedTimestamp: mintedTimestamp ?? null,
          paymentTokens: collection.paymentTokens ? { opensea: collection.paymentTokens } : {},
          creator: collection.creator ? toBuffer(collection.creator) : null,
        },
      });

      let tokenFilter = `AND "token_id" <@ ${tokenIdRangeParam}`;
      if (_.isNull(tokenIdRange)) {
        tokenFilter = `AND "token_id" = $/tokenId/`;
      }

      // Since this is the first time we run into this collection,
      // we update all tokens that match its token definition
      queries.push({
        query: `
          UPDATE "tokens"
          SET "collection_id" = $/collection/,
              "updated_at" = now()
          WHERE "contract" = $/contract/
          ${tokenFilter}
          AND ("collection_id" IS DISTINCT FROM $/collection/)
        `,
        values: {
          contract: toBuffer(collection.contract),
          tokenIdRange,
          tokenId,
          collection: collection.id,
        },
      });

      // Write the collection to the database
      await idb.none(pgp.helpers.concat(queries));

      // Schedule a job to re-count tokens in the collection
      await recalcTokenCountQueueJob.addToQueue({ collection: collection.id });
      await recalcOwnerCountQueueJob.addToQueue([
        { context: this.queueName, kind: "collectionId", data: { collectionId: collection.id } },
      ]);

      if (collection?.id && !config.disableRealtimeMetadataRefresh) {
        logger.log(
          config.debugMetadataIndexingCollections.includes(contract) ? "info" : "debug",
          this.queueName,
          JSON.stringify({
            topic: "tokenMetadataIndexing",
            message: `metadataIndexFetchJob. contract=${contract}, tokenId=${tokenId}, context=${context}`,
            payload,
            collection,
            metadataMintDelay: getNetworkSettings().metadataMintDelay,
            debugMetadataIndexingCollection:
              config.debugMetadataIndexingCollections.includes(contract),
          })
        );

        await metadataIndexFetchJob.addToQueue(
          [
            {
              kind: "single-token",
              data: {
                method: config.metadataIndexingMethod,
                contract,
                tokenId,
                collection: collection.id,
              },
              context: this.queueName,
            },
          ],
          true,
          getNetworkSettings().metadataMintDelay
        );
      }

      if (collection.hasPerTokenRoyalties) {
        await royalties.clearRoyalties(collection.id);
      } else {
        // Refresh all royalty specs and the default royalties
        await royalties.refreshAllRoyaltySpecs(
          collection.id,
          collection.royalties as royalties.Royalty[] | undefined,
          collection.openseaRoyalties as royalties.Royalty[] | undefined,
          true
        );

        await royalties.refreshDefaultRoyalties(collection.id, this.queueName);
      }

      // Refresh marketplace fees
      await marketplaceFees.updateMarketplaceFeeSpec(
        collection.id,
        "opensea",
        collection.openseaFees as royalties.Royalty[] | undefined
      );
    } catch (error) {
      logger.error(
        this.queueName,
        `Failed to fetch collection metadata ${JSON.stringify(payload)}: ${error}`
      );
      throw error;
    }
  }

  public async addToQueue(infos: FetchCollectionMetadataJobPayload[], delay = 0) {
    await this.sendBatch(
      infos.map((info) => {
        return {
          payload: info,
          jobId: isSharedContract(info.contract)
            ? `${info.contract}-${info.tokenId}`
            : info.contract,
          delay,
        };
      })
    );
  }
}

export const fetchCollectionMetadataJob = new FetchCollectionMetadataJob();
