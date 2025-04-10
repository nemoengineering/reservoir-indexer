import { baseProvider } from "@/common/provider";
import { Transaction } from "@/models/transactions";
import {
  CollectionMint,
  getCollectionMints,
  simulateAndUpsertCollectionMint,
  simulateAndUpsertCollectionMints,
} from "@/orderbook/mints";
import { Contract } from "@ethersproject/contracts";
import { logger } from "@/common/logger";
import { extractByCollectionERC721 } from "@/orderbook/mints/calldata/detector/seadrop";
import * as Sdk from "@reservoir0x/sdk";
import { config } from "@/config/index";
import { Interface } from "@ethersproject/abi";
import { toSafeNumber, toSafeTimestamp } from "@/orderbook/mints/calldata/helpers";

const STANDARD = "coinbase";

export const extractByCollection = async (
  collection: string,
  context?: string
): Promise<CollectionMint[]> => {
  const results: CollectionMint[] = [];

  logger.info(
    "coinbase-mint-detection",
    JSON.stringify({
      message: `extractByCollection start. standard=${STANDARD}, collection=${collection}, context=${context}`,
      collection,
    })
  );

  try {
    const contract = new Contract(
      collection,
      new Interface([
        `
        function mintingContract() view returns (address)
      `,
        `
        function metadata() view returns (
          (
            address creator,
            uint128 name,
            uint128 description,
            uint128 symbol,
            uint128 image,
            uint128 animation_url,
            uint128 mintType,
            uint128 maxSupply,
            uint128 maxPerWallet,
            uint256 cost,
            uint256 startTime,
            uint256 endTime
          )
        )
      `,
        "function cost(uint256 quantity) view returns (uint256)",
      ]),
      baseProvider
    );

    const mintingContract = await contract.mintingContract();

    if (mintingContract.toLowerCase() === Sdk.Coinbase.Addresses.MintFactory[config.chainId]) {
      const metadata = await contract.metadata();
      const price = await contract.cost(1);

      results.push({
        collection,
        contract: collection,
        stage: "public-sale",
        kind: "public",
        status: "open",
        standard: STANDARD,
        details: {
          tx: {
            to: collection,
            data: {
              // `mint`
              signature: "0x0d4d1513",
              params: [
                {
                  kind: "recipient",
                  abiType: "address",
                },
                {
                  kind: "quantity",
                  abiType: "uint256",
                },
                {
                  kind: "unknown",
                  abiType: "address",
                  abiValue: "0x0000000000000000000000000000000000000000",
                },
              ],
            },
          },
        },
        currency: Sdk.Common.Addresses.Native[config.chainId],
        price: price.toString(),
        maxMintsPerWallet: toSafeNumber(metadata.maxPerWallet),
        maxSupply: toSafeNumber(metadata.maxSupply),
        startTime: toSafeTimestamp(metadata.startTime),
        endTime: toSafeTimestamp(metadata.endTime),
      });

      logger.info(
        "coinbase-mint-detection",
        JSON.stringify({
          message: `extractByCollection results. standard=${STANDARD}, collection=${collection}, context=${context}`,
          collection,
          results,
        })
      );
    }
  } catch (error) {
    logger.warn("coinbase-mint-detection", JSON.stringify({ kind: STANDARD, error }));
  }

  return results;
};

export const extractByTx = async (
  collection: string,
  tx: Transaction
): Promise<CollectionMint[]> => {
  if (
    [
      "0x0d4d1513", // `mint`
      "0x9a716b95", // 'mintToSender'
      "0x2290748b", // 'mintWithComment'
    ].some((bytes4) => tx.data.startsWith(bytes4))
  ) {
    return extractByCollection(collection, "extractByTx");
  }

  return [];
};

export const refreshByCollection = async (collection: string) => {
  const existingCollectionMints = await getCollectionMints(collection, {
    standard: STANDARD,
  });

  // Fetch and save/update the currently available mints
  const latestCollectionMints = await extractByCollectionERC721(collection);
  await simulateAndUpsertCollectionMints(latestCollectionMints);

  // Assume anything that exists in our system but was not returned
  // in the above call is not available anymore so we can close
  for (const existing of existingCollectionMints) {
    if (
      !latestCollectionMints.find(
        (latest) =>
          latest.collection === existing.collection &&
          latest.stage === existing.stage &&
          latest.tokenId === existing.tokenId
      )
    ) {
      await simulateAndUpsertCollectionMint({
        ...existing,
        status: "closed",
      });
    }
  }
};
