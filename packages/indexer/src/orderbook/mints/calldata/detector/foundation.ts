import { Interface, Result } from "@ethersproject/abi";
import { hexZeroPad } from "@ethersproject/bytes";
import { AddressZero, HashZero } from "@ethersproject/constants";
import { Contract } from "@ethersproject/contracts";
import { keccak256 } from "@ethersproject/keccak256";
import { keccak256 as solidityKeccak256 } from "@ethersproject/solidity";
import * as Sdk from "@reservoir0x/sdk";
import { flatten } from "lodash";
import { MerkleTree } from "merkletreejs";

import { idb } from "@/common/db";
import { baseProvider } from "@/common/provider";
import { bn, toBuffer } from "@/common/utils";
import { config } from "@/config/index";
import { Transaction } from "@/models/transactions";
import {
  CollectionMint,
  getCollectionMints,
  simulateAndUpsertCollectionMint,
  simulateAndUpsertCollectionMints,
} from "@/orderbook/mints";
import {
  AllowlistItem,
  getAllowlist,
  allowlistExists,
  createAllowlist,
} from "@/orderbook/mints/allowlists";
import {
  fetchMetadata,
  getStatus,
  toSafeNumber,
  toSafeTimestamp,
} from "@/orderbook/mints/calldata/helpers";
import { getContractKind } from "@/orderbook/orders/common/helpers";

const STANDARD = "foundation";

