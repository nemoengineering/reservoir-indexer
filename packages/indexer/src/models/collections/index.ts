import * as Sdk from "@reservoir0x/sdk";
import _ from "lodash";

import { idb, redb } from "@/common/db";
import { logger } from "@/common/logger";
import { redis } from "@/common/redis";
import { toBuffer, now } from "@/common/utils";
import { config } from "@/config/index";
import MetadataProviderRouter from "@/metadata/metadata-provider-router";
import {
  CollectionsEntity,
  CollectionsEntityParams,
  CollectionsEntityUpdateParams,
} from "@/models/collections/collections-entity";
import { Contracts } from "@/models/contracts";
import { updateBlurRoyalties } from "@/utils/blur";
import * as erc721c from "@/utils/erc721c";
import * as marketplaceBlacklist from "@/utils/marketplace-blacklists";
import * as marketplaceFees from "@/utils/marketplace-fees";
import * as paymentProcessor from "@/utils/payment-processor";
import * as paymentProcessorRegistry from "@/utils/payment-processor-registry";
import * as paymentProcessorV2 from "@/utils/payment-processor-v2";
import * as royalties from "@/utils/royalties";
import { checkContractHasStakingKeywords } from "@/utils/staking-detection";
import { Network } from "@reservoir0x/sdk/dist/utils";
import { recalcOwnerCountQueueJob } from "@/jobs/collection-updates/recalc-owner-count-queue-job";
import { recalcTokenCountQueueJob } from "@/jobs/collection-updates/recalc-token-count-queue-job";
import {
  topBidCollectionJob,
  TopBidCollectionJobPayload,
} from "@/jobs/collection-updates/top-bid-collection-job";
import {
  ActionsLogContext,
  ActionsLogOrigin,
  actionsLogJob,
} from "@/jobs/general-tracking/actions-log-job";
import { orderUpdatesByIdJob } from "@/jobs/order-updates/order-updates-by-id-job";
import { fetchCollectionMetadataJob } from "@/jobs/token-updates/fetch-collection-metadata-job";
import { Tokens } from "@/models/tokens";
import { getContractOwner } from "@/jobs/collections/utils";

export class Collections {
  public static async getById(collectionId: string, readReplica = false) {
    const dbInstance = readReplica ? redb : idb;
    const collection: CollectionsEntityParams | null = await dbInstance.oneOrNone(
      `
        SELECT
          *
        FROM collections
        WHERE id = $/collectionId/
      `,
      { collectionId }
    );

    if (collection) {
      return new CollectionsEntity(collection);
    }

    return null;
  }

  public static async getByContractAndTokenId(
    contract: string,
    tokenId: number,
    readReplica = false
  ) {
    const dbInstance = readReplica ? redb : idb;
    const collection: CollectionsEntityParams | null = await dbInstance.oneOrNone(
      `
        SELECT
          *
        FROM collections
        WHERE collections.contract = $/contract/
          AND collections.token_id_range @> $/tokenId/::NUMERIC(78, 0)
        ORDER BY collections.created_at DESC
        LIMIT 1
      `,
      {
        contract: toBuffer(contract),
        tokenId,
      }
    );

    if (collection) {
      return new CollectionsEntity(collection);
    }

    return null;
  }

  public static async getByTokenSetId(tokenSetId: string) {
    const collection: CollectionsEntityParams | null = await redb.oneOrNone(
      `
        SELECT
          *
        FROM collections
        WHERE token_set_id = $/tokenSetId/
      `,
      { tokenSetId }
    );

    if (collection) {
      return new CollectionsEntity(collection);
    }

    return null;
  }

