import { idb } from "@/common/db";
import { toBuffer } from "@/common/utils";
import { metadataIndexFetchJob } from "@/jobs/metadata-index/metadata-fetch-job";
import MetadataProviderRouter from "@/metadata/metadata-provider-router";
import { CollectionMintStandard } from "@/orderbook/mints";
import { recalcTokenCountQueueJob } from "@/jobs/collection-updates/recalc-token-count-queue-job";
import { getContractKind } from "@/orderbook/mints/calldata/helpers";
import { collectionNewContractDeployedJob } from "@/jobs/collections/collection-contract-deployed";
import { logger } from "@/common/logger";
import { config } from "@/config/index";

// Based on the mint's standard, select the appropriate metadata indexing method
const getMetadataIndexingMethod = (standard: CollectionMintStandard, isPremint?: boolean) =>
  standard === "manifold"
    ? "manifold"
    : standard === "seadrop-v1.0"
    ? "opensea"
    : standard === "zora" && isPremint
    ? "zora"
    : "onchain";

const createOffchainContractIfInexistent = async (
  contract: string,
  kind: "erc721" | "erc1155",
  name?: string
) => {
  const contractExists = await idb.oneOrNone(
    "SELECT 1 FROM contracts WHERE contracts.address = $/contract/",
    {
      contract: toBuffer(contract),
    }
  );
  if (!contractExists) {
    await idb.none(
      `
        INSERT INTO contracts (
          address,
          kind,
          symbol,
          name,
          deployed_at,
          metadata,
          deployer,
          owner,
          is_offchain
        ) VALUES (
          $/address/,
          $/kind/,
          $/symbol/,
          $/name/,
          $/deployed_at/,
          $/metadata:json/,
          $/deployer/,
          $/owner/,
          $/isOffchain/
        )
        ON CONFLICT DO NOTHING
      `,
      {
        address: toBuffer(contract),
        kind: kind.toLowerCase(),
        symbol: null,
        name: name || null,
        deployed_at: null,
        metadata: null,
        deployer: null,
        owner: null,
        isOffchain: true,
      }
    );
  }
};

export const createContractIfInexistent = async (contract: string) => {
  const contractExists = await idb.oneOrNone(
    "SELECT 1 FROM contracts WHERE contracts.address = $/contract/",
    {
      contract: toBuffer(contract),
    }
  );

  if (!contractExists) {
    const kind = await getContractKind(contract);

    if (!kind) {
      throw new Error("Could not detect contract kind");
    }

    await idb.none(
      `
        INSERT INTO contracts (
          address,
          kind,
          symbol,
          name,
          deployed_at,
          metadata,
          deployer,
          owner
        ) VALUES (
          $/address/,
          $/kind/,
          $/symbol/,
          $/name/,
          $/deployed_at/,
          $/metadata:json/,
          $/deployer/,
          $/owner/
        )
        ON CONFLICT DO NOTHING
      `,
      {
        address: toBuffer(contract),
        kind: kind.toLowerCase(),
        symbol: null,
        name: null,
        deployed_at: null,
        metadata: null,
        deployer: null,
        owner: null,
      }
    );

    await collectionNewContractDeployedJob.addToQueue(
      {
        contract,
      },
      5000
    );
  }
};

export const createCollectionIfInexistent = async (
  contract: string,
  standard: CollectionMintStandard,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  additionalInfo?: any
) => {
  const collectionExists = await idb.oneOrNone(
    "SELECT 1 FROM collections WHERE collections.id = $/contract/",
    {
      contract,
    }
  );

  if (!collectionExists) {
    // Get the collection's metadata
    const collection = await MetadataProviderRouter.getCollectionMetadata(contract, "0", "", {
      indexingMethod: getMetadataIndexingMethod(standard, additionalInfo?.isPremint),
      additionalQueryParams:
        standard === "manifold" ? { instanceId: additionalInfo?.instanceId } : undefined,
      context: "createCollectionIfInexistent",
    });

    logger.log(
      config.debugMetadataIndexingCollections.includes(contract) ? "info" : "debug",
      "createCollectionIfInexistent",
      JSON.stringify({
        topic: "CollectionNewContractDeployedJob",
        message: `Debug. contract=${contract}, standard=${standard}`,
        collection,
        debugMetadataIndexingCollection: config.debugMetadataIndexingCollections.includes(contract),
      })
    );

    let tokenIdRange: string | null = null;
    if (collection.tokenIdRange) {
      tokenIdRange = `numrange(${collection.tokenIdRange[0]}, ${collection.tokenIdRange[1]}, '[]')`;
    } else if (collection.id === contract) {
      tokenIdRange = `'(,)'::numrange`;
    }

    // For covering the case where the token id range is null
    const tokenIdRangeParam = tokenIdRange ? "$/tokenIdRange:raw/" : "$/tokenIdRange/";

    // Write the collection to the database
    await idb.none(
      `
        INSERT INTO collections (
          id,
          slug,
          name,
          metadata,
          contract,
          token_id_range,
          token_set_id,
          creator
        ) VALUES (
          $/id/,
          $/slug/,
          $/name/,
          $/metadata:json/,
          $/contract/,
          ${tokenIdRangeParam},
          $/tokenSetId/,
          $/creator/
        ) ON CONFLICT DO NOTHING
      `,
      {
        id: collection.id,
        slug: collection.slug,
        name: collection.name,
        metadata: collection.metadata,
        contract: toBuffer(collection.contract),
        tokenIdRange,
        tokenSetId: collection.tokenSetId,
        creator: collection.creator ? toBuffer(collection.creator) : null,
      }
    );
  }
};

export const createTokenIfInexistent = async (
  contract: string,
  tokenId: string,
  standard: CollectionMintStandard,
  isPremint?: boolean
) => {
  const { rowCount } = await idb.result(
    `
        INSERT INTO tokens (
          contract,
          token_id,
          collection_id
        ) VALUES (
          $/contract/,
          $/tokenId/,
          $/collection/
        )
        ON CONFLICT DO NOTHING
      `,
    {
      contract: toBuffer(contract),
      tokenId,
      collection: contract.toLowerCase(),
    }
  );

  if (rowCount > 0) {
    await recalcTokenCountQueueJob.addToQueue({ collection: contract.toLowerCase() });

    // Add a job to fetch the token's metadata
    await metadataIndexFetchJob.addToQueue([
      {
        kind: "single-token",
        data: {
          method: getMetadataIndexingMethod(standard, isPremint),
          collection: contract,
          contract,
          tokenId,
        },
      },
    ]);
  }
};

export const prepareMetadata = async (
  contract: string,
  name: string,
  kind: "erc1155" | "erc721",
  standard: CollectionMintStandard,
  tokenId?: string
) => {
  const promises: Promise<void>[] = [
    createOffchainContractIfInexistent(contract, kind, name),
    createCollectionIfInexistent(contract, standard, { isPremint: true }),
  ];
  if (tokenId) {
    promises.push(createTokenIfInexistent(contract, tokenId, standard, true));
  }

  return Promise.all(promises);
};
