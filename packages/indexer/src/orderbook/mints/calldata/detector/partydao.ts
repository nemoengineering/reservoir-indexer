import { Interface } from "@ethersproject/abi";
import { Contract } from "@ethersproject/contracts";
import * as Sdk from "@reservoir0x/sdk";

import { baseProvider } from "@/common/provider";
import { config } from "@/config/index";
import { Transaction } from "@/models/transactions";
import { getStatus, toSafeTimestamp } from "@/orderbook/mints/calldata/helpers";
import {
  CollectionMint,
  getCollectionMints,
  simulateAndUpsertCollectionMint,
  simulateAndUpsertCollectionMints,
} from "@/orderbook/mints";

const STANDARD = "partydao";

export type Info = {
  minter: string;
  saleId?: string;
};

export const extractByCollectionERC721 = async (
  collection: string,
  minter: string,
  saleId?: string
): Promise<CollectionMint[]> => {
  const results: CollectionMint[] = [];

  const contributionRouter = "0xc534bb3640a66faf5eae8699fece511e1c331cad";

  const mint = new Contract(
    minter,
    new Interface([
      "function minContribution() view returns (uint96)",
      "function party() view returns (address)",
      "function maxTotalContributions() view returns (uint96)",
      "function totalContributions() view returns (uint96)",
      "function expiry() view returns (uint40)",
      "function getCrowdfundLifecycle() view returns (uint8)",
      "function lastSaleId(address party) view returns (uint256)",
      "function isSaleActive(address party, uint256 saleId) view returns (bool)",
      `function getFixedMembershipSaleInfo(address party, uint256 saleId) view returns (
        uint96 pricePerMembership,
        uint96 votingPowerPerMembership,
        uint96 totalContributions,
        uint96 totalMembershipsForSale,
        uint16 fundingSplitBps,
        address fundingSplitRecipient,
        uint40 expiry,
        address gateKeeper,
        bytes12 gateKeeperId
      )`,
      `function getFlexibleMembershipSaleInfo(address party, uint256 saleId) view returns (
        uint96 minContribution,
        uint96 maxContribution,
        uint96 totalContributions,
        uint96 maxTotalContributions,
        uint160 exchangeRate,
        uint16 fundingSplitBps,
        address fundingSplitRecipient,
        uint40 expiry,
        address gateKeeper,
        bytes12 gateKeeperId
      )`,
    ]),
    baseProvider
  );

  const router = new Contract(
    contributionRouter,
    new Interface(["function feePerMint() view returns (uint96)"]),
    baseProvider
  );

  // InitialETHCrowdfund
  try {
    const [minContribution, expiry, crowdfundLifecycle, feePerMint] = await Promise.all([
      mint.minContribution(),
      mint.expiry(),
      mint.getCrowdfundLifecycle(),
      router.feePerMint(),
    ]);

    const price = minContribution.add(feePerMint).toString();

    results.push({
      collection,
      contract: collection,
      stage: `public-sale-${collection}`,
      kind: "public",
      status: crowdfundLifecycle == 1 ? "open" : "closed",
      standard: STANDARD,
      details: {
        tx: {
          to: contributionRouter,
          data: {
            // `contributeFor`
            signature: "0xe7a79057",
            params: [
              {
                kind: "unknown",
                abiType: "uint256",
                abiValue: 0,
              },
              {
                kind: "recipient",
                abiType: "address",
              },
              {
                kind: "recipient",
                abiType: "address",
              },
              {
                kind: "unknown",
                abiType: "bytes",
                abiValue: "0x",
              },
            ],
          },
        },
        info: {
          minter: minter.toLowerCase(),
        },
      },
      currency: Sdk.Common.Addresses.Native[config.chainId],
      endTime: toSafeTimestamp(expiry),
      price,
    });
  } catch {
    // logger.warn("mint-detector", JSON.stringify({ kind: STANDARD, error }));
  }

  // SellPartyCardsAuthority
  try {
    if (saleId) {
      const isActive = await mint.isSaleActive(collection, saleId);
      const feePerMint = await router.feePerMint();
      const saleInfo = await mint.getFixedMembershipSaleInfo(collection, saleId);
      const price = saleInfo.pricePerMembership.add(feePerMint).toString();

      results.push({
        collection,
        contract: collection,
        stage: `public-sale-${collection}-${saleId}`,
        kind: "public",
        status: isActive ? "open" : "closed",
        standard: STANDARD,
        details: {
          tx: {
            to: contributionRouter,
            data: {
              // `contributeFor`
              signature: "0xc14bf63f",
              params: [
                {
                  kind: "unknown",
                  abiType: "address",
                  abiValue: collection,
                },
                {
                  kind: "unknown",
                  abiType: "uint256",
                  abiValue: saleId,
                },
                {
                  kind: "recipient",
                  abiType: "address",
                },
                {
                  kind: "recipient",
                  abiType: "address",
                },
                {
                  kind: "unknown",
                  abiType: "bytes",
                  abiValue: "0x",
                },
              ],
            },
          },
          info: {
            saleId: saleId!,
            minter: minter.toLowerCase(),
          },
        },
        currency: Sdk.Common.Addresses.Native[config.chainId],
        endTime: toSafeTimestamp(saleInfo.expiry),
        price,
      });
    }
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
  if (
    [
      // InitialETHCrowdfund
      "0xe7a79057", // `contributeFor`
      "0xa2290d35", // `batchContributeFor`
      // SellPartyCardsAuthority
      "0xc14bf63f", // `contributeFor`
      "0x02bb443b", // `batchContributeFor`
    ].some((bytes4) => tx.data.startsWith(bytes4))
  ) {
    const minter = "0x" + tx.data.slice(-40);

    let saleId: undefined | string = undefined;
    if (
      [
        "0xc14bf63f", // `contributeFor`
        "0x02bb443b", // `batchContributeFor`,
      ].some((bytes4) => tx.data.startsWith(bytes4))
    ) {
      saleId = new Interface([
        `
          function contributeFor(
            address party,
            uint256 saleId,
            address recipient,
            address initialDelegate,
            bytes gateData
          ) view returns (uint96 votingPower)
        `,
        `
          function batchContributeFor(
            address party,
            uint256 saleId,
            address[] recipients,
            address[] initialDelegates,
            uint96[] contributions,
            bytes gateData
          ) view returns (uint96[] votingPowers)
        `,
      ])
        .parseTransaction(tx)
        .args.saleId.toString();
    }

    return extractByCollectionERC721(collection, minter, saleId);
  }

  return [];
};

export const refreshByCollection = async (collection: string) => {
  const existingCollectionMints = await getCollectionMints(collection, { standard: STANDARD });

  for (const { details } of existingCollectionMints) {
    // Fetch and save/update the currently available mints
    const latestCollectionMints = await extractByCollectionERC721(
      collection,
      (details.info! as Info).minter!,
      (details.info! as Info).saleId
    );
    await simulateAndUpsertCollectionMints(latestCollectionMints);

    // Assume anything that exists in our system but was not returned
    // in the above call is not available anymore so we can close
    for (const existing of existingCollectionMints) {
      if (
        !latestCollectionMints.find(
          (latest) => latest.collection === existing.collection && latest.stage === existing.stage
        )
      ) {
        await simulateAndUpsertCollectionMint({
          ...existing,
          status: "closed",
        });
      }
    }
  }
};