  public static async updateCollectionCache(
    contract: string,
    tokenId: string,
    community = "",
    automaticRefresh = false
  ) {
    const startTimestamp = now();

    logger.log(
      config.debugMetadataIndexingCollections.includes(contract) ? "info" : "debug",
      "updateCollectionCache",
      JSON.stringify({
        topic: "tokenMetadataIndexing",
        message: `Start. contract=${contract}, tokenId=${tokenId}, automaticRefresh=${automaticRefresh}`,
        debugMetadataIndexingCollection: config.debugMetadataIndexingCollections.includes(contract),
      })
    );

    try {
      await Contracts.updateContractMetadata(contract);
    } catch (error) {
      logger.error(
        "updateCollectionCache",
        `updateContractMetadataError. contract=${contract}, tokenId=${tokenId}, community=${community}`
      );
    }

    const collectionResult = await idb.oneOrNone(
      `
        SELECT
          collections.id,
          collections.is_spam AS "isSpam",
          collections.metadata,
          contracts.is_offchain
        FROM tokens
        JOIN contracts
          ON tokens.contract = contracts.address
        JOIN collections
          ON tokens.collection_id = collections.id
        WHERE tokens.contract = $/contract/
          AND tokens.token_id = $/tokenId/
      `,
      {
        contract: toBuffer(contract),
        tokenId,
      }
    );

    // Skip any further processing for offchain contracts
    if (collectionResult?.is_offchain) {
      return;
    }

    let contractOwner;

    if (!collectionResult?.id) {
      const _tokenId = await Tokens.getSingleToken(contract);

      logger.info(
        "updateCollectionCache",
        JSON.stringify({
          message: `fetchCollectionMetadataJob fallback. contract=${contract}, tokenId=${tokenId}, community=${community}`,
          hasToken: !!_tokenId,
        })
      );

      if (_tokenId) {
        // If the collection doesn't exist, push a job to retrieve it
        await fetchCollectionMetadataJob.addToQueue([
          {
            contract,
            tokenId,
            context: "updateCollectionCache",
          },
        ]);

        return;
      }

      contractOwner = await getContractOwner(contract);
    }

    const collection = await MetadataProviderRouter.getCollectionMetadata(
      contract,
      tokenId,
      community,
      {
        context: "updateCollectionCache",
      }
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let collectionMetadata: any = {};

    if (collectionResult?.metadata != null) {
      collectionMetadata = { ...collectionResult.metadata }; // Start with all values from db

      if (collection.metadata != null) {
        // Update with new values
        for (const key in collection.metadata) {
          if (collection.metadata[key] != null) {
            collectionMetadata[key] = collection.metadata[key];
          }
        }
      } else {
        logger.warn(
          "updateCollectionCache",
          JSON.stringify({
            message: `InvalidUpdateCollectionCache. contract=${contract}, tokenId=${tokenId}, community=${community}`,
            collection,
            collectionResult,
          })
        );
      }
    } else if (collection.metadata != null) {
      collectionMetadata = { ...collection.metadata };
    }

    // If no image use one of the tokens images
    if (_.isEmpty(collectionMetadata?.imageUrl)) {
      const tokenImageQuery = `
        SELECT image FROM tokens
        WHERE collection_id = $/collection/
        ORDER BY rarity_rank DESC NULLS LAST
        LIMIT 1
      `;

      const tokenImage = await redb.oneOrNone(tokenImageQuery, { collection: collection.id });

      if (tokenImage?.image) {
        collectionMetadata.imageUrl = tokenImage.image;
      }
    }

    const query = `
      UPDATE collections SET
        metadata = $/metadata:json/,
        name = $/name/,
        slug = $/slug/,
        payment_tokens = $/paymentTokens/,
        creator = COALESCE($/creator/, creator),
        updated_at = now(),
        image_version = CASE WHEN (metadata IS DISTINCT FROM $/metadata:json/) THEN now() ELSE image_version END
      WHERE id = $/id/
        AND (metadata IS DISTINCT FROM $/metadata:json/
        OR name IS DISTINCT FROM $/name/
        OR slug IS DISTINCT FROM $/slug/
        OR payment_tokens IS DISTINCT FROM $/paymentTokens/
        OR ($/creator/ IS NOT NULL AND creator IS DISTINCT FROM $/creator/)
      )
    `;

    const values = {
      id: collection.id,
      metadata: collectionMetadata,
      name: collection.name,
      slug: collection.slug,
      paymentTokens: collection.paymentTokens ? { opensea: collection.paymentTokens } : {},
      creator: collection.creator
        ? toBuffer(collection.creator)
        : contractOwner
        ? toBuffer(contractOwner)
        : null,
    };

    await idb.oneOrNone(query, values);

    logger.log(
      config.chainId === Network.MonadTestnet ||
        config.debugMetadataIndexingCollections.includes(contract)
        ? "info"
        : "debug",
      "updateCollectionCache",
      JSON.stringify({
        topic: "tokenMetadataIndexing",
        message: `Updated. contract=${contract}, tokenId=${tokenId}, latency=${
          now() - startTimestamp
        }, automaticRefresh=${automaticRefresh}`,
        debugMetadataIndexingCollection:
          config.chainId === Network.MonadTestnet ||
          config.debugMetadataIndexingCollections.includes(contract),
        collection,
        collectionMetadata,
        latency: now() - startTimestamp,
      })
    );

    await recalcTokenCountQueueJob.addToQueue({ collection: collection.id });
    await recalcOwnerCountQueueJob.addToQueue([
      {
        context: "updateCollectionCache",
        kind: "collectionId",
        data: { collectionId: collection.id },
      },
    ]);

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
      await royalties.refreshDefaultRoyalties(collection.id, "updateCollectionCache");
    }

    // Refresh Blur royalties (which get stored separately)
    await updateBlurRoyalties(collection.id, true);

    // Soft-staking detection
    const hasStakingKeywords = await checkContractHasStakingKeywords(collection.contract);
    if (hasStakingKeywords) {
      await redis.set(`has-staking-keywords:${collection.contract}`, "1", "EX", 7 * 24 * 3600);
    }

    // Refresh OpenSea marketplace fees
    const openseaFees = collection.openseaFees as royalties.Royalty[] | undefined;
    await marketplaceFees.updateMarketplaceFeeSpec(collection.id, "opensea", openseaFees);

    // Refresh blacklist cache only if manual refresh
    if (!automaticRefresh) {
      // Delete any contract blacklists caches
      await marketplaceBlacklist.deleteCollectionCaches(collection.contract);

      // Refresh any contract blacklists
      await marketplaceBlacklist.checkMarketplaceIsFiltered(collection.contract, [], true);
    }

    // Refresh ERC721C configs
    await erc721c.refreshConfig(collection.contract);

    // Refresh PaymentProcessor configs
    await Promise.all([
      paymentProcessor.getConfigByContract(collection.contract, true),
      paymentProcessorV2.getConfigByContract(collection.contract, true),
      paymentProcessorRegistry.getConfigByContract(
        Sdk.PaymentProcessorV21.Addresses.Exchange[config.chainId],
        collection.contract,
        true
      ),
    ]);
  }