export const extractByCollectionERC721 = async (collection: string): Promise<CollectionMint[]> => {
  const results: CollectionMint[] = [];

  const contract = new Contract(
    Sdk.Foundation.Addresses.DropMarket[config.chainId],
    new Interface([
      `
        function getFixedPriceSale(address nftContract) view returns (
          address seller,
          uint256 price,
          uint256 limitPerAccount,
          uint256 numberOfTokensAvailableToMint,
          bool marketCanMint,
          uint256 generalAvailabilityStartTime,
          uint256 earlyAccessStartTime
        )
      `,
      `
        function getFixedPriceSaleV2(address nftContract) view returns (
          address seller,
          uint256 price,
          uint256 limitPerAccount,
          uint256 numberOfTokensAvailableToMint,
          bool marketCanMint,
          uint256 generalAvailabilityStartTime,
          uint256 earlyAccessStartTime,
          uint256 mintFeePerNftInWei
        )
      `,
    ]),
    baseProvider
  );

  try {
    let isV2 = false;
    let result: Result | undefined;
    try {
      result = await contract.getFixedPriceSale(collection);
    } catch {
      // Skip errors
    }
    try {
      result = await contract.getFixedPriceSaleV2(collection);
      isV2 = true;
    } catch {
      // Skip errors
    }

    if (!result) {
      return [];
    }

    const mintFee = isV2 ? result.mintFeePerNftInWei.toString() : "0";
    const mintPrice = bn(result.price).add(mintFee).toString();

    const editionConfig: {
      seller: string;
      price: string;
      limitPerAccount: string;
      numberOfTokensAvailableToMint: string;
      marketCanMint: boolean;
      generalAvailabilityStartTime: string;
      earlyAccessStartTime: string;
    } = {
      seller: result.seller,
      price: result.price.toString(),
      limitPerAccount: result.limitPerAccount.toString(),
      numberOfTokensAvailableToMint: result.numberOfTokensAvailableToMint.toString(),
      marketCanMint: result.marketCanMint,
      generalAvailabilityStartTime: result.generalAvailabilityStartTime.toString(),
      earlyAccessStartTime: result.earlyAccessStartTime.toString(),
    };

    // Public sale
    results.push({
      collection,
      contract: collection,
      stage: "public-sale",
      kind: "public",
      status: result.marketCanMint ? "open" : "closed",
      standard: STANDARD,
      details: {
        tx: {
          to: Sdk.Foundation.Addresses.DropMarket[config.chainId],
          data: isV2
            ? {
                // `mintFromFixedPriceSaleV2`
                signature: "0x334965c2",
                params: [
                  {
                    kind: "contract",
                    abiType: "address",
                  },
                  {
                    kind: "quantity",
                    abiType: "uint256",
                  },
                  {
                    kind: "recipient",
                    abiType: "address",
                  },
                  {
                    kind: "referrer",
                    abiType: "address",
                  },
                ],
              }
            : {
                // `mintFromFixedPriceSale`
                signature: "0xecbc9554",
                params: [
                  {
                    kind: "contract",
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
      currency: Sdk.Common.Addresses.Native[config.chainId],
      price: mintPrice,
      maxMintsPerWallet: toSafeNumber(editionConfig.limitPerAccount),
      maxSupply: toSafeNumber(editionConfig.numberOfTokensAvailableToMint),
      startTime: toSafeTimestamp(editionConfig.generalAvailabilityStartTime),
    });

    // Allowlist mint
    if (result.earlyAccessStartTime != "0") {
      const { merkleRoot, merkleTreeUri } = await getLatestMerkleRootData(collection);
      if (merkleRoot && merkleRoot !== HashZero && merkleTreeUri && merkleTreeUri !== "") {
        let allowlistCreated = true;
        if (!(await allowlistExists(merkleRoot))) {
          const contractMetadata: { unhashedLeaves: string[] } = await fetchMetadata(merkleTreeUri);
          const items: AllowlistItem[] = contractMetadata.unhashedLeaves.map(
            (e) =>
              ({
                address: e,
                price: editionConfig.price,
                actualPrice: editionConfig.price,
              } as AllowlistItem)
          );

          if (generateMerkleTree(items).tree.getHexRoot() === merkleRoot) {
            await createAllowlist(merkleRoot!, items);
          } else {
            allowlistCreated = false;
          }
        }

        if (allowlistCreated) {
          results.push({
            collection,
            contract: collection,
            stage: "presale",
            kind: "allowlist",
            status: "open",
            standard: STANDARD,
            details: {
              tx: {
                to: Sdk.Foundation.Addresses.DropMarket[config.chainId],
                data: isV2
                  ? {
                      // `mintFromFixedPriceSaleWithEarlyAccessAllowlistV2`
                      signature: "0x0cafb113",
                      params: [
                        {
                          kind: "contract",
                          abiType: "address",
                        },
                        {
                          kind: "quantity",
                          abiType: "uint256",
                        },
                        {
                          kind: "recipient",
                          abiType: "address",
                        },
                        {
                          kind: "referrer",
                          abiType: "address",
                        },
                        {
                          kind: "allowlist",
                          abiType: "bytes32[]",
                        },
                      ],
                    }
                  : {
                      // `mintFromFixedPriceSaleWithEarlyAccessAllowlist`
                      signature: "0xd782d491",
                      params: [
                        {
                          kind: "contract",
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
                        {
                          kind: "allowlist",
                          abiType: "bytes32[]",
                        },
                      ],
                    },
              },
            },
            currency: Sdk.Common.Addresses.Native[config.chainId],
            price: mintPrice,
            maxMintsPerWallet: toSafeNumber(editionConfig.limitPerAccount),
            maxSupply: toSafeNumber(editionConfig.numberOfTokensAvailableToMint),
            startTime: toSafeTimestamp(editionConfig.earlyAccessStartTime),
            allowlistId: merkleRoot,
          });
        }
      }
    }
  } catch (error) {
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

const getMultiTokenDropMarketContract = () => {
  return new Contract(
    Sdk.Foundation.Addresses.MultiTokenDropMarket[config.chainId],
    new Interface([
      "function getSaleTermsForToken(address nftContract, uint256 tokenId) view returns (uint256 saleTermsId)",
      `
        function getFixedPriceSale(uint256 saleTermsId, address payable referrer) view returns (
          (
            address multiTokenContract,
            uint256 tokenId,
            uint256 pricePerQuantity,
            uint256 quantityAvailableToMint,
            address payable creatorPaymentAddress,
            uint256 generalAvailabilityStartTime,
            uint256 mintEndTime,
            uint256 creatorRevenuePerQuantity,
            uint256 referrerRewardPerQuantity,
            uint256 worldCuratorRevenuePerQuantity,
            uint256 protocolFeePerQuantity
          ) results
        )
      `,
    ]),
    baseProvider
  );
};

export const extractByCollectionERC1155 = async (
  collection: string,
  tokenId: string
): Promise<CollectionMint[]> => {
  const contract = getMultiTokenDropMarketContract();

  const results: CollectionMint[] = [];
  try {
    const saleTermId = await contract.getSaleTermsForToken(collection, tokenId);
    const result = await contract.getFixedPriceSale(saleTermId, AddressZero);
    const mintPrice = result.pricePerQuantity
      .add(result.protocolFeePerQuantity)
      .add(result.creatorRevenuePerQuantity)
      .toString();

    // Public sale
    results.push({
      collection,
      contract: collection,
      stage: "public-sale",
      kind: "public",
      status: result.quantityAvailableToMint.gt(0) ? "open" : "closed",
      standard: STANDARD,
      tokenId,
      details: {
        tx: {
          to: Sdk.Foundation.Addresses.MultiTokenDropMarket[config.chainId],
          data: {
            // `mintFromFixedPriceSale`
            signature: "0x337fae59",
            params: [
              {
                kind: "unknown",
                abiType: "uint256",
                abiValue: saleTermId.toString(),
              },
              {
                kind: "quantity",
                abiType: "uint256",
              },
              {
                kind: "recipient",
                abiType: "address",
              },
              {
                kind: "referrer",
                abiType: "address",
              },
            ],
          },
        },
      },
      currency: Sdk.Common.Addresses.Native[config.chainId],
      price: mintPrice,
      startTime: toSafeTimestamp(result.generalAvailabilityStartTime),
      endTime: toSafeTimestamp(result.mintEndTime),
    });
  } catch {
    // logger.warn("mint-detector", JSON.stringify({ kind: STANDARD, error }));
  }

  // Update the status of each collection mint
  await Promise.all(
    results.map(async (cm) => {
      await getStatus(cm).then(({ status, reason }) => {
        cm.status = status;
        cm.statusReason = reason ?? cm.statusReason;
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
      "0xecbc9554", // `mintFromFixedPriceSale`
      "0xd782d491", // `mintFromFixedPriceSaleWithEarlyAccessAllowlist`
      "0x0cafb113", // `mintFromFixedPriceSaleWithEarlyAccessAllowlistV2`
    ].some((bytes4) => tx.data.startsWith(bytes4))
  ) {
    return extractByCollectionERC721(collection);
  }

  if (
    [
      "0x337fae59", // `mintFromFixedPriceSale`
    ].some((bytes4) => tx.data.startsWith(bytes4))
  ) {
    const contract = getMultiTokenDropMarketContract();
    const saleTermId = new Interface([
      "function mintFromFixedPriceSale(uint256 saleTermsId, uint256 tokenQuantity, address tokenRecipient, address referrer)",
    ]).parseTransaction(tx).args.saleTermsId;

    const result = await contract.getFixedPriceSale(saleTermId, AddressZero);
    return extractByCollectionERC1155(collection, result.tokenId.toString());
  }

  if (
    [
      "0x5df78fa5", // `mintMultiTokensFromFreeFixedPriceSale`
    ].some((bytes4) => tx.data.startsWith(bytes4))
  ) {
    const tokenQuantities = new Interface([
      `function mintMultiTokensFromFreeFixedPriceSale(
        address multiTokenCollection,
        (
          uint256 tokenId,
          uint256 quantity
        )[] tokenQuantities,
        address tokenRecipient,
        address referrer
      )`,
    ]).parseTransaction(tx).args.tokenQuantities;

    const allResults = await Promise.all(
      tokenQuantities.map((tokenQuantity: Result) =>
        extractByCollectionERC1155(collection, tokenQuantity.tokenId.toString())
      )
    );

    return flatten(allResults);
  }

  return [];
};

export const refreshByCollection = async (collection: string) => {
  const existingCollectionMints = await getCollectionMints(collection, { standard: STANDARD });

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

const hashFn = (item: AllowlistItem) => solidityKeccak256(["address"], [item.address]);

const generateMerkleTree = (
  items: AllowlistItem[]
): {
  root: string;
  tree: MerkleTree;
} => {
  const tree = new MerkleTree(items.map(hashFn), keccak256, {
    sortPairs: true,
  });
  return {
    root: tree.getHexRoot(),
    tree,
  };
};

type ProofValue = string[];

export const generateProofValue = async (
  collectionMint: CollectionMint,
  address: string
): Promise<ProofValue> => {
  const items = await getAllowlist(collectionMint.allowlistId!);
  const item = items.find((i) => i.address === address)!;
  return generateMerkleTree(items).tree.getHexProof(hashFn(item));
};

const getLatestMerkleRootData = async (collection: string, maxRetry = 5, blockInterval = 10000) => {
  const iface = new Interface([
    `event CreateFixedPriceSale(
      address indexed nftContract,
      address indexed seller,
      uint256 price,
      uint256 limitPerAccount,
      uint256 generalAvailabilityStartTime,
      uint256 earlyAccessStartTime,
      bytes32 merkleRoot,
      string merkleTreeUri
    )`,
    `event AddMerkleRootToFixedPriceSale(
      address indexed nftContract,
      bytes32 merkleRoot,
      string merkleTreeUri
    )`,
  ]);

  const blockNumber = await baseProvider.getBlockNumber();
  const topicsFilter = [
    [
      iface.getEventTopic("CreateFixedPriceSale"),
      iface.getEventTopic("AddMerkleRootToFixedPriceSale"),
    ],
    hexZeroPad(collection, 32),
  ];

  let merkleRoot: string | undefined;
  let merkleTreeUri: string | undefined;
  for (let i = 0; i < maxRetry; i++) {
    const relevantLogs = await baseProvider.getLogs({
      fromBlock: blockNumber - blockInterval * (i + 1),
      toBlock: blockNumber - blockInterval * i,
      topics: topicsFilter,
    });

    if (relevantLogs.length) {
      const mostRecentLog = relevantLogs[relevantLogs.length - 1];

      let decodedLog: Result;
      if (mostRecentLog.topics[0] === iface.getEventTopic("CreateFixedPriceSale")) {
        decodedLog = iface.decodeEventLog(
          "CreateFixedPriceSale",
          mostRecentLog.data,
          mostRecentLog.topics
        );
      } else {
        decodedLog = iface.decodeEventLog(
          "AddMerkleRootToFixedPriceSale",
          mostRecentLog.data,
          mostRecentLog.topics
        );
      }

      merkleTreeUri = decodedLog.merkleTreeUri;
      merkleRoot = decodedLog.merkleRoot;

      break;
    }
  }

  return {
    merkleRoot,
    merkleTreeUri,
  };
};
