import { Interface } from "@ethersproject/abi";
import { Contract } from "@ethersproject/contracts";
import * as Sdk from "@reservoir0x/sdk";
import { Network } from "@reservoir0x/sdk/dist/utils";

import { baseProvider } from "@/common/provider";
import { config } from "@/config/index";
import { Transaction } from "@/models/transactions";
import { getStatus } from "@/orderbook/mints/calldata/helpers";
import {
  CollectionMint,
  getCollectionMints,
  simulateAndUpsertCollectionMint,
  simulateAndUpsertCollectionMints,
} from "@/orderbook/mints";

const STANDARD = "basepaint";

export const extractByCollectionERC1155 = async (collection: string): Promise<CollectionMint[]> => {
  const results: CollectionMint[] = [];

  const contract = new Contract(
    collection,
    new Interface([
      "function openEditionPrice() view returns (uint256)",
      "function today() view returns (uint256)",
    ]),
    baseProvider
  );

  try {
    const [mintPrice, today] = await Promise.all([contract.openEditionPrice(), contract.today()]);

    const tokenId = today.sub(1).toString();
    results.push({
      collection,
      contract: collection,
      stage: `public-sale-${collection}`,
      kind: "public",
      status: "open",
      standard: STANDARD,
      details: {
        tx: {
          to: "0xaff1a9e200000061fc3283455d8b0c7e3e728161",
          data: {
            // "mint"
            signature: "0xe9eb7008",
            params: [
              {
                kind: "unknown",
                abiType: "uint256",
                abiValue: tokenId,
              },
              {
                kind: "recipient",
                abiType: "address",
              },
              {
                kind: "quantity",
                abiType: "uint256",
              },
              {
                kind: "referrer",
                abiType: "address",
              },
            ],
          },
        },
      },
      tokenId,
      currency: Sdk.Common.Addresses.Native[config.chainId],
      price: mintPrice.toString(),
    });
  } catch {
    // logger.warn("mint-detector", JSON.stringify({ kind: STANDARD, error }));
  }

  // Update the status of each collection mint
  await Promise.all(
    results.map(async (cm) => {
      await getStatus(cm).then(({ status, reason }) => {
        cm.status = status;
        cm.statusReason = reason;
      });
    })
  );

  return results;
};

export const extractByTx = async (
  collection: string,
  tx: Transaction
): Promise<CollectionMint[]> => {
  if (config.chainId === Network.Base) {
    if (
      [
        "0xe9eb7008", // `mint`
      ].some((bytes4) => tx.data.startsWith(bytes4)) ||
      collection === "0xba5e05cb26b78eda3a2f8e3b3814726305dcac83"
    ) {
      return extractByCollectionERC1155(collection);
    }
  }

  return [];
};

export const refreshByCollection = async (collection: string) => {
  const existingCollectionMints = await getCollectionMints(collection, { standard: STANDARD });

  // Fetch and save/update the currently available mints
  const latestCollectionMints = await extractByCollectionERC1155(collection);
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
