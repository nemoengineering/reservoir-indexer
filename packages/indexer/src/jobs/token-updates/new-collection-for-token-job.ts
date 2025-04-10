import { idb, pgp, PgPromiseQuery } from "@/common/db";
import { toBuffer } from "@/common/utils";
import { AbstractRabbitMqJobHandler, BackoffStrategy } from "@/jobs/abstract-rabbit-mq-job-handler";
import { logger } from "@/common/logger";
import { recalcTokenCountQueueJob } from "@/jobs/collection-updates/recalc-token-count-queue-job";
import { recalcOwnerCountQueueJob } from "@/jobs/collection-updates/recalc-owner-count-queue-job";
import { config } from "@/config/index";
import { getNetworkSettings } from "@/config/network";
import { nonFlaggedFloorQueueJob } from "@/jobs/collection-updates/non-flagged-floor-queue-job";
import { collectionNormalizedJob } from "@/jobs/collection-updates/collection-normalized-floor-queue-job";
import { collectionFloorJob } from "@/jobs/collection-updates/collection-floor-queue-job";
import { metadataIndexFetchJob } from "@/jobs/metadata-index/metadata-fetch-job";
import { Collections } from "@/models/collections";
import { updateCollectionDailyVolumeJob } from "@/jobs/collection-updates/update-collection-daily-volume-job";
import { replaceActivitiesCollectionJob } from "@/jobs/elasticsearch/activities/replace-activities-collection-job";
import _ from "lodash";
import * as royalties from "@/utils/royalties";
import * as marketplaceFees from "@/utils/marketplace-fees";
import MetadataProviderRouter from "@/metadata/metadata-provider-router";
import PgPromise from "pg-promise";
import { tokenReassignedUserCollectionsJob } from "@/jobs/nft-balance-updates/token-reassigned-user-collections-job";
import { isSharedContract } from "@/metadata/extend";

export type NewCollectionForTokenJobPayload = {
  contract: string;
  tokenId: string;
  mintedTimestamp?: number;
  newCollectionId: string;
  oldCollectionId: string;
  context?: string;
};

export class NewCollectionForTokenJob extends AbstractRabbitMqJobHandler {
  queueName = "new-collection-for-token";
  maxRetries = 10;
  concurrency = 1;
  backoff = {
    type: "exponential",
    delay: 10000,
  } as BackoffStrategy;

