import { Interface } from "@ethersproject/abi";
import { Contract } from "@ethersproject/contracts";
import * as Sdk from "@reservoir0x/sdk";

import { idb } from "@/common/db";
import { baseProvider } from "@/common/provider";
import { toBuffer } from "@/common/utils";
import { Transaction } from "@/models/transactions";
import {
  CollectionMint,
  getCollectionMints,
  simulateAndUpsertCollectionMint,
  simulateAndUpsertCollectionMints,
} from "@/orderbook/mints";

import { toSafeNumber, toSafeTimestamp } from "@/orderbook/mints/calldata/helpers";
import { getContractKind } from "@/orderbook/orders/common/helpers";
import { config } from "@/config/index";

const STANDARD = "magiceden";

export const extractByCollectionERC721 = async (collection: string): Promise<CollectionMint[]> => {
  const results: CollectionMint[] = [];

  const c = new Contract(
    collection,
    new Interface([
      `
        function getPublicStage() view returns (
          (
            uint256 startTime,
            uint256 endTime,
            uint256 price
          )
        )
      `,
      `
        function maxSupply() view returns (uint256)
      `,
      `
        function walletLimit() view returns (uint256)
      `,
      `
        function mintFee() view returns (uint256)
      `,
    ]),
    baseProvider
  );

  try {
    const publicStage = await c.getPublicStage();
    const maxSupply = await c.maxSupply();
    const walletLimit = await c.walletLimit();

    let price = publicStage.price;

    try {
      const mintFee = await c.mintFee();

      if (mintFee) {
        price = price.add(mintFee);
      }
    } catch {
      // Do nothing
    }

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
            // `mintPublic`
            signature: "0x9f93f779",
            params: [
              {
                kind: "recipient",
                abiType: "address",
              },
              {
                kind: "quantity",
                abiType: "uint256",
              },
            ],
          },
        },
      },
      currency: Sdk.Common.Addresses.Native[config.chainId],
      price: price.toString(),
      maxMintsPerWallet: toSafeNumber(walletLimit),
      maxSupply: toSafeNumber(maxSupply),
      startTime: toSafeTimestamp(publicStage.startTime),
      endTime: toSafeTimestamp(publicStage.endTime),
    });
  } catch (error) {
    // logger.warn("mint-detector", JSON.stringify({ kind: STANDARD, error }));
  }

  return results;
};

export const extractByCollectionERC1155 = async (
  collection: string,
  tokenId: string
): Promise<CollectionMint[]> => {
  const results: CollectionMint[] = [];

  const c = new Contract(
    collection,
    new Interface([
      `
        function getPublicStage(uint256 tokenId) view returns (
          (
            uint256 startTime,
            uint256 endTime,
            uint256 price
          )
        )
      `,
      `
        function maxSupply(uint256 tokenId) view returns (uint256)
      `,
      `
        function walletLimit(uint256 tokenId) view returns (uint256)
      `,
      `
        function mintFee() view returns (uint256)
      `,
    ]),
    baseProvider
  );

  try {
    const publicStage = await c.getPublicStage(tokenId);
    const maxSupply = await c.maxSupply(tokenId);
    const walletLimit = await c.walletLimit(tokenId);

    let price = publicStage.price;

    try {
      const mintFee = await c.mintFee();

      if (mintFee) {
        price = price.add(mintFee);
      }
    } catch {
      // Do nothing
    }

    results.push({
      collection,
      contract: collection,
      tokenId,
      stage: "public-sale",
      kind: "public",
      status: "open",
      standard: STANDARD,
      details: {
        tx: {
          to: collection,
          data: {
            // `mintPublic`
            signature: "0x9b4f3af5",
            params: [
              {
                kind: "recipient",
                abiType: "address",
              },
              {
                kind: "tokenId",
                abiType: "uint256",
                abiValue: tokenId,
              },
              {
                kind: "quantity",
                abiType: "uint256",
              },
              {
                kind: "unknown",
                abiType: "bytes",
                abiValue: "0x00",
              },
            ],
          },
        },
      },
      currency: Sdk.Common.Addresses.Native[config.chainId],
      price: price.toString(),
      maxMintsPerWallet: toSafeNumber(walletLimit),
      maxSupply: toSafeNumber(maxSupply),
      startTime: toSafeTimestamp(publicStage.startTime),
      endTime: toSafeTimestamp(publicStage.endTime),
    });
  } catch (error) {
    // logger.warn("mint-detector", JSON.stringify({ kind: STANDARD, error }));
  }

  return results;
};

export const extractByTx = async (
  collection: string,
  tx: Transaction
): Promise<CollectionMint[]> => {
  if (
    [
      "0x9f93f779", // `mintPublic`
    ].some((bytes4) => tx.data.startsWith(bytes4))
  ) {
    return extractByCollectionERC721(collection);
  }

  if (
    [
      "0x9b4f3af5", // `mintPublic`
    ].some((bytes4) => tx.data.startsWith(bytes4))
  ) {
    return extractByCollectionERC1155(collection, "0");
  }

  return [];
};

export const refreshByCollection = async (collection: string) => {
  const existingCollectionMints = await getCollectionMints(collection, {
    standard: STANDARD,
  });

  const refresh = async (tokenId?: string) => {
    // Fetch and save/update the currently available mints
    const latestCollectionMints = tokenId
      ? await extractByCollectionERC1155(collection, tokenId)
      : await extractByCollectionERC721(collection);

    await simulateAndUpsertCollectionMints(latestCollectionMints);

    // Assume anything that exists in our system but was not returned
    // in the above call is not available anymore so we can close
    for (const existing of existingCollectionMints.filter((cm) => cm.tokenId === tokenId)) {
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

  const kind = await getContractKind(collection);

  if (kind === "erc1155") {
    const tokenIds = await idb.manyOrNone(
      `
        SELECT
          tokens.token_id
        FROM tokens
        WHERE tokens.contract = $/contract/
        LIMIT 1000
      `,
      {
        contract: toBuffer(collection),
      }
    );
    await Promise.all(tokenIds.map(async ({ token_id }) => refresh(token_id)));
  } else {
    await Promise.all(existingCollectionMints.map(async ({ tokenId }) => refresh(tokenId)));
  }
};
