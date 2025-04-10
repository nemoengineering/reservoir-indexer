import { Interface, defaultAbiCoder } from "@ethersproject/abi";
import { BigNumber } from "@ethersproject/bignumber";
import { AddressZero } from "@ethersproject/constants";
import { Contract } from "@ethersproject/contracts";
import { keccak256 } from "@ethersproject/keccak256";
import { parseEther } from "@ethersproject/units";
import * as Sdk from "@reservoir0x/sdk";
import axios from "axios";
import _ from "lodash";
import semver from "semver";

import { idb } from "@/common/db";
import { baseProvider } from "@/common/provider";
import { redis } from "@/common/redis";
import { bn, toBuffer } from "@/common/utils";
import { config } from "@/config/index";
import { Transaction } from "@/models/transactions";
import {
  CollectionMint,
  getCollectionMints,
  simulateAndUpsertCollectionMint,
  simulateAndUpsertCollectionMints,
} from "@/orderbook/mints";
import { AllowlistItem, allowlistExists, createAllowlist } from "@/orderbook/mints/allowlists";
import { MintTxSchema } from "@/orderbook/mints/calldata";
import { getStatus, toSafeNumber, toSafeTimestamp } from "@/orderbook/mints/calldata/helpers";
import { getContractKind } from "@/orderbook/orders/common/helpers";
import * as mints from "@/orderbook/mints";

const STANDARD = "zora";
const ZORA_ENDPOINT = "https://api.zora.co";

export type Info = {
  minter?: string;
};