  public static async update(collectionId: string, fields: CollectionsEntityUpdateParams) {
    let updateString = "";
    const replacementValues = {
      collectionId,
    };

    _.forEach(fields, (value, fieldName) => {
      updateString += `${_.snakeCase(fieldName)} = $/${fieldName}/,`;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (replacementValues as any)[fieldName] = value;
    });

    updateString = _.trimEnd(updateString, ",");

    const query = `
      UPDATE collections
        SET updated_at = now(), ${updateString}
      WHERE id = $/collectionId/
    `;

    return await idb.none(query, replacementValues);
  }

  public static async getCollectionsMintedBetween(from: number, to: number, limit = 2000) {
    const query = `
      SELECT
        *
      FROM collections
      WHERE minted_timestamp > ${from}
        AND minted_timestamp < ${to}
      ORDER BY minted_timestamp ASC
      LIMIT ${limit}
    `;

    const collections = await redb.manyOrNone(query);
    if (!_.isEmpty(collections)) {
      return _.map(collections, (collection) => new CollectionsEntity(collection));
    }

    return [];
  }

  public static async getTopCollectionsByVolume(limit = 500) {
    const query = `
      SELECT
        *
      FROM collections
      ORDER BY day1_volume DESC
      LIMIT ${limit}
    `;

    const collections = await redb.manyOrNone(query);
    if (!_.isEmpty(collections)) {
      return _.map(collections, (collection) => new CollectionsEntity(collection));
    }

    return [];
  }