  public async process(payload: NewCollectionForTokenJobPayload) {
    const { contract, tokenId, mintedTimestamp, oldCollectionId } = payload;
    const { newCollectionId } = payload;
    const queries: PgPromiseQuery[] = [];

    try {
      // Fetch collection from local DB
      let collection = await Collections.getById(newCollectionId);

      // If collection not found in the DB
      if (!collection) {
        // Fetch collection metadata
        const collectionMetadata = await MetadataProviderRouter.getCollectionMetadata(
          contract,
          tokenId,
          "",
          {
            context: this.queueName,
          }
        );

        let tokenIdRange: string | null = null;

        if (collectionMetadata.tokenIdRange) {
          // Shared contract
          tokenIdRange = `numrange(${collectionMetadata.tokenIdRange[0]}, ${collectionMetadata.tokenIdRange[1]}, '[]')`;
        } else if (collectionMetadata.id === contract) {
          // Contract wide collection
          tokenIdRange = `'(,)'::numrange`;
        }

        // Check we have a name for the collection
        if (_.isNull(collectionMetadata.name)) {
          logger.warn(this.queueName, `no name for ${JSON.stringify(payload)}`);
          return;
        }

        // For covering the case where the token id range is null
        const tokenIdRangeParam = tokenIdRange ? "$/tokenIdRange:raw/" : "$/tokenIdRange/";

        // Create the collection in the DB
        const insertCollectionQuery = `
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
              "last_mint_timestamp",
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
              $/mintedTimestamp/,
              $/paymentTokens/,
              $/creator/
            ) ON CONFLICT DO NOTHING;
          `;

        const values = {
          id: collectionMetadata.id,
          slug: collectionMetadata.slug,
          name: collectionMetadata.name,
          community: collectionMetadata.community,
          metadata: collectionMetadata.metadata,
          contract: toBuffer(collectionMetadata.contract),
          tokenIdRange,
          tokenSetId: collectionMetadata.tokenSetId,
          mintedTimestamp: mintedTimestamp ?? null,
          paymentTokens: collectionMetadata.paymentTokens
            ? { opensea: collectionMetadata.paymentTokens }
            : {},
          creator: collectionMetadata.creator ? toBuffer(collectionMetadata.creator) : null,
        };

        await idb.none(insertCollectionQuery, values);

        // Retrieve the newly created collection
        collection = await Collections.getById(collectionMetadata.id);

        // If still no collection
        if (!collection) {
          logger.error(
            this.queueName,
            `failed to fetch/create collection ${JSON.stringify(
              payload
            )} collectionMetadata ${JSON.stringify(collectionMetadata)} query ${PgPromise.as.format(
              insertCollectionQuery,
              values
            )}`
          );
          return;
        }

        // As this is a new collection refresh all royalty specs and the default royalties
        await royalties.refreshAllRoyaltySpecs(
          collectionMetadata.id,
          collectionMetadata.royalties as royalties.Royalty[] | undefined,
          collectionMetadata.openseaRoyalties as royalties.Royalty[] | undefined
        );

        await royalties.refreshDefaultRoyalties(collectionMetadata.id, this.queueName);

        // Refresh marketplace fees
        await marketplaceFees.updateMarketplaceFeeSpec(
          collectionMetadata.id,
          "opensea",
          collectionMetadata.openseaFees as royalties.Royalty[] | undefined
        );
      }

      if (collection.id === oldCollectionId) {
        logger.info(
          this.queueName,
          `collection id ${collection.id} same as old collection id ${JSON.stringify(payload)}`
        );
        return;
      }

      // Trigger async job to recalc the daily volumes
      await updateCollectionDailyVolumeJob.addToQueue({
        newCollectionId: collection.id,
        contract,
      });

      // Update the activities to the new collection
      await replaceActivitiesCollectionJob.addToQueue({
        contract,
        tokenId,
        newCollectionId: collection.id,
        oldCollectionId,
      });

      // Update the token new collection
      queries.push({
        query: `
                UPDATE "tokens"
                SET "collection_id" = $/collection/,
                    "updated_at" = now()
                WHERE "contract" = $/contract/
                AND "token_id" = $/tokenId/
                AND ("collection_id" IS DISTINCT FROM $/collection/)
            `,
        values: {
          contract: toBuffer(contract),
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

      if (oldCollectionId) {
        // Update the old collection's token count
        await recalcTokenCountQueueJob.addToQueue({
          collection: oldCollectionId,
        });
      }

      await tokenReassignedUserCollectionsJob.addToQueue({ oldCollectionId, tokenId, contract });

      // If this is a new collection, recalculate floor price
      const floorAskInfo = {
        kind: "revalidation",
        contract,
        tokenId,
        txHash: null,
        txTimestamp: null,
      };

      await Promise.all([
        collectionFloorJob.addToQueue([floorAskInfo]),
        nonFlaggedFloorQueueJob.addToQueue([floorAskInfo]),
        collectionNormalizedJob.addToQueue([floorAskInfo]),
      ]);

      if (!config.disableRealtimeMetadataRefresh) {
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
    } catch (error) {
      logger.error(
        this.queueName,
        `Failed to fetch collection metadata ${JSON.stringify(payload)}: ${error}`
      );
      throw error;
    }
  }

  public async addToQueue(infos: NewCollectionForTokenJobPayload[], jobId = "", delay = 0) {
    await this.sendBatch(
      infos.map((info) => {
        if (jobId === "") {
          // For contracts with multiple collections, we have to include the token in order the fetch the right collection
          jobId = isSharedContract(info.contract)
            ? `${info.contract}-${info.tokenId}`
            : info.contract;
        }

        return {
          payload: info,
          jobId,
          delay,
        };
      })
    );
  }
}

export const newCollectionForTokenJob = new NewCollectionForTokenJob();
