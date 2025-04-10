import { Common } from "@reservoir0x/sdk";

import { bn } from "@/common/utils";
import { config } from "@/config/index";
import { getEventData } from "@/events-sync/data";
import { EnhancedEvent, OnChainData } from "@/events-sync/handlers/utils";
import * as utils from "@/events-sync/utils";
import * as zoraMarkets from "@/models/zora-pools";
import * as zoraV4 from "@/orderbook/orders/zora-v4";
import { getUSDAndNativePrices } from "@/utils/prices";
import * as zoraUtils from "@/utils/zora";

export const handleEvents = async (events: EnhancedEvent[], onChainData: OnChainData) => {
  const nftToKind: Map<string, "erc721" | "erc1155"> = new Map();

  // Handle the events
  for (const { kind, subKind, baseEventParams, log } of events) {
    if (kind === "erc721") {
      nftToKind.set(baseEventParams.address.toLowerCase(), "erc721");
    } else if (kind === "erc1155") {
      nftToKind.set(baseEventParams.address.toLowerCase(), "erc1155");
    }

    const eventData = getEventData([subKind])[0];

    switch (subKind) {
      case "zora-sales-config-changed": {
        onChainData.mints.push({
          by: "collection",
          data: {
            standard: "zora",
            collection: baseEventParams.address,
          },
        });

        break;
      }

      case "zora-timed-sale-strategy-rewards": {
        const { args } = eventData.abi.parseLog(log);
        onChainData.mints.push({
          by: "collection",
          data: {
            standard: "zora",
            collection: args["collection"].toLowerCase(),
            tokenId: args["tokenId"].toString(),
          },
        });

        break;
      }

      case "zora-updated-token": {
        const { args } = eventData.abi.parseLog(log);
        onChainData.mints.push({
          by: "collection",
          data: {
            standard: "zora",
            collection: baseEventParams.address,
            tokenId: args["tokenId"].toString(),
          },
        });

        break;
      }

      case "zora-custom-mint-comment":
      case "zora-mint-comment": {
        const { args } = eventData.abi.parseLog(log);
        const token = args["tokenContract"].toLowerCase();
        const comment = args["comment"];
        const quantity = args["quantity"].toString();

        // One mint comment for every individual ERC721 quantity
        const quantityForIteration = nftToKind.get(token) === "erc721" ? Number(quantity) : 1;
        if (subKind === "zora-custom-mint-comment") {
          for (let i = 0; i < quantityForIteration; i++) {
            onChainData.mintComments.push({
              token,
              quantity,
              comment,
              baseEventParams,
            });
          }
        } else {
          const firstMintedTokenId = args["tokenId"];
          for (let i = 0; i < quantityForIteration; i++) {
            const tokenId = firstMintedTokenId.add(i + 1);
            onChainData.mintComments.push({
              token,
              tokenId: tokenId.toString(),
              quantity,
              comment,
              baseEventParams,
            });
          }
        }

        break;
      }

      case "zora-timed-sale-set-v2":
      case "zora-timed-sale-set":
      case "zora-erc20-sale-set":
      case "zora-merkle-sale-set":
      case "zora-fixed-price-sale-set": {
        const { args } = eventData.abi.parseLog(log);
        const minter = baseEventParams.address.toLowerCase();
        onChainData.mints.push({
          by: "collection",
          data: {
            standard: "zora",
            collection: args["collection"].toLowerCase(),
            tokenId: args["tokenId"].toString(),
            additionalInfo: {
              minter,
            },
          },
        });

        break;
      }

      case "zora-secondary-market-activated": {
        const erc20z = baseEventParams.address.toLowerCase();

        const market = await zoraUtils.getMarketDetails(erc20z);
        if (market) {
          onChainData.orders.push({
            kind: "zora-v4",
            info: {
              orderParams: {
                pool: erc20z,
                txHash: baseEventParams.txHash,
                txTimestamp: baseEventParams.timestamp,
                txBlock: baseEventParams.block,
                logIndex: baseEventParams.logIndex,
                amount: 0,
                tokenId: market.tokenId,
              },
              metadata: {},
            },
          });
        }

        break;
      }

      case "zora-swap": {
        const erc20z = baseEventParams.address.toLowerCase();

        const market = await zoraMarkets.getMarketByPool(erc20z);
        if (!market) {
          break;
        }

        // Refresh order after each swap/transfer
        const existOrder = onChainData.orders.find(
          (c) => c.kind === "zora-v4" && c.info.orderParams.pool == market.address
        );
        if (!existOrder) {
          onChainData.orders.push({
            kind: "zora-v4",
            info: {
              orderParams: {
                pool: market.address,
                txHash: baseEventParams.txHash,
                txTimestamp: baseEventParams.timestamp,
                txBlock: baseEventParams.block,
                logIndex: baseEventParams.logIndex,
                amount: 0,
                tokenId: market.tokenId,
              },
              metadata: {},
            },
          });
        }

        break;
      }

      case "zora-secondary-sell":
      case "zora-secondary-buy": {
        const { args } = eventData.abi.parseLog(log);
        const taker = args["msgSender"].toLowerCase();
        const erc20zAddress = args["erc20zAddress"].toLowerCase();
        const totalPrice = args["totalPirce"].toString();
        const amount = args["amount"].toString();
        const price = bn(totalPrice).div(amount).toString();

        const market = await zoraUtils.getMarketDetails(erc20zAddress);
        if (!market) {
          break;
        }

        // Handle: attribution
        const isBuy = subKind.includes("-buy");
        const orderSide = isBuy ? "sell" : "buy";
        const orderId = zoraV4.getOrderId(erc20zAddress, isBuy ? "sell" : "buy", market.tokenId);

        const orderKind = "zora-v4";
        const data = await utils.extractAttributionData(baseEventParams.txHash, orderKind, {
          orderId,
        });

        // Handle: prices
        const tokenContract = market.collection;
        const tokenId = market.tokenId;

        const currency = Common.Addresses.Native[config.chainId];
        const prices = await getUSDAndNativePrices(currency, price, baseEventParams.timestamp);
        if (!prices.nativePrice) {
          // We must always have the native price
          break;
        }

        onChainData.fillEventsOnChain.push({
          orderKind,
          orderId,
          currency,
          orderSide,
          maker: market.pool,
          taker,
          price: prices.nativePrice,
          currencyPrice: price,
          usdPrice: prices.usdPrice,
          contract: tokenContract,
          tokenId,
          amount,
          orderSourceId: data.orderSource?.id,
          aggregatorSourceId: data.aggregatorSource?.id,
          fillSourceId: data.fillSource?.id,
          baseEventParams,
        });

        onChainData.fillInfos.push({
          context: `zora-${tokenContract}-${tokenId}-${baseEventParams.txHash}`,
          orderSide,
          contract: tokenContract,
          tokenId,
          amount,
          price: prices.nativePrice,
          timestamp: baseEventParams.timestamp,
          maker: market.pool,
          taker,
        });

        break;
      }
    }
  }
};