  public static async recalculateCollectionFloorSell(collection: string) {
    const query = `
      UPDATE collections SET
        floor_sell_id = x.floor_sell_id,
        floor_sell_value = x.floor_sell_value,
        floor_sell_maker = x.floor_sell_maker,
        floor_sell_source_id_int = x.source_id_int,
        floor_sell_valid_between = x.valid_between,
        updated_at = now()
      FROM (
        SELECT
          tokens.floor_sell_id,
          tokens.floor_sell_value,
          tokens.floor_sell_maker,
          orders.source_id_int,
          orders.valid_between
        FROM tokens
        LEFT JOIN orders
        ON tokens.floor_sell_id = orders.id
        WHERE tokens.collection_id = $/collection/
        ORDER BY tokens.floor_sell_value
        LIMIT 1
      ) x
      WHERE collections.id = $/collection/
      AND (
        collections.floor_sell_id IS DISTINCT FROM x.floor_sell_id
        OR collections.floor_sell_value IS DISTINCT FROM x.floor_sell_value
      )
    `;

    await idb.none(query, {
      collection,
    });
  }

  public static async recalculateContractFloorSell(contract: string) {
    const result = await redb.manyOrNone(
      `
        SELECT
          tokens.token_id
        FROM tokens
        WHERE tokens.contract = $/contract/
          AND tokens.floor_sell_value IS NOT NULL
        LIMIT 10000
      `,
      { contract: toBuffer(contract) }
    );

    if (result) {
      const currentTime = now();
      await orderUpdatesByIdJob.addToQueue(
        result.map(({ token_id }) => {
          const tokenSetId = `token:${contract}:${token_id}`;
          return {
            context: `revalidate-sell-${tokenSetId}-${currentTime}`,
            tokenSetId,
            side: "sell",
            trigger: { kind: "revalidation" },
          };
        })
      );
    }
  }

  public static async recalculateContractTopBuy(contract: string) {
    const result = await redb.manyOrNone(
      `
        SELECT
          tokens.token_id
        FROM tokens
        WHERE tokens.contract = $/contract/
        LIMIT 10000
      `,
      { contract: toBuffer(contract) }
    );

    if (result) {
      const currentTime = now();
      await orderUpdatesByIdJob.addToQueue(
        result.map(({ token_id }) => {
          const tokenSetId = `token:${contract}:${token_id}`;
          return {
            context: `revalidate-buy-${tokenSetId}-${currentTime}`,
            tokenSetId,
            side: "buy",
            trigger: { kind: "revalidation" },
          };
        })
      );
    }
  }

  public static async revalidateCollectionTopBuy(collection: string) {
    const tokenSetsResult = await redb.manyOrNone(
      `
        SELECT token_sets.id
        FROM token_sets
        WHERE token_sets.collection_id = $/collection/
          AND token_sets.top_buy_value IS NOT NULL
      `,
      { collection }
    );

    if (tokenSetsResult.length) {
      const currentTime = now();
      await orderUpdatesByIdJob.addToQueue(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tokenSetsResult.map((tokenSet: { id: any }) => ({
          context: `revalidate-buy-${tokenSet.id}-${currentTime}`,
          tokenSetId: tokenSet.id,
          side: "buy",
          trigger: { kind: "revalidation" },
        }))
      );
    } else {
      logger.info(
        "revalidateCollectionTopBuy",
        JSON.stringify({
          message: "No token sets with top bid found for collection",
          collection,
        })
      );

      await topBidCollectionJob.addToQueue([
        {
          collectionId: collection,
          kind: "revalidation",
          txHash: null,
          txTimestamp: null,
        } as TopBidCollectionJobPayload,
      ]);
    }
  }

  public static async getIdsByCommunity(community: string) {
    const query = `
      SELECT id
      FROM collections
      WHERE community = $/community/
    `;

    const collectionIds = await idb.manyOrNone(query, { community });
    return _.map(collectionIds, "id");
  }

  public static async updateSpam(
    collectionIds: string[],
    newSpamState: number,
    actionTakerIdentifier: string
  ) {
    const updateResult = await idb.manyOrNone(
      `
        UPDATE collections
        SET
          is_spam = $/spam/,
          updated_at = now()
        WHERE id IN ($/ids:list/)
        AND is_spam IS DISTINCT FROM $/spam/
        RETURNING id
      `,
      {
        ids: collectionIds,
        spam: newSpamState,
      }
    );

    if (updateResult) {
      // Track the change
      await actionsLogJob.addToQueue(
        updateResult.map((res) => ({
          context: ActionsLogContext.SpamCollectionUpdate,
          origin: ActionsLogOrigin.API,
          actionTakerIdentifier,
          collection: res.id,
          data: {
            newSpamState,
          },
        }))
      );
    }
  }
}