export const extractByCollectionERC721 = async (collection: string): Promise<CollectionMint[]> => {
  const results: CollectionMint[] = [];

  const c = new Contract(
    collection,
    new Interface([
      "function computeTotalReward(uint256 mintPrice, uint256 numTokens) view returns (uint256)",
      "function computeTotalReward(uint256 numTokens) view returns (uint256)",
      `
        function saleDetails() view returns (
          (
            bool publicSaleActive,
            bool presaleActive,
            uint256 publicSalePrice,
            uint64 publicSaleStart,
            uint64 publicSaleEnd,
            uint64 presaleStart,
            uint64 presaleEnd,
            bytes32 presaleMerkleRoot,
            uint256 maxSalePurchasePerAddress,
            uint256 totalMinted,
            uint256 maxSupply
          )
        )
      `,
      "function zoraFeeForAmount(uint256 quantity) view returns (address recipient, uint256 fee)",
    ]),
    baseProvider
  );

  try {
    const saleDetails = await c.saleDetails();
    const fee = await c.zoraFeeForAmount(1).then((f: { fee: BigNumber }) => f.fee);

    let totalRewards: BigNumber | undefined;
    try {
      totalRewards = await c["computeTotalReward(uint256)"](1);
    } catch {
      // Skip error for old version
    }
    try {
      totalRewards = await c["computeTotalReward(uint256,uint256)"](bn(10).pow(18), 1);
    } catch {
      // Skip error for old version
    }

    // Public sale
    if (saleDetails.publicSaleActive) {
      // price = on-chain-price + fee
      const price = bn(saleDetails.publicSalePrice).add(fee).toString();

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
            data:
              totalRewards == undefined
                ? {
                    // `purchase`
                    signature: "0xefef39a1",
                    params: [
                      {
                        kind: "quantity",
                        abiType: "uint256",
                      },
                    ],
                  }
                : {
                    // `mintWithRewards`
                    signature: "0x45368181",
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
                        kind: "comment",
                        abiType: "string",
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
        price,
        maxMintsPerWallet: toSafeNumber(saleDetails.maxSalePurchasePerAddress),
        maxSupply: toSafeNumber(saleDetails.maxSupply),
        startTime: toSafeTimestamp(saleDetails.publicSaleStart),
        endTime: toSafeTimestamp(saleDetails.publicSaleEnd),
      });
    }

    // Presale
    if (saleDetails.presaleActive) {
      const merkleRoot = saleDetails.presaleMerkleRoot;
      if (!(await allowlistExists(merkleRoot))) {
        await axios
          .get(`https://allowlist.zora.co/allowlist/${merkleRoot}`)
          .then(({ data }) => data)
          .then(
            async (data: { entries: { user: string; price: string; maxCanMint: number }[] }) => {
              return data.entries.map(
                (e) =>
                  ({
                    address: e.user,
                    maxMints: String(e.maxCanMint),
                    // price = on-chain-price
                    price: e.price,
                    // actualPrice = on-chain-price + fee
                    actualPrice: bn(e.price).add(fee).toString(),
                  } as AllowlistItem)
              );
            }
          )
          .then((items) => createAllowlist(merkleRoot, items));
      }

      results.push({
        collection,
        contract: collection,
        stage: "presale",
        kind: "allowlist",
        status: "open",
        standard: STANDARD,
        details: {
          tx: {
            to: collection,
            data:
              totalRewards == undefined
                ? {
                    // `purchasePresale`
                    signature: "0x25024a2b",
                    params: [
                      {
                        kind: "quantity",
                        abiType: "uint256",
                      },
                      {
                        kind: "allowlist",
                        abiType: "uint256",
                      },
                      {
                        kind: "allowlist",
                        abiType: "uint256",
                      },
                      {
                        kind: "allowlist",
                        abiType: "bytes32[]",
                      },
                    ],
                  }
                : {
                    // `purchasePresaleWithRewards`
                    signature: "0xae6e7875",
                    params: [
                      {
                        kind: "quantity",
                        abiType: "uint256",
                      },
                      {
                        kind: "allowlist",
                        abiType: "uint256",
                      },
                      {
                        kind: "allowlist",
                        abiType: "uint256",
                      },
                      {
                        kind: "allowlist",
                        abiType: "bytes32[]",
                      },
                      {
                        kind: "comment",
                        abiType: "string",
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
        maxSupply: toSafeNumber(saleDetails.maxSupply),
        startTime: toSafeTimestamp(saleDetails.presaleStart),
        endTime: toSafeTimestamp(saleDetails.presaleEnd),
        allowlistId: merkleRoot,
      });
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

export const extractByCollectionERC1155 = async (
  collection: string,
  tokenId: string,
  minter?: string
): Promise<CollectionMint[]> => {
  const results: CollectionMint[] = [];

  const c = new Contract(
    collection,
    new Interface([
      "function computeTotalReward(uint256 numTokens) view returns (uint256)",
      "function computeTotalReward(uint256 mintPrice, uint256 numTokens) view returns (uint256)",
      "function getPermissions(uint256 tokenId, address user) view returns (uint256)",
      "function permissions(uint256 tokenId, address user) view returns (uint256)",
      "function mintFee() external view returns(uint256)",
      `function getTokenInfo(uint256 tokenId) view returns (
        (
          string uri,
          uint256 maxSupply,
          uint256 totalMinted
        )
      )`,
      "function contractVersion() view returns (string)",
    ]),
    baseProvider
  );

  let contractVersion: string | undefined;
  try {
    contractVersion = await c.contractVersion();
  } catch {
    // Skip errors
  }

  const isNewVersion = contractVersion && semver.gt(contractVersion, "2.10.1");

  try {
    let totalRewards: BigNumber | undefined;
    try {
      totalRewards = await c["computeTotalReward(uint256)"](1);
    } catch {
      // Skip error for old version
    }
    try {
      totalRewards = await c["computeTotalReward(uint256,uint256)"](bn(10).pow(18), 1);
    } catch {
      // Skip error for old version
    }

    const defaultMinters: string[] = minter ? [minter] : [];
    for (const factory of [
      Sdk.Zora.Addresses.ERC1155Factory[config.chainId],
      Sdk.Zora.Addresses.ERC1155FactoryV2[config.chainId],
    ]) {
      try {
        const zoraFactory = new Contract(
          factory,
          new Interface(["function defaultMinters() view returns (address[])"]),
          baseProvider
        );
        defaultMinters.push(...(await zoraFactory.defaultMinters()));
      } catch {
        // Skip errors
      }
    }

    // Some known minters
    for (const minter of [
      Sdk.Zora.Addresses.ERC1155ZoraMerkleMinter[config.chainId],
      Sdk.Zora.Addresses.ERC1155ZoraFixedPriceEMinter[config.chainId],
      Sdk.Zora.Addresses.ZoraTimedSaleStrategy[config.chainId],
    ]) {
      if (minter) {
        defaultMinters.push(minter);
      }
    }

    for (const minter of defaultMinters) {
      // Try both `getPermissions` and `permissions` to cover as many versions as possible
      const permissionsForToken = await c
        .getPermissions(tokenId, minter)
        .catch(() => c.permissions(tokenId, minter));
      const permissionsForContract = await c.permissions(0, minter).catch(() => bn(0));

      // Need to have mint permissions
      if (permissionsForToken.toNumber() === 4 || permissionsForContract.toNumber() === 4) {
        const s = new Contract(
          minter,
          new Interface(["function contractName() external view returns (string memory)"]),
          baseProvider
        );

        let mintFee = bn(0);
        try {
          mintFee = await c.mintFee();
        } catch {
          // Skip errors
          mintFee = bn("700000000000000");
          totalRewards = bn("700000000000000");
        }

        const contractName = await s.contractName();
        if (contractName === "Fixed Price Sale Strategy") {
          const fixedSale = new Contract(
            minter,
            new Interface([
              `function sale(address tokenContract, uint256 tokenId) view returns (
                (
                  uint64 saleStart,
                  uint64 saleEnd,
                  uint64 maxTokensPerAddress,
                  uint96 pricePerToken,
                  address fundsRecipient
                )
              )`,
            ]),
            baseProvider
          );

          const [saleConfig, tokenInfo] = await Promise.all([
            fixedSale.sale(collection, tokenId),
            c.getTokenInfo(tokenId),
          ]);

          const price = saleConfig.pricePerToken.add(mintFee).toString();

          let mintTx: MintTxSchema = {
            to: collection,
            data: {
              // `mintWithRewards`
              signature: "0x9dbb844d",
              params: [
                {
                  kind: "unknown",
                  abiType: "address",
                  abiValue: minter.toLowerCase(),
                },
                {
                  kind: "unknown",
                  abiType: "uint256",
                  abiValue: tokenId,
                },
                {
                  kind: "quantity",
                  abiType: "uint256",
                },
                {
                  kind: "custom",
                  abiType: "bytes",
                },
                {
                  kind: "referrer",
                  abiType: "address",
                },
              ],
            },
          };

          if (!totalRewards) {
            mintTx = {
              to: collection,
              data: {
                // `mint`
                signature: "0x731133e9",
                params: [
                  {
                    kind: "unknown",
                    abiType: "address",
                    abiValue: minter.toLowerCase(),
                  },
                  {
                    kind: "unknown",
                    abiType: "uint256",
                    abiValue: tokenId,
                  },
                  {
                    kind: "quantity",
                    abiType: "uint256",
                  },
                  {
                    kind: "custom",
                    abiType: "bytes",
                  },
                ],
              },
            };
          }

          if (isNewVersion) {
            mintTx = {
              to: collection,
              data: {
                // `mint`
                signature: "0x359f1302",
                params: [
                  {
                    kind: "unknown",
                    abiType: "address",
                    abiValue: minter.toLowerCase(),
                  },
                  {
                    kind: "unknown",
                    abiType: "uint256",
                    abiValue: tokenId,
                  },
                  {
                    kind: "quantity",
                    abiType: "uint256",
                  },
                  {
                    kind: "unknown",
                    abiType: "address[]",
                    abiValue: [],
                  },
                  {
                    kind: "custom",
                    abiType: "bytes",
                  },
                ],
              },
            };
          }

          results.push({
            collection,
            contract: collection,
            stage: "public-sale",
            kind: "public",
            status: "open",
            standard: STANDARD,
            details: {
              tx: mintTx,
              info: minter ? { minter } : undefined,
            },
            tokenId,
            currency: Sdk.Common.Addresses.Native[config.chainId],
            price,
            maxMintsPerWallet: toSafeNumber(saleConfig.maxTokensPerAddress),
            maxSupply: toSafeNumber(tokenInfo.maxSupply),
            startTime: toSafeTimestamp(saleConfig.saleStart),
            endTime: toSafeTimestamp(saleConfig.saleEnd),
          });
        } else if (contractName === "Merkle Tree Sale Strategy") {
          const merkleSale = new Contract(
            minter,
            new Interface([
              `function sale(address tokenContract, uint256 tokenId) view returns (
                (
                  uint64 presaleStart,
                  uint64 presaleEnd,
                  address fundsRecipient,
                  bytes32 merkleRoot
                )
              )`,
            ]),
            baseProvider
          );

          const [saleConfig, tokenInfo] = await Promise.all([
            merkleSale.sale(collection, tokenId),
            c.getTokenInfo(tokenId),
          ]);

          const merkleRoot = merkleSale.merkleRoot;
          if (!(await allowlistExists(merkleRoot))) {
            await axios
              .get(`https://allowlist.zora.co/allowlist/${merkleRoot}`)
              .then(({ data }) => data)
              .then(
                async (data: {
                  entries: { user: string; price: string; maxCanMint: number }[];
                }) => {
                  return data.entries.map(
                    (e) =>
                      ({
                        address: e.user,
                        maxMints: String(e.maxCanMint),
                        // price = on-chain-price
                        price: e.price,
                        // actualPrice = on-chain-price + fee
                        actualPrice: bn(e.price).add(mintFee).toString(),
                      } as AllowlistItem)
                  );
                }
              )
              .then((items) => createAllowlist(merkleRoot, items));
          }

          results.push({
            collection,
            contract: collection,
            stage: "presale",
            kind: "allowlist",
            status: "open",
            standard: STANDARD,
            details: {
              tx: {
                to: collection,
                data:
                  totalRewards == undefined
                    ? {
                        // `mint`
                        signature: "0x731133e9",
                        params: [
                          {
                            kind: "unknown",
                            abiType: "address",
                            abiValue: minter.toLowerCase(),
                          },
                          {
                            kind: "unknown",
                            abiType: "uint256",
                            abiValue: tokenId.toString(),
                          },
                          {
                            kind: "quantity",
                            abiType: "uint256",
                          },
                          {
                            kind: "allowlist",
                            abiType: "bytes",
                          },
                        ],
                      }
                    : {
                        // `mintWithRewards`
                        signature: "0x9dbb844d",
                        params: [
                          {
                            kind: "unknown",
                            abiType: "address",
                            abiValue: minter.toLowerCase(),
                          },
                          {
                            kind: "unknown",
                            abiType: "uint256",
                            abiValue: tokenId.toString(),
                          },
                          {
                            kind: "quantity",
                            abiType: "uint256",
                          },
                          {
                            kind: "allowlist",
                            abiType: "bytes",
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
            maxSupply: toSafeNumber(tokenInfo.maxSupply),
            startTime: toSafeTimestamp(saleConfig.presaleStart),
            endTime: toSafeTimestamp(saleConfig.presaleEnd),
            allowlistId: merkleRoot,
          });
        } else if (contractName === "ERC20 Minter") {
          const erc20Minter = new Contract(
            minter,
            new Interface([
              `function sale(address tokenContract, uint256 tokenId) view returns (
                (
                  uint64 saleStart,
                  uint64 saleEnd,
                  uint64 maxTokensPerAddress,
                  uint96 pricePerToken,
                  address fundsRecipient,
                  address currency
                )
              )`,
            ]),
            baseProvider
          );

          const [saleConfig, tokenInfo] = await Promise.all([
            erc20Minter.sale(collection, tokenId),
            c.getTokenInfo(tokenId),
          ]);

          const currency = saleConfig.currency.toLowerCase();

          // No need to include the mint fee
          const price = saleConfig.pricePerToken.toString();

          results.push({
            collection,
            contract: collection,
            stage: "public-sale",
            kind: "public",
            status: "open",
            standard: STANDARD,
            details: {
              tx: {
                to: minter,
                data: {
                  // `mint`
                  signature: "0xf54f216a",
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
                      abiValue: collection,
                    },
                    {
                      kind: "unknown",
                      abiType: "uint256",
                      abiValue: tokenId,
                    },
                    {
                      kind: "price",
                      abiType: "uint256",
                    },
                    {
                      kind: "unknown",
                      abiType: "address",
                      abiValue: currency,
                    },
                    {
                      kind: "referrer",
                      abiType: "address",
                    },
                    {
                      kind: "comment",
                      abiType: "string",
                    },
                  ],
                },
              },
              info: minter ? { minter } : undefined,
            },
            tokenId,
            currency,
            price,
            maxMintsPerWallet: toSafeNumber(saleConfig.maxTokensPerAddress),
            maxSupply: toSafeNumber(tokenInfo.maxSupply),
            startTime: toSafeTimestamp(saleConfig.saleStart),
            endTime: toSafeTimestamp(saleConfig.saleEnd),
          });
        } else if (contractName === "Zora Timed Sale Strategy") {
          const timedSale = new Contract(
            minter,
            new Interface([
              `function sale(address tokenContract, uint256 tokenId) view returns (
                (
                  address payable erc20zAddress,
                  uint64 saleStart,
                  address poolAddress,
                  uint64 saleEnd,
                  bool secondaryActivated
                )
              )`,
            ]),
            baseProvider
          );

          // https://github.com/ourzora/zora-protocol/blob/0e99ffb6b3f1a5cc11eca3b8cfd5911826fa0dc7/packages/erc20z/src/minter/ZoraTimedSaleStrategyConstants.sol#L32
          const price = parseEther("0.000111").toString();
          const saleConfig = await timedSale.sale(collection, tokenId);

          results.push({
            collection,
            contract: collection,
            stage: "public-sale",
            kind: "public",
            status: "open",
            standard: STANDARD,
            details: {
              tx: {
                to: minter,
                data: {
                  // `mint`
                  signature: "0xa836f32f",
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
                      abiValue: collection,
                    },
                    {
                      kind: "unknown",
                      abiType: "uint256",
                      abiValue: tokenId,
                    },
                    {
                      kind: "referrer",
                      abiType: "address",
                    },
                    {
                      kind: "comment",
                      abiType: "string",
                    },
                  ],
                },
              },
              info: minter ? { minter } : undefined,
            },
            tokenId,
            currency: Sdk.Common.Addresses.Native[config.chainId],
            price,
            startTime: toSafeTimestamp(saleConfig.saleStart),
            endTime: toSafeTimestamp(saleConfig.saleEnd),
          });
        }

        break;
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

export const extractByTx = async (
  collection: string,
  rootTx: Transaction
): Promise<CollectionMint[]> => {
  try {
    const nestedTxs: Transaction[] = [rootTx];

    const isMulticall = rootTx.data.startsWith("0xac9650d8");
    if (isMulticall) {
      try {
        const multicall = new Interface(["function multicall(bytes[] calls)"]).decodeFunctionData(
          "multicall",
          rootTx.data
        );

        for (const call of multicall.calls) {
          nestedTxs.push({
            ...rootTx,
            data: call,
          });
        }
      } catch {
        // Skip errors
      }
    }

    for (const tx of nestedTxs) {
      // ERC721
      if (
        [
          "0xefef39a1", // `purchase`
          "0x03ee2733", // `purchaseWithComment`
          "0x25024a2b", // `purchasePresale`
          "0x2e706b5a", // `purchasePresaleWithComment`
          "0x45368181", // `mintWithRewards`
          "0xae6e7875", // `purchasePresaleWithRewards`
        ].some((bytes4) => tx.data.startsWith(bytes4))
      ) {
        return extractByCollectionERC721(collection);
      }

      // ERC1155
      if (
        [
          "0x731133e9", // `mint`
          "0x359f1302", // `mint`
          "0xf54f216a", // `ERC20Minter.mint`,
          "0x9dbb844d", // `mintWithRewards`
          "0x0a8945df", // `premint`
          "0xd904b94a", // `callSale`
          "0xa836f32f", // `mint`
        ].some((bytes4) => tx.data.startsWith(bytes4))
      ) {
        const iface = new Interface([
          "function mint(address minter, uint256 tokenId, uint256 quantity, bytes data)",
          "function mint(address minter, uint256 tokenId, uint256 quantity, address[] rewardsRecipients, bytes data)",
          "function mint(address mintTo, uint256 quantity, address collection, uint256 tokenId, address mintReferral, string comment)",
          "function mintWithRewards(address minter, uint256 tokenId, uint256 quantity, bytes minterArguments, address mintReferral)",
          "function premint((address, string, string, address[]) contractConfig, address premintCollection, (uint32, uint32, bool, bytes, bytes32) encodedPremintConfig, bytes signature, uint256 quantityToMint, (address, string, address[]) mintArguments, address firstMinter, address signerContract)",
          "function callSale(uint256 tokenId, address salesConfig, bytes data)",
          "function mint(address mintTo, uint256 quantity, address tokenAddress, uint256 tokenId, uint256 totalValue, address currency, address mintReferral, string comment)",
        ]);

        let tokenId: string;
        let minter: string | undefined;
        switch (tx.data.slice(0, 10)) {
          case "0x731133e9": {
            tokenId = iface
              .decodeFunctionData(
                "mint(address minter, uint256 tokenId, uint256 quantity, bytes data)",
                tx.data
              )
              .tokenId.toString();
            break;
          }

          case "0x359f1302": {
            tokenId = iface
              .decodeFunctionData(
                "mint(address minter, uint256 tokenId, uint256 quantity, address[] rewardsRecipients, bytes data)",
                tx.data
              )
              .tokenId.toString();
            break;
          }

          case "0xa836f32f": {
            tokenId = new Interface([
              `function mint(address mintTo, uint256 quantity, address collection, uint256 tokenId, address mintReferral, string comment)`,
            ])
              .decodeFunctionData("mint", tx.data)
              .tokenId.toString();
            minter = tx.to;
            break;
          }

          case "0x9dbb844d": {
            const parseArgs = iface.decodeFunctionData("mintWithRewards", tx.data);
            tokenId = parseArgs.tokenId.toString();
            minter = parseArgs.minter.toLowerCase();
            break;
          }

          case "0xd904b94a": {
            tokenId = iface.decodeFunctionData("callSale", tx.data).tokenId.toString();
            break;
          }

          case "0xf54f216a": {
            minter = tx.to;
            tokenId = iface
              .decodeFunctionData(
                "mint(address mintTo, uint256 quantity, address tokenAddress, uint256 tokenId, uint256 totalValue, address currency, address mintReferral, string comment)",
                tx.data
              )
              .tokenId.toString();
            break;
          }

          case "0x0a8945df": {
            const contract = new Contract(
              collection,
              new Interface(["function delegatedTokenId(uint32 uid) view returns (uint256)"]),
              baseProvider
            );
            const uid = iface.decodeFunctionData(
              "premint((address, string, string, address[]) contractConfig, address premintCollection, (uint32 tokenId, uint32, bool, bytes, bytes32) encodedPremintConfig, bytes signature, uint256 quantityToMint, (address, string, address[]) mintArguments, address firstMinter, address signerContract)",
              tx.data
            ).encodedPremintConfig[0];
            tokenId = await contract.delegatedTokenId(uid).then((r: BigNumber) => r.toString());
            break;
          }
        }

        return extractByCollectionERC1155(collection, tokenId!, minter);
      }
    }
  } catch {
    // Skip errors
  }

  return [];
};

export const refreshByCollection = async (collection: string) => {
  const existingCollectionMints = await getCollectionMints(collection, {
    standard: STANDARD,
  });

  const refresh = async (tokenId?: string, minter?: string) => {
    // Fetch and save/update the currently available mints
    const latestCollectionMints = tokenId
      ? await extractByCollectionERC1155(collection, tokenId, minter)
      : await extractByCollectionERC721(collection);

    // Make sure to include any premints as well
    latestCollectionMints.push(
      ...(await fetchPremints(collection).then((premints) =>
        convertPremintsToCollectionMint(premints)
      ))
    );

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
    await Promise.all(
      existingCollectionMints.map(async ({ tokenId, details }) =>
        refresh(tokenId, (details.info as Info | undefined)?.minter)
      )
    );
  }
};

type ProofValue = {
  proof: string[];
  user: string;
  price: string;
  maxCanMint: number;
};

export const generateProofValue = async (
  collectionMint: CollectionMint,
  address: string
): Promise<ProofValue> => {
  const cacheKey = `${collectionMint.collection}-${collectionMint.stage}-${collectionMint.tokenId}-${address}`;

  let result: ProofValue = await redis
    .get(cacheKey)
    .then((response) => (response ? JSON.parse(response) : undefined));
  if (!result) {
    result = await axios
      .get(`https://allowlist.zora.co/allowed?user=${address}&root=${collectionMint.allowlistId}`)
      .then(({ data }: { data: ProofValue[] }) => {
        data[0].proof = data[0].proof.map((item) => `0x${item}`);
        return data[0];
      });

    if (result) {
      await redis.set(cacheKey, JSON.stringify(result), "EX", 3600);
    }
  }

  return result;
};

// Handling of premints

export type Premint = {
  contract_address: string;
  contract_admin: string;
  contract_uri: string;
  contract_name: string;
  premint: {
    config_version: string;
    tokenConfig: {
      tokenURI: string;
      maxSupply: string;
      maxTokensPerAddress: number;
      pricePerToken: number;
      mintStart: number;
      mintDuration: number;
      royaltyBPS: number;
      payoutRecipient: string;
      fixedPriceMinter: string;
      createReferral: string;
    };
    uid: number;
    version: number;
    deleted: boolean;
    signature: string;
  };
};

export const getNetworkName = (chainId: number) => {
  if (chainId === 1) {
    return "ETHEREUM-MAINNET";
  } else if (chainId === 10) {
    return "OPTIMISM-MAINNET";
  } else if (chainId === 8453) {
    return "BASE-MAINNET";
  } else if (chainId === 84532) {
    return "BASE-SEPOLIA";
  } else if (chainId === 7777777) {
    return "ZORA-MAINNET";
  }

  return null;
};

export const fetchPremints = async (contract?: string) => {
  // Ensure the `Preminter` contract is available
  // if (!Sdk.Zora.Addresses.Preminter[config.chainId]) {
  //   return [];
  // }
  let data: Premint[];

  try {
    const network = getNetworkName(config.chainId);

    if (contract) {
      data = await axios
        .get(`${ZORA_ENDPOINT}/premint/signature/${network}/${contract}`)
        .then((response) => {
          return response.data.premints.map(
            (p: Premint["premint"]) =>
              ({
                contract_address: response.data.contract_address,
                contract_admin: response.data.contract_admin,
                contract_uri: response.data.contract_uri,
                contract_name: response.data.contract_name,
                premint: p,
              } as Premint)
          );
        });
    } else {
      const contracts = await axios
        .get(`${ZORA_ENDPOINT}/discover/premints/${network}?limit=50&sort_direction=DESC`)
        .then((response) =>
          (response.data.data as { contract_address: string }[]).map((c) => c.contract_address)
        );
      data = _.flatten(
        await Promise.all(_.uniq(contracts).map((contract) => fetchPremints(contract)))
      );
    }
  } catch {
    return [];
  }

  return data;
};

export const convertPremintsToCollectionMint = async (premints: Premint[]) => {
  const results: CollectionMint[] = [];

  for (const premint of premints) {
    try {
      const collection = premint.contract_address.toLowerCase();

      const c = new Contract(
        Sdk.Zora.Addresses.Preminter[config.chainId],
        new Interface([
          "function mintFee(address collectionAddress) external view returns (uint256)",
        ]),
        baseProvider
      );

      const mintFee = await c.mintFee(collection);

      const hashedVersion = keccak256(Buffer.from(premint.premint.config_version, "utf8"));
      const tokenConfig = premint.premint.tokenConfig;

      const startTime = toSafeTimestamp(tokenConfig.mintStart);
      let endTime;

      if (!startTime) {
        await mints.getCollectionMints(collection, {
          status: "open",
          tokenId: premint.premint.uid.toString(),
          stage: "public-sale",
        });

        endTime = toSafeTimestamp(Math.floor(Date.now() / 1000) + tokenConfig.mintDuration);
      } else {
        endTime = toSafeTimestamp(tokenConfig.mintStart + tokenConfig.mintDuration);
      }

      const price = bn(tokenConfig.pricePerToken).add(mintFee).toString();
      results.push({
        collection,
        contract: collection,
        tokenId: premint.premint.uid.toString(),
        stage: "public-sale",
        kind: "public",
        status: "open",
        standard: STANDARD,
        details: {
          tx: {
            to: Sdk.Zora.Addresses.Preminter[config.chainId],
            data: {
              // `premint`
              signature: "0x0a8945df",
              params: [
                {
                  kind: "tuple",
                  params: [
                    {
                      kind: "unknown",
                      abiType: "address",
                      abiValue: premint.contract_admin,
                    },
                    {
                      kind: "unknown",
                      abiType: "string",
                      abiValue: premint.contract_uri,
                    },
                    {
                      kind: "unknown",
                      abiType: "string",
                      abiValue: premint.contract_name,
                    },
                    {
                      kind: "unknown",
                      abiType: "address[]",
                      // This seems to be the Zora admin address
                      abiValue: ["0xa14731e7d05e7e83a18019ec049d99fb096a7027"],
                    },
                  ],
                },
                {
                  kind: "unknown",
                  abiType: "address",
                  abiValue: AddressZero,
                },
                {
                  kind: "tuple",
                  params: [
                    {
                      kind: "unknown",
                      abiType: "uint32",
                      abiValue: premint.premint.uid,
                    },
                    {
                      kind: "unknown",
                      abiType: "uint32",
                      abiValue: premint.premint.version,
                    },
                    {
                      kind: "unknown",
                      abiType: "bool",
                      abiValue: premint.premint.deleted,
                    },
                    {
                      kind: "unknown",
                      abiType: "bytes",
                      abiValue:
                        premint.premint.config_version === "1"
                          ? defaultAbiCoder.encode(
                              [
                                `(
                                  string,
                                  uint256,
                                  uint64,
                                  uint96,
                                  uint64,
                                  uint64,
                                  uint32,
                                  uint32,
                                  address,
                                  address
                                )`,
                              ],
                              [
                                [
                                  tokenConfig.tokenURI,
                                  tokenConfig.maxSupply,
                                  tokenConfig.maxTokensPerAddress,
                                  tokenConfig.pricePerToken,
                                  tokenConfig.mintStart,
                                  tokenConfig.mintDuration,
                                  0,
                                  tokenConfig.royaltyBPS,
                                  tokenConfig.payoutRecipient,
                                  tokenConfig.fixedPriceMinter,
                                ],
                              ]
                            )
                          : defaultAbiCoder.encode(
                              [
                                `(
                                  string,
                                  uint256,
                                  uint64,
                                  uint96,
                                  uint64,
                                  uint64,
                                  uint32,
                                  address,
                                  address,
                                  address                          
                                )`,
                              ],
                              [
                                [
                                  tokenConfig.tokenURI,
                                  tokenConfig.maxSupply,
                                  tokenConfig.maxTokensPerAddress,
                                  tokenConfig.pricePerToken,
                                  tokenConfig.mintStart,
                                  tokenConfig.mintDuration,
                                  tokenConfig.royaltyBPS,
                                  tokenConfig.payoutRecipient,
                                  tokenConfig.fixedPriceMinter,
                                  tokenConfig.createReferral,
                                ],
                              ]
                            ),
                    },
                    {
                      kind: "unknown",
                      abiType: "bytes32",
                      abiValue: hashedVersion,
                    },
                  ],
                },
                {
                  kind: "unknown",
                  abiType: "bytes",
                  abiValue: premint.premint.signature,
                },
                {
                  kind: "quantity",
                  abiType: "uint256",
                },
                {
                  kind: "tuple",
                  params: [
                    {
                      kind: "recipient",
                      abiType: "address",
                    },
                    {
                      kind: "comment",
                      abiType: "string",
                    },
                    {
                      kind: "unknown",
                      abiType: "address[]",
                      abiValue: [],
                    },
                  ],
                },
                {
                  kind: "recipient",
                  abiType: "address",
                },
                {
                  kind: "unknown",
                  abiType: "address",
                  abiValue: AddressZero,
                },
              ],
            },
          },
        },
        currency: Sdk.Common.Addresses.Native[config.chainId],
        price,
        maxMintsPerWallet: toSafeNumber(tokenConfig.maxTokensPerAddress),
        maxSupply: toSafeNumber(tokenConfig.maxSupply),
        startTime,
        endTime,
      });
    } catch {
      // Skip errors
    }
  }

  return results;
};
